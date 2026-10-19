/** Captura a realização uma vez para manter confirmação, ocorrência e lançamento na mesma data. */
export function obterInstanteRealizacaoTreinamento(
  ocorrencia: { createdAt?: number; dataOcorrencia?: number },
  agora = Date.now(),
): number {
  return [ocorrencia.createdAt, ocorrencia.dataOcorrencia, agora]
    .find((valor) => typeof valor === "number" && valor > 0 && Number.isFinite(valor))!;
}

/** Data local de realização; a solicitação e o próximo agendamento são independentes. */
export function obterDataRealizacaoTreinamento(
  ocorrencia: { createdAt?: number; dataOcorrencia?: number },
  agora = Date.now(),
): string {
  const timestamp = obterInstanteRealizacaoTreinamento(ocorrencia, agora);
  const data = new Date(timestamp);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}
