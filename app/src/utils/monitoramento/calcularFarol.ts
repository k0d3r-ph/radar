export type StatusFarolType = "verde" | "amarelo" | "vermelho" | "none";

export function calcularFarol({
  progresso,
  tme,
  alerta,
  dataFinalizacao,
  dataFollowUpFinal,
}: {
  progresso: number;
  tme: number | null;
  alerta?: boolean;
  dataFinalizacao?: string;
  dataFollowUpFinal?: string;
}): StatusFarolType {
  if (dataFollowUpFinal && dataFollowUpFinal.trim() !== "") {
    return "verde";
  }

  if (tme === null) return "none";

  if (alerta) {
    return "vermelho";
  }

  const finalizado = progresso >= 100;

  if (!finalizado) {
    if (tme < 0) return "verde";

    if (tme >= 4) {
      return "vermelho";
    }

    if (tme <= 3) {
      return "amarelo";
    }

    return "verde";
  }

  if (tme > 20) return "vermelho";
  if (tme < 0) return "verde";

  return "verde";
}
