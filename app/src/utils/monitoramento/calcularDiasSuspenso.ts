/** Total de dias suspenso: dias da suspensão em andamento (se houver) somados ao acumulado de suspensões anteriores. */
export function calcularDiasSuspenso(
  isSuspended?: boolean,
  dataSuspensao?: string,
  diasSuspensoAcumulado?: number,
) {
  let diasSuspensaoAtual = 0;

  if (isSuspended && dataSuspensao) {
    // ← interpreta no fuso local em vez de UTC
    const [year, month, day] = dataSuspensao.split("-").map(Number);
    const inicio = new Date(year, month - 1, day);

    if (!isNaN(inicio.getTime())) {
      diasSuspensaoAtual = Math.max(
        0,
        Math.floor((Date.now() - inicio.getTime()) / (1000 * 60 * 60 * 24)),
      );
    }
  }

  return diasSuspensaoAtual + (diasSuspensoAcumulado || 0);
}
