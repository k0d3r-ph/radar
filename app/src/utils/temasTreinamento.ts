const PREFIXO_REVISAO = "Revisão de ";

export function normalizarTemaTreinamento(tema: string): string {
  // Espaços repetidos dentro do nome ("Funções do  App") viram um só, para o
  // tema da ocorrência bater com o da esteira independentemente da digitação.
  return tema
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:Revisão de\s+)+/i, "")
    .trim();
}

export function normalizarTemasTreinamento(temas: string[]): string[] {
  return [...new Set(temas.map(normalizarTemaTreinamento).filter(Boolean))];
}

export function isTemaTreinamento(tema: string): boolean {
  return !["", "ausente", "cancelado"].includes(
    normalizarTemaTreinamento(tema).toLowerCase(),
  );
}

/** Revisões também são treinamentos realizados, mesmo sem avançar a esteira. */
export function isTreinamentoRealizado(ocorrencia: {
  tipo: string;
  temaOcorrencia?: string[];
}): boolean {
  const temas = normalizarTemasTreinamento(ocorrencia.temaOcorrencia ?? []);
  return ocorrencia.tipo === "Treinamento" &&
    temas.length > 0 && temas.every(isTemaTreinamento);
}

/**
 * Instante em que o treinamento aconteceu. Em ocorrências de Treinamento,
 * `dataOcorrencia` guarda a data do PRÓXIMO treinamento (campo opcional do
 * formulário), não a da aula: o registro é feito no momento da aula, então a
 * data de realização é `createdAt`. `dataOcorrencia` só é usado em registros
 * antigos sem `createdAt`.
 */
export function instanteRealizacaoTreinamento(ocorrencia: {
  createdAt?: number;
  dataOcorrencia?: number;
}): number {
  return ocorrencia.createdAt || ocorrencia.dataOcorrencia || 0;
}

/** Recupera também registros antigos com prefixos repetidos e tags duplicadas. */
export function lerTemasTreinamento(temas: string[], revisaoLegada = false) {
  const selecionados = normalizarTemasTreinamento(temas);
  const revisados = normalizarTemasTreinamento(
    temas.filter((tema) => /^Revisão de\s+/i.test(tema.trim())),
  ).filter(isTemaTreinamento);
  const validos = selecionados.filter(isTemaTreinamento);
  // Havendo marcações por tema, elas prevalecem sobre a flag geral antiga.
  const temasRevisados = revisados.length > 0
    ? revisados
    : revisaoLegada ? validos : [];

  return {
    temas: selecionados,
    temasRevisados,
    isRevisao: validos.length > 0 && validos.every((t) => temasRevisados.includes(t)),
  };
}

export function prepararTemasTreinamento(
  temas: string[],
  temasRevisados: string[],
  todosRevisados = false,
) {
  const selecionados = normalizarTemasTreinamento(temas);
  const revisados = new Set(normalizarTemasTreinamento(temasRevisados));
  const validos = selecionados.filter(isTemaTreinamento);
  const ehRevisao = (tema: string) => todosRevisados || revisados.has(tema);
  const temasNovos = validos.filter((tema) => !ehRevisao(tema));

  return {
    temaOcorrencia: selecionados.map((tema) =>
      isTemaTreinamento(tema) && ehRevisao(tema) ? `${PREFIXO_REVISAO}${tema}` : tema,
    ),
    isRevisao: validos.length > 0 && temasNovos.length === 0,
    temasNovos,
  };
}
