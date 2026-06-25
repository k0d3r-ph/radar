import {
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  getDocs,
  getDoc,
} from "firebase/firestore";

import { db } from "./firebase";
import type { Empresa } from "../types";
import { calcularTotalFases, calcularProgressoPorFases } from "../utils/monitoramento";

const COLLECTION = "empresas";

export async function salvarEmpresas(empresa: Partial<Empresa>) {
  const { id, tme, progresso, farol, dias, ocorrenciaAlertaId, ...dados } = empresa as any;

  let concludedAtToSave = dados.concludedAt;

  if (id) {
    const ref = doc(db, COLLECTION, id);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const currentData = snap.data();
      const currentPhaseVal = dados.currentPhase !== undefined ? dados.currentPhase : currentData.currentPhase;
      const temaTextVal = dados.temaText !== undefined ? dados.temaText : currentData.temaText;
      const totalFases = calcularTotalFases(temaTextVal || "");
      const progressoCalculado = calcularProgressoPorFases(currentPhaseVal ?? 0, totalFases);

      if (progressoCalculado >= 100) {
        concludedAtToSave = currentData.concludedAt || Date.now();
      } else {
        concludedAtToSave = null;
      }
    }
  } else {
    const currentPhase = dados.currentPhase ?? 0;
    const totalFases = calcularTotalFases(dados.temaText || "");
    const progressoCalculado = calcularProgressoPorFases(currentPhase, totalFases);
    if (progressoCalculado >= 100) {
      concludedAtToSave = Date.now();
    } else {
      concludedAtToSave = null;
    }
  }

  dados.concludedAt = concludedAtToSave;

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
