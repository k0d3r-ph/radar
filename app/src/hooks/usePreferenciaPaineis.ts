import { useEffect, useMemo, useState } from "react";
import { resolverPreferenciasColunas } from "../utils/preferenciasColunas";

export interface ItemPreferencia {
  key: string;
  /** Item essencial: pode ser reordenado, mas não pode ser ocultado. */
  locked?: boolean;
  /** Disponível no seletor, mas não visível no primeiro acesso ou ao restaurar o padrão. */
  hiddenByDefault?: boolean;
}

function carregarPrefs(storageKey: string): unknown {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Persiste no navegador a ordem e a visibilidade escolhidas pelo usuário para uma lista
 * fixa de itens (abas de relatório, painéis de um relatório etc.). Pensado para uso com
 * o componente `ColumnSelector`, que já resolve mostrar/ocultar e reordenar por arraste.
 */
export function usePreferenciaPaineis(storageKey: string, itens: ItemPreferencia[]) {
  const defaultOrder = useMemo(() => itens.map((i) => i.key), [itens]);
  const defaultHidden = useMemo(
    () => itens.filter((i) => i.hiddenByDefault && !i.locked).map((i) => i.key),
    [itens],
  );

  const [iniciais] = useState(() => resolverPreferenciasColunas(itens, carregarPrefs(storageKey)));
  const [order, setOrder] = useState<string[]>(iniciais.order);
  const [hidden, setHidden] = useState<string[]>(iniciais.hidden);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ order, hidden, widths: {} }));
    } catch {
      // localStorage indisponível — preferência não persiste nesta sessão
    }
  }, [storageKey, order, hidden]);

  function restaurarPadrao() {
    setOrder(defaultOrder);
    setHidden(defaultHidden);
  }

  const visiveis = useMemo(
    () => order.filter((k) => !hidden.includes(k)),
    [order, hidden],
  );

  return { order, hidden, setOrder, setHidden, restaurarPadrao, visiveis };
}
