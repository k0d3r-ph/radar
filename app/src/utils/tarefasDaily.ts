const TIME_ZONE = "America/Sao_Paulo";
const OFFSET_SAO_PAULO = "-03:00";

/** Converte a data sem horário da daily para o vencimento às 18h de Brasília. */
export function obterPrazoTarefaDaily(venceEm: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(venceEm)) {
    throw new Error("Data de vencimento da tarefa deve estar no formato YYYY-MM-DD.");
  }

  const prazo = Date.parse(`${venceEm}T18:00:00${OFFSET_SAO_PAULO}`);
  const dataEmSaoPaulo = Number.isFinite(prazo)
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(prazo)
    : "";

  if (!Number.isFinite(prazo) || dataEmSaoPaulo !== venceEm) {
    throw new Error("Data de vencimento da tarefa é inválida.");
  }

  return prazo;
}
