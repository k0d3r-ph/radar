import type { LancamentoPonto } from "../types";

interface TreinadorRanking {
  uid: string;
  nome: string;
  email: string;
}

export interface DesempenhoGamificacao extends TreinadorRanking {
  baseScore: number;
  score: number;
  qtdAcoes: number;
  qtdFalhas: number;
  totalTrainingsCount: number;
  answeredTrainingsCount: number;
  taxaResposta: number;
  bonusPercentage: number;
  lancamentos: LancamentoPonto[];
  empate: boolean;
}

/** Mesma apuração do placar: os filtros de treinador e motivo são só do histórico. */
export function calcularRankingGamificacao<T extends TreinadorRanking>(
  treinadores: T[],
  lancamentos: LancamentoPonto[],
): (T & DesempenhoGamificacao)[] {
  const ranking = treinadores.map((t) => {
    const trainerEntries = lancamentos.filter((e) => e.treinadorId === t.uid);
    const baseScore = trainerEntries.reduce((acc, curr) => acc + curr.pontos, 0);
    const realizedTrainings = trainerEntries.filter((e) => {
      if (e.tipoAcao !== "treinamento" || !e.treinamentoTema) return false;
      const themes = e.treinamentoTema.split(",").map((theme) => theme.trim().toLowerCase());
      return !themes.includes("cancelado") && !themes.includes("ausente");
    });
    const answeredTrainings = realizedTrainings.filter(
      (e) => (e.treinamentoNotas && e.treinamentoNotas.length > 0) ||
        (e.treinamentoResultados && e.treinamentoResultados.length > 0),
    );
    const totalTrainingsCount = realizedTrainings.length;
    const answeredTrainingsCount = answeredTrainings.length;
    const taxaResposta = totalTrainingsCount > 0 ? answeredTrainingsCount / totalTrainingsCount : 0;
    let bonus = 0;
    if (taxaResposta >= 0.9) bonus = 0.3;
    else if (taxaResposta >= 0.8) bonus = 0.2;
    else if (taxaResposta >= 0.7) bonus = 0.1;
    const score = parseFloat((baseScore * (1 + bonus)).toFixed(1));
    const qtdAcoes = trainerEntries.filter((e) => {
      if (e.tipoAcao === "chamado_falha" || e.tipoAcao === "desconto_suporte") return false;
      if (e.tipoAcao === "treinamento" && e.treinamentoTema) {
        const themes = e.treinamentoTema.split(",").map((theme) => theme.trim().toLowerCase());
        if (themes.includes("cancelado") || themes.includes("ausente")) return false;
      }
      return true;
    }).length;
    const qtdFalhas = trainerEntries.filter((e) => e.tipoAcao === "chamado_falha").length;
    return {
      ...t, baseScore, score, qtdAcoes, qtdFalhas, totalTrainingsCount,
      answeredTrainingsCount, taxaResposta, bonusPercentage: Math.round(bonus * 100),
      lancamentos: trainerEntries, empate: false,
    };
  }).sort((a, b) => b.score - a.score || b.taxaResposta - a.taxaResposta ||
    a.qtdFalhas - b.qtdFalhas || a.nome.localeCompare(b.nome));

  const mesmosCriterios = (a: DesempenhoGamificacao, b?: DesempenhoGamificacao) =>
    !!b && b.lancamentos.length > 0 && a.score === b.score && a.taxaResposta === b.taxaResposta && a.qtdFalhas === b.qtdFalhas;
  return ranking.map((t, index) => ({
    ...t,
    empate: t.lancamentos.length > 0 &&
      (mesmosCriterios(t, ranking[index - 1]) || mesmosCriterios(t, ranking[index + 1])),
  }));
}

/** A composição usa os valores efetivamente aplicados, inclusive em bases negativas. */
export function comporPontosGamificacao(treinador: DesempenhoGamificacao) {
  const grupos = new Map<string, { tipo: string; quantidade: number; pontos: number }>();
  for (const entry of treinador.lancamentos) {
    const grupo = grupos.get(entry.tipoAcao) ?? { tipo: entry.tipoAcao, quantidade: 0, pontos: 0 };
    grupo.quantidade += 1;
    grupo.pontos += entry.pontos;
    grupos.set(entry.tipoAcao, grupo);
  }
  return {
    grupos: [...grupos.values()],
    bonusPontos: Number((treinador.score - treinador.baseScore).toFixed(1)),
  };
}
