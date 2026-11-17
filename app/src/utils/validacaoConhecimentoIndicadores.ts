import type { QuestaoValidacao, TentativaValidacao } from "../../../server/src/domain/validacaoConhecimento";

/** Chave, nas metas do painel (`configuracoes/metasPainelTreinamento`), do mínimo de perguntas
 * com validação parcial marcada para a avaliação aberta entrar como prévia. Editável pelo Master. */
export const CHAVE_MINIMO_PREVIA_PARCIAL = "validacaoParcialMinimoPerguntas";
export const MINIMO_PREVIA_PARCIAL_PADRAO = 5;
export const LIMITES_MINIMO_PREVIA_PARCIAL = { minimo: 1, maximo: 100 } as const;

/** Mínimo salvo quando for um inteiro dentro dos limites; senão, o padrão. */
export function minimoPreviaParcial(metas: Record<string, number> | null | undefined): number {
  const salvo = metas?.[CHAVE_MINIMO_PREVIA_PARCIAL];
  return typeof salvo === "number" && Number.isInteger(salvo)
    && salvo >= LIMITES_MINIMO_PREVIA_PARCIAL.minimo && salvo <= LIMITES_MINIMO_PREVIA_PARCIAL.maximo
    ? salvo
    : MINIMO_PREVIA_PARCIAL_PADRAO;
}

export interface ResultadoValidacaoCliente {
  empresaId: string;
  aprovada: boolean;
  /** `true` quando o resultado vem da validação parcial de uma avaliação ainda aberta (prévia). */
  previa: boolean;
  /** Quando a avaliação foi concluída ou, na prévia, quando a validação parcial mudou pela última vez. */
  dataReferencia: number;
}

/**
 * Resultado da validação parcial: só as perguntas com marcação parcial, com os mesmos pesos da
 * nota final (Correto 1, Parcial 0,5, Incorreto 0) e o mesmo mínimo de 80%. A conta usa unidades
 * inteiras (pesos ×2), como `calcularResultadoValidacao`, para 80% exatos não sofrerem
 * arredondamento. `null` se nenhuma pergunta foi marcada.
 */
export function resultadoParcialValidacao(
  questoes: Pick<QuestaoValidacao, "respostaParcial">[],
): { marcadas: number; aprovada: boolean } | null {
  const marcadas = questoes.filter((q) => q.respostaParcial);
  if (!marcadas.length) return null;
  const unidades = marcadas.reduce(
    (soma, q) => soma + (q.respostaParcial === "correto" ? 2 : q.respostaParcial === "parcial" ? 1 : 0),
    0,
  );
  return { marcadas: marcadas.length, aprovada: unidades * 5 >= 8 * marcadas.length };
}

function resultadoDaTentativa(t: TentativaValidacao, minimoParcial: number): ResultadoValidacaoCliente | null {
  if (t.status === "concluida") {
    if (typeof t.concluidaEm !== "number") return null;
    return { empresaId: t.empresaId, aprovada: !!t.aprovada, previa: false, dataReferencia: t.concluidaEm };
  }
  if (t.status !== "andamento" && t.status !== "pausada") return null;
  const parcial = resultadoParcialValidacao(t.questoes || []);
  // Registros anteriores a `parcialAtualizadaEm` usam a última gravação da tentativa.
  const data = t.parcialAtualizadaEm ?? t.updatedAt;
  // Poucas marcações fariam a prévia oscilar (1 pergunta correta = 100%): exige o mínimo configurado.
  if (!parcial || parcial.marcadas < minimoParcial || typeof data !== "number") return null;
  return { empresaId: t.empresaId, aprovada: parcial.aprovada, previa: true, dataReferencia: data };
}

/**
 * Uma linha por cliente, pelo evento mais recente: a conclusão de uma avaliação (resultado
 * final) ou a validação parcial de uma avaliação aberta (prévia). Assim, um cliente reprovado
 * que refez e passou conta só como aprovado; a conclusão substitui a prévia; e uma nova
 * validação parcial depois de uma reprovação passa a valer como prévia. A prévia exige ao menos
 * `minimoParcial` perguntas com marcação parcial.
 */
export function calcularValidacaoPorCliente(
  tentativas: TentativaValidacao[],
  minimoParcial: number = MINIMO_PREVIA_PARCIAL_PADRAO,
): ResultadoValidacaoCliente[] {
  const maisRecentePorEmpresa = new Map<string, ResultadoValidacaoCliente>();
  for (const t of tentativas) {
    const resultado = resultadoDaTentativa(t, minimoParcial);
    if (!resultado) continue;
    const atual = maisRecentePorEmpresa.get(t.empresaId);
    if (!atual || resultado.dataReferencia > atual.dataReferencia) {
      maisRecentePorEmpresa.set(t.empresaId, resultado);
    }
  }
  return [...maisRecentePorEmpresa.values()];
}
