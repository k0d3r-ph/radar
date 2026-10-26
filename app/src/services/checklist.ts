import {
  collection,
  addDoc,
  deleteDoc,
  deleteField,
  doc,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import { RADAR_API_URL } from './apiConfig';
import type { TarefaChecklist } from "../types";
import { sincronizarColecao } from "./sincronizacaoIncremental";

const COLLECTION = "checklist_tarefas";

let cachedTarefas: TarefaChecklist[] | null = null;
let lastFetchTarefas = 0;
let cachedUsuario: string | undefined;
const CACHE_TTL = 30000; // 30 segundos

export async function listarTarefasChecklist(forceRefresh = false): Promise<TarefaChecklist[]> {
  const now = Date.now();
  if (cachedTarefas && cachedUsuario === auth.currentUser?.uid && !forceRefresh && (now - lastFetchTarefas < CACHE_TTL)) {
    return cachedTarefas;
  }

  // Sincronização incremental: lê só as tarefas criadas ou alteradas desde a
  // última consulta. A ordem vem do cliente, como nas demais listas do Radar.
  const tarefas = await sincronizarColecao<TarefaChecklist>(COLLECTION, forceRefresh);
  cachedTarefas = tarefas.filter(t => !t.excluida).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  lastFetchTarefas = now;
  cachedUsuario = auth.currentUser?.uid;
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
  // Firestore não aceita `undefined` em updateDoc; campos undefined viram
  // deleteField() para permitir remover valores opcionais (ex: SLA).
  const payload: Record<string, unknown> = { ...updates, updatedAt: Date.now() };
  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) {
      payload[key] = deleteField();
    }
  });

  await updateDoc(doc(db, COLLECTION, id), payload);

  if (cachedTarefas) {
    cachedTarefas = cachedTarefas.map((t) => (t.id === id ? { ...t, ...updates } : t));
  }
}

export async function removerTarefaChecklist(id: string, concluida = false): Promise<void> {
  if (concluida) {
    if (!auth.currentUser) throw new Error('Entre novamente no Radar.');
    const token = await auth.currentUser.getIdToken();
    let response: Response;
    try {
      response = await fetch(`${RADAR_API_URL}/api/checklist/tarefas/${encodeURIComponent(id)}/concluida`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
      });
    } catch { throw new Error('Não foi possível conectar à API para excluir a tarefa. Tente novamente.'); }
    const dados: unknown = await response.json().catch(() => { throw new Error('A API retornou uma resposta inválida. Confira se o backend está atualizado.'); });
    if (!response.ok) {
      const mensagem = dados && typeof dados === 'object' && 'error' in dados && typeof dados.error === 'string' ? dados.error : 'Não foi possível excluir a tarefa. Tente novamente.';
      throw new Error(mensagem);
    }
    if (!dados || typeof dados !== 'object' || !('sucesso' in dados) || dados.sucesso !== true) throw new Error('A API não confirmou a exclusão da tarefa. Atualize a lista e tente novamente.');
  } else {
    await deleteDoc(doc(db, COLLECTION, id));
  }

  if (cachedTarefas) {
    cachedTarefas = cachedTarefas.filter((t) => t.id !== id);
  }
}
