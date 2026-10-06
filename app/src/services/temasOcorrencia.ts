import {
  collection,
  getDocs,
  setDoc,
  getDoc,
  deleteDoc,
  doc,
  query,
  where,
} from "firebase/firestore";
import { db } from "./firebase";

import { TIPOS_PADRAO_SISTEMA, perfisPadraoTema } from "../utils/tabulacoes";
export { TIPOS_PADRAO_SISTEMA, PERFIS_TABULACAO, perfisPadraoTema, temaDisponivelParaPerfil } from "../utils/tabulacoes";

const COLLECTION_TEMAS = "temasOcorrencia";

export type CategoriaTema = "duvida" | "solicitacao" | "tipo" | "pendencia";

// Nomes originais dos tipos de ocorrência do sistema (Informativa, Comercial
// etc.), usados apenas para semear a coleção "temasOcorrencia" (categoria
// "tipo") na primeira consulta. A partir daí o Firestore é a única fonte da
// verdade: todos os tipos — inclusive esses — podem ser livremente criados,
// renomeados ou excluídos pela tela de administração (Master).
//
// Atenção: alguns desses nomes acionam regras de negócio específicas no
// Histórico por comparação exata de string (ex.: "Treinamento" exige cálculo
// de score, "Checkpoint" exige data, "Dúvida"/"Solicitação" exigem assunto).
// Renomear ou excluir um deles remove essa regra especial para o tipo restante
// — ele passa a se comportar como um tipo genérico.
export interface TemaOcorrencia {
  id: string;
  nome: string;
  categoria: CategoriaTema;
  createdAt: number;
  perfisDisponiveis?: string[];
}

export async function atualizarPerfisTema(tema: TemaOcorrencia, perfis: string[]): Promise<void> {
  await setDoc(doc(db, COLLECTION_TEMAS, tema.id), { perfisDisponiveis: perfis }, { merge: true });
  invalidarCacheTemas(tema.categoria);
}

// Listas usadas para popular a coleção na primeira vez que cada categoria é
// consultada (coleção vazia = nunca foi inicializada). Depois disso, a fonte
// da verdade passa a ser inteiramente o Firestore, incluindo remoções.
const SEED_DUVIDA = [
  "Acesso a plataforma",
  "Configurar/apontar câmera",
  "Apontar rastreador tradicional (QS)",
  "Cadastrar cliente",
  "Cadastrar rastreador",
  "Cadastrar veículo",
  "Cadastrar gateway",
  "Cadastrar Chip/operadora",
  "Cadastrar/configurar pessoas",
  "Unidades Organizacional",
  "Debug",
  "Áreas e Rotas",
  "Comandos",
  "Configuração de bloqueio",
  "Rastreador desatualizado",
  "Correção de odômetro/horímetro",
  "Envio de comando",
  "Funções da tela operacional",
  "Chamados",
  "Hardware",
  "Identificação de motorista",
  "Pessoas",
  "Perfil de acesso",
  "Rastreador integrado ao SSX",
  "Regras",
  "Relatório",
  "Templates",
  "Reset de senha",
  "SSX Mobile",
  "SSX Onboard",
  "Desassociar rastreador",
  "Uso de TAGs",
  "Importação de arquivos",
  "Performance",
  "Logistics",
  "Jornada de Trabalho",
  "Videotelemetria",
  "Abastecimento",
  "Manutenção",
  "Gestão de Multas",
];

const SEED_SOLICITACAO = [
  "Mascaramento da URL",
  "Liberação/Exclusão de Gateway",
  "Material de apoio",
  "Troca de email do usuário Admin",
  "Troca de nome da central",
  "Informações ou configurações de API",
  "Exclusão de UR gerada por aplicativo",
  "Antecipação de tema",
  "Sugestão de desenvolvimento",
];

const cachePorCategoria: Record<CategoriaTema, TemaOcorrencia[] | null> = {
  duvida: null,
  solicitacao: null,
  tipo: null,
  pendencia: null,
};
const lastFetchPorCategoria: Record<CategoriaTema, number> = {
  duvida: 0,
  solicitacao: 0,
  tipo: 0,
  pendencia: 0,
};
const CACHE_TTL = 30000; // 30 segundos

function invalidarCacheTemas(categoria: CategoriaTema) {
  cachePorCategoria[categoria] = null;
  lastFetchPorCategoria[categoria] = 0;
}

// ID determinístico (categoria + nome normalizado). Evita duplicatas mesmo
// que a semeadura ou o cadastro rodem duas vezes em paralelo (ex.: efeitos
// duplicados do StrictMode em desenvolvimento, ou duas telas carregando ao
// mesmo tempo): a segunda chamada sempre sobrescreve o mesmo documento.
function gerarIdTema(categoria: CategoriaTema, nome: string): string {
  const slug = nome
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${categoria}__${slug}`;
}

const SEED_TIPO = TIPOS_PADRAO_SISTEMA;

async function semearCategoria(categoria: CategoriaTema): Promise<void> {
  // Os tipos de pendência são definidos pelos masters na tela Tabulações.
  if (categoria === 'pendencia') return;
  const seed =
    categoria === "duvida"
      ? SEED_DUVIDA
      : categoria === "solicitacao"
        ? SEED_SOLICITACAO
        : SEED_TIPO;
  await Promise.all(
    seed.map((nome) =>
      setDoc(
        doc(db, COLLECTION_TEMAS, gerarIdTema(categoria, nome)),
        { nome, categoria, createdAt: Date.now() },
        { merge: true },
      ),
    ),
  );
}

// Remove duplicatas de nome (case-insensitive) dentro de uma categoria,
// mantendo o registro mais antigo. Corrige dados que já ficaram duplicados
// pela semeadura antiga (baseada em addDoc, sem ID determinístico). Se quem
// chamou não tiver permissão de exclusão (não é Master), a tentativa de
// remoção falha silenciosamente e a lista retornada apenas oculta as
// repetições na sessão atual.
async function removerDuplicados(
  docs: { id: string; nome: string; createdAt: number }[],
): Promise<Set<string>> {
  const porChave = new Map<string, { id: string; createdAt: number }[]>();
  docs.forEach((d) => {
    const chave = d.nome.trim().toLowerCase();
    const lista = porChave.get(chave) ?? [];
    lista.push(d);
    porChave.set(chave, lista);
  });

  const idsRemovidos = new Set<string>();
  const remocoes: Promise<void>[] = [];
  porChave.forEach((lista) => {
    if (lista.length <= 1) return;
    lista.sort((a, b) => a.createdAt - b.createdAt);
    lista.slice(1).forEach((d) => {
      idsRemovidos.add(d.id);
      remocoes.push(
        deleteDoc(doc(db, COLLECTION_TEMAS, d.id)).catch(() => {}),
      );
    });
  });

  if (remocoes.length > 0) {
    await Promise.all(remocoes);
  }
  return idsRemovidos;
}

export async function listarTemas(
  categoria: CategoriaTema,
  forceRefresh = false,
): Promise<TemaOcorrencia[]> {
  const now = Date.now();
  if (
    cachePorCategoria[categoria] &&
    !forceRefresh &&
    now - lastFetchPorCategoria[categoria] < CACHE_TTL
  ) {
    return cachePorCategoria[categoria]!;
  }

  const q = query(
    collection(db, COLLECTION_TEMAS),
    where("categoria", "==", categoria),
  );
  let snapshot = await getDocs(q);

  if (snapshot.empty) {
    await semearCategoria(categoria);
    snapshot = await getDocs(q);
  }

  const brutos: TemaOcorrencia[] = [];
  snapshot.forEach((d) => {
    const data = d.data();
    brutos.push({
      id: d.id,
      nome: data.nome || "",
      categoria: data.categoria,
      createdAt: data.createdAt || 0,
      perfisDisponiveis: data.perfisDisponiveis,
    });
  });

  const idsRemovidos = await removerDuplicados(brutos);
  // Checkpoints antigos continuam no histórico, mas deixam de ser uma opção para novos registros.
  const lista = brutos.filter((t) => !idsRemovidos.has(t.id) && !(categoria === 'tipo' && t.nome.trim().toLowerCase() === 'checkpoint'));
  lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  cachePorCategoria[categoria] = lista;
  lastFetchPorCategoria[categoria] = now;
  return lista;
}

export async function criarTema(
  nome: string,
  categoria: CategoriaTema,
): Promise<void> {
  const nomeLimpo = nome.trim();
  if (!nomeLimpo) return;
  if (categoria === 'tipo' && nomeLimpo.toLowerCase() === 'checkpoint') {
    throw new Error('Checkpoint foi substituído pelas pendências no cadastro do cliente.');
  }

  const existentes = await listarTemas(categoria);
  const jaExiste = existentes.some(
    (t) => t.nome.toLowerCase() === nomeLimpo.toLowerCase(),
  );
  if (jaExiste) {
    throw new Error("Já existe um item com esse nome nessa categoria.");
  }

  invalidarCacheTemas(categoria);
  const id = gerarIdTema(categoria, nomeLimpo);
  const refDoc = doc(db, COLLECTION_TEMAS, id);
  const existente = await getDoc(refDoc);
  if (existente.exists()) {
    throw new Error("Já existe um item com esse nome nessa categoria.");
  }
  await setDoc(refDoc, {
    nome: nomeLimpo,
    categoria,
    createdAt: Date.now(),
  });
}

export async function editarTema(
  id: string,
  novoNome: string,
  categoria: CategoriaTema,
): Promise<void> {
  const nomeLimpo = novoNome.trim();
  if (!nomeLimpo) return;
  if (categoria === 'tipo' && nomeLimpo.toLowerCase() === 'checkpoint') {
    throw new Error('Checkpoint foi substituído pelas pendências no cadastro do cliente.');
  }

  const existentes = await listarTemas(categoria);
  const conflito = existentes.some(
    (t) => t.id !== id && t.nome.toLowerCase() === nomeLimpo.toLowerCase(),
  );
  if (conflito) {
    throw new Error("Já existe um item com esse nome nessa categoria.");
  }

  const atual = existentes.find((t) => t.id === id);
  if (!atual) {
    throw new Error("Item não encontrado.");
  }

  invalidarCacheTemas(categoria);
  const novoId = gerarIdTema(categoria, nomeLimpo);

  if (novoId === id) {
    await setDoc(
      doc(db, COLLECTION_TEMAS, id),
      { nome: nomeLimpo, categoria, createdAt: atual.createdAt },
      { merge: true },
    );
    return;
  }

  // O ID é determinístico a partir do nome, então renomear implica criar um
  // novo documento com o novo ID e remover o antigo.
  await setDoc(doc(db, COLLECTION_TEMAS, novoId), {
    nome: nomeLimpo,
    categoria,
    createdAt: atual.createdAt,
    perfisDisponiveis: atual.perfisDisponiveis ?? perfisPadraoTema(atual),
  });
  await deleteDoc(doc(db, COLLECTION_TEMAS, id));
}

export async function removerTema(
  id: string,
  categoria: CategoriaTema,
): Promise<void> {
  invalidarCacheTemas(categoria);
  await deleteDoc(doc(db, COLLECTION_TEMAS, id));
}
