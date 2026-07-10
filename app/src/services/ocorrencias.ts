import {
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  getDocs,
  query,
  orderBy,
} from "firebase/firestore";

import { db } from "./firebase";
import type { Ocorrencia } from "../types";

const COLLECTION = "ocorrencias";

let cachedOcorrencias: Ocorrencia[] | null = null;
let lastFetchOcorrencias = 0;
const CACHE_TTL = 30000; // 30 segundos

export async function salvarOcorrencia(ocorrencia: Ocorrencia) {
  // Invalida o cache
  cachedOcorrencias = null;
  lastFetchOcorrencias = 0;

  const { horaOcorrencia, id, ...dados } = ocorrencia as any;

  const dadosLimpos = Object.fromEntries(
    Object.entries(dados).filter(([_, v]) => v !== undefined),
  );

  if (id) {
    const ref = doc(db, COLLECTION, id);
    await updateDoc(ref, {
      ...dadosLimpos,
      updatedAt: Date.now(),
    });
    return id;
  }

  const docRef = await addDoc(collection(db, COLLECTION), {
    ...dadosLimpos,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  return docRef.id;
}

export async function listarOcorrencias(forceRefresh = false) {
  const now = Date.now();
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
  // Invalida o cache
  cachedOcorrencias = null;
  lastFetchOcorrencias = 0;

  await deleteDoc(doc(db, COLLECTION, id));
}

