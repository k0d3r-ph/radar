import { useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { resolverPreferenciasColunas } from "../utils/preferenciasColunas";

export interface ColumnDef<T> {
  key: string;
  label: string;
  defaultWidth: number;
  minWidth?: number;
  align?: "left" | "right" | "center";
  className?: string;
  /** Coluna essencial: pode ser reordenada, mas não pode ser ocultada. */
  locked?: boolean;
  /** Disponível no seletor, mas não visível no primeiro acesso ou ao restaurar o padrão. */
  hiddenByDefault?: boolean;
  render: (item: T) => ReactNode;
  /** Cabeçalho usado na exportação para Excel, quando diferente de `label`. */
  exportLabel?: string;
  /** Valor em texto/número usado na exportação para Excel. Sem isso, a coluna não é exportada. */
  exportValue?: (item: T) => string | number;
}

function carregarPrefs(storageKey: string): unknown {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw);
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
  const defaultHidden = useMemo(() => columns.filter((c) => c.hiddenByDefault && !c.locked).map((c) => c.key), [columns]);

  const [iniciais] = useState(() => resolverPreferenciasColunas(columns, carregarPrefs(storageKey)));

  const [order, setOrder] = useState<string[]>(iniciais.order);

  const [hidden, setHidden] = useState<string[]>(iniciais.hidden);

  const [widths, setWidths] = useState<Record<string, number>>(iniciais.widths);

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
    setHidden(defaultHidden);
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
