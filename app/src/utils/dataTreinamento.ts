/** Data local de realização; a solicitação e o próximo agendamento são independentes. */
export function obterDataRealizacaoTreinamento(
  ocorrencia: { createdAt?: number; dataOcorrencia?: number },
  agora = Date.now(),
): string {
  const timestamp = [ocorrencia.createdAt, ocorrencia.dataOcorrencia, agora]
    .find((valor) => typeof valor === "number" && valor > 0 && Number.isFinite(valor))!;
  const data = new Date(timestamp);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}
