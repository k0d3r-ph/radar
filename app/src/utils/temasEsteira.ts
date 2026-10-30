/**
 * Temas e datas da esteira são persistidos como texto, uma linha por fase
 * (`temaText`, `dataText`, `blocoText` e `reagendamentosText`, alinhados pelo índice
 * da linha). Estas funções convertem esse formato para a lista de campos editada na Esteira.
 */
export type LinhaTemaEsteira = {
  tema: string;
  data: string;
  reagendamentos: number;
  /** true quando este tema acontece no mesmo dia do próximo (mesmo bloco/encontro). */
  mesmoDiaDoProximo: boolean;
};

/** Uma linha por fase, sem aparar o texto para não perder o espaço que está sendo digitado. */
export function textosParaLinhasTema(
  temaText = "",
  dataText = "",
  blocoText = "",
  reagendamentosText = "",
): LinhaTemaEsteira[] {
  const temas = temaText.split("\n");
  const datas = dataText.split("\n");
  const blocos = blocoText.split("\n");
  const reagendamentos = reagendamentosText.split("\n");
  const total = Math.max(temas.length, datas.length, reagendamentos.length, 1);
  return Array.from({ length: total }, (_, i) => {
    const contagem = Number(reagendamentos[i]);
    return {
      tema: temas[i] ?? "",
      data: datas[i] ?? "",
      reagendamentos:
        Number.isSafeInteger(contagem) && contagem >= 0 ? contagem : 0,
      mesmoDiaDoProximo: (blocos[i] ?? "") === "1",
    };
  });
}

export function linhasTemaParaTextos(linhas: LinhaTemaEsteira[]) {
  return {
    temaText: linhas.map((l) => l.tema).join("\n"),
    dataText: linhas.map((l) => l.data).join("\n"),
    reagendamentosText: linhas.map((l) => String(Math.max(0, l.reagendamentos))).join("\n"),
    // A última linha nunca carrega o marcador: não existe "próximo" para agrupar.
    blocoText: linhas.map((l, i) => (l.mesmoDiaDoProximo && i < linhas.length - 1 ? "1" : "")).join("\n"),
  };
}

/** Formata uma data digitada como DD/MM, inserindo a barra após o dia. */
export function formatarDataDigitada(valor: string): string {
  const digitos = valor.replace(/\D/g, "").slice(0, 4);
  if (digitos.length < 2) return digitos;
  if (digitos.length === 2) return `${digitos}/`;
  return `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
}

/** Incrementa apenas a fase cuja data foi reagendada, nunca as seguintes recalculadas. */
export function incrementarReagendamentoSeDataAlterada(
  linhas: LinhaTemaEsteira[],
  indice: number,
  dataAnterior: string,
): LinhaTemaEsteira[] {
  const atual = linhas[indice];
  if (
    !atual ||
    !dataAnterior.trim() ||
    dataAnterior.trim() === atual.data.trim()
  ) {
    return linhas;
  }
  return linhas.map((linha, i) =>
    i === indice
      ? { ...linha, reagendamentos: linha.reagendamentos + 1 }
      : linha,
  );
}

export function definirContagemReagendamento(
  linhas: LinhaTemaEsteira[],
  indice: number,
  contagem: number,
): LinhaTemaEsteira[] {
  if (!linhas[indice]) return linhas;
  const valor = Number.isFinite(contagem)
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(contagem)))
    : 0;
  return linhas.map((linha, i) =>
    i === indice ? { ...linha, reagendamentos: valor } : linha,
  );
}

/**
 * Versão para gravar: apara os textos e descarta linhas sem tema e sem data.
 * Remover a linha inteira mantém tema, data e bloco alinhados.
 */
export function normalizarTextosTema(
  temaText = "",
  dataText = "",
  blocoText = "",
  reagendamentosText = "",
) {
  const linhas = textosParaLinhasTema(temaText, dataText, blocoText, reagendamentosText)
    .map((l) => ({
      tema: l.tema.trim(),
      data: l.data.trim(),
      reagendamentos: l.reagendamentos,
      mesmoDiaDoProximo: l.mesmoDiaDoProximo,
    }))
    .filter((l) => l.tema || l.data);
  if (linhas.length === 0) {
    return { temaText: "", dataText: "", blocoText: "", reagendamentosText: "" };
  }
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
