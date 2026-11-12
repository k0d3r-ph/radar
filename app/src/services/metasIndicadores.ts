import { doc, getDoc, setDoc } from "firebase/firestore";

import { db } from "./firebase";

const COLLECTION = "configuracoes";
const DOC_METAS = "metasIndicadores";
/** Metas do painel ao vivo "Indicadores de Treinamento" — documento separado das metas
 * da Gamificação, que usam outras chaves e outra tela. */
export const DOC_METAS_PAINEL_TREINAMENTO = "metasPainelTreinamento";

/** Meta de cada indicador, indexada pela chave da coluna (ex.: "notaCsat"). */
export type MetasIndicadores = Record<string, number>;

export async function listarMetasIndicadores(
  documento: string = DOC_METAS,
): Promise<MetasIndicadores> {
  const snapshot = await getDoc(doc(db, COLLECTION, documento));
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
  documento: string = DOC_METAS,
): Promise<void> {
  await setDoc(
    doc(db, COLLECTION, documento),
    { metas, updatedAt: Date.now() },
    { merge: true },
  );
}
