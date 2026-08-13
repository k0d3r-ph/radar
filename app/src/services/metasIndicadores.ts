import { doc, getDoc, setDoc } from "firebase/firestore";

import { db } from "./firebase";

const COLLECTION = "configuracoes";
const DOC_METAS = "metasIndicadores";

/** Meta de cada indicador, indexada pela chave da coluna (ex.: "notaCsat"). */
export type MetasIndicadores = Record<string, number>;

export async function listarMetasIndicadores(): Promise<MetasIndicadores> {
  const snapshot = await getDoc(doc(db, COLLECTION, DOC_METAS));
  if (!snapshot.exists()) return {};

  const dados = snapshot.data()?.metas;
  if (!dados || typeof dados !== "object") return {};

  // Descarta qualquer valor que não seja numérico, para um documento editado
  // manualmente no console não quebrar o cálculo na tela.
  const metas: MetasIndicadores = {};
  Object.entries(dados as Record<string, unknown>).forEach(([chave, valor]) => {
    if (typeof valor === "number" && Number.isFinite(valor)) {
      metas[chave] = valor;
    }
  });
  return metas;
}

export async function salvarMetasIndicadores(
  metas: MetasIndicadores,
): Promise<void> {
  await setDoc(
    doc(db, COLLECTION, DOC_METAS),
    { metas, updatedAt: Date.now() },
    { merge: true },
  );
}
