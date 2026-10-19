import type { MotivoEsperaTreinamento } from "../types";

export const LIMITE_ESPERA_LONGA_TREINAMENTO = 3;

/** Dias úteis (segunda a sexta) em (solicitação, realização], sem deslocar datas de negócio. */
export function calcularDiasEsperaTreinamento(solicitacao?: string, realizacao?: string): number | null {
  const numeroDia = (valor?: string): number | null => {
    if (!valor || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
    const [ano, mes, dia] = valor.split("-").map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) return null;
    return data.getTime() / 86_400_000;
  };
  const inicio = numeroDia(solicitacao);
  const fim = numeroDia(realizacao);
  if (inicio === null || fim === null || fim < inicio) return null;
  const intervalo = fim - inicio;
  let diasUteis = Math.floor(intervalo / 7) * 5;
  const diaInicial = new Date(inicio * 86_400_000).getUTCDay();
  for (let dia = 1; dia <= intervalo % 7; dia++) {
    const diaDaSemana = (diaInicial + dia) % 7;
    if (diaDaSemana !== 0 && diaDaSemana !== 6) diasUteis++;
  }
  return diasUteis;
}

export function motivoEsperaValido(valor: unknown): valor is MotivoEsperaTreinamento {
  return valor === "cliente" || valor === "agenda_treinador";
}

export function avaliarMotivoEsperaTreinamento(dados: {
  tipo: string;
  temas?: string[];
  solicitacao?: string;
  realizacao?: string;
  motivo?: MotivoEsperaTreinamento | null;
}): { dias: number | null; motivo: MotivoEsperaTreinamento | null; precisaConfirmar: boolean } {
  if (dados.tipo !== "Treinamento" || dados.temas?.some((tema) => ["ausente", "cancelado"].includes(tema.trim().toLowerCase()))) {
    return { dias: null, motivo: null, precisaConfirmar: false };
  }
  const dias = calcularDiasEsperaTreinamento(dados.solicitacao, dados.realizacao);
  const longa = dias !== null && dias >= LIMITE_ESPERA_LONGA_TREINAMENTO;
  const motivo = longa && motivoEsperaValido(dados.motivo) ? dados.motivo : null;
  return { dias, motivo, precisaConfirmar: longa && motivo === null };
}

export function descreverMotivoEsperaTreinamento(motivo?: MotivoEsperaTreinamento | null): string {
  if (motivo === "cliente") return "Data distante a pedido do cliente";
  if (motivo === "agenda_treinador") return "Data distante por disponibilidade da agenda do treinador";
  return "Motivo não informado";
}
