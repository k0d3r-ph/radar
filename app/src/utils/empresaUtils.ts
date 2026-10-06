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

export function atribuirIdsOcorrencias(lista: Ocorrencia[], empresasList?: { nomeEmpresa: string; idNumeric?: number; ocorrenciasSequenciasReservadas?: number[] }[]): (Ocorrencia & { idSeqFormatted?: string })[] {
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
    const empresa = empresasList?.find(e => e.nomeEmpresa.trim().toLowerCase() === emp);
    const reservados = new Set(empresa?.ocorrenciasSequenciasReservadas || []);
    grupo.forEach(o => {
      if (o.idSeqFormatted?.startsWith(`#${prefix}`)) {
        const sequencia = Number(o.idSeqFormatted.slice(prefix.length + 1));
        if (Number.isInteger(sequencia) && sequencia > 0) reservados.add(sequencia);
      }
    });
    let seq = 0;
    sorted.forEach((o) => {
      if (o.csatReservaId || o.idSeqFormatted) return;
      do { seq += 1; } while (reservados.has(seq));
      const seqStr = String(seq).padStart(2, "0");
      mapaIds.set(o, `#${prefix}${seqStr}`);
    });
  });

  return lista.map((o) => ({
    ...o,
    idSeqFormatted: o.idSeqFormatted || mapaIds.get(o),
  }));
}

export function obterInfoTipoOcorrencia(o: Ocorrencia): { label: string; className: string } {
  if (o.tipo === "Treinamento") {
    const temas = o.temaOcorrencia ?? [];
    const isAusente = temas.some((t) => t.trim().toLowerCase() === "ausente");
    const isCancelado = temas.some((t) => t.trim().toLowerCase() === "cancelado");

    if (isAusente) {
      return {
        label: "Treinamento (Ausente)",
        className: "tipo--treinamento-ausente",
      };
    }
    if (isCancelado) {
      return {
        label: "Treinamento (Cancelado)",
        className: "tipo--treinamento-cancelado",
      };
    }
    return {
      label: "Treinamento (Realizado)",
      className: "tipo--treinamento",
    };
  }

  const classes: Record<string, string> = {
    Informativa: "tipo--informativa",
    Financeira: "tipo--financeira",
    Comercial: "tipo--comercial",
    Treinamento: "tipo--treinamento",
    Checkpoint: "tipo--checkpoint",
    "Mudança de score": "tipo--mudanca-score",
    Problema: "tipo--problema",
    Dúvida: "tipo--duvida",
    Solicitação: "tipo--solicitacao",
    Gol: "tipo--gol",
  };

  return {
    label: o.tipo === "Gol" ? "⚽ Gol" : o.tipo || "Sem classificação",
    // Tipos personalizados (criados em /tipos-ocorrencia) não têm classe de
    // cor própria e caem sempre na mesma tag cinza usada por "Informativa".
    className: classes[o.tipo] || "tipo--informativa",
  };
}

