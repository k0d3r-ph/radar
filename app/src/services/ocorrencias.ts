import {
  collection,
  addDoc,
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
import type { Empresa, LancamentoPonto, Ocorrencia } from "../types";
import { sincronizarColecao } from "./sincronizacaoIncremental";
import { RADAR_API_URL } from './apiConfig.ts';
import { exigeClienteAtivoParaTreinamento, MENSAGEM_TREINAMENTO_SUSPENSO, normalizarEmpresaOcorrencia } from "../utils/registroTreinamento";
import { invalidarCacheGamificacao } from "./gamificacao";
import { invalidarCacheEmpresas } from "./empresas";

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
  opcoes?: {
    updatedAtEsperado?: number;
    empresaId?: string;
    lancamentoPonto?: AcaoLancamentoPonto;
    removerDescontoSuporteId?: string;
    concluirEsteiraUnilateralmente?: {
      empresaId: string;
      dataFinalizacao: string;
    };
    reverterConclusaoUnilateralmente?: boolean;
  },
) {
  // A estrela é alterada somente pelo endpoint que valida perfil e limite por cliente.
  const { horaOcorrencia, id, favorita, favoritadaPor, favoritadaEm, favoritaEmpresaId, ...dados } = ocorrencia as any;

  const dadosLimpos = removerUndefined(dados);
  if (
    opcoes?.concluirEsteiraUnilateralmente &&
    (ocorrencia.tipo !== "Informativa" ||
      ocorrencia.conclusaoUnilateralCapacitacao !== true ||
      !/^\d{4}-\d{2}-\d{2}$/.test(
        opcoes.concluirEsteiraUnilateralmente.dataFinalizacao,
      ))
  ) {
    throw new Error(
      "A conclusão unilateral exige uma ocorrência Informativa e uma data válida.",
    );
  }
  if (id) {
    const ref = doc(db, COLLECTION, id);
    const updatedAt = Date.now();
    let gamificacaoPontoId: string | undefined;
    let estadoAnteriorConclusaoUnilateral:
      | NonNullable<Ocorrencia["conclusaoUnilateralEstadoAnterior"]>
      | undefined;
    let empresaConclusaoRef: DocumentReference | undefined;
    let empresaConclusaoAtual: Empresa | undefined;
    let restauracaoConclusaoUnilateral:
      | NonNullable<Ocorrencia["conclusaoUnilateralEstadoAnterior"]>
      | undefined;
    await runTransaction(db, async transaction => {
      const atual = await transaction.get(ref);
      if (!atual.exists() && (opcoes?.concluirEsteiraUnilateralmente || opcoes?.reverterConclusaoUnilateralmente)) {
        throw new Error(
          "Não foi possível localizar a ocorrência que deseja concluir ou restaurar.",
        );
      }
      const ocorrenciaAtual = atual.data() as Ocorrencia | undefined;
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
      if (
        opcoes?.removerDescontoSuporteId &&
        atual.data()?.gamificacaoDescontoPontoId !==
          opcoes.removerDescontoSuporteId
      ) {
        throw new Error(
          "O desconto de gamificação desta ocorrência foi alterado. Recarregue a página e tente novamente.",
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

      if (opcoes?.concluirEsteiraUnilateralmente) {
        empresaConclusaoRef = doc(
          db,
          "empresas",
          opcoes.concluirEsteiraUnilateralmente.empresaId,
        );
        const empresaSnapshot = await transaction.get(empresaConclusaoRef);
        if (!empresaSnapshot.exists()) {
          throw new Error(
            "Não foi possível localizar o cadastro do cliente para concluir a capacitação.",
          );
        }
        empresaConclusaoAtual = empresaSnapshot.data() as Empresa;
        const normalizar = (nome: string) =>
          nome.trim().toLowerCase().replace(/&amp;/g, "&").replace(/\s+/g, " ");
        if (
          normalizar(empresaConclusaoAtual.nomeEmpresa) !==
          normalizar(ocorrencia.empresa)
        ) {
          throw new Error(
            "O cliente da ocorrência não corresponde ao cadastro selecionado.",
          );
        }
        if (
          empresaConclusaoAtual.dataFinalizacao?.trim() &&
          empresaConclusaoAtual.conclusaoUnilateralOcorrenciaId !== id
        ) {
          throw new Error(
            "Este cliente já possui uma data de finalização da esteira.",
          );
        }
        const temas = (empresaConclusaoAtual.temaText || "")
          .split("\n")
          .map((tema) => tema.trim())
          .filter(Boolean);
        if (temas.length === 0) {
          throw new Error(
            "Cadastre os temas da esteira antes de concluir a capacitação.",
          );
        }
        estadoAnteriorConclusaoUnilateral = {
          empresaId: opcoes.concluirEsteiraUnilateralmente.empresaId,
          currentPhase: empresaConclusaoAtual.currentPhase || 0,
          dataFinalizacao: empresaConclusaoAtual.dataFinalizacao || "",
          dataFollowUpFinal: empresaConclusaoAtual.dataFollowUpFinal || "",
          conclusaoUnilateralCapacitacao:
            empresaConclusaoAtual.conclusaoUnilateralCapacitacao ?? false,
          temasConcluidosUnilateralmente:
            empresaConclusaoAtual.temasConcluidosUnilateralmente ?? [],
        };
      } else if (opcoes?.reverterConclusaoUnilateralmente) {
        const estadoAnterior =
          ocorrenciaAtual?.conclusaoUnilateralEstadoAnterior;
        if (
          ocorrenciaAtual?.conclusaoUnilateralCapacitacao !== true ||
          !estadoAnterior
        ) {
          throw new Error(
            "Não há dados suficientes para restaurar a esteira desta ocorrência.",
          );
        }
        empresaConclusaoRef = doc(
          db,
          "empresas",
          estadoAnterior.empresaId,
        );
        const empresaSnapshot = await transaction.get(empresaConclusaoRef);
        if (
          !empresaSnapshot.exists() ||
          empresaSnapshot.data()?.conclusaoUnilateralOcorrenciaId !== id
        ) {
          throw new Error(
            "A conclusão unilateral não está mais vinculada a esta ocorrência.",
          );
        }
        empresaConclusaoAtual = empresaSnapshot.data() as Empresa;
        restauracaoConclusaoUnilateral = estadoAnterior;
      }

      // Escritas (dados lidos acima): o lançamento de pontos vai na mesma transação da
      // ocorrência, para nunca ficar órfão se um dos dois falhar.
      gamificacaoPontoId = aplicarLancamentoPonto(transaction, opcoes?.lancamentoPonto);
      const gamificacao = opcoes?.lancamentoPonto ? { gamificacaoPontoId: gamificacaoPontoId ?? "" } : {};
      if (
        opcoes?.concluirEsteiraUnilateralmente &&
        empresaConclusaoRef &&
        empresaConclusaoAtual
      ) {
        const temas = (empresaConclusaoAtual.temaText || "")
          .split("\n")
          .map((tema) => tema.trim())
          .filter(Boolean);
        const indiceAtual = Math.min(
          Math.max(0, Math.trunc(empresaConclusaoAtual.currentPhase || 0)),
          temas.length - 1,
        );
        const temasUnilaterais = Array.from(
          new Set([
            ...(empresaConclusaoAtual.temasConcluidosUnilateralmente ?? []),
            ...temas.slice(indiceAtual + 1),
          ]),
        );
        transaction.update(empresaConclusaoRef, {
          currentPhase: temas.length - 1,
          dataFinalizacao:
            opcoes.concluirEsteiraUnilateralmente.dataFinalizacao,
          dataFollowUpFinal: "",
          conclusaoUnilateralCapacitacao: true,
          conclusaoUnilateralOcorrenciaId: id,
          temasConcluidosUnilateralmente: temasUnilaterais,
          updatedAt,
        });
      } else if (
        opcoes?.reverterConclusaoUnilateralmente &&
        empresaConclusaoRef &&
        empresaConclusaoAtual &&
        restauracaoConclusaoUnilateral
      ) {
        const totalTemas = (empresaConclusaoAtual.temaText || "")
          .split("\n")
          .filter((tema) => tema.trim()).length;
        transaction.update(empresaConclusaoRef, {
          currentPhase: totalTemas
            ? Math.min(restauracaoConclusaoUnilateral.currentPhase, totalTemas - 1)
            : 0,
          dataFinalizacao: restauracaoConclusaoUnilateral.dataFinalizacao,
          dataFollowUpFinal:
            restauracaoConclusaoUnilateral.dataFollowUpFinal ?? "",
          conclusaoUnilateralCapacitacao:
            restauracaoConclusaoUnilateral.conclusaoUnilateralCapacitacao,
          conclusaoUnilateralOcorrenciaId: "",
          temasConcluidosUnilateralmente:
            restauracaoConclusaoUnilateral.temasConcluidosUnilateralmente,
          updatedAt,
        });
      }
      if (opcoes?.removerDescontoSuporteId) {
        transaction.delete(
          doc(db, COLLECTION_PONTOS, opcoes.removerDescontoSuporteId),
        );
      }
      const descontoSuporte = opcoes?.removerDescontoSuporteId
        ? { gamificacaoDescontoPontoId: "" }
        : {};
      transaction.update(ref, {
        ...dadosLimpos,
        ...csat,
        ...gamificacao,
        ...descontoSuporte,
        ...(estadoAnteriorConclusaoUnilateral
          ? {
              conclusaoUnilateralEstadoAnterior:
                estadoAnteriorConclusaoUnilateral,
            }
          : {}),
        ...(opcoes?.reverterConclusaoUnilateralmente
          ? { conclusaoUnilateralEstadoAnterior: null }
          : {}),
        updatedAt,
      });
    });
    if (opcoes?.lancamentoPonto || opcoes?.removerDescontoSuporteId) {
      invalidarCacheGamificacao();
    }
    if (
      opcoes?.concluirEsteiraUnilateralmente ||
      opcoes?.reverterConclusaoUnilateralmente
    ) {
      invalidarCacheEmpresas();
    }

    // Atualização Otimista do Cache
    // Usa apenas dadosLimpos (sem campos undefined) para não sobrescrever
    // valores já corretos no cache (ex: createdAt) com undefined.
    if (cachedOcorrencias) {
      const gamificacao = opcoes?.lancamentoPonto ? { gamificacaoPontoId: gamificacaoPontoId ?? "" } : {};
      const descontoSuporte = opcoes?.removerDescontoSuporteId
        ? { gamificacaoDescontoPontoId: "" }
        : {};
      cachedOcorrencias = cachedOcorrencias.map((o) =>
        o.id === id
          ? ({
              ...o,
              ...dadosLimpos,
              ...gamificacao,
              ...descontoSuporte,
              ...(estadoAnteriorConclusaoUnilateral
                ? {
                    conclusaoUnilateralEstadoAnterior:
                      estadoAnteriorConclusaoUnilateral,
                  }
                : {}),
              ...(opcoes?.reverterConclusaoUnilateralmente
                ? { conclusaoUnilateralEstadoAnterior: null }
                : {}),
              updatedAt,
            } as Ocorrencia)
          : o
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
  let estadoAnteriorConclusaoUnilateral:
    | NonNullable<Ocorrencia["conclusaoUnilateralEstadoAnterior"]>
    | undefined;
  if (
    exigeClienteAtivoParaTreinamento(ocorrencia) ||
    opcoes?.concluirEsteiraUnilateralmente
  ) {
    docRef = doc(collection(db, COLLECTION));
    await runTransaction(db, async transaction => {
      if (exigeClienteAtivoParaTreinamento(ocorrencia)) {
        await validarDestinoTreinamento(transaction, ocorrencia.empresa, opcoes?.empresaId);
      }
      let atualEmpresa: Empresa | undefined;
      if (opcoes?.concluirEsteiraUnilateralmente) {
        const empresaRef = doc(
          db,
          "empresas",
          opcoes.concluirEsteiraUnilateralmente.empresaId,
        );
        const empresaSnapshot = await transaction.get(empresaRef);
        if (!empresaSnapshot.exists()) {
          throw new Error(
            "Não foi possível localizar o cadastro do cliente para concluir a capacitação.",
          );
        }
        atualEmpresa = empresaSnapshot.data() as Empresa;
        const normalizar = (nome: string) =>
          nome.trim().toLowerCase().replace(/&amp;/g, "&").replace(/\s+/g, " ");
        if (
          normalizar(atualEmpresa.nomeEmpresa) !==
          normalizar(ocorrencia.empresa)
        ) {
          throw new Error(
            "O cliente da ocorrência não corresponde ao cadastro selecionado.",
          );
        }
        if (atualEmpresa.dataFinalizacao?.trim()) {
          throw new Error(
            "Este cliente já possui uma data de finalização da esteira.",
          );
        }
        const temas = (atualEmpresa.temaText || "")
          .split("\n")
          .map((tema) => tema.trim())
          .filter(Boolean);
        if (temas.length === 0) {
          throw new Error(
            "Cadastre os temas da esteira antes de concluir a capacitação.",
          );
        }
        estadoAnteriorConclusaoUnilateral = {
          empresaId: opcoes.concluirEsteiraUnilateralmente.empresaId,
          currentPhase: atualEmpresa.currentPhase || 0,
          dataFinalizacao: atualEmpresa.dataFinalizacao || "",
          dataFollowUpFinal: atualEmpresa.dataFollowUpFinal || "",
          conclusaoUnilateralCapacitacao:
            atualEmpresa.conclusaoUnilateralCapacitacao ?? false,
          temasConcluidosUnilateralmente:
            atualEmpresa.temasConcluidosUnilateralmente ?? [],
        };
      }
      gamificacaoPontoId = aplicarLancamentoPonto(transaction, opcoes?.lancamentoPonto);
      const gamificacao = opcoes?.lancamentoPonto ? { gamificacaoPontoId: gamificacaoPontoId ?? "" } : {};
      if (opcoes?.concluirEsteiraUnilateralmente && atualEmpresa) {
        const temas = (atualEmpresa.temaText || "")
          .split("\n")
          .map((tema) => tema.trim())
          .filter(Boolean);
        const indiceAtual = Math.min(
          Math.max(0, Math.trunc(atualEmpresa.currentPhase || 0)),
          temas.length - 1,
        );
        const temasUnilaterais = Array.from(
          new Set([
            ...(atualEmpresa.temasConcluidosUnilateralmente ?? []),
            ...temas.slice(indiceAtual + 1),
          ]),
        );
        transaction.update(
          doc(
            db,
            "empresas",
            opcoes.concluirEsteiraUnilateralmente.empresaId,
          ),
          {
            currentPhase: temas.length - 1,
            dataFinalizacao:
              opcoes.concluirEsteiraUnilateralmente.dataFinalizacao,
            dataFollowUpFinal: "",
            conclusaoUnilateralCapacitacao: true,
            conclusaoUnilateralOcorrenciaId: docRef.id,
            temasConcluidosUnilateralmente: temasUnilaterais,
            updatedAt: Date.now(),
          },
        );
      }
      transaction.set(docRef, {
        ...novoDocumento,
        ...gamificacao,
        ...(estadoAnteriorConclusaoUnilateral
          ? {
              conclusaoUnilateralEstadoAnterior:
                estadoAnteriorConclusaoUnilateral,
            }
          : {}),
      });
    });
    if (opcoes?.lancamentoPonto) invalidarCacheGamificacao();
    if (opcoes?.concluirEsteiraUnilateralmente) invalidarCacheEmpresas();
  } else docRef = await addDoc(collection(db, COLLECTION), novoDocumento);

  const novaOcorrencia = {
    id: docRef.id,
    ...ocorrencia,
    createdAt,
    updatedAt,
    ...(opcoes?.lancamentoPonto ? { gamificacaoPontoId: gamificacaoPontoId ?? "" } : {}),
    ...(estadoAnteriorConclusaoUnilateral
      ? {
          conclusaoUnilateralEstadoAnterior:
            estadoAnteriorConclusaoUnilateral,
        }
      : {}),
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
  let reverteuConclusaoUnilateral = false;
  await runTransaction(db, async (transaction) => {
    const ocorrenciaRef = doc(db, COLLECTION, id);
    const ocorrenciaSnapshot = await transaction.get(ocorrenciaRef);
    if (!ocorrenciaSnapshot.exists()) return;

    const ocorrencia = ocorrenciaSnapshot.data() as Ocorrencia;
    const estadoAnterior = ocorrencia.conclusaoUnilateralEstadoAnterior;
    if (ocorrencia.conclusaoUnilateralCapacitacao && estadoAnterior) {
      const empresaRef = doc(db, "empresas", estadoAnterior.empresaId);
      const empresaSnapshot = await transaction.get(empresaRef);
      if (
        empresaSnapshot.exists() &&
        empresaSnapshot.data()?.conclusaoUnilateralOcorrenciaId === id
      ) {
        const empresa = empresaSnapshot.data() as Empresa;
        const totalTemas = (empresa.temaText || "")
          .split("\n")
          .filter((tema) => tema.trim()).length;
        transaction.update(empresaRef, {
          currentPhase: totalTemas
            ? Math.min(estadoAnterior.currentPhase, totalTemas - 1)
            : 0,
          dataFinalizacao: estadoAnterior.dataFinalizacao,
          dataFollowUpFinal: estadoAnterior.dataFollowUpFinal ?? "",
          conclusaoUnilateralCapacitacao:
            estadoAnterior.conclusaoUnilateralCapacitacao,
          conclusaoUnilateralOcorrenciaId: "",
          temasConcluidosUnilateralmente:
            estadoAnterior.temasConcluidosUnilateralmente,
          updatedAt: Date.now(),
        });
        reverteuConclusaoUnilateral = true;
      }
    }

    transaction.delete(ocorrenciaRef);
  });
  if (reverteuConclusaoUnilateral) invalidarCacheEmpresas();

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
