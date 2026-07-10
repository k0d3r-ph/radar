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
} from "firebase/firestore";
import { db } from "./firebase";
import type { LancamentoPonto } from "../types";

const COLLECTION = "gamificacao_pontos";

let cachedPontos: LancamentoPonto[] | null = null;
let lastFetchPontos = 0;
const CACHE_TTL = 30000; // 30 segundos

function invalidarCachePontos() {
  cachedPontos = null;
  lastFetchPontos = 0;
}

export async function salvarLancamentoPonto(
  lancamento: Omit<LancamentoPonto, "id" | "dataLancamento">
): Promise<string> {
  invalidarCachePontos();
  const dadosLimpos = Object.fromEntries(
    Object.entries(lancamento).filter(([_, v]) => v !== undefined)
  );

  const docRef = await addDoc(collection(db, COLLECTION), {
    ...dadosLimpos,
    dataLancamento: Date.now(),
  });
  return docRef.id;
}

export async function atualizarLancamentoPonto(
  id: string,
  lancamento: Partial<Omit<LancamentoPonto, "id" | "dataLancamento">>
): Promise<void> {
  invalidarCachePontos();
  const docRef = doc(db, COLLECTION, id);
  const dadosLimpos = Object.fromEntries(
    Object.entries(lancamento).filter(([_, v]) => v !== undefined)
  );
  await updateDoc(docRef, dadosLimpos);
}

export async function listarLancamentosPontos(forceRefresh = false): Promise<LancamentoPonto[]> {
  const now = Date.now();
  if (cachedPontos && !forceRefresh && (now - lastFetchPontos < CACHE_TTL)) {
    return cachedPontos;
  }

  const q = query(collection(db, COLLECTION), orderBy("dataLancamento", "desc"));
  const snapshot = await getDocs(q);

  cachedPontos = snapshot.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<LancamentoPonto, "id">),
  }));

  lastFetchPontos = now;
  return cachedPontos;
}

export async function removerLancamentoPonto(id: string): Promise<void> {
  invalidarCachePontos();
  await deleteDoc(doc(db, COLLECTION, id));
}

export async function reassociarPontosTreinador(
  oldTreinadorId: string,
  newTreinadorId: string,
  newTreinadorNome: string
): Promise<number> {
  invalidarCachePontos();
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
  return snapshot.size;
}


