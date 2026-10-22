import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./StatusFarol.css";
import type { StatusFarolType } from "../utils/monitoramento/calcularFarol";

type Props = {
  status: StatusFarolType;
  pendencia?: string;
};

const MARGEM_TELA = 8;

export default function StatusFarol({ status, pendencia }: Props) {
  const [ancora, setAncora] = useState<{ top: number; bottom: number; centro: number } | null>(null);
  const [estilo, setEstilo] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);

  const descricao = status === "laranja" ? `Pendência: ${pendencia || 'Não informada'}` : `Status ${status}`;

  useLayoutEffect(() => {
    if (!ancora) { setEstilo(null); return; }
    const rect = tooltipRef.current?.getBoundingClientRect();
    const largura = rect?.width ?? 0;
    const altura = rect?.height ?? 0;
    const abaixo = ancora.top < altura + MARGEM_TELA;
    setEstilo({
      top: abaixo ? ancora.bottom + MARGEM_TELA : ancora.top - altura - MARGEM_TELA,
      left: Math.max(
        MARGEM_TELA,
        Math.min(ancora.centro - largura / 2, window.innerWidth - largura - MARGEM_TELA)
      ),
    });
  }, [ancora]);

  if (status === "none") return null;

  function mostrarTooltip() {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAncora({ top: rect.top, bottom: rect.bottom, centro: rect.left + rect.width / 2 });
  }

  function esconderTooltip() {
    setAncora(null);
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
      {ancora &&
        createPortal(
          <span
            ref={tooltipRef}
            className="farol-tooltip farol-tooltip-portal"
            style={estilo ? { top: estilo.top, left: estilo.left, opacity: 1 } : { top: ancora.top, left: ancora.centro, opacity: 0 }}
          >
            {descricao}
          </span>,
          document.body
        )}
    </div>
  );
}
