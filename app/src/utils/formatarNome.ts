/**
 * Padroniza nomes com as iniciais maiúsculas.
 * Mantém preposições comuns em minúsculas (de, da, do, dos, das, e) a menos que comecem o nome.
 */
export function formatarNome(nome?: string | null): string {
  if (!nome) return "";
  
  // Se for e-mail, mantém como está
  if (nome.includes("@")) {
    return nome;
  }

  const preposicoes = ["de", "da", "do", "dos", "das", "e"];
  
  return nome
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (preposicoes.includes(lower) && index > 0) {
        return lower;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}
