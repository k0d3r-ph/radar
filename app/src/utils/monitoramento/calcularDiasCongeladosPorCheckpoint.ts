import type { Ocorrencia } from "../../types";

const DIA_MS = 1000 * 60 * 60 * 24;

function inicioDoDia(timestamp: number) {
  const d = new Date(timestamp);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Soma os dias em que a contagem de dias na esteira ficou congelada por causa
 * de Checkpoints agendados para o futuro no momento em que foram criados.
 * Ex.: um Checkpoint criado hoje com data para daqui 5 dias mantém a contagem
 * congelada por até 5 dias (menos, se a data do checkpoint já chegou).
 */
export function calcularDiasCongeladosPorCheckpoint(
  historico: Ocorrencia[],
  empresaNome: string,
) {
  const nome = empresaNome.trim().toLowerCase();
  const hoje = inicioDoDia(Date.now());

  const checkpoints = historico.filter(
    (item) =>
      item.empresa.trim().toLowerCase() === nome &&
      item.tipo?.toLowerCase() === "checkpoint" &&
      item.createdAt &&
      item.dataOcorrencia,
  );

  let diasCongelados = 0;

  for (const checkpoint of checkpoints) {
    const criadoEm = inicioDoDia(checkpoint.createdAt!);
    const dataCheckpoint = inicioDoDia(checkpoint.dataOcorrencia);

    if (dataCheckpoint <= criadoEm) continue;

    const fimCongelamento = Math.min(hoje, dataCheckpoint);
    const dias = Math.floor((fimCongelamento - criadoEm) / DIA_MS);

    diasCongelados += Math.max(0, dias);
  }

  return diasCongelados;
}
