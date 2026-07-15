/**
 * Verifica se a data e hora fornecidas estão fora do expediente configurado.
 * 
 * @param date Data e hora a verificar
 * @param config Objeto de configuração com startTime, endTime e workingDays
 * @returns true se estiver FORA do expediente, false caso contrário
 */
export function isTimeOutOfOffice(
  date: Date,
  config: {
    startTime?: string;
    endTime?: string;
    workingDays?: number[];
  }
): boolean {
  const workingDays = config.workingDays || [1, 2, 3, 4, 5]; // Segunda a Sexta por padrão
  const currentDay = date.getDay(); // 0 = Domingo, 6 = Sábado
  
  // Se o dia atual não for dia de expediente
  const isWorkingDay = workingDays.includes(currentDay);
  if (!isWorkingDay) {
    return true;
  }

  const startTime = config.startTime;
  const endTime = config.endTime;

  if (startTime && endTime) {
    try {
      const [startHour, startMin] = startTime.split(':').map(Number);
      const [endHour, endMin] = endTime.split(':').map(Number);

      const currentHour = date.getHours();
      const currentMin = date.getMinutes();

      const currentTotalMin = currentHour * 60 + currentMin;
      const startTotalMin = startHour * 60 + startMin;
      const endTotalMin = endHour * 60 + endMin;

      // Se a hora atual for menor que o início ou maior que o fim
      if (currentTotalMin < startTotalMin || currentTotalMin > endTotalMin) {
        return true;
      }
    } catch (err) {
      console.error('Erro ao analisar horas de expediente:', err);
      // Em caso de erro de parse, assume segurança (não aciona fora do expediente)
      return false;
    }
  }

  return false;
}
