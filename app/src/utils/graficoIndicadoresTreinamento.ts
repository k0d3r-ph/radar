import type { LineChartSeries } from "../components/LineChart";
import type { IntervaloComparacaoTreinamento } from "./comparativoTreinamento";
import {
  calcularValorKpiTreinamento,
  formatarValorKpiTreinamento,
  gerarPeriodosIndicadoresEntreDatas,
  KPI_POR_CHAVE,
  type EventosIndicadoresTreinamento,
  type KpiTreinamentoChave,
} from "./indicadoresTreinamento";

interface OpcoesGrafico {
  atual: IntervaloComparacaoTreinamento;
  comparacoes: IntervaloComparacaoTreinamento[];
  granularidade: "dia" | "semana";
  incluirFinsDeSemana: boolean;
  eventos: EventosIndicadoresTreinamento;
  kpi: KpiTreinamentoChave;
  treinador: string | null;
  cor: string;
}

const CORES_COMPARACAO = ["#f59e0b", "#10b981", "#a78bfa", "#f472b6", "#06b6d4", "#f97316"];
const dataCompleta = (data: Date) => data.toLocaleDateString("pt-BR");

/** Alinha cada período pela posição no calendário; datas ausentes não viram zeros. */
export function construirGraficoIndicadoresTreinamento(opcoes: OpcoesGrafico): {
  categorias: string[];
  series: LineChartSeries[];
} {
  const { atual, comparacoes, granularidade, incluirFinsDeSemana, eventos, kpi, treinador, cor } = opcoes;
  const comparando = comparacoes.length > 0;
  // Ao comparar dias, preserva a posição de cada dia do calendário, inclusive fins de semana.
  const periodos = [atual, ...comparacoes].map((intervalo) =>
    gerarPeriodosIndicadoresEntreDatas(intervalo.inicio, intervalo.fim, granularidade,
      comparando || incluirFinsDeSemana).map((p) => ({
        ...p,
        inicio: new Date(Math.max(p.inicio.getTime(), intervalo.inicio.getTime())),
        fim: new Date(Math.min(p.fim.getTime(), intervalo.fim.getTime())),
      })),
  );
  const quantidade = Math.max(0, ...periodos.map((lista) => lista.length));
  const categorias = Array.from({ length: quantidade }, (_, i) => comparando
    ? `${granularidade === "dia" ? "Dia" : "Semana"} ${i + 1}` : periodos[0][i].categoria);
  const intervalos = [atual, ...comparacoes];
  const series = periodos.map((lista, indice): LineChartSeries => {
    const intervalo = intervalos[indice];
    const rotulo = `${dataCompleta(intervalo.inicio)} a ${dataCompleta(intervalo.fim)}`;
    const valores = lista.map((p) => calcularValorKpiTreinamento(kpi, eventos, p.inicio, p.fim, treinador));
    return {
      label: comparando ? `${indice === 0 ? "Principal" : "Comparação"}: ${rotulo}` : KPI_POR_CHAVE[kpi].titulo,
      color: indice === 0 ? cor : CORES_COMPARACAO[indice - 1] ?? `hsl(${(indice * 137.5) % 360} 75% 65%)`,
      values: Array.from({ length: quantidade }, (_, i) => valores[i] ?? null),
      pointDetails: Array.from({ length: quantidade }, (_, i) => {
        const p = lista[i];
        if (!p) return null;
        return {
          dateLabel: granularidade === "dia" ? dataCompleta(p.inicio)
            : `${dataCompleta(p.inicio)} a ${dataCompleta(p.fim)}`,
          valueLabel: formatarValorKpiTreinamento(kpi, valores[i]),
          metrics: kpi === "treinamentosRealizados" ? (["taxaCsat", "tempoMedioEspera"] as const).map((chave) => ({
            label: KPI_POR_CHAVE[chave].titulo,
            value: formatarValorKpiTreinamento(chave,
              calcularValorKpiTreinamento(chave, eventos, p.inicio, p.fim, treinador)),
          })) : [],
        };
      }),
    };
  });
  return { categorias, series };
}
