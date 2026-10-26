import {
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  runTransaction,
  doc,
  getDocs,
  query,
  limit,
} from "firebase/firestore";

import { auth, db } from "./firebase";
import type { Empresa } from "../types";
import { normalizarTelefoneWhatsApp } from "../utils/telefone";
import { sincronizarColecao } from "./sincronizacaoIncremental";
import { descreverQuedaParaSafetyPorReducao, obterTipoEfetivo } from "../utils/score";

const COLLECTION = "empresas";

export function invalidarCacheEmpresas(): void { cachedEmpresas = null; }

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
let cachedUsuario: string | undefined;
const CACHE_TTL = 300000; // 5 minutos (300.000 ms)

/** Lê o score mais recente e aplica cada redução uma única vez, inclusive com gravações concorrentes. */
export async function aplicarReducaoScoreEmpresa(
  empresaId: string,
  ajuste: NonNullable<Empresa["scoreAjustesTemporarios"]>[number],
  motivo: string,
): Promise<string | null> {
  const ref = doc(db, COLLECTION, empresaId);
  const resultado = await runTransaction(db, async (transaction) => {
    const documento = await transaction.get(ref);
    if (!documento.exists()) throw new Error("Cliente não encontrado ao aplicar redução de score.");
    const atual = documento.data() as Empresa;
    const anteriores = atual.scoreAjustesTemporarios ?? [];
    if (ajuste.ocorrenciaId && anteriores.some((a) => a.ocorrenciaId === ajuste.ocorrenciaId && a.motivo === ajuste.motivo)) return null;
    const agora = Date.now();
    const ajustes = [...anteriores.filter((a) => a.expiraEm > agora), ajuste];
    const descricao = descreverQuedaParaSafetyPorReducao(atual, ajustes, motivo);
    const dados = { scoreAjustesTemporarios: ajustes, tipo: obterTipoEfetivo({ ...atual, scoreAjustesTemporarios: ajustes }), updatedAt: agora };
    transaction.update(ref, dados);
    return { dados, descricao };
  });
  if (resultado && cachedEmpresas) {
    cachedEmpresas = cachedEmpresas.map((e) => e.id === empresaId ? { ...e, ...resultado.dados } : e);
  }
  return resultado?.descricao ?? null;
}

export async function salvarEmpresas(
  empresa: Partial<Empresa>,
  opcoes?: { updatedAtEsperado?: number },
) {
  const { id, tme, progresso, farol, dias, diasSuspenso, motivoSuspensao, ocorrenciaAlertaId, ocorrenciasSequenciasReservadas, ...dados } = empresa as any;

  const dadosLimpos = Object.fromEntries(
    Object.entries(dados).filter(([_, v]) => v !== undefined)
  );

  const updatedAt = Date.now();

  if (id) {
    const ref = doc(db, COLLECTION, id);

    if (opcoes?.updatedAtEsperado !== undefined) {
      await runTransaction(db, async (transaction) => {
        const atual = await transaction.get(ref);
        if (atual.exists() && atual.data()?.updatedAt !== opcoes.updatedAtEsperado) {
          throw new Error(
            'Este cliente foi alterado por outra pessoa enquanto você editava. Recarregue a página e tente novamente.',
          );
        }
        transaction.update(ref, {
          ...dadosLimpos,
          updatedAt,
        });
      });
    } else {
      await updateDoc(ref, {
        ...dadosLimpos,
        updatedAt,
      });
    }

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

  if (cachedEmpresas && cachedUsuario === auth.currentUser?.uid && !forceRefresh && (now - lastFetchEmpresas < CACHE_TTL)) {
    return cachedEmpresas;
  }

  const empresas = await sincronizarColecao<Empresa>(COLLECTION, forceRefresh);

  cachedEmpresas = empresas.filter((empresa) => empresa.id);

  lastFetchEmpresas = now;
  cachedUsuario = auth.currentUser?.uid;
  return cachedEmpresas;
}

export async function removerEmpresa(id: string) {
  await deleteDoc(doc(db, "empresas", id));

  // Remoção Otimista do Cache
  if (cachedEmpresas) {
    cachedEmpresas = cachedEmpresas.filter((e) => e.id !== id);
  }
}
