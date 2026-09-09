import type { Empresa } from "../types";

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
