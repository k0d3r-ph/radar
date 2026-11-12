import { formatarNome } from "./formatarNome";

/**
 * Usuário que aparece como CS nos filtros e no cadastro de clientes: perfil (`role`)
 * "cs" em Usuários. O cargo (Supervisor/Analista/Comercial) não decide — um treinador
 * com cargo "Analista" não é CS. Para incluir ou tirar alguém, altere o perfil do
 * usuário; não há lista fixa de nomes no código.
 */
export function ehUsuarioCs(usuario: { role?: string }): boolean {
  return usuario.role?.trim().toLowerCase() === "cs";
}

/** Mapeamento de apelidos e primeiros nomes para o nome completo padronizado de cada CS */
const ALIASES_CS: Record<string, string> = {
  ana: "Ana Carolina",
  "ana carolina": "Ana Carolina",
  eduarda: "Eduarda Melo",
  "eduarda melo": "Eduarda Melo",
  duda: "Eduarda Melo",
  jeferson: "Jeferson Augusto",
  "jeferson augusto": "Jeferson Augusto",
  jefferson: "Jeferson Augusto",
  "jefferson augusto": "Jeferson Augusto",
  joao: "João Pedro",
  "joao pedro": "João Pedro",
  joão: "João Pedro",
  "joão pedro": "João Pedro",
  juan: "Juan Candia",
  "juan candia": "Juan Candia",
  lucas: "Lucas Barreto",
  "lucas barreto": "Lucas Barreto",
  luiz: "Luiz Felipe",
  "luiz felipe": "Luiz Felipe",
  rafaela: "Rafaela Agnelo",
  "rafaela agnelo": "Rafaela Agnelo",
  rafa: "Rafaela Agnelo",
};

/**
 * Normaliza um nome de CS para o nome completo padronizado da equipe.
 * Se o nome corresponder a um primeiro nome ou variação conhecida, retorna o nome completo padronizado.
 * Caso contrário, aplica a formatação padrão de nomes.
 */
export function normalizarNomeCS(nome?: string | null): string {
  if (!nome || !nome.trim()) return "";
  
  const key = nome
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (ALIASES_CS[key]) {
    return ALIASES_CS[key];
  }

  // Tenta encontrar por correspondência de primeiro nome se o texto fornecido for uma só palavra
  const partes = key.split(/\s+/);
  if (partes.length === 1 && ALIASES_CS[partes[0]]) {
    return ALIASES_CS[partes[0]];
  }

  return formatarNome(nome.trim());
}

/**
 * Compara dois nomes de CS considerando a normalização (aliases e primeiro nome/nome completo).
 */
export function compararCS(nome1?: string | null, nome2?: string | null): boolean {
  if (!nome1 || !nome2) return false;
  const n1 = normalizarNomeCS(nome1);
  const n2 = normalizarNomeCS(nome2);
  if (!n1 || !n2) return false;
  return n1.toLowerCase() === n2.toLowerCase();
}
