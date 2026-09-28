import { useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

export interface ColumnDef<T> {
  key: string;
  label: string;
  defaultWidth: number;
  minWidth?: number;
  align?: "left" | "right" | "center";
  className?: string;
  /** Coluna essencial: pode ser reordenada, mas não pode ser ocultada. */
  locked?: boolean;
  render: (item: T) => ReactNode;
  /** Cabeçalho usado na exportação para Excel, quando diferente de `label`. */
  exportLabel?: string;
  /** Valor em texto/número usado na exportação para Excel. Sem isso, a coluna não é exportada. */
  exportValue?: (item: T) => string | number;
}

interface ColumnPrefsStored {
  order: string[];
  hidden: string[];
  widths: Record<string, number>;
}

function carregarPrefs(storageKey: string): ColumnPrefsStored | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      Array.isArray(parsed.order) &&
      Array.isArray(parsed.hidden) &&
      parsed.widths &&
      typeof parsed.widths === "object"
    ) {
      return parsed as ColumnPrefsStored;
    }
    return null;
  } catch {
    // localStorage indisponível (modo privativo, cota cheia) ou JSON corrompido
    return null;
  }
}

/** Persiste ordem, visibilidade e largura das colunas de uma tabela no localStorage. */
export function useColumnPreferences<T>(
  storageKey: string,
  columns: ColumnDef<T>[],
) {
  const defaultOrder = useMemo(() => columns.map((c) => c.key), [columns]);

  const [order, setOrder] = useState<string[]>(() => {
    const salvo = carregarPrefs(storageKey);
    if (!salvo) return defaultOrder;
    const validas = salvo.order.filter((k) => defaultOrder.includes(k));
    const faltantes = defaultOrder.filter((k) => !validas.includes(k));
    return [...validas, ...faltantes];
  });

  const [hidden, setHidden] = useState<string[]>(() => {
    const salvo = carregarPrefs(storageKey);
    if (!salvo) return [];
    return salvo.hidden.filter((k) => defaultOrder.includes(k));
  });

  const [widths, setWidths] = useState<Record<string, number>>(() => {
    const salvo = carregarPrefs(storageKey);
    return salvo?.widths || {};
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ order, hidden, widths }),
      );
    } catch {
      // localStorage indisponível — preferências não serão persistidas nesta sessão
    }
  }, [storageKey, order, hidden, widths]);

  const colunasVisiveis = useMemo(() => {
    const mapa = new Map(columns.map((c) => [c.key, c]));
    return order
      .filter((k) => !hidden.includes(k))
      .map((k) => mapa.get(k))
      .filter((c): c is ColumnDef<T> => !!c);
  }, [columns, order, hidden]);

  function alterarLargura(key: string, largura: number) {
    setWidths((prev) => ({ ...prev, [key]: largura }));
  }

  function restaurarPadrao() {
    setOrder(defaultOrder);
    setHidden([]);
    setWidths({});
  }

  return {
    order,
    hidden,
    widths,
    setOrder,
    setHidden,
    colunasVisiveis,
    alterarLargura,
    restaurarPadrao,
  };
}

/** Move `chaveArrastada` para a posição imediatamente antes de `chaveAlvo`, preservando as demais colunas (visíveis ou ocultas) nos seus lugares relativos. */
export function reordenarColunaPorArraste(
  order: string[],
  chaveArrastada: string,
  chaveAlvo: string,
): string[] {
  if (chaveArrastada === chaveAlvo) return order;
  const semArrastada = order.filter((k) => k !== chaveArrastada);
  const indexAlvo = semArrastada.indexOf(chaveAlvo);
  if (indexAlvo === -1) return order;
  const novaOrdem = [...semArrastada];
  novaOrdem.splice(indexAlvo, 0, chaveArrastada);
  return novaOrdem;
}

/** Inicia o arraste de redimensionamento a partir do handle no cabeçalho da coluna. */
export function iniciarRedimensionamentoColuna(
  e: ReactMouseEvent,
  key: string,
  larguraAtual: number,
  aoRedimensionar: (key: string, largura: number) => void,
  larguraMinima = 60,
) {
  e.preventDefault();
  e.stopPropagation();

  const startX = e.clientX;

  function onMouseMove(ev: MouseEvent) {
    const novaLargura = Math.max(
      larguraMinima,
      Math.round(larguraAtual + (ev.clientX - startX)),
    );
    aoRedimensionar(key, novaLargura);
  }

  function onMouseUp() {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  }

  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
}
