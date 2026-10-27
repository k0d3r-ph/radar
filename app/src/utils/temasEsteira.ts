/**
 * Temas e datas da esteira são persistidos como texto, uma linha por fase
 * (`temaText`, `dataText` e `blocoText`, alinhados pelo índice da linha). Estas
 * funções convertem esse formato para a lista de campos editada na tela da Esteira.
 */
export type LinhaTemaEsteira = {
  tema: string;
  data: string;
  /** true quando este tema acontece no mesmo dia do próximo (mesmo bloco/encontro). */
  mesmoDiaDoProximo: boolean;
};

/** Uma linha por fase, sem aparar o texto para não perder o espaço que está sendo digitado. */
export function textosParaLinhasTema(temaText = "", dataText = "", blocoText = ""): LinhaTemaEsteira[] {
  const temas = temaText.split("\n");
  const datas = dataText.split("\n");
  const blocos = blocoText.split("\n");
  const total = Math.max(temas.length, datas.length, 1);
  return Array.from({ length: total }, (_, i) => ({
    tema: temas[i] ?? "",
    data: datas[i] ?? "",
    mesmoDiaDoProximo: (blocos[i] ?? "") === "1",
  }));
}

export function linhasTemaParaTextos(linhas: LinhaTemaEsteira[]) {
  return {
    temaText: linhas.map((l) => l.tema).join("\n"),
    dataText: linhas.map((l) => l.data).join("\n"),
    // A última linha nunca carrega o marcador: não existe "próximo" para agrupar.
    blocoText: linhas.map((l, i) => (l.mesmoDiaDoProximo && i < linhas.length - 1 ? "1" : "")).join("\n"),
  };
}

/**
 * Versão para gravar: apara os textos e descarta linhas sem tema e sem data.
 * Remover a linha inteira mantém tema, data e bloco alinhados.
 */
export function normalizarTextosTema(temaText = "", dataText = "", blocoText = "") {
  const linhas = textosParaLinhasTema(temaText, dataText, blocoText)
    .map((l) => ({ tema: l.tema.trim(), data: l.data.trim(), mesmoDiaDoProximo: l.mesmoDiaDoProximo }))
    .filter((l) => l.tema || l.data);
  if (linhas.length === 0) return { temaText: "", dataText: "", blocoText: "" };
  return linhasTemaParaTextos(linhas);
}

/**
 * Agrupa as linhas em blocos (um dia/encontro) seguindo `mesmoDiaDoProximo`: cada
 * bloco é a lista de índices originais que compartilham o mesmo dia planejado.
 */
export function agruparLinhasEmBlocos(linhas: LinhaTemaEsteira[]): number[][] {
  const blocos: number[][] = [];
  let atual: number[] = [];
  linhas.forEach((linha, i) => {
    atual.push(i);
    if (!linha.mesmoDiaDoProximo || i === linhas.length - 1) {
      blocos.push(atual);
      atual = [];
    }
  });
  return blocos;
}
