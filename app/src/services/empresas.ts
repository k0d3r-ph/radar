import {
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  getDocs,
  query,
  limit,
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

let cachedEmpresas: Empresa[] | null = null;
let lastFetchEmpresas = 0;
const CACHE_TTL = 300000; // 5 minutos (300.000 ms)

export async function salvarEmpresas(empresa: Partial<Empresa>) {
  const { id, tme, progresso, farol, dias, ocorrenciaAlertaId, ...dados } = empresa as any;

  const dadosLimpos = Object.fromEntries(
    Object.entries(dados).filter(([_, v]) => v !== undefined)
  );

  const updatedAt = Date.now();

  if (id) {
    const ref = doc(db, COLLECTION, id);

    await updateDoc(ref, {
      ...dadosLimpos,
      updatedAt,
    });

    // Atualização Otimista do Cache
    if (cachedEmpresas) {
      cachedEmpresas = cachedEmpresas.map((e) =>
        e.id === id ? ({ ...e, ...empresa, ...dadosLimpos, updatedAt } as Empresa) : e
      );
    }

    return id;
  }

  const docRef = await addDoc(collection(db, COLLECTION), {
    ...dadosLimpos,
    updatedAt,
  });

  const novaEmpresa = {
    ...empresa,
    ...dadosLimpos,
    updatedAt,
    id: docRef.id,   // sempre por último — garante que o ID real não seja sobrescrito por undefined
  } as Empresa;

  // Inserção Otimista do Cache (no final)
  if (cachedEmpresas) {
    cachedEmpresas = [...cachedEmpresas, novaEmpresa];
  }

  return docRef.id;
}

export async function listarEmpresas(forceRefresh = false, limitCount?: number) {
  const now = Date.now();

  // Se for especificado um limite de registros, faz a busca sob demanda sem afetar o cache global
  if (limitCount) {
    const q = query(collection(db, COLLECTION), limit(limitCount));
    const snapshot = await getDocs(q);
    return snapshot.docs
      .map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<Empresa, "id">),
      }))
      .filter((empresa) => empresa.id) as Empresa[];
  }

  if (cachedEmpresas && !forceRefresh && (now - lastFetchEmpresas < CACHE_TTL)) {
    return cachedEmpresas;
  }

  const snapshot = await getDocs(collection(db, COLLECTION));

  cachedEmpresas = snapshot.docs
    .map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<Empresa, "id">),
    }))
    .filter((empresa) => empresa.id) as Empresa[];

  lastFetchEmpresas = now;
  return cachedEmpresas;
}

export async function removerEmpresa(id: string) {
  await deleteDoc(doc(db, "empresas", id));

  // Remoção Otimista do Cache
  if (cachedEmpresas) {
    cachedEmpresas = cachedEmpresas.filter((e) => e.id !== id);
  }
}
