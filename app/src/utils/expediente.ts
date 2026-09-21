/**
 * Expediente fixo: 09h às 18h, dias úteis (segunda a sexta). Usado para decidir se um
 * contato com o Suporte aconteceu dentro ou fora do horário de atendimento.
 */
export function estaDentroDoExpediente(timestamp: number): boolean {
  const data = new Date(timestamp);
  const diaSemana = data.getDay(); // 0 = domingo, 6 = sábado
  const hora = data.getHours();
  const isFimDeSemana = diaSemana === 0 || diaSemana === 6;
  return !isFimDeSemana && hora >= 9 && hora < 18;
}
