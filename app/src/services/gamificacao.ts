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

export async function salvarLancamentoPonto(
  lancamento: Omit<LancamentoPonto, "id" | "dataLancamento">
): Promise<string> {
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
  const docRef = doc(db, COLLECTION, id);
  const dadosLimpos = Object.fromEntries(
    Object.entries(lancamento).filter(([_, v]) => v !== undefined)
  );
  await updateDoc(docRef, dadosLimpos);
}

export async function listarLancamentosPontos(): Promise<LancamentoPonto[]> {
  const q = query(collection(db, COLLECTION), orderBy("dataLancamento", "desc"));
  const snapshot = await getDocs(q);

  return snapshot.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<LancamentoPonto, "id">),
  }));
}

export async function removerLancamentoPonto(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
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
  return snapshot.size;
}

