import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarClock } from "lucide-react";
import type { MotivoEsperaTreinamento } from "../types";
import "./MotivoEsperaTreinamentoModal.css";

interface Props {
  dias: number;
  /** Treinador responsável, quando quem responde não é quem deu o treinamento. */
  treinador?: string;
  onConfirmar: (motivo: MotivoEsperaTreinamento) => void;
  onCancelar: () => void;
}

export function MotivoEsperaTreinamentoModal({ dias, treinador, onConfirmar, onCancelar }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelarRef = useRef<HTMLButtonElement>(null);
  const [motivo, setMotivo] = useState<MotivoEsperaTreinamento | null>(null);
  const tituloId = useId();
  const descricaoId = useId();
  const grupoId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focoAnterior = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    cancelarRef.current?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (focoAnterior instanceof HTMLElement && focoAnterior.isConnected) focoAnterior.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(<dialog ref={dialogRef} className="espera-treinamento-dialog"
    aria-labelledby={tituloId} aria-describedby={descricaoId}
    onCancel={(event) => { event.preventDefault(); onCancelar(); }}>
    <div className="espera-treinamento-conteudo">
      <CalendarClock size={26} aria-hidden="true" />
      <h2 id={tituloId}>Motivo da espera do treinamento</h2>
      <p id={descricaoId}>O treinamento ocorreu <strong>{dias} dias úteis</strong> após a solicitação.
        O tempo de espera longo foi a pedido do cliente?</p>
      <fieldset>
        <legend>Selecione o motivo (obrigatório)</legend>
        <label><input type="radio" required name={grupoId} value="cliente" checked={motivo === "cliente"}
          onChange={() => setMotivo("cliente")} /><span>Sim, o cliente solicitou.</span></label>
        <label><input type="radio" required name={grupoId} value="agenda_treinador" checked={motivo === "agenda_treinador"}
          onChange={() => setMotivo("agenda_treinador")} /><span>{treinador
            ? <>Não, a data mais distante foi definida pela disponibilidade da agenda de <strong>{treinador}</strong>.</>
            : "Não, a data mais distante foi sugerida por mim devido à disponibilidade da minha agenda."}</span></label>
      </fieldset>
      <p className="espera-treinamento-nota">São considerados apenas os dias de segunda a sexta. O motivo ficará registrado e a espera continuará na média geral do relatório.</p>
      <div className="espera-treinamento-acoes">
        <button ref={cancelarRef} type="button" onClick={onCancelar}>Voltar ao formulário</button>
        <button type="button" disabled={!motivo} onClick={() => { if (motivo) onConfirmar(motivo); }}>Confirmar motivo</button>
      </div>
    </div>
  </dialog>, document.body);
}
