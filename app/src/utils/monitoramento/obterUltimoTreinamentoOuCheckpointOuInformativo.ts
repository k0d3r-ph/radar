import type { Ocorrencia } from "../../types";

export function obterUltimoTreinamento(
  historico: Ocorrencia[],
  empresaNome: string,
) {
  const nome = empresaNome.trim().toLowerCase();

  const treinamentos = historico.filter((item: Ocorrencia) => {
    return (
      item.empresa.trim().toLowerCase() === nome &&
      (item.tipo?.toLowerCase().includes("treinamento") ||
        item.tipo?.toLowerCase() === "checkpoint" ||
        item.tipo?.toLowerCase() === "informativa")
    );
  });

  if (!treinamentos.length) return undefined;

  return treinamentos.sort(
    (a: Ocorrencia, b: Ocorrencia) =>
      (b.dataOcorrencia || b.createdAt || 0) -
      (a.dataOcorrencia || a.createdAt || 0),
  )[0];
}
