export type AbaRelatorio =
  | "esteira"
  | "score"
  | "jornada"
  | "executiva"
  | "aging"
  | "indicadores"
  | "validacao";

export interface DefinicaoAbaRelatorio {
  key: AbaRelatorio;
  label: string;
  /** Item essencial: pode ser reordenado, mas não pode ser ocultado. */
  locked?: boolean;
}

/**
 * Abas de /relatorios disponíveis para o perfil, na ordem padrão (antes da
 * personalização do usuário via `usePreferenciaPaineis`). Compartilhada entre a
 * página de Relatórios e o submenu do menu lateral, para os dois ficarem sempre
 * em sincronia (mesmas abas, mesmos rótulos).
 */
export function obterAbasRelatorio(role: string | null | undefined): DefinicaoAbaRelatorio[] {
  const todas: DefinicaoAbaRelatorio[] = [{ key: "esteira", label: "Visão Geral", locked: true }];
  if (role !== "painel") {
    todas.push(
      { key: "score", label: "Scores dos Clientes" },
      { key: "jornada", label: "Jornada do Cliente" },
      { key: "executiva", label: "Visão Executiva" },
      { key: "aging", label: "Aging da Esteira" },
      { key: "indicadores", label: "Indicadores de Treinamento" },
    );
    if (role === "master" || role === "treinador") {
      todas.push({ key: "validacao", label: "Validação do Conhecimento" });
    }
  }
  return todas;
}
