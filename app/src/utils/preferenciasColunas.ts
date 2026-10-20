interface ColunaPreferencia {
  key: string;
  locked?: boolean;
  hiddenByDefault?: boolean;
}

export interface PreferenciasColunas {
  order: string[];
  hidden: string[];
  widths: Record<string, number>;
}

/** Preserva as definições de cada esteira e oferece as demais como opcionais. */
export function ampliarCatalogoColunas<T extends ColunaPreferencia>(padrao: T[], catalogo: T[]): T[] {
  const chaves = new Set(padrao.map((c) => c.key));
  const adicionais: T[] = [];
  for (const coluna of catalogo) {
    if (chaves.has(coluna.key)) continue;
    chaves.add(coluna.key);
    adicionais.push({ ...coluna, hiddenByDefault: true, locked: false });
  }
  return [...padrao, ...adicionais];
}

/** Compatível com o cache anterior: novas colunas opcionais não aparecem automaticamente. */
export function resolverPreferenciasColunas(colunas: ColunaPreferencia[], salvo: unknown): PreferenciasColunas {
  const chaves = colunas.map((c) => c.key);
  const validas = new Set(chaves);
  const ocultasPadrao = colunas.filter((c) => c.hiddenByDefault && !c.locked).map((c) => c.key);
  const padrao: PreferenciasColunas = { order: chaves, hidden: ocultasPadrao, widths: {} };
  if (!salvo || typeof salvo !== "object") return padrao;
  const dados = salvo as Record<string, unknown>;
  if (!Array.isArray(dados.order) || !dados.order.every((k) => typeof k === "string") ||
    !Array.isArray(dados.hidden) || !dados.hidden.every((k) => typeof k === "string") ||
    !dados.widths || typeof dados.widths !== "object" || Array.isArray(dados.widths)) return padrao;

  const orderSalva = new Set<string>(dados.order);
  const order = [...orderSalva].filter((k) => validas.has(k));
  order.push(...chaves.filter((k) => !orderSalva.has(k)));
  const locked = new Set(colunas.filter((c) => c.locked).map((c) => c.key));
  const hidden = [...new Set([
    ...dados.hidden,
    ...ocultasPadrao.filter((k) => !orderSalva.has(k)),
  ])].filter((k) => validas.has(k) && !locked.has(k));
  const widths: Record<string, number> = {};
  for (const [k, v] of Object.entries(dados.widths)) {
    if (validas.has(k) && typeof v === "number" && Number.isFinite(v) && v > 0) widths[k] = v;
  }
  return { order, hidden, widths };
}
