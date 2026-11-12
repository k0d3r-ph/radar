import type { Empresa, Ocorrencia } from "../types";
import { calcularDiasSuspensaoAtual } from "./monitoramento/calcularDiasSuspenso.ts";

type EstadoFinalCliente = Pick<
  Empresa,
  "isCancelled" | "conclusaoUnilateralCapacitacao" | "dataFinalizacao" | "dataFollowUpFinal"
>;

/** Concluído: data de finalização da esteira e follow up final registrados (ver Home). */
export function clienteConcluidoEsteira(
  empresa: Pick<Empresa, "dataFinalizacao" | "dataFollowUpFinal">,
): boolean {
  return !!empresa.dataFinalizacao?.trim() && !!empresa.dataFollowUpFinal?.trim();
}

/**
 * Estados finais que tiram o cliente da esteira de Suspensos: cancelado, conclusão
 * unilateral da capacitação ou esteira concluída. Nesses casos o cliente deixa de
 * estar suspenso — não faz sentido abrir o cadastro e vê-lo como "Suspenso".
 */
export function encerraSuspensao(empresa: EstadoFinalCliente): boolean {
  return (
    !!empresa.isCancelled ||
    empresa.conclusaoUnilateralCapacitacao === true ||
    clienteConcluidoEsteira(empresa)
  );
}

/** Suspenso de fato: marcado como suspenso e sem nenhum estado final que encerre a suspensão. */
export function clienteEstaSuspenso(
  empresa: EstadoFinalCliente & Pick<Empresa, "isSuspended">,
): boolean {
  return !!empresa.isSuspended && !encerraSuspensao(empresa);
}

/**
 * Campos que encerram a suspensão em andamento, com a mesma contagem do "Retornar
 * cliente à esteira": os dias suspensos vão para o acumulado, para não voltarem a contar
 * nos dias na esteira. `suspensaoEncerradaEm` registra quando isso aconteceu, usado pelo
 * indicador de Suspensos para fechar o período. Devolve `null` se o cliente não está suspenso.
 */
export function alteracoesEncerrarSuspensao(
  empresa: Pick<Empresa, "isSuspended" | "dataSuspensao" | "diasSuspensoAcumulado">,
  historicoEmpresa: Ocorrencia[],
  agora = Date.now(),
): Partial<Empresa> | null {
  if (!empresa.isSuspended) return null;
  return {
    isSuspended: false,
    // String vazia, não undefined: salvarEmpresas descarta campos undefined.
    dataSuspensao: "",
    diasSuspensoAcumulado:
      (empresa.diasSuspensoAcumulado || 0) +
      calcularDiasSuspensaoAtual(empresa, historicoEmpresa, agora),
    suspensaoEncerradaEm: agora,
  };
}
