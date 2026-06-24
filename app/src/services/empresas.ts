import {
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  getDocs,
} from "firebase/firestore";

import { db } from "./firebase";
import type { Empresa } from "../types";

const COLLECTION = "empresas";

export async function salvarEmpresas(empresa: Partial<Empresa>) {
  const { id, tme, progresso, farol, dias, ocorrenciaAlertaId, ...dados } = empresa as any;

  const dadosLimpos = Object.fromEntries(
    Object.entries(dados).filter(([_, v]) => v !== undefined)
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
    updatedAt: Date.now(),
  });

  return docRef.id;
}

export async function listarEmpresas() {
  const snapshot = await getDocs(collection(db, COLLECTION));

  return snapshot.docs
    .map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<Empresa, "id">),
    }))
    .filter((empresa) => empresa.id);
}

export async function removerEmpresa(id: string) {
  await deleteDoc(doc(db, "empresas", id));
}
