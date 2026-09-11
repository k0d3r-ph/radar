import type { ContadorPerdasScore, Empresa } from "../types";

type RespostaSimNao = "Sim" | "Não" | "";

/** Formato do questionário de score usado em Home e Histórico (estruturalmente idêntico nos dois). */
export interface ScoreFormAnswers {
  facilContato: RespostaSimNao;
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
 * Perguntas cuja perda é escalonada: a contribuição ao score é `ganhoSim` menos
 * `valorPorMarcacao * marcações seguidas` (desde o último "Sim"), até o teto de
 * `maxMarcacoes` marcações. Ou seja, a 1ª marcação de "Não" só cancela o bônus do
 * "Sim" (contribuição 0); a partir da 2ª a pergunta passa a puxar o score para
 * baixo do neutro. Marcar "Sim" volta ao ganho cheio e zera o contador.
 */
const PERGUNTAS_PERDA_ESCALONADA = {
  facilContato: { ganhoSim: 0.5, valorPorMarcacao: 0.5, maxMarcacoes: 2 },
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
 * O score é recalculado do zero a cada cálculo (não é um valor incremental persistido),
 * então a contribuição desta pergunta precisa ser o valor líquido
 * `{@link RECORDA_TEMAS_GANHO_SIM} - perda pendente`, não "quanto foi recuperado" — é essa
 * subtração que faz a mudança de resposta refletir como delta correto no score total.
 *
 * A perda acumulada anda em degraus: 0 → {@link RECORDA_TEMAS_PERDA_NIVEL_1} (1ª marcação
 * de "Não", cancelando o bônus do "Sim") → {@link RECORDA_TEMAS_PERDA_MAX} (2ª marcação
 * seguida). "Sim" desfaz os degraus na mesma ordem em que foram criados: a 1ª marcação de
 * "Sim" recupera os {@link RECORDA_TEMAS_PERDA_NIVEL_1} pontos do 1º degrau (mesmo partindo
 * do teto, passando por um estado intermediário de perda {@link RECORDA_TEMAS_PERDA_NIVEL_2}),
 * e a 2ª recupera os {@link RECORDA_TEMAS_PERDA_NIVEL_2} pontos do 2º degrau, voltando a 0 (e
 * a contribuição ao bônus cheio). Marcar "Não" com o degrau 1 já recuperado (perda =
 * {@link RECORDA_TEMAS_PERDA_NIVEL_2}) reaplica o 1º degrau, voltando ao teto.
 */
function calcularRecordaTemas(
  resposta: RespostaSimNao,
  perdaAnterior: number,
): { contribuicao: number; perda: number } {
  let perda: number;

  if (resposta === "Sim") {
    if (perdaAnterior >= RECORDA_TEMAS_PERDA_MAX) {
      perda = RECORDA_TEMAS_PERDA_NIVEL_2;
    } else {
      perda = 0;
    }
  } else if (resposta === "Não") {
    if (perdaAnterior <= 0) {
      perda = RECORDA_TEMAS_PERDA_NIVEL_1;
    } else {
      perda = RECORDA_TEMAS_PERDA_MAX;
    }
  } else {
    return { contribuicao: 0, perda: perdaAnterior };
  }

  return { contribuicao: RECORDA_TEMAS_GANHO_SIM - perda, perda };
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
        // A 1ª marcação apenas cancela o bônus do "Sim" (contribuição 0); só a partir da
        // 2ª a pergunta passa a puxar o score para baixo do neutro.
        score += config.ganhoSim - config.valorPorMarcacao * marcacoes;
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

  if (respostas.fazPerguntas === "Sim") score += 1.5;

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
