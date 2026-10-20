import React, { useState } from "react";
import "./Recolhivel.css";

type Fase = "fechada" | "abrindo" | "aberta" | "fechando";

interface RecolhivelProps {
  aberta: boolean;
  children: React.ReactNode;
}

/**
 * Seção que expande/recolhe com animação de altura. O conteúdo só fica montado enquanto
 * está aberto ou fechando, como um `{aberta && ...}`, mas sem o corte abrupto.
 */
export const Recolhivel: React.FC<RecolhivelProps> = ({ aberta, children }) => {
  const [fase, setFase] = useState<Fase>(aberta ? "aberta" : "fechada");
  const [abertaAnterior, setAbertaAnterior] = useState(aberta);

  // Ajuste de estado durante a renderização quando a prop muda (padrão recomendado pelo React).
  if (aberta !== abertaAnterior) {
    setAbertaAnterior(aberta);
    setFase(aberta ? "abrindo" : "fechando");
  }

  if (fase === "fechada") return null;

  return (
    <div
      className={`recolhivel recolhivel--${fase}`}
      onAnimationEnd={(e) => {
        if (e.target !== e.currentTarget) return;
        setFase((atual) => (atual === "abrindo" ? "aberta" : atual === "fechando" ? "fechada" : atual));
      }}
    >
      <div className="recolhivel-conteudo">{children}</div>
    </div>
  );
};
