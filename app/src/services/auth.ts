import {
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  createUserWithEmailAndPassword,
  getAuth,
  sendPasswordResetEmail,
} from "firebase/auth";
import type { User } from "firebase/auth";
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, orderBy } from "firebase/firestore";
import { initializeApp, deleteApp } from "firebase/app";
import { auth, db, firebaseConfig } from "./firebase";

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
}

export async function criarNovoUsuario(email: string, senhaTemp: string, role: string, nome: string): Promise<void> {
  invalidarCacheUsuarios();
  const tempAppName = `temp-register-${Date.now()}`;
  const tempApp = initializeApp(firebaseConfig, tempAppName);
  const tempAuth = getAuth(tempApp);

  try {
    const userCredential = await createUserWithEmailAndPassword(tempAuth, email, senhaTemp);
    const uid = userCredential.user.uid;

    await setDoc(doc(db, COLLECTION_USUARIOS, uid), {
      email,
      role,
      needsPasswordChange: true,
      nome,
      createdAt: Date.now()
    });

    await signOut(tempAuth);
  } finally {
    await deleteApp(tempApp);
  }
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


