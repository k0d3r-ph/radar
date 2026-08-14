import React from "react";
import { Printer, Star } from "lucide-react";
import qrAvaliacao from "../../assets/QR_CODE_AVALIAÇÃO_CSAT.png";
import "./AvaliacaoTreinamento.css";

const PASSOS = [
  "Abra a câmera do celular e aponte para o QR Code",
  "Toque no link que aparecer na tela",
  "Responda às perguntas — é rapidinho!",
];

export const AvaliacaoTreinamento: React.FC = () => {
  return (
    <div className="avaliacao-page">
      <header className="avaliacao-header">
        <h1>Avaliação do Treinamento</h1>
        <p>
          Mostre esta tela para o cliente ao final do treinamento para que ele
          avalie o atendimento recebido.
        </p>
      </header>

      <div className="avaliacao-card">
        <span className="avaliacao-eyebrow">Pós-treinamento</span>

        <div className="avaliacao-stars" aria-hidden="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star key={i} size={18} fill="currentColor" strokeWidth={0} />
          ))}
        </div>

        <h2>Como foi o seu treinamento?</h2>
        <p className="avaliacao-subtitle">
          A avaliação leva menos de 2 minutos e ajuda a gente a melhorar cada
          capacitação.
        </p>

        <div className="avaliacao-qr-plate">
          <img
            src={qrAvaliacao}
            alt="QR Code para abrir a avaliação do treinamento"
          />
        </div>

        <ol className="avaliacao-passos">
          {PASSOS.map((passo, i) => (
            <li key={passo}>
              <span className="avaliacao-passo-num">{i + 1}</span>
              <span>{passo}</span>
            </li>
          ))}
        </ol>

        <button
          type="button"
          className="avaliacao-btn-imprimir"
          onClick={() => window.print()}
        >
          <Printer size={16} />
          Imprimir
        </button>
      </div>
    </div>
  );
};
