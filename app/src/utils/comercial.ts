import { formatarNome } from "./formatarNome";

function normalizarKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Lista de comerciais que não estão mais na empresa e devem ser desconsiderados */
export const COMERCIAIS_INATIVOS: string[] = [];

export function isComercialInativo(nome?: string | null): boolean {
  if (!nome || !nome.trim()) return false;
  const key = normalizarKey(nome);
  const primeiroNome = key.split(/\s+/)[0];
  return COMERCIAIS_INATIVOS.some(
    (inativo) => key === inativo || primeiroNome === inativo || key.startsWith(inativo + " ")
  );
}

export interface ResultadoConsolidacaoComerciais {
  lista: string[];
  mapaCanonical: Record<string, string>;
}

/**
 * Normaliza e consolida uma lista de nomes de Comerciais,
 * resolvendo automaticamente duplicidades entre primeiro nome (ex: "Carlos")
 * e nome completo (ex: "Carlos Eduardo"), e desconsiderando comerciais inativos.
 */
export function consolidarListaComerciais(
  nomesBrutos: (string | undefined | null)[]
): ResultadoConsolidacaoComerciais {
  const formatados = new Set<string>();
  nomesBrutos.forEach((n) => {
    if (n && n.trim() && !isComercialInativo(n)) {
      formatados.add(formatarNome(n.trim()));
    }
  });

  const arrayNomes = Array.from(formatados);

  // Ordena por quantidade de palavras (descendente) para priorizar nomes completos
  arrayNomes.sort((a, b) => {
    const palavrasA = a.trim().split(/\s+/).length;
    const palavrasB = b.trim().split(/\s+/).length;
    if (palavrasB !== palavrasA) return palavrasB - palavrasA;
    return b.length - a.length;
  });

  const mapaCanonical: Record<string, string> = {};
  const nomesEscolhidos = new Set<string>();
  const mapaPrimeiroNome: Record<string, string> = {};

  arrayNomes.forEach((nome) => {
    const keyCompleta = normalizarKey(nome);
    const partes = keyCompleta.split(/\s+/);
    const primeiroNome = partes[0];

    if (partes.length === 1 && mapaPrimeiroNome[primeiroNome]) {
      // Se for apenas primeiro nome e já conhecemos um nome completo com esse primeiro nome
      const canonical = mapaPrimeiroNome[primeiroNome];
      mapaCanonical[keyCompleta] = canonical;
    } else {
      if (!mapaPrimeiroNome[primeiroNome]) {
        mapaPrimeiroNome[primeiroNome] = nome;
      }
      mapaCanonical[keyCompleta] = nome;
      nomesEscolhidos.add(nome);
    }
  });

  Object.entries(mapaPrimeiroNome).forEach(([primeiro, canonical]) => {
    mapaCanonical[primeiro] = canonical;
  });

  return {
    lista: Array.from(nomesEscolhidos).sort((a, b) => a.localeCompare(b, "pt-BR")),
    mapaCanonical,
  };
}

/**
 * Normaliza um nome de comercial usando o mapa canônico consolidado.
 */
export function normalizarNomeComercial(
  nome?: string | null,
  mapaCanonical?: Record<string, string>
): string {
  if (!nome || !nome.trim()) return "";
  const key = normalizarKey(nome);
  if (mapaCanonical && mapaCanonical[key]) {
    return mapaCanonical[key];
  }
  const primeiroNome = key.split(/\s+/)[0];
  if (mapaCanonical && mapaCanonical[primeiroNome]) {
    return mapaCanonical[primeiroNome];
  }
  return formatarNome(nome.trim());
}

/**
 * Compara dois nomes de comercial considerando correspondências parciais e canônicas.
 */
export function compararComercial(
  nome1?: string | null,
  nome2?: string | null,
  mapaCanonical?: Record<string, string>
): boolean {
  if (!nome1 || !nome2) return false;
  const n1 = normalizarKey(nome1);
  const n2 = normalizarKey(nome2);
  if (!n1 || !n2) return false;
  if (n1 === n2) return true;

  if (mapaCanonical) {
    const c1 = normalizarKey(normalizarNomeComercial(nome1, mapaCanonical));
    const c2 = normalizarKey(normalizarNomeComercial(nome2, mapaCanonical));
    if (c1 && c2 && c1 === c2) return true;
  }

  // Correspondência de primeiro nome se um deles for nome simples
  const p1 = n1.split(/\s+/)[0];
  const p2 = n2.split(/\s+/)[0];
  if (p1 === p2 && (n1.split(/\s+/).length === 1 || n2.split(/\s+/).length === 1)) {
    return true;
  }

  return false;
}
