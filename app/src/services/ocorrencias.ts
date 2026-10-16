import {
  collection,
  addDoc,
  deleteDoc,
  runTransaction,
  doc,
  getDocsFromServer,
  query,
  orderBy,
  limit,
} from "firebase/firestore";

import { auth, db } from "./firebase";
import type { Ocorrencia } from "../types";
import { sincronizarColecao } from "./sincronizacaoIncremental";
import { RADAR_API_URL } from './apiConfig.ts';

const COLLECTION = "ocorrencias";

let cachedOcorrencias: Ocorrencia[] | null = null;
let lastFetchOcorrencias = 0;
let cachedUsuario: string | undefined;
const CACHE_TTL = 300000; // 5 minutos (300.000 ms)

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
  opcoes?: { updatedAtEsperado?: number },
) {
  // A estrela é alterada somente pelo endpoint que valida perfil e limite por cliente.
  const { horaOcorrencia, id, favorita, favoritadaPor, favoritadaEm, favoritaEmpresaId, ...dados } = ocorrencia as any;

  const dadosLimpos = removerUndefined(dados);

  if (id) {
    const ref = doc(db, COLLECTION, id);
    const updatedAt = Date.now();
    await runTransaction(db, async transaction => {
      const atual = await transaction.get(ref);
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
      transaction.update(ref, { ...dadosLimpos, ...csat, updatedAt });
    });

    // Atualização Otimista do Cache
    // Usa apenas dadosLimpos (sem campos undefined) para não sobrescrever
    // valores já corretos no cache (ex: createdAt) com undefined.
    if (cachedOcorrencias) {
      cachedOcorrencias = cachedOcorrencias.map((o) =>
        o.id === id ? ({ ...o, ...dadosLimpos, updatedAt } as Ocorrencia) : o
      );
    }
    return id;
  }

  const createdAt = ocorrencia.createdAt || Date.now();
  const updatedAt = Date.now();
  const docRef = await addDoc(collection(db, COLLECTION), {
    ...dadosLimpos,
    createdAt,
    updatedAt,
  });

  const novaOcorrencia = {
    id: docRef.id,
    ...ocorrencia,
    createdAt,
    updatedAt,
  } as Ocorrencia;

  // Inserção Otimista do Cache (no início devido ao orderBy("createdAt", "desc"))
  if (cachedOcorrencias) {
    cachedOcorrencias = [novaOcorrencia, ...cachedOcorrencias];
  }

  return docRef.id;
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
