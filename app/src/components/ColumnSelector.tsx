import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./ColumnSelector.css";

export interface ColumnSelectorItem {
  key: string;
  label: string;
  locked?: boolean;
}

interface ColumnSelectorProps {
  columns: ColumnSelectorItem[];
  order: string[];
  hidden: string[];
  onChangeOrder: (order: string[]) => void;
  onChangeHidden: (hidden: string[]) => void;
  onRestaurarPadrao: () => void;
}

const LARGURA_PAINEL = 280;

/** Botão + painel para o usuário escolher, ocultar e reordenar colunas de uma tabela. */
export function ColumnSelector({
  columns,
  order,
  hidden,
  onChangeOrder,
  onChangeHidden,
  onRestaurarPadrao,
}: ColumnSelectorProps) {
  const [aberto, setAberto] = useState(false);
  const [arrastandoIndex, setArrastandoIndex] = useState<number | null>(null);
  const [posicao, setPosicao] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);

  function recalcularPosicao() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosicao({
      top: rect.bottom + 6,
      left: Math.max(8, rect.right - LARGURA_PAINEL),
    });
  }

  useLayoutEffect(() => {
    if (aberto) recalcularPosicao();
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;

    function handleClickFora(e: MouseEvent) {
      const alvo = e.target as Node;
      if (
        triggerRef.current?.contains(alvo) ||
        painelRef.current?.contains(alvo)
      ) {
        return;
      }
      setAberto(false);
    }

    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }

    function handleReposicionar() {
      recalcularPosicao();
    }

    document.addEventListener("mousedown", handleClickFora);
    document.addEventListener("keydown", handleEsc);
    window.addEventListener("scroll", handleReposicionar, true);
    window.addEventListener("resize", handleReposicionar);
    return () => {
      document.removeEventListener("mousedown", handleClickFora);
      document.removeEventListener("keydown", handleEsc);
      window.removeEventListener("scroll", handleReposicionar, true);
      window.removeEventListener("resize", handleReposicionar);
    };
  }, [aberto]);

  const mapaColunas = new Map(columns.map((c) => [c.key, c]));
  const ordemVisivel = order.filter((k) => mapaColunas.has(k));

  function alternarVisibilidade(key: string) {
    const coluna = mapaColunas.get(key);
    if (coluna?.locked) return;

    const jaOculta = hidden.includes(key);
    if (jaOculta) {
      onChangeHidden(hidden.filter((k) => k !== key));
    } else {
      // Evita ocultar todas as colunas: mantém pelo menos uma visível
      const visiveisRestantes = ordemVisivel.filter(
        (k) => k !== key && !hidden.includes(k),
      );
      if (visiveisRestantes.length === 0) return;
      onChangeHidden([...hidden, key]);
    }
  }

  function moverColuna(indexOrigem: number, indexDestino: number) {
    if (indexOrigem === indexDestino) return;
    const novaOrdem = [...ordemVisivel];
    const [removida] = novaOrdem.splice(indexOrigem, 1);
    novaOrdem.splice(indexDestino, 0, removida);
    onChangeOrder(novaOrdem);
  }

  return (
    <div className="column-selector">
      <button
        ref={triggerRef}
        type="button"
        className="column-selector-trigger"
        onClick={() => setAberto((prev) => !prev)}
        title="Escolher e reorganizar colunas"
        aria-expanded={aberto}
      >
        ⚙️ Colunas
      </button>

      {aberto &&
        createPortal(
          <div
            ref={painelRef}
            className="column-selector-painel"
            role="menu"
            style={{ top: posicao.top, left: posicao.left, width: LARGURA_PAINEL }}
          >
            <div className="column-selector-painel-header">
              <span>Colunas visíveis</span>
              <span className="column-selector-dica">arraste para reordenar</span>
            </div>

            <ul className="column-selector-lista">
              {ordemVisivel.map((key, index) => {
                const coluna = mapaColunas.get(key)!;
                const oculta = hidden.includes(key);
                return (
                  <li
                    key={key}
                    className={`column-selector-item ${arrastandoIndex === index ? "arrastando" : ""}`}
                    draggable
                    onDragStart={() => setArrastandoIndex(index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (arrastandoIndex !== null) {
                        moverColuna(arrastandoIndex, index);
                      }
                      setArrastandoIndex(null);
                    }}
                    onDragEnd={() => setArrastandoIndex(null)}
                  >
                    <span className="column-selector-handle" aria-hidden="true">
                      ⠿
                    </span>
                    <label className="column-selector-checkbox-label">
                      <input
                        type="checkbox"
                        checked={!oculta}
                        disabled={coluna.locked}
                        onChange={() => alternarVisibilidade(key)}
                      />
                      {coluna.label}
                      {coluna.locked && (
                        <span className="column-selector-locked" title="Coluna fixa">
                          🔒
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>

            <div className="column-selector-painel-footer">
              <button
                type="button"
                className="column-selector-restaurar"
                onClick={onRestaurarPadrao}
              >
                Restaurar padrão
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
