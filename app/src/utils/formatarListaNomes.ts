/**
 * Junta uma lista de nomes em texto corrido, separando por vírgula e
 * usando "e" antes do último item. Ex.: ["Pedro", "Jeff", "Clarice", "Natália"]
 * -> "Pedro, Jeff, Clarice e Natália"
 */
export function formatarListaNomes(nomes: string[]): string {
  const validos = nomes.map((n) => n.trim()).filter(Boolean);
  if (validos.length === 0) return "";
  if (validos.length === 1) return validos[0];
  return `${validos.slice(0, -1).join(", ")} e ${validos[validos.length - 1]}`;
}
