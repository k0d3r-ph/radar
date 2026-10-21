/**
 * Temas e datas da esteira são persistidos como texto, uma linha por fase
 * (`temaText` e `dataText`, alinhados pelo índice da linha). Estas funções
 * convertem esse formato para a lista de campos editada na tela da Esteira.
 */
export type LinhaTemaEsteira = { tema: string; data: string };

/** Uma linha por fase, sem aparar o texto para não perder o espaço que está sendo digitado. */
export function textosParaLinhasTema(temaText = "", dataText = ""): LinhaTemaEsteira[] {
  const temas = temaText.split("\n");
  const datas = dataText.split("\n");
  const total = Math.max(temas.length, datas.length, 1);
  return Array.from({ length: total }, (_, i) => ({
    tema: temas[i] ?? "",
    data: datas[i] ?? "",
  }));
}

export function linhasTemaParaTextos(linhas: LinhaTemaEsteira[]) {
  return {
    temaText: linhas.map((l) => l.tema).join("\n"),
    dataText: linhas.map((l) => l.data).join("\n"),
  };
}

/**
 * Versão para gravar: apara os textos e descarta linhas sem tema e sem data.
 * Remover a linha inteira mantém tema e data alinhados.
 */
export function normalizarTextosTema(temaText = "", dataText = "") {
  const linhas = textosParaLinhasTema(temaText, dataText)
    .map((l) => ({ tema: l.tema.trim(), data: l.data.trim() }))
    .filter((l) => l.tema || l.data);
  if (linhas.length === 0) return { temaText: "", dataText: "" };
  return linhasTemaParaTextos(linhas);
}
