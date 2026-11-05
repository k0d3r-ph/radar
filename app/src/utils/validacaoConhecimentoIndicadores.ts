import type { TentativaValidacao } from "../../../server/src/domain/validacaoConhecimento";

export interface ResultadoValidacaoCliente {
  empresaId: string;
  aprovada: boolean;
  /** Quando a tentativa mais recente do cliente foi concluída. */
  concluidaEm: number;
}

/**
 * Uma linha por cliente com tentativa concluída: só a mais recente, que substitui
 * qualquer tentativa concluída anterior do mesmo cliente para fins de resultado
 * (um cliente reprovado que refez e passou conta só como aprovado).
 */
export function calcularValidacaoPorCliente(
  tentativas: TentativaValidacao[],
): ResultadoValidacaoCliente[] {
  const maisRecentePorEmpresa = new Map<string, TentativaValidacao>();
  for (const t of tentativas) {
    if (t.status !== "concluida" || typeof t.concluidaEm !== "number") continue;
    const atual = maisRecentePorEmpresa.get(t.empresaId);
    if (!atual || t.concluidaEm > (atual.concluidaEm ?? 0)) {
      maisRecentePorEmpresa.set(t.empresaId, t);
    }
  }
  return [...maisRecentePorEmpresa.values()].map((t) => ({
    empresaId: t.empresaId,
    aprovada: !!t.aprovada,
    concluidaEm: t.concluidaEm!,
  }));
}
