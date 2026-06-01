export function calcularDiasNaEsteira(
  dataEntrada?: string,
  progresso?: number,
  dataUltimoTreinamento?: number,
  dataFinalizacao?: string,
) {
  if (!dataEntrada) return 0;

  // ← interpreta no fuso local em vez de UTC
  const [year, month, day] = dataEntrada.split("-").map(Number);
  const entrada = new Date(year, month - 1, day);

  if (isNaN(entrada.getTime())) return 0;

  let fim: Date;
  if (dataFinalizacao) {
    const [fYear, fMonth, fDay] = dataFinalizacao.split("-").map(Number);
    fim = new Date(fYear, fMonth - 1, fDay);
  } else {
    fim =
      progresso !== undefined && progresso >= 100 && dataUltimoTreinamento
        ? new Date(dataUltimoTreinamento)
        : new Date();
  }

  return Math.floor(
    (fim.getTime() - entrada.getTime()) / (1000 * 60 * 60 * 24),
  );
}
