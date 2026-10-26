/** Duração em horas e minutos, sem relação com horário do dia. */
export const duracaoAgendaValida = (valor: unknown): valor is string => typeof valor === 'string' && /^\d{2}:[0-5]\d$/.test(valor);

export function formatarDuracaoAgenda(valor: string): string {
  const digitos = valor.replace(/\D/g, '').slice(0, 4);
  return digitos.length > 2 ? `${digitos.slice(0, 2)}:${digitos.slice(2)}` : digitos;
}
