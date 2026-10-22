export const MENSAGEM_TREINAMENTO_SUSPENSO = "Não é possível registrar treinamento para cliente suspenso. Retorne o cliente à esteira antes de registrar o treinamento.";

export const normalizarEmpresaOcorrencia = (nome: string) => nome.trim().toLowerCase().replace(/&amp;/g, "&").replace(/\s+/g, " ");

/** Uma edição do treinamento já registrado no mesmo cliente preserva seu histórico. */
export function exigeClienteAtivoParaTreinamento(
  destino: { tipo?: string; empresa?: string },
  original?: { tipo?: string; empresa?: string } | null,
): boolean {
  return destino.tipo === "Treinamento" && !(original?.tipo === "Treinamento" &&
    normalizarEmpresaOcorrencia(original.empresa ?? "") === normalizarEmpresaOcorrencia(destino.empresa ?? ""));
}

export function bloquearTreinamentoSuspenso(
  empresa: { isSuspended?: boolean } | undefined,
  destino: { tipo?: string; empresa?: string },
  original?: { tipo?: string; empresa?: string } | null,
): boolean {
  return !!empresa?.isSuspended && exigeClienteAtivoParaTreinamento(destino, original);
}
