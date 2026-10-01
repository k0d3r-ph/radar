import { pendenciaAtiva } from '../pendencias.ts';
import type { PendenciaCliente } from '../pendencias.ts';

export type StatusFarolType = "verde" | "amarelo" | "laranja" | "vermelho" | "none";

export function calcularFarol({
  progresso,
  tme,
  alerta,
  dataFinalizacao,
  dataFollowUpFinal,
  pendencia,
  agora = Date.now(),
}: {
  progresso: number;
  tme: number | null;
  alerta?: boolean;
  dataFinalizacao?: string;
  dataFollowUpFinal?: string;
  pendencia?: PendenciaCliente;
  agora?: number;
}): StatusFarolType {
  if (pendenciaAtiva(pendencia, agora)) {
    return "laranja";
  }

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
