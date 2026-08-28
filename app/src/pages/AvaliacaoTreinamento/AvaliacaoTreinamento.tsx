import React from "react";
import { Copy, Star } from "lucide-react";
import { toast } from "sonner";
import qrAvaliacao from "../../assets/QR_CODE_AVALIAÇÃO_CSAT.png";
import "./AvaliacaoTreinamento.css";

const PASSOS = [
  "Abra a câmera do celular e aponte para o QR Code",
  "Toque no link que aparecer na tela",
  "Responda às perguntas — é rapidinho!",
];

const LINK_AVALIACAO =
  "https://docs.google.com/forms/d/e/1FAIpQLSeACkNtCCX_-LzVt_n6pLRoNPSME2i1LpG_VWSdkWRzlDPEdg/viewform";

export const AvaliacaoTreinamento: React.FC = () => {
  return (
    <div className="avaliacao-page">
      <header className="avaliacao-header">
        <h1>Avaliação do Treinamento</h1>
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
          onClick={() => {
            navigator.clipboard.writeText(LINK_AVALIACAO);
            toast.success(
              "Link copiado! Cole no chat da reunião para o cliente.",
            );
          }}
        >
          <Copy size={16} />
          Copiar link do formulário
        </button>
      </div>
    </div>
  );
};
