import type { TemaOcorrencia } from "../services/temasOcorrencia";

export const TIPOS_PADRAO_SISTEMA = [
  "Informativa",
  "Financeira",
  "Comercial",
  "Treinamento",
  "Mudança de score",
  "Problema",
  "Dúvida",
  "Solicitação",
  "Gol",
];

export const PERFIS_TABULACAO = [
  { id: "master", nome: "Master" },
  { id: "treinador", nome: "Treinador" },
  { id: "suporte", nome: "Suporte" },
  { id: "hardware", nome: "Hardware" },
  { id: "comercial", nome: "Comercial/Aplicações" },
  { id: "financeiro", nome: "Financeiro" },
  { id: "cs", nome: "CS" },
];

export function perfisPadraoTema(tema: Pick<TemaOcorrencia, "categoria" | "nome">): string[] {
  if (tema.categoria !== "tipo" || !TIPOS_PADRAO_SISTEMA.includes(tema.nome)) {
    return PERFIS_TABULACAO.map((perfil) => perfil.id);
  }
  const tiposPorPerfil: Record<string, string[]> = {
    treinador: ["Informativa", "Treinamento", "Problema", "Dúvida", "Solicitação", "Gol"],
    suporte: ["Informativa", "Problema", "Dúvida", "Solicitação"],
    hardware: ["Informativa"],
    comercial: ["Comercial", "Informativa"],
    financeiro: ["Financeira", "Informativa"],
    cs: ["Informativa", "Financeira", "Comercial"],
  };
  return ["master", ...Object.keys(tiposPorPerfil).filter((perfil) => tiposPorPerfil[perfil].includes(tema.nome))];
}

export function temaDisponivelParaPerfil(tema: TemaOcorrencia, role?: string): boolean {
  return !!role && (tema.perfisDisponiveis ?? perfisPadraoTema(tema)).includes(role);
}

