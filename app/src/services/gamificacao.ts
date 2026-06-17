import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  orderBy,
} from "firebase/firestore";
import { db } from "./firebase";
import type { LancamentoPonto } from "../types";

const COLLECTION = "gamificacao_pontos";

export async function salvarLancamentoPonto(
  lancamento: Omit<LancamentoPonto, "id" | "dataLancamento">
): Promise<string> {
  const docRef = await addDoc(collection(db, COLLECTION), {
    ...lancamento,
    dataLancamento: Date.now(),
  });
  return docRef.id;
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
