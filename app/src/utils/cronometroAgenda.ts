export function formatarTempoCronometro(milissegundos: number): string {
  const segundosTotais = Math.floor(Math.max(0, milissegundos) / 1000);
  const horas = Math.floor(segundosTotais / 3600);
  const minutos = Math.floor((segundosTotais % 3600) / 60);
  const segundos = segundosTotais % 60;

  return [horas, minutos, segundos].map(valor => String(valor).padStart(2, '0')).join(':');
}

export function formatarDuracaoCronometro(milissegundos: number): string {
  if (!Number.isFinite(milissegundos) || milissegundos < 0) {
    throw new Error('O tempo do cronômetro é inválido.');
  }

  const minutosTotais = Math.max(1, Math.round(milissegundos / 60_000));
  if (minutosTotais > 99 * 60 + 59) {
    throw new Error('O cronômetro ultrapassou 99:59. Informe a duração manualmente.');
  }

  const horas = Math.floor(minutosTotais / 60);
  const minutos = minutosTotais % 60;
  return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}`;
}

export function converterDuracaoAgendaParaMs(duracao: string): number {
  const correspondencia = /^(\d{2}):([0-5]\d)$/.exec(duracao);
  if (!correspondencia) return 0;
  return (Number(correspondencia[1]) * 60 + Number(correspondencia[2])) * 60_000;
}
