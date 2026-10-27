import {
  collection,
  addDoc,
  deleteDoc,
  runTransaction,
  doc,
  getDocsFromServer,
  getDocFromServer,
  query,
  orderBy,
  limit,
  where,
  type Transaction,
  type DocumentSnapshot,
  type DocumentReference,
} from "firebase/firestore";

import { auth, db } from "./firebase";
import type { LancamentoPonto, Ocorrencia } from "../types";
import { sincronizarColecao } from "./sincronizacaoIncremental";
import { RADAR_API_URL } from './apiConfig.ts';
import { exigeClienteAtivoParaTreinamento, MENSAGEM_TREINAMENTO_SUSPENSO, normalizarEmpresaOcorrencia } from "../utils/registroTreinamento";
import { invalidarCacheGamificacao } from "./gamificacao";

const COLLECTION = "ocorrencias";
const COLLECTION_PONTOS = "gamificacao_pontos";

/**
 * Criação/atualização/remoção do lançamento de pontos da gamificação vinculado a esta
 * ocorrência, executada dentro da mesma transação do Firestore que grava a ocorrência —
 * os dois sempre vão juntos, ou nenhum vai. Antes disso, o ponto era escrito numa chamada
 * separada antes da ocorrência; se a gravação da ocorrência falhasse por qualquer motivo
 * (conflito de edição concorrente, rede instável etc.) o ponto ficava órfão, e uma nova
 * tentativa do usuário criava outro, duplicando os pontos do treinamento.
 */
export type AcaoLancamentoPonto =
  | { acao: "criar"; dados: Omit<LancamentoPonto, "id" | "updatedAt" | "dataLancamento"> & { dataLancamento?: number } }
  | { acao: "atualizar"; id: string; dados: Partial<LancamentoPonto> }
  | { acao: "remover"; id: string };

/** Só realiza escritas (sem leituras): deve ser chamada depois de todo `transaction.get` já ter sido feito. */
function aplicarLancamentoPonto(transaction: Transaction, acao: AcaoLancamentoPonto | undefined): string | undefined {
  if (!acao) return undefined;
  const agora = Date.now();

  if (acao.acao === "remover") {
    transaction.delete(doc(db, COLLECTION_PONTOS, acao.id));
    return undefined;
  }

  if (acao.acao === "atualizar") {
    const dadosLimpos = removerUndefined(acao.dados);
    transaction.update(doc(db, COLLECTION_PONTOS, acao.id), { ...dadosLimpos, updatedAt: agora });
    return acao.id;
  }

  const ref = doc(collection(db, COLLECTION_PONTOS));
  const dadosLimpos = removerUndefined(acao.dados);
  transaction.set(ref, { ...dadosLimpos, dataLancamento: acao.dados.dataLancamento || agora, updatedAt: agora });
  return ref.id;
}

export function invalidarCacheOcorrencias(): void { cachedOcorrencias = null; }

let cachedOcorrencias: Ocorrencia[] | null = null;
let lastFetchOcorrencias = 0;
let cachedUsuario: string | undefined;
const CACHE_TTL = 300000; // 5 minutos (300.000 ms)

function validarCadastroTreinamento(cliente: DocumentSnapshot, nomeEmpresa: string): void {
  const cadastro = cliente.data();
  if (!cliente.exists() || typeof cadastro?.nomeEmpresa !== "string" || normalizarEmpresaOcorrencia(cadastro.nomeEmpresa) !== normalizarEmpresaOcorrencia(nomeEmpresa)) {
    throw new Error("Selecione um cliente cadastrado válido para registrar o treinamento.");
  }
  if (cadastro.isSuspended) throw new Error(MENSAGEM_TREINAMENTO_SUSPENSO);
}

/** Consulta pontual antes de score/pontos; o estado é conferido novamente na transação de gravação. */
export async function validarClienteParaNovoTreinamento(empresaId: string, nomeEmpresa: string): Promise<void> {
  validarCadastroTreinamento(await getDocFromServer(doc(db, 'empresas', empresaId)), nomeEmpresa);
}

async function validarDestinoTreinamento(transaction: Transaction, nomeEmpresa: string, empresaId?: string): Promise<void> {
  let ref: DocumentReference;
  if (empresaId) ref = doc(db, 'empresas', empresaId);
  else {
    // Compatibilidade com chamadores antigos sem ID, sem leitura completa da coleção.
    const clientes = await getDocsFromServer(query(collection(db, 'empresas'), where('nomeEmpresa', '==', nomeEmpresa), limit(2)));
    if (clientes.docs.length !== 1) throw new Error("Selecione um cliente cadastrado válido para registrar o treinamento.");
    ref = clientes.docs[0].ref;
  }
  validarCadastroTreinamento(await transaction.get(ref), nomeEmpresa);
}

// Remove `undefined` recursivamente (inclusive dentro de arrays/objetos aninhados),
// pois o Firestore lança erro em updateDoc/addDoc ao encontrar undefined em qualquer profundidade.
function removerUndefined<T>(valor: T): T {
  if (Array.isArray(valor)) {
    return valor.map((v) => removerUndefined(v)) as unknown as T;
  }
  if (valor !== null && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>)
        .filter(([_, v]) => v !== undefined)
        .map(([k, v]) => [k, removerUndefined(v)]),
    ) as T;
  }
  return valor;
}

export async function salvarOcorrencia(
  ocorrencia: Ocorrencia,
  opcoes?: { updatedAtEsperado?: number; empresaId?: string; lancamentoPonto?: AcaoLancamentoPonto },
) {
  // A estrela é alterada somente pelo endpoint que valida perfil e limite por cliente.
  const { horaOcorrencia, id, favorita, favoritadaPor, favoritadaEm, favoritaEmpresaId, ...dados } = ocorrencia as any;

  const dadosLimpos = removerUndefined(dados);

  if (id) {
    const ref = doc(db, COLLECTION, id);
    const updatedAt = Date.now();
    let gamificacaoPontoId: string | undefined;
    await runTransaction(db, async transaction => {
      const atual = await transaction.get(ref);
      const destino = { tipo: dadosLimpos.tipo ?? atual.data()?.tipo, empresa: dadosLimpos.empresa ?? atual.data()?.empresa };
      if (exigeClienteAtivoParaTreinamento(destino, atual.data())) {
        await validarDestinoTreinamento(transaction, destino.empresa, opcoes?.empresaId);
      }
      if (
        opcoes?.updatedAtEsperado !== undefined &&
        atual.exists() &&
        atual.data()?.updatedAt !== opcoes.updatedAtEsperado
      ) {
        throw new Error(
          'Esta ocorrência foi alterada por outra pessoa enquanto você editava. Recarregue a página e tente novamente.',
        );
      }
      const normalizarEmpresa = (nome: string) => nome.trim().toLowerCase().replace(/&amp;/g, '&').replace(/\s+/g, ' ');
      if (atual.data()?.favorita && dadosLimpos.empresa
        && normalizarEmpresa(atual.data()!.empresa) !== normalizarEmpresa(dadosLimpos.empresa)) {
        const empresaId = atual.data()!.favoritaEmpresaId;
        const cliente = empresaId ? await transaction.get(doc(db, 'empresas', empresaId)) : undefined;
        // Renomear o cadastro é permitido. Transferir a estrela entre clientes exigiria nova validação do limite.
        if (!cliente?.exists() || normalizarEmpresa(cliente.data().nomeEmpresa) !== normalizarEmpresa(dadosLimpos.empresa)) {
          throw new Error('Remova a estrela antes de transferir a ocorrência para outro cliente.');
        }
      }
      const csat = atual.data()?.csatReservaId ? {
        csatReservaId: atual.data()!.csatReservaId,
        csatRespostas: atual.data()!.csatRespostas || [],
        treinamentoResultados: atual.data()!.treinamentoResultados || [],
        idSeqFormatted: atual.data()!.idSeqFormatted,
      } : {};
      // Escritas (dados lidos acima): o lançamento de pontos vai na mesma transação da
      // ocorrência, para nunca ficar órfão se um dos dois falhar.
      gamificacaoPontoId = aplicarLancamentoPonto(transaction, opcoes?.lancamentoPonto);
      const gamificacao = opcoes?.lancamentoPonto ? { gamificacaoPontoId: gamificacaoPontoId ?? "" } : {};
      transaction.update(ref, { ...dadosLimpos, ...csat, ...gamificacao, updatedAt });
    });
    if (opcoes?.lancamentoPonto) invalidarCacheGamificacao();

    // Atualização Otimista do Cache
    // Usa apenas dadosLimpos (sem campos undefined) para não sobrescrever
    // valores já corretos no cache (ex: createdAt) com undefined.
    if (cachedOcorrencias) {
      const gamificacao = opcoes?.lancamentoPonto ? { gamificacaoPontoId: gamificacaoPontoId ?? "" } : {};
      cachedOcorrencias = cachedOcorrencias.map((o) =>
        o.id === id ? ({ ...o, ...dadosLimpos, ...gamificacao, updatedAt } as Ocorrencia) : o
      );
    }
    return { id, gamificacaoPontoId };
  }

  const createdAt = ocorrencia.createdAt || Date.now();
  const updatedAt = Date.now();
  const novoDocumento = {
    ...dadosLimpos,
    createdAt,
    updatedAt,
  };
  let docRef: DocumentReference;
  let gamificacaoPontoId: string | undefined;
  if (exigeClienteAtivoParaTreinamento(ocorrencia)) {
    docRef = doc(collection(db, COLLECTION));
    await runTransaction(db, async transaction => {
      await validarDestinoTreinamento(transaction, ocorrencia.empresa, opcoes?.empresaId);
      gamificacaoPontoId = aplicarLancamentoPonto(transaction, opcoes?.lancamentoPonto);
      const gamificacao = opcoes?.lancamentoPonto ? { gamificacaoPontoId: gamificacaoPontoId ?? "" } : {};
      transaction.set(docRef, { ...novoDocumento, ...gamificacao });
    });
    if (opcoes?.lancamentoPonto) invalidarCacheGamificacao();
  } else docRef = await addDoc(collection(db, COLLECTION), novoDocumento);

  const novaOcorrencia = {
    id: docRef.id,
    ...ocorrencia,
    createdAt,
    updatedAt,
    ...(opcoes?.lancamentoPonto ? { gamificacaoPontoId: gamificacaoPontoId ?? "" } : {}),
  } as Ocorrencia;

  // Inserção Otimista do Cache (no início devido ao orderBy("createdAt", "desc"))
  if (cachedOcorrencias) {
    cachedOcorrencias = [novaOcorrencia, ...cachedOcorrencias];
  }

  return { id: docRef.id, gamificacaoPontoId };
}

export async function listarOcorrencias(forceRefresh = false, limitCount?: number) {
  const now = Date.now();

  // Se for especificado um limite de registros, faz a busca sob demanda sem afetar o cache global
  if (limitCount) {
    const q = query(collection(db, COLLECTION), orderBy("createdAt", "desc"), limit(limitCount));
    const snapshot = await getDocsFromServer(q);
    return snapshot.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<Ocorrencia, "id">),
    })) as Ocorrencia[];
  }

  if (cachedOcorrencias && cachedUsuario === auth.currentUser?.uid && !forceRefresh && (now - lastFetchOcorrencias < CACHE_TTL)) {
    return cachedOcorrencias;
  }

  const ocorrencias = await sincronizarColecao<Ocorrencia>(COLLECTION, forceRefresh);

  // Ordena também registros antigos sem createdAt, sem excluí-los da consulta.
  cachedOcorrencias = ocorrencias.sort(
    (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)
  );

  lastFetchOcorrencias = now;
  cachedUsuario = auth.currentUser?.uid;
  return cachedOcorrencias;
}

export async function removerOcorrencia(id: string) {
  await deleteDoc(doc(db, COLLECTION, id));

  // Remoção Otimista do Cache
  if (cachedOcorrencias) {
    cachedOcorrencias = cachedOcorrencias.filter((o) => o.id !== id);
  }
}

export async function definirOcorrenciaFavorita(id: string, favorita: boolean) {
  if (!auth.currentUser) throw new Error('Entre no Radar para alterar as estrelas.');
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(`${RADAR_API_URL}/api/ocorrencias/${encodeURIComponent(id)}/favorito`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorita }),
  });
  const dados = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(dados.error || 'Não foi possível alterar a estrela.');
  if (cachedOcorrencias) cachedOcorrencias = cachedOcorrencias.map(o => o.id === id ? { ...o, ...dados } : o);
  return dados as Pick<Ocorrencia, 'favorita' | 'favoritaEmpresaId' | 'favoritadaPor' | 'favoritadaEm' | 'updatedAt'>;
}
