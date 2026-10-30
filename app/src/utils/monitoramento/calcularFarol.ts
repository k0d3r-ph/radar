import { pendenciaAtiva } from '../pendencias.ts';
import type { PendenciaCliente } from '../pendencias.ts';
import { baseAcompanhamento, PRAZO_FOLLOW_UP_FINAL, PRAZO_AGENDAR_TREINAMENTO } from '../../../../server/src/domain/acompanhamentoEsteira.ts';

export type StatusFarolType = "verde" | "amarelo" | "laranja" | "vermelho" | "none";

export function calcularFarol({
  progresso,
  tme,
  alerta,
  dataFinalizacao,
  dataFollowUpFinal,
  conclusaoUnilateralCapacitacao,
  pendencia,
  agora = Date.now(),
}: {
  progresso: number;
  tme: number | null;
  alerta?: boolean;
  dataFinalizacao?: string;
  dataFollowUpFinal?: string;
  conclusaoUnilateralCapacitacao?: boolean;
  pendencia?: PendenciaCliente;
  agora?: number;
}): StatusFarolType {
  if (progresso >= 100 && dataFinalizacao) {
    const base = baseAcompanhamento(progresso, dataFinalizacao);
    tme = base ? Math.floor((agora - base) / 86_400_000) : null;
  }
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
  if (finalizado && conclusaoUnilateralCapacitacao) return "verde";

  if (!finalizado) {
    if (tme < 0) return "verde";

    if (tme >= PRAZO_AGENDAR_TREINAMENTO) {
      return "vermelho";
    }

    if (tme <= 3) {
      return "amarelo";
    }

    return "verde";
  }

  if (tme >= PRAZO_FOLLOW_UP_FINAL) return "vermelho";
  if (tme < 0) return "verde";

  return "verde";
}
