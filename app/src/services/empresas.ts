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

export function formatarTelefoneWhatsApp(telefone?: string): string {
  if (!telefone) return "";
  const limpo = telefone.replace(/\D/g, "");
  if (!limpo) return "";

  // Se tiver DDD + número (10 ou 11 dígitos, ex: 21999999999)
  if (limpo.length === 10 || limpo.length === 11) {
    return "55" + limpo;
  }

  // Se já tiver DDI 55 (12 ou 13 dígitos, ex: 5521999999999)
  if ((limpo.length === 12 || limpo.length === 13) && limpo.startsWith("55")) {
    return limpo;
  }

  return limpo;
}

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
