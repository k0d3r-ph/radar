import {
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  sendPasswordResetEmail,
} from "firebase/auth";
import type { User } from "firebase/auth";
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, orderBy } from "firebase/firestore";
import { auth, db } from "./firebase";
import { RADAR_API_URL } from "./apiConfig.ts";

const COLLECTION_USUARIOS = "usuarios";

export async function loginComEmail(email: string, senhaParticular: string) {
  const userCredential = await signInWithEmailAndPassword(
    auth,
    email,
    senhaParticular,
  );
  return userCredential.user;
}

export async function deslogarUsuario() {
  await signOut(auth);
}

export async function atualizarSenhaUsuario(user: User, novaSenha: string) {
  await updatePassword(user, novaSenha);
}

export async function verificarPrimeiroAcesso(uid: string): Promise<boolean> {
  try {
    const userDocRef = doc(db, COLLECTION_USUARIOS, uid);
    const userDoc = await getDoc(userDocRef);

    if (!userDoc.exists()) {
      // Documento não existe no Firestore: é primeiro acesso/senha temporária
      return true;
    }

    const data = userDoc.data();
    return !!data?.needsPasswordChange;
  } catch (error) {
    console.error("Erro ao verificar primeiro acesso no Firestore:", error);
    // Em caso de erro de permissão (por exemplo, antes de cadastrar a primeira senha),
    // podemos retornar true se o doc não puder ser lido, mas para ser seguro
    // assumimos que precisa trocar a senha se não conseguirmos validar o doc.
    return true;
  }
}

export async function registrarSenhaDefinida(
  uid: string,
  email: string,
  role: string,
  nome: string,
) {
  invalidarCacheUsuarios();
  const userDocRef = doc(db, COLLECTION_USUARIOS, uid);
  await setDoc(
    userDocRef,
    {
      email,
      role,
      nome,
      needsPasswordChange: false,
      updatedAt: Date.now(),
    },
    { merge: true },
  );
}

export type CargoCsUsuario = "supervisor" | "analista" | "comercial" | "";

export interface UsuarioDocument {
  uid: string;
  email: string;
  role: string;
  nome: string;
  needsPasswordChange: boolean;
  createdAt?: number;
  cargo?: CargoCsUsuario;
  telefone?: string;
  /**
   * Fator de capacidade do treinador, usado na distribuição do próximo cliente.
   * Multiplica o peso de cada cliente ativo sob sua responsabilidade: acima de 1
   * cada cliente pesa mais (menos capacidade), abaixo de 1 pesa menos.
   */
  fatorCapacidade?: number;
  /**
   * Quando true, o treinador fica fora da fila de distribuição de "Próximo cliente"
   * (ex.: férias, afastamento), sem precisar remover o usuário do sistema.
   */
  suspensoDistribuicao?: boolean;
  /**
   * Habilitação por tipo de mensagem de gestão via WhatsApp (Suspenso, Alerta, Cancelado,
   * Conclusão). Quando o campo está ausente (`undefined`), o tipo é considerado habilitado —
   * só fica desabilitado quando o próprio usuário/admin desmarca explicitamente (`false`).
   * Vale para quem se qualifica para receber notificações de gestão: cargo Supervisor
   * (todos os clientes), role "master" (todos os clientes, mesmo tratamento do Supervisor),
   * cargo/role CS e cargo/role Comercial (apenas os clientes de sua responsabilidade).
   */
  notificarSuspenso?: boolean;
  notificarAlerta?: boolean;
  notificarCancelado?: boolean;
  notificarConclusao?: boolean;
  /**
   * Quando true, o usuário está inativado: não consegue mais entrar no Radar
   * (ver checagem em AuthContext/Login) e some das listas de seleção para
   * novos cadastros (responsável, CS, comercial). Registros antigos já
   * vinculados a ele permanecem intactos e continuam aparecendo em filtros
   * e tabulações existentes.
   */
  inativo?: boolean;
}

/** Chama a gestão de usuários da API (treinador e master); devolve o corpo ou lança a mensagem do servidor. */
async function chamarGestaoUsuarios(caminho: string, init: RequestInit): Promise<{ uid?: string }> {
  if (!auth.currentUser) throw new Error("Entre novamente no Radar.");
  const token = await auth.currentUser.getIdToken();
  let response: Response;
  try {
    response = await fetch(`${RADAR_API_URL}/api/usuarios${caminho}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error("Não foi possível conectar ao servidor do Radar. Verifique sua conexão e tente novamente.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true) {
    throw new Error(data.error || `O servidor recusou a operação (HTTP ${response.status}).`);
  }
  return data;
}

/** Cria a conta pelo servidor: o cadastro público do Firebase Auth fica desativado. Devolve o UID. */
export async function criarNovoUsuario(email: string, senhaTemp: string, role: string, nome: string): Promise<string> {
  invalidarCacheUsuarios();
  const { uid } = await chamarGestaoUsuarios("", {
    method: "POST",
    body: JSON.stringify({ email, senhaTemporaria: senhaTemp, role, nome }),
  });
  if (!uid) throw new Error("O servidor não devolveu o identificador do novo usuário.");
  return uid;
}

/** Define uma senha temporária; o usuário troca no próximo acesso. */
export async function redefinirSenhaUsuario(uid: string, novaSenha: string): Promise<void> {
  invalidarCacheUsuarios();
  await chamarGestaoUsuarios(`/${encodeURIComponent(uid)}/redefinir-senha`, {
    method: "POST",
    body: JSON.stringify({ novaSenha }),
  });
}

/** Exclui a conta de acesso e o cadastro; os registros vinculados ao usuário são mantidos. */
export async function excluirUsuario(uid: string): Promise<void> {
  invalidarCacheUsuarios();
  await chamarGestaoUsuarios(`/${encodeURIComponent(uid)}`, { method: "DELETE" });
}

let cachedUsuarios: UsuarioDocument[] | null = null;
let lastFetchUsuarios = 0;
const CACHE_TTL = 300000; // 5 minutos: a lista de usuários é relida a cada consulta após o TTL.

function invalidarCacheUsuarios() {
  cachedUsuarios = null;
  lastFetchUsuarios = 0;
}

export async function listarUsuarios(forceRefresh = false): Promise<UsuarioDocument[]> {
  const now = Date.now();
  if (cachedUsuarios && !forceRefresh && (now - lastFetchUsuarios < CACHE_TTL)) {
    return cachedUsuarios;
  }

  const querySnapshot = await getDocs(query(collection(db, COLLECTION_USUARIOS), orderBy("email")));
  const list: UsuarioDocument[] = [];
  querySnapshot.forEach((doc) => {
    const data = doc.data();
    list.push({
      uid: doc.id,
      email: data.email || "",
      role: data.role || "",
      nome: data.nome || "",
      needsPasswordChange: !!data.needsPasswordChange,
      createdAt: data.createdAt,
      cargo: data.cargo || "",
      telefone: data.telefone || "",
      fatorCapacidade:
        typeof data.fatorCapacidade === "number" ? data.fatorCapacidade : undefined,
      suspensoDistribuicao: !!data.suspensoDistribuicao,
      notificarSuspenso: data.notificarSuspenso,
      notificarAlerta: data.notificarAlerta,
      notificarCancelado: data.notificarCancelado,
      notificarConclusao: data.notificarConclusao,
      inativo: !!data.inativo,
    });
  });

  cachedUsuarios = list;
  lastFetchUsuarios = now;
  return list;
}

export async function removerUsuarioFirestore(uid: string): Promise<void> {
  invalidarCacheUsuarios();
  await deleteDoc(doc(db, COLLECTION_USUARIOS, uid));
}

export async function atualizarRoleUsuario(uid: string, role: string): Promise<void> {
  invalidarCacheUsuarios();
  const userDocRef = doc(db, COLLECTION_USUARIOS, uid);
  await setDoc(userDocRef, { role, updatedAt: Date.now() }, { merge: true });
}

export async function atualizarDadosUsuario(
  uid: string,
  dados: {
    cargo?: string;
    telefone?: string;
    nome?: string;
    fatorCapacidade?: number;
    suspensoDistribuicao?: boolean;
    notificarSuspenso?: boolean;
    notificarAlerta?: boolean;
    notificarCancelado?: boolean;
    notificarConclusao?: boolean;
    inativo?: boolean;
  }
): Promise<void> {
  invalidarCacheUsuarios();
  const userDocRef = doc(db, COLLECTION_USUARIOS, uid);
  // Firestore rejeita valores undefined; só enviamos os campos preenchidos
  const dadosLimpos = Object.fromEntries(
    Object.entries(dados).filter(([, valor]) => valor !== undefined),
  );
  await setDoc(userDocRef, { ...dadosLimpos, updatedAt: Date.now() }, { merge: true });
}

export async function enviarEmailRedefinicaoSenha(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email);
}


