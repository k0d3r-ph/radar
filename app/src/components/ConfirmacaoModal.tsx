import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert } from 'lucide-react';
import './ConfirmacaoModal.css';

export interface OpcoesConfirmacao {
  titulo: string;
  descricao: string;
  textoConfirmar: string;
  textoCancelar?: string;
  destrutivo?: boolean;
}

interface Props extends OpcoesConfirmacao {
  onConfirmar: () => void;
  onCancelar: () => void;
}

export function ConfirmacaoModal({ titulo, descricao, textoConfirmar, textoCancelar = 'Voltar', destrutivo = false, onConfirmar, onCancelar }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelarRef = useRef<HTMLButtonElement>(null);
  const tituloId = useId(), descricaoId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focoAnterior = document.activeElement;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    cancelarRef.current?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = overflowAnterior;
      if (focoAnterior instanceof HTMLElement && focoAnterior.isConnected) focoAnterior.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(<dialog ref={dialogRef} className="confirmacao-modal" role="alertdialog" aria-modal="true" aria-labelledby={tituloId} aria-describedby={descricaoId}
    onPointerDown={event => event.stopPropagation()}
    onKeyDown={event => event.stopPropagation()}
    onCancel={event => { event.preventDefault(); onCancelar(); }}
    onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onCancelar(); } }}>
    <div className={`confirmacao-modal-icone${destrutivo ? ' confirmacao-modal-icone--perigo' : ''}`} aria-hidden="true"><CircleAlert size={24} /></div>
    <h2 id={tituloId}>{titulo}</h2>
    <p id={descricaoId}>{descricao}</p>
    <div className="confirmacao-modal-acoes">
      <button ref={cancelarRef} type="button" className="confirmacao-modal-voltar" onClick={onCancelar}>{textoCancelar}</button>
      <button type="button" className={`confirmacao-modal-confirmar${destrutivo ? ' confirmacao-modal-confirmar--perigo' : ''}`} onClick={onConfirmar}>{textoConfirmar}</button>
    </div>
  </dialog>, document.body);
}
