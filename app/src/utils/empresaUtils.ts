import type { Ocorrencia } from "../types";

export function obterPrefixoEmpresa(nomeEmpresa: string, empresasList?: { nomeEmpresa: string; idNumeric?: number }[]): string {
  if (!nomeEmpresa) return "0";

  if (empresasList) {
    const matched = empresasList.find(e => e.nomeEmpresa.trim().toLowerCase() === nomeEmpresa.trim().toLowerCase());
    if (matched && typeof matched.idNumeric === "number") {
      return String(matched.idNumeric);
    }
  }

  // Fallback to parse from name if it still has (#XX) during transition
  const hashMatch = nomeEmpresa.match(/#(\d+)/);
  if (hashMatch) return hashMatch[1];
  
  const parenMatch = nomeEmpresa.match(/\((\d+)\)/);
  if (parenMatch) return parenMatch[1];
  
  const numMatch = nomeEmpresa.match(/\d+/);
  if (numMatch) return numMatch[0];
  
  return "0";
}

export function atribuirIdsOcorrencias(lista: Ocorrencia[], empresasList?: { nomeEmpresa: string; idNumeric?: number }[]): (Ocorrencia & { idSeqFormatted?: string })[] {
  const porEmpresa: Record<string, Ocorrencia[]> = {};
  lista.forEach((o) => {
    const key = o.empresa.trim().toLowerCase();
    if (!porEmpresa[key]) porEmpresa[key] = [];
    porEmpresa[key].push(o);
  });

  const mapaIds = new Map<Ocorrencia, string>();
  
  Object.keys(porEmpresa).forEach((emp) => {
    const grupo = porEmpresa[emp];
    const sorted = [...grupo].sort((a, b) => {
      const timeA = a.createdAt ?? a.dataOcorrencia ?? 0;
      const timeB = b.createdAt ?? b.dataOcorrencia ?? 0;
      return timeA - timeB;
    });

    const prefix = obterPrefixoEmpresa(grupo[0].empresa, empresasList);

    sorted.forEach((o, index) => {
      const seq = index + 1;
      const seqStr = String(seq).padStart(2, "0");
      mapaIds.set(o, `#${prefix}${seqStr}`);
    });
  });

  return lista.map((o) => ({
    ...o,
    idSeqFormatted: mapaIds.get(o),
  }));
}
