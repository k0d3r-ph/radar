import type { Ocorrencia } from "../../types";

/** Checkpoint ativo: ocorrência com data e hora agendadas ainda no futuro. */
export function obterProximoCheckpoint(
  historico: Ocorrencia[],
  agora = Date.now(),
): Ocorrencia | undefined {
  return historico.reduce<Ocorrencia | undefined>((proximo, ocorrencia) => {
    if (
      ocorrencia.tipo?.trim().toLowerCase() !== "checkpoint" ||
      !Number.isFinite(ocorrencia.dataOcorrencia) ||
      ocorrencia.dataOcorrencia <= agora
    ) {
      return proximo;
    }

    return !proximo || ocorrencia.dataOcorrencia < proximo.dataOcorrencia
      ? ocorrencia
      : proximo;
  }, undefined);
}
