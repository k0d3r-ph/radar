import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { FilePenLine } from "lucide-react";
import "./ConfirmarDescarteModal.css";

interface ConfirmarDescarteModalProps {
  onContinuar: () => void;
  onDescartar: () => void;
}

export function ConfirmarDescarteModal({ onContinuar, onDescartar }: ConfirmarDescarteModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const continuarRef = useRef<HTMLButtonElement>(null);
  const tituloId = useId();
  const descricaoId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    continuarRef.current?.focus();

    return () => {
      dialog.close();
      document.body.style.overflow = overflowAnterior;
    };
  }, []);

  function continuar() {
    dialogRef.current?.close();
    onContinuar();
  }

  function descartar() {
    dialogRef.current?.close();
    onDescartar();
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
        continuar();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) continuar();
      }}
    >
      <div className="descarte-conteudo">
        <div className="descarte-icone" aria-hidden="true"><FilePenLine size={22} /></div>
        <h2 id={tituloId}>Sair sem salvar?</h2>
        <p id={descricaoId}>
          Você tem alterações não salvas nesta ocorrência. Ao sair, elas serão descartadas.
        </p>
        <div className="descarte-acoes">
          <button ref={continuarRef} type="button" className="descarte-continuar" onClick={continuar}>
            Continuar editando
          </button>
          <button type="button" className="descarte-confirmar" onClick={descartar}>
            Descartar alterações
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
