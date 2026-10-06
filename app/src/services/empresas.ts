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
import { normalizarTelefoneWhatsApp } from "../utils/telefone";
import { sincronizarColecao } from "./sincronizacaoIncremental";

const COLLECTION = "empresas";

// Empresas internas (ex.: treinamentos dados à própria Systemsat) não devem ser
// contabilizadas como clientes na esteira, ongoing, cancelados ou suspensos —
// mas continuam pesquisáveis normalmente ao registrar uma ocorrência.
const NOMES_EMPRESAS_INTERNAS = ["systemsat"];

function normalizarNomeEmpresa(nome: string): string {
  return nome
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function isEmpresaInterna(empresa: Pick<Empresa, "nomeEmpresa">): boolean {
  return NOMES_EMPRESAS_INTERNAS.includes(
    normalizarNomeEmpresa(empresa.nomeEmpresa || ""),
  );
}

/**
 * @deprecated Use `normalizarTelefoneWhatsApp` de `utils/telefone` diretamente.
 * Mantida para não quebrar os imports existentes.
 */
export function formatarTelefoneWhatsApp(telefone?: string): string {
  return normalizarTelefoneWhatsApp(telefone);
}

let cachedEmpresas: Empresa[] | null = null;
let lastFetchEmpresas = 0;
const CACHE_TTL = 300000; // 5 minutos (300.000 ms)

export async function salvarEmpresas(empresa: Partial<Empresa>) {
  const { id, tme, progresso, farol, dias, ocorrenciaAlertaId, ocorrenciasSequenciasReservadas, ...dados } = empresa as any;

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

  const empresas = await sincronizarColecao<Empresa>(COLLECTION, forceRefresh);

  cachedEmpresas = empresas.filter((empresa) => empresa.id);

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
