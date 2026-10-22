import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { CalendarCheck2 } from "lucide-react";
import "./ConfirmarDescarteModal.css";

interface ConfirmarNovoFollowUpModalProps {
  onConcluiuAgora: () => void;
  onPrecisaDeMaisUmFollowUp: () => void;
}

/**
 * Exibido ao abrir uma nova ocorrência de Follow up final para um cliente que
 * já teve um follow up anterior marcado "Reforço de treinamento" (ainda não
 * concluído). "Precisa de mais um follow up" só fecha o modal: o próximo
 * contato é agendado fora da ocorrência, não reabre o formulário de 3
 * perguntas.
 */
export function ConfirmarNovoFollowUpModal({ onConcluiuAgora, onPrecisaDeMaisUmFollowUp }: ConfirmarNovoFollowUpModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const concluiuRef = useRef<HTMLButtonElement>(null);
  const tituloId = useId();
  const descricaoId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    concluiuRef.current?.focus();

    return () => {
      dialog.close();
      document.body.style.overflow = overflowAnterior;
    };
  }, []);

  function precisaDeMais() {
    dialogRef.current?.close();
    onPrecisaDeMaisUmFollowUp();
  }

  function concluiuAgora() {
    dialogRef.current?.close();
    onConcluiuAgora();
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      className="descarte-dialog"
      aria-labelledby={tituloId}
      aria-describedby={descricaoId}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const botoes = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        const primeiro = botoes[0];
        const ultimo = botoes[botoes.length - 1];
        if (event.shiftKey && document.activeElement === primeiro) {
          event.preventDefault();
          ultimo?.focus();
        } else if (!event.shiftKey && document.activeElement === ultimo) {
          event.preventDefault();
          primeiro?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        precisaDeMais();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) precisaDeMais();
      }}
    >
      <div className="descarte-conteudo">
        <div className="descarte-icone" aria-hidden="true"><CalendarCheck2 size={22} /></div>
        <h2 id={tituloId}>O que houve com este follow up?</h2>
        <p id={descricaoId}>
          Esse cliente já teve um follow up final marcado como "Reforço de treinamento", ainda não concluído.
        </p>
        <div className="descarte-acoes">
          <button ref={concluiuRef} type="button" className="descarte-continuar" onClick={concluiuAgora}>
            Concluiu agora
          </button>
          <button type="button" className="descarte-confirmar" onClick={precisaDeMais}>
            Precisa de mais um follow up
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
