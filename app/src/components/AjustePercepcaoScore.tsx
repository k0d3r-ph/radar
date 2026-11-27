import { useEffect, useId, useRef, useState } from "react";
import {
  AJUSTE_PERCEPCAO_VAZIO,
  LIMITE_AJUSTE_PERCEPCAO_SCORE,
  PASSO_AJUSTE_PERCEPCAO_SCORE,
  ajustePercepcaoValido,
  normalizarValorAjustePercepcao,
  type AjustePercepcaoRascunho,
  type AjustePercepcaoScore as AjustePercepcaoSalvo,
} from "../utils/score";
import "./AjustePercepcaoScore.css";

const formatar = (valor: number) =>
  `${valor > 0 ? "+" : valor < 0 ? "−" : ""}${Math.abs(valor).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}`;

interface ResumoProps {
  /** Ajuste em edição no questionário. */
  ajuste: AjustePercepcaoRascunho;
  /** Ajuste gravado no último cálculo, para mostrar quem o fez e quando. */
  salvo?: AjustePercepcaoSalvo | null;
  /** Sem `onChange` (perfil sem permissão), o quadro só informa, sem ações. */
  onChange?: (ajuste: AjustePercepcaoRascunho) => void;
}

const textoPontos = (valor: number) =>
  `${formatar(valor)} ponto${Math.abs(valor) > 1 ? "s" : ""}`;

/**
 * Explica, dentro do questionário, por que o score tem pontos a mais ou a menos que
 * as respostas: valor do ajuste do treinador, justificativa e autoria. Permite tirar o
 * ajuste (e desfazer a retirada antes de confirmar o cálculo).
 */
export function ResumoAjustePercepcao({ ajuste, salvo, onChange }: ResumoProps) {
  if (ajuste.valor === 0) {
    // Ajuste salvo retirado no rascunho: avisa que só vale após confirmar e permite desfazer.
    if (!salvo?.valor || !onChange) return null;
    return (
      <div className="ajuste-percepcao-resumo removido" role="status">
        <span className="ajuste-percepcao-resumo-titulo">
          Ajuste do treinador de <strong>{textoPontos(salvo.valor)}</strong> retirado.
        </span>
        <span className="ajuste-percepcao-resumo-autor">
          Clique em "Confirmar Cálculo" para salvar o score sem esse ajuste.
        </span>
        <div className="ajuste-percepcao-resumo-acoes">
          <button
            type="button"
            className="ajuste-percepcao-resumo-acao"
            onClick={() =>
              onChange({ valor: salvo.valor, justificativa: salvo.justificativa || "" })
            }
          >
            Desfazer
          </button>
        </div>
      </div>
    );
  }
  const mesmoDoSalvo =
    !!salvo &&
    salvo.valor === ajuste.valor &&
    salvo.justificativa === ajuste.justificativa.trim();
  return (
    <div
      className={`ajuste-percepcao-resumo ${ajuste.valor > 0 ? "positivo" : "negativo"}`}
    >
      <span className="ajuste-percepcao-resumo-titulo">
        {ajuste.valor > 0 ? "Pontos somados" : "Pontos descontados"} pelo treinador:{" "}
        <strong>{textoPontos(ajuste.valor)}</strong>
      </span>
      <span className="ajuste-percepcao-resumo-motivo">
        Motivo: {ajuste.justificativa.trim() || "—"}
      </span>
      {mesmoDoSalvo && (salvo.responsavel || salvo.criadoEm) ? (
        <span className="ajuste-percepcao-resumo-autor">
          Registrado
          {salvo.responsavel ? ` por ${salvo.responsavel}` : ""}
          {salvo.criadoEm
            ? ` em ${new Date(salvo.criadoEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
            : ""}
        </span>
      ) : (
        !mesmoDoSalvo && (
          <span className="ajuste-percepcao-resumo-autor">
            Será registrado ao confirmar o cálculo.
          </span>
        )
      )}
      {onChange && (
        <div className="ajuste-percepcao-resumo-acoes">
          <button
            type="button"
            className="ajuste-percepcao-resumo-acao"
            onClick={() => onChange(AJUSTE_PERCEPCAO_VAZIO)}
            aria-label={`Retirar ajuste do treinador de ${textoPontos(ajuste.valor)}`}
          >
            {ajuste.valor > 0 ? "Tirar pontos somados" : "Devolver pontos descontados"}
          </button>
        </div>
      )}
    </div>
  );
}

interface Props {
  ajuste: AjustePercepcaoRascunho;
  onChange: (ajuste: AjustePercepcaoRascunho) => void;
}

/**
 * Botão "Ajustar pontos" do rodapé do questionário de score: abre um painel em que o
 * treinador soma ou desconta pontos conforme a própria percepção, com justificativa.
 * O valor é aplicado ao score no "Confirmar Cálculo" (ver `aplicarAjustePercepcao`).
 */
export default function AjustePercepcaoScore({ ajuste, onChange }: Props) {
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState(ajuste.valor);
  const [justificativa, setJustificativa] = useState(ajuste.justificativa);
  const [erro, setErro] = useState("");
  const botaoRef = useRef<HTMLButtonElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);
  const idBase = useId();

  function abrir() {
    setValor(ajuste.valor);
    setJustificativa(ajuste.justificativa);
    setErro("");
    setAberto(true);
  }

  function fechar() {
    setAberto(false);
    botaoRef.current?.focus();
  }

  useEffect(() => {
    if (!aberto) return;
    painelRef.current?.querySelector<HTMLElement>("[data-foco-inicial]")?.focus();
    function aoClicarFora(e: MouseEvent) {
      const alvo = e.target as Node;
      if (painelRef.current?.contains(alvo) || botaoRef.current?.contains(alvo)) return;
      setAberto(false);
    }
    document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
  }, [aberto]);

  function alterar(delta: number) {
    setValor((v) => normalizarValorAjustePercepcao(v + delta));
    setErro("");
  }

  function aplicar() {
    const novo = { valor, justificativa: justificativa.trim() };
    if (!ajustePercepcaoValido(novo)) {
      setErro("Explique o motivo do ajuste para registrar no histórico do cliente.");
      return;
    }
    onChange(novo.valor === 0 ? AJUSTE_PERCEPCAO_VAZIO : novo);
    fechar();
  }

  function remover() {
    onChange(AJUSTE_PERCEPCAO_VAZIO);
    fechar();
  }

  const temAjuste = ajuste.valor !== 0;
  const classeValor = valor > 0 ? "positivo" : valor < 0 ? "negativo" : "";

  return (
    <div className="ajuste-percepcao">
      <button
        ref={botaoRef}
        type="button"
        className={`btn-ajuste-percepcao${temAjuste ? " btn-ajuste-percepcao--ativo" : ""}`}
        onClick={() => (aberto ? fechar() : abrir())}
        aria-expanded={aberto}
        aria-controls={`${idBase}-painel`}
        title="Somar ou descontar pontos conforme a sua percepção do cliente"
      >
        {temAjuste ? `Ajuste ${formatar(ajuste.valor)}` : "± Ajustar pontos"}
      </button>

      {aberto && (
        <div
          ref={painelRef}
          id={`${idBase}-painel`}
          className="ajuste-percepcao-painel"
          role="dialog"
          aria-label="Ajuste de pontos por percepção do treinador"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              fechar();
            }
          }}
        >
          <p className="ajuste-percepcao-titulo">Ajuste por percepção do treinador</p>
          <p className="ajuste-percepcao-hint">
            Até {LIMITE_AJUSTE_PERCEPCAO_SCORE} pontos para mais ou para menos, além do questionário.
          </p>

          <div className="ajuste-percepcao-stepper" role="group" aria-label="Pontos do ajuste">
            <button
              type="button"
              onClick={() => alterar(-PASSO_AJUSTE_PERCEPCAO_SCORE)}
              disabled={valor <= -LIMITE_AJUSTE_PERCEPCAO_SCORE}
              aria-label={`Descontar ${PASSO_AJUSTE_PERCEPCAO_SCORE.toLocaleString("pt-BR")} ponto`}
              data-foco-inicial
            >
              −
            </button>
            <output
              className={`ajuste-percepcao-valor ${classeValor}`}
              aria-live="polite"
            >
              {formatar(valor) || "0"}
              <span className="ajuste-percepcao-valor-rotulo">
                {valor > 0 ? "somar" : valor < 0 ? "descontar" : "sem ajuste"}
              </span>
            </output>
            <button
              type="button"
              onClick={() => alterar(PASSO_AJUSTE_PERCEPCAO_SCORE)}
              disabled={valor >= LIMITE_AJUSTE_PERCEPCAO_SCORE}
              aria-label={`Somar ${PASSO_AJUSTE_PERCEPCAO_SCORE.toLocaleString("pt-BR")} ponto`}
            >
              +
            </button>
          </div>

          <label className="ajuste-percepcao-label" htmlFor={`${idBase}-justificativa`}>
            Justificativa {valor !== 0 && "*"}
          </label>
          <textarea
            id={`${idBase}-justificativa`}
            className="ajuste-percepcao-textarea"
            value={justificativa}
            onChange={(e) => {
              setJustificativa(e.target.value);
              setErro("");
            }}
            rows={3}
            maxLength={300}
            placeholder="Ex.: cliente muito engajado, mas não compartilha tela por limitação técnica."
            aria-invalid={!!erro}
            aria-describedby={erro ? `${idBase}-erro` : undefined}
          />
          {erro && (
            <span id={`${idBase}-erro`} className="ajuste-percepcao-erro" role="alert">
              {erro}
            </span>
          )}

          <div className="ajuste-percepcao-acoes">
            {temAjuste && (
              <button type="button" className="ajuste-percepcao-remover" onClick={remover}>
                Remover ajuste
              </button>
            )}
            <button type="button" className="ajuste-percepcao-cancelar" onClick={fechar}>
              Cancelar
            </button>
            <button type="button" className="ajuste-percepcao-aplicar" onClick={aplicar}>
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
