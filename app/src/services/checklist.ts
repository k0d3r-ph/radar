import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  orderBy,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";
import type { TarefaChecklist } from "../types";

const COLLECTION = "checklist_tarefas";

let cachedTarefas: TarefaChecklist[] | null = null;
let lastFetchTarefas = 0;
const CACHE_TTL = 30000; // 30 segundos

export async function listarTarefasChecklist(forceRefresh = false): Promise<TarefaChecklist[]> {
  const now = Date.now();
  if (cachedTarefas && !forceRefresh && (now - lastFetchTarefas < CACHE_TTL)) {
    return cachedTarefas;
  }

  const q = query(collection(db, COLLECTION), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);

  cachedTarefas = snapshot.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<TarefaChecklist, "id">),
  }));

  lastFetchTarefas = now;
  return cachedTarefas;
}

export async function criarTarefaChecklist(
  dados: Omit<TarefaChecklist, "id">
): Promise<string> {
  const docRef = await addDoc(collection(db, COLLECTION), dados);

  const novaTarefa: TarefaChecklist = { id: docRef.id, ...dados };
  if (cachedTarefas) {
    cachedTarefas = [novaTarefa, ...cachedTarefas];
  }

  return docRef.id;
}

export async function atualizarTarefaChecklist(
  id: string,
  updates: Partial<TarefaChecklist>
): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), updates);

  if (cachedTarefas) {
    cachedTarefas = cachedTarefas.map((t) => (t.id === id ? { ...t, ...updates } : t));
  }
}

export async function removerTarefaChecklist(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));

  if (cachedTarefas) {
    cachedTarefas = cachedTarefas.filter((t) => t.id !== id);
  }
}
