import type { ContadorPerdasScore, Empresa } from "../types";

type RespostaSimNao = "Sim" | "Não" | "";

/** Formato do questionário de score usado em Home e Histórico (estruturalmente idêntico nos dois). */
export interface ScoreFormAnswers {
  entraComputador: RespostaSimNao;
  compartilhaTela: RespostaSimNao;
  fazPerguntas: RespostaSimNao;
  recordaTemas: RespostaSimNao;
  faltouDoisDias: RespostaSimNao;
  estruturaNecessaria: RespostaSimNao;
  clienteReclamante: RespostaSimNao;
  clienteSumido: RespostaSimNao;
}

/**
 * Perguntas cuja perda é escalonada: a 1ª marcação seguida de "Não" (desde o
 * último "Sim") só cancela o bônus do "Sim" (contribui 0); a partir da 2ª
 * marcação seguida já pune `valorPorMarcacao` por marcação, até o teto de
 * `(maxMarcacoes - 1) * valorPorMarcacao`. Marcar "Sim" dá o ganho cheio
 * (`ganhoSim`) e zera o contador de perdas.
 */
const PERGUNTAS_PERDA_ESCALONADA = {
  entraComputador: { ganhoSim: 1.0, valorPorMarcacao: 1.0, maxMarcacoes: 2 },
  compartilhaTela: { ganhoSim: 1.0, valorPorMarcacao: 1.0, maxMarcacoes: 2 },
} as const;

/** Perda da 1ª marcação de "Não" seguida em "Cliente se recorda de temas anteriores?". */
const RECORDA_TEMAS_PERDA_NIVEL_1 = 2.0;
/** Perda adicional da 2ª marcação de "Não" seguida (acima da do nível 1). */
const RECORDA_TEMAS_PERDA_NIVEL_2 = 3.0;
/** Bônus de "Sim" quando não há perda pendente para recuperar. */
const RECORDA_TEMAS_GANHO_SIM = 2.0;

const RECORDA_TEMAS_PERDA_MAX =
  RECORDA_TEMAS_PERDA_NIVEL_1 + RECORDA_TEMAS_PERDA_NIVEL_2;

/**
 * Calcula a contribuição ao score da pergunta "Cliente se recorda de temas anteriores?"
 * e a nova perda acumulada a persistir em {@link ContadorPerdasScore.recordaTemas}.
 *
 * "Não" na 1ª marcação seguida só cancela o bônus do "Sim" (contribui 0); a partir da
 * 2ª marcação seguida já pune de verdade com {@link RECORDA_TEMAS_PERDA_NIVEL_2}. "Sim"
 * dá o ganho cheio {@link RECORDA_TEMAS_GANHO_SIM} e zera o contador de perdas.
 */
function calcularRecordaTemas(
  resposta: RespostaSimNao,
  perdaAnterior: number,
): { contribuicao: number; perda: number } {
  if (resposta === "Sim") {
    return { contribuicao: RECORDA_TEMAS_GANHO_SIM, perda: 0 };
  }

  if (resposta === "Não") {
    if (perdaAnterior <= 0) {
      // 1ª marcação seguida só cancela o bônus do Sim (contribui 0).
      return { contribuicao: 0, perda: RECORDA_TEMAS_PERDA_NIVEL_1 };
    }
    // A partir da 2ª marcação seguida já pune de verdade.
    return { contribuicao: -RECORDA_TEMAS_PERDA_NIVEL_2, perda: RECORDA_TEMAS_PERDA_MAX };
  }

  return { contribuicao: 0, perda: perdaAnterior };
}

/**
 * Calcula score e tipo (Fast/Safety) a partir das respostas do questionário, aplicando
 * perda crescente nas perguntas de {@link PERGUNTAS_PERDA_ESCALONADA} conforme o histórico
 * de marcações em `contadoresAnteriores` (persistido em {@link Empresa.scoreContadoresPerda}).
 * Retorna os contadores já atualizados, para serem salvos junto com o score.
 */
export function calcularPontuacaoScore(
  respostas: ScoreFormAnswers,
  contadoresAnteriores?: ContadorPerdasScore,
): { score: number; tipo: "Fast" | "Safety"; contadores: ContadorPerdasScore } {
  let score = 0;
  const contadores: ContadorPerdasScore = {};

  (Object.keys(PERGUNTAS_PERDA_ESCALONADA) as (keyof typeof PERGUNTAS_PERDA_ESCALONADA)[]).forEach(
    (chave) => {
      const config = PERGUNTAS_PERDA_ESCALONADA[chave];
      const resposta = respostas[chave];
      if (resposta === "Sim") {
        score += config.ganhoSim;
        contadores[chave] = 0;
      } else if (resposta === "Não") {
        const marcacoes = Math.min((contadoresAnteriores?.[chave] || 0) + 1, config.maxMarcacoes);
        contadores[chave] = marcacoes;
        // 1ª marcação só cancela o bônus do Sim (contribui 0); a partir da 2ª já pune de verdade.
        score -= config.valorPorMarcacao * (marcacoes - 1);
      } else {
        contadores[chave] = contadoresAnteriores?.[chave] || 0;
      }
    },
  );

  {
    const { contribuicao, perda } = calcularRecordaTemas(
      respostas.recordaTemas,
      contadoresAnteriores?.recordaTemas || 0,
    );
    score += contribuicao;
    contadores.recordaTemas = perda;
  }

  if (respostas.fazPerguntas === "Sim") score += 2.0;

  if (respostas.faltouDoisDias === "Sim") {
    score -= 1.0;
  } else if (respostas.faltouDoisDias === "Não") {
    score += 1.0;
  }

  if (respostas.estruturaNecessaria === "Sim") score += 1.0;

  if (respostas.clienteReclamante === "Sim") {
    score -= 3.0;
  } else if (respostas.clienteReclamante === "Não") {
    score += 2.0;
  }

  if (respostas.clienteSumido === "Sim") score -= 5.0;

  const tipo = score >= 6 ? "Fast" : "Safety";
  return { score, tipo, contadores };
}

/** Quantos dias uma redução de score por contato com o Suporte permanece ativa. */
export const DIAS_REDUCAO_SCORE_SUPORTE = 15;

/** Quanto o score cai por contato do cliente com o Suporte para tirar dúvidas. */
export const VALOR_REDUCAO_SCORE_SUPORTE = 1;

export const MOTIVO_REDUCAO_SCORE_SUPORTE = "Contato com o Suporte (dúvida)";

/** Quantos dias uma redução de score por contato com o Treinamento permanece ativa. */
export const DIAS_REDUCAO_SCORE_TREINAMENTO = 15;

/** Quanto o score cai por contato do cliente com o Treinamento para tirar dúvidas. */
export const VALOR_REDUCAO_SCORE_TREINAMENTO = 1;

export const MOTIVO_REDUCAO_SCORE_TREINAMENTO =
  "Contato com o Treinamento (dúvida)";

/** A partir de quantos dias de intervalo entre a última e a penúltima agenda o score é reduzido. */
export const LIMITE_DIAS_GAP_AGENDA = 5;

/** Quantos dias uma redução de score por intervalo grande entre agendas permanece ativa. */
export const DIAS_REDUCAO_SCORE_GAP_AGENDA = 15;

/** Quanto o score cai quando o intervalo entre a última e a penúltima agenda ultrapassa {@link LIMITE_DIAS_GAP_AGENDA}. */
export const VALOR_REDUCAO_SCORE_GAP_AGENDA = 1;

export const MOTIVO_REDUCAO_SCORE_GAP_AGENDA =
  "Intervalo maior que 5 dias entre agendas";

/** Monta um ajuste temporário de score (ex.: redução por contato de dúvida, ou por gap de agenda). */
export function criarAjusteTemporarioScore(
  motivo: string,
  valor: number,
  dias: number,
  ocorrenciaId?: string,
): NonNullable<Empresa["scoreAjustesTemporarios"]>[number] {
  const agora = Date.now();
  return {
    motivo,
    valor,
    criadoEm: agora,
    expiraEm: agora + dias * 24 * 60 * 60 * 1000,
    ocorrenciaId,
  };
}

/**
 * Score efetivo do cliente: o valor base menos a soma dos ajustes temporários ainda
 * dentro do prazo (ex.: reduções por contato recente com o Suporte). Ajustes vencidos
 * são ignorados, sem precisar de uma limpeza ativa dos dados salvos.
 */
export function calcularScoreEfetivo(empresa: Pick<Empresa, "score" | "scoreAjustesTemporarios">): number | undefined {
  if (typeof empresa.score !== "number") return undefined;
  const agora = Date.now();
  const reducaoAtiva = (empresa.scoreAjustesTemporarios || [])
    .filter((a) => a.expiraEm > agora)
    .reduce((soma, a) => soma + a.valor, 0);
  return empresa.score - reducaoAtiva;
}

/**
 * Tipo (Fast/Safety) do cliente considerando o score efetivo (já com reduções
 * temporárias aplicadas), não apenas o `tipo` gravado no momento do questionário.
 * Sem isso, uma redução temporária (ex.: contato com o Suporte) pode derrubar o
 * score para menos de 6 sem que o `tipo` armazenado seja atualizado, deixando o
 * cliente marcado como Fast mesmo com score efetivo baixo.
 */
export function obterTipoEfetivo(
  empresa: Pick<Empresa, "score" | "scoreAjustesTemporarios" | "tipo">,
): "Fast" | "Safety" | "" {
  const scoreEfetivo = calcularScoreEfetivo(empresa);
  if (typeof scoreEfetivo !== "number") return empresa.tipo;
  return scoreEfetivo >= 6 ? "Fast" : "Safety";
}

/** Rótulo curto exibido no resumo do score para cada motivo de redução temporária. */
const LABEL_REDUCAO_POR_MOTIVO: Record<string, string> = {
  [MOTIVO_REDUCAO_SCORE_SUPORTE]: "contato com Suporte",
  [MOTIVO_REDUCAO_SCORE_TREINAMENTO]: "contato com Treinamento",
  [MOTIVO_REDUCAO_SCORE_GAP_AGENDA]: "intervalo entre agendas",
};

/**
 * Descreve, em texto curto, os motivos das reduções ativas passadas (ex.: "contato com
 * Suporte", ou "contato com Suporte e contato com Treinamento" quando há mais de um).
 * Usado no resumo do score para não fixar sempre "contato com Suporte", já que a
 * mesma redução pode vir do Treinamento ou de um gap de agenda.
 */
export function descreverMotivosReducaoAtiva(
  ajustes: NonNullable<Empresa["scoreAjustesTemporarios"]>,
): string {
  const labels = Array.from(
    new Set(ajustes.map((a) => LABEL_REDUCAO_POR_MOTIVO[a.motivo] || a.motivo)),
  );
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`;
}

/** Ajustes temporários de score ainda dentro do prazo (não vencidos), para exibir a composição do resultado. */
export function obterAjustesAtivos(
  empresa: Pick<Empresa, "scoreAjustesTemporarios">,
): NonNullable<Empresa["scoreAjustesTemporarios"]> {
  const agora = Date.now();
  return (empresa.scoreAjustesTemporarios || []).filter((a) => a.expiraEm > agora);
}

/** Janela de tolerância para casar um ajuste sem `ocorrenciaId` com a ocorrência que o originou. */
const JANELA_CORRELACAO_AJUSTE_MS = 5 * 60 * 1000;

/**
 * Acha a ocorrência que originou um ajuste temporário de score. Ajustes criados
 * a partir da referência gravada em {@link Empresa.scoreAjustesTemporarios} usam
 * `ocorrenciaId` diretamente; ajustes antigos (gravados antes desse campo existir)
 * são casados pela ocorrência de Suporte/Dúvida da mesma empresa gravada no mesmo
 * instante da redução (os dois são gravados em sequência na mesma ação). A
 * comparação usa `updatedAt` — timestamp real de gravação, sempre `Date.now()` — e
 * não `createdAt`/`dataOcorrencia`, que o usuário pode editar livremente no
 * formulário para refletir quando o contato de fato aconteceu.
 */
export function encontrarOcorrenciaDoAjuste<
  T extends {
    id?: string;
    createdAt?: number;
    dataOcorrencia?: number;
    updatedAt?: number;
    departamento: string;
    tipo: string;
  },
>(
  ajuste: { ocorrenciaId?: string; criadoEm: number },
  ocorrenciasDaEmpresa: T[],
): T | undefined {
  if (ajuste.ocorrenciaId) {
    const direta = ocorrenciasDaEmpresa.find((o) => o.id === ajuste.ocorrenciaId);
    if (direta) return direta;
  }

  let melhor: T | undefined;
  let menorDiff = Infinity;
  ocorrenciasDaEmpresa.forEach((o) => {
    if (o.departamento !== "Suporte" || o.tipo !== "Dúvida") return;
    const referencia = o.updatedAt ?? o.createdAt ?? o.dataOcorrencia ?? 0;
    const diff = Math.abs(referencia - ajuste.criadoEm);
    if (diff < menorDiff) {
      menorDiff = diff;
      melhor = o;
    }
  });
  return menorDiff <= JANELA_CORRELACAO_AJUSTE_MS ? melhor : undefined;
}
