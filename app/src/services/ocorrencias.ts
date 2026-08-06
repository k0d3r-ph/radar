import {
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  getDocs,
  query,
  orderBy,
  limit,
} from "firebase/firestore";

import { db } from "./firebase";
import type { Ocorrencia } from "../types";

const COLLECTION = "ocorrencias";

let cachedOcorrencias: Ocorrencia[] | null = null;
let lastFetchOcorrencias = 0;
const CACHE_TTL = 300000; // 5 minutos (300.000 ms)

export async function salvarOcorrencia(ocorrencia: Ocorrencia) {
  const { horaOcorrencia, id, ...dados } = ocorrencia as any;

  const dadosLimpos = Object.fromEntries(
    Object.entries(dados).filter(([_, v]) => v !== undefined),
  );

  if (id) {
    const ref = doc(db, COLLECTION, id);
    const updatedAt = Date.now();
    await updateDoc(ref, {
      ...dadosLimpos,
      updatedAt,
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
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<Ocorrencia, "id">),
    })) as Ocorrencia[];
  }

  if (cachedOcorrencias && !forceRefresh && (now - lastFetchOcorrencias < CACHE_TTL)) {
    return cachedOcorrencias;
  }

  const q = query(collection(db, COLLECTION), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);

  cachedOcorrencias = snapshot.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Ocorrencia, "id">),
  }));

  lastFetchOcorrencias = now;
  return cachedOcorrencias;
}

export async function removerOcorrencia(id: string) {
  await deleteDoc(doc(db, COLLECTION, id));

  // Remoção Otimista do Cache
  if (cachedOcorrencias) {
    cachedOcorrencias = cachedOcorrencias.filter((o) => o.id !== id);
  }
}
