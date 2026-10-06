import type { Empresa, WhatsappDestinatarioEnvio, WhatsappStatus } from "../types";

export function podeNotificarConclusao(empresa: Empresa, role?: string): boolean {
  if (role !== "treinador" && role !== "master") return false;
  if (empresa.isOngoing) return false;
  const fases = (empresa.temaText || "").split("\n").filter((tema) => tema.trim()).length;
  return !!empresa.dataFinalizacao || (fases > 0 && (empresa.currentPhase ?? 0) >= fases - 1);
}

export function camposResultadoConclusao(resultado: {
  status: WhatsappStatus;
  enviadoEm: number;
  destinatarios: WhatsappDestinatarioEnvio[];
}): Partial<Empresa> {
  return {
    whatsappStatusConclusao: resultado.status,
    whatsappEnviadoEmConclusao: resultado.enviadoEm,
    whatsappDestinatariosConclusao: resultado.destinatarios,
  };
}
