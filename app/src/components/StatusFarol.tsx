import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./StatusFarol.css";
import type { StatusFarolType } from "../utils/monitoramento/calcularFarol";

type Props = {
  status: StatusFarolType;
  pendencia?: string;
};

export default function StatusFarol({ status, pendencia }: Props) {
  const [posicao, setPosicao] = useState<{ top: number; left: number; abaixo: boolean } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  if (status === "none") return null;

  const descricao = status === "laranja" ? `Pendência: ${pendencia || 'Não informada'}` : `Status ${status}`;

  const ALTURA_TOOLTIP_ESTIMADA = 32;

  function mostrarTooltip() {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const abaixo = rect.top < ALTURA_TOOLTIP_ESTIMADA;
    setPosicao({
      top: abaixo ? rect.bottom : rect.top,
      left: rect.left + rect.width / 2,
      abaixo,
    });
  }

  function esconderTooltip() {
    setPosicao(null);
  }

  return (
    <div
      ref={wrapperRef}
      className="farol-wrapper"
      tabIndex={0}
      onMouseEnter={mostrarTooltip}
      onMouseLeave={esconderTooltip}
      onFocus={mostrarTooltip}
      onBlur={esconderTooltip}
    >
      <div
        className={`farol farol-${status}`}
        role="img"
        aria-label={descricao}
        title={descricao}
      />
      {posicao &&
        createPortal(
          <span
            className={`farol-tooltip farol-tooltip-portal${posicao.abaixo ? " farol-tooltip-abaixo" : ""}`}
            style={{ top: posicao.top, left: posicao.left }}
          >
            {descricao}
          </span>,
          document.body
        )}
    </div>
  );
}
