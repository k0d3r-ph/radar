import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  orderBy,
  updateDoc,
  writeBatch,
  where,
  limit,
} from "firebase/firestore";
import { db } from "./firebase";
import type { LancamentoPonto } from "../types";
import { sincronizarColecao } from "./sincronizacaoIncremental";

const COLLECTION = "gamificacao_pontos";

let cachedPontos: LancamentoPonto[] | null = null;
let lastFetchPontos = 0;
const CACHE_TTL = 300000; // 5 minutos (300.000 ms)

export async function salvarLancamentoPonto(
  lancamento: Omit<LancamentoPonto, "id"> & { dataLancamento?: number }
): Promise<string> {
  const dadosLimpos = Object.fromEntries(
    Object.entries(lancamento).filter(([_, v]) => v !== undefined)
  );

  const dataLancamento = lancamento.dataLancamento || Date.now();
  const updatedAt = Date.now();
  const docRef = await addDoc(collection(db, COLLECTION), {
    ...dadosLimpos,
    dataLancamento,
    updatedAt,
  });

  // `dataLancamento` e `updatedAt` vêm depois do spread: são os valores já
  // resolvidos acima e não podem ser sobrescritos por um campo indefinido.
  const novoPonto = {
    id: docRef.id,
    ...lancamento,
    dataLancamento,
    updatedAt,
  } as LancamentoPonto;

  // Inserção Otimista do Cache (no início devido ao orderBy("dataLancamento", "desc"))
  if (cachedPontos) {
    cachedPontos = [novoPonto, ...cachedPontos];
  }

  return docRef.id;
}

export async function atualizarLancamentoPonto(
  id: string,
  lancamento: Partial<LancamentoPonto>
): Promise<void> {
  const docRef = doc(db, COLLECTION, id);
  const dadosLimpos = Object.fromEntries(
    Object.entries(lancamento).filter(([_, v]) => v !== undefined)
  );
  const updatedAt = Date.now();
  await updateDoc(docRef, { ...dadosLimpos, updatedAt });

  // Atualização Otimista do Cache
  if (cachedPontos) {
    cachedPontos = cachedPontos.map((p) =>
      p.id === id
        ? ({ ...p, ...lancamento, ...dadosLimpos, updatedAt } as LancamentoPonto)
        : p
    );
  }
}

export async function listarLancamentosPontos(forceRefresh = false, limitCount?: number): Promise<LancamentoPonto[]> {
  const now = Date.now();

  // Se for especificado um limite de registros, faz a busca sob demanda sem afetar o cache global
  if (limitCount) {
    const q = query(collection(db, COLLECTION), orderBy("dataLancamento", "desc"), limit(limitCount));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<LancamentoPonto, "id">),
    })) as LancamentoPonto[];
  }

  if (cachedPontos && !forceRefresh && (now - lastFetchPontos < CACHE_TTL)) {
    return cachedPontos;
  }

  const pontos = await sincronizarColecao<LancamentoPonto>(COLLECTION, forceRefresh);

  // Ver comentário equivalente em `ocorrencias.ts`: a ordem vem do cliente.
  cachedPontos = pontos.sort((a, b) => b.dataLancamento - a.dataLancamento);

  lastFetchPontos = now;
  return cachedPontos;
}

export async function removerLancamentoPonto(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));

  // Remoção Otimista do Cache
  if (cachedPontos) {
    cachedPontos = cachedPontos.filter((p) => p.id !== id);
  }
}

export async function reassociarPontosTreinador(
  oldTreinadorId: string,
  newTreinadorId: string,
  newTreinadorNome: string
): Promise<number> {
  const q = query(
    collection(db, COLLECTION),
    where("treinadorId", "==", oldTreinadorId)
  );
  const snapshot = await getDocs(q);
  if (snapshot.empty) return 0;

  const batch = writeBatch(db);
  snapshot.docs.forEach((docSnap) => {
    batch.update(docSnap.ref, {
      treinadorId: newTreinadorId,
      treinadorNome: newTreinadorNome,
      updatedAt: Date.now(),
    });
  });

  await batch.commit();

  // Atualização Otimista do Cache para todos os itens afetados
  if (cachedPontos) {
    cachedPontos = cachedPontos.map((p) => {
      if (p.treinadorId === oldTreinadorId) {
        return {
          ...p,
          treinadorId: newTreinadorId,
          treinadorNome: newTreinadorNome,
          updatedAt: Date.now(),
        } as LancamentoPonto;
      }
      return p;
    });
  }

  return snapshot.size;
}
