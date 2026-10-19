export type ModoPeriodoTreinamento = "semana" | "mes" | "personalizado";

export interface IntervaloComparacaoTreinamento {
  inicio: Date;
  fim: Date;
}

export function lerDataComparacao(valor: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  const [ano, mes, dia] = valor.split("-").map(Number);
  const data = new Date(ano, mes - 1, dia);
  return data.getFullYear() === ano && data.getMonth() === mes - 1 && data.getDate() === dia
    ? data : null;
}

function numeroDia(data: Date): number {
  return Date.UTC(data.getFullYear(), data.getMonth(), data.getDate()) / 86_400_000;
}

/** Calendário local: não desloca datas sem horário nem soma milissegundos em transições de fuso. */
export function criarIntervaloComparacao(
  modo: ModoPeriodoTreinamento,
  referencia: Date,
  atual: IntervaloComparacaoTreinamento,
): IntervaloComparacaoTreinamento {
  const inicio = new Date(referencia);
  inicio.setHours(0, 0, 0, 0);
  const fim = new Date(inicio);
  if (modo === "mes") {
    inicio.setDate(1);
    fim.setFullYear(inicio.getFullYear(), inicio.getMonth() + 1, 0);
  } else if (modo === "semana") {
    inicio.setDate(inicio.getDate() - (inicio.getDay() + 6) % 7);
    fim.setTime(inicio.getTime());
    fim.setDate(fim.getDate() + 6);
  } else {
    fim.setDate(fim.getDate() + numeroDia(atual.fim) - numeroDia(atual.inicio));
  }
  fim.setHours(23, 59, 59, 999);
  return { inicio, fim };
}

export function intervaloAnteriorTreinamento(
  modo: ModoPeriodoTreinamento,
  atual: IntervaloComparacaoTreinamento,
): IntervaloComparacaoTreinamento {
  const referencia = new Date(atual.inicio);
  if (modo === "mes") {
    referencia.setDate(1);
    referencia.setMonth(referencia.getMonth() - 1);
  } else {
    referencia.setDate(referencia.getDate() - (modo === "semana"
      ? 7 : numeroDia(atual.fim) - numeroDia(atual.inicio) + 1));
  }
  return criarIntervaloComparacao(modo, referencia, atual);
}

export function formatarVariacaoTreinamento(
  atual: number | null,
  anterior: number | null,
  percentual: boolean,
): string {
  if (atual === null || anterior === null) return "Sem dados para comparar";
  if (!percentual && anterior === 0 && atual !== 0) return "Sem base percentual (anterior: 0)";
  const variacao = percentual ? atual - anterior : anterior === 0 ? 0 : (atual - anterior) / anterior * 100;
  return `${variacao > 0 ? "+" : ""}${variacao.toFixed(1).replace(".", ",")}${percentual ? " p.p." : "%"}`;
}
