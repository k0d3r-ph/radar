import { useEffect, useRef, useState, type FormEvent } from "react";
import { TEMPLATE_TREINAMENTO } from "../utils/templateTreinamento";

type Props = {
  tentativa: number;
  empresa: string;
  ocupado: boolean;
  erro: string;
  onCancelar: () => void;
  onConfirmar: (impressoes: string) => Promise<boolean>;
};

export function ImpressaoValidacaoModal({
  tentativa,
  empresa,
  ocupado,
  erro,
  onCancelar,
  onConfirmar,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [impressoes, setImpressoes] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  async function confirmar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ocupado) return;
    if (await onConfirmar(impressoes.trim())) {
      dialogRef.current?.close();
      onCancelar();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="validacao-impressao-dialog"
      aria-labelledby="validacao-impressao-titulo"
      onCancel={(event) => {
        event.preventDefault();
        if (!ocupado) onCancelar();
      }}
    >
      <form onSubmit={confirmar}>
        <h2 id="validacao-impressao-titulo">Registrar resultado da validação</h2>
        <p>
          Tentativa {tentativa} · {empresa}. As respostas da avaliação serão
          mantidas e você pode complementar o registro com as impressões da
          agenda.
        </p>
        <label htmlFor="validacao-impressoes-agenda">
          Impressões da agenda <span>(opcional)</span>
        </label>
        {erro && <p className="validacao-impressao-erro" role="alert">{erro}</p>}
        <button
          type="button"
          className="validacao-template"
          disabled={ocupado}
          onClick={() => setImpressoes(TEMPLATE_TREINAMENTO)}
        >
          Usar template de treinamento
        </button>
        <textarea
          id="validacao-impressoes-agenda"
          autoFocus
          rows={10}
          maxLength={4000}
          value={impressoes}
          onChange={(event) => setImpressoes(event.target.value)}
          disabled={ocupado}
          placeholder="Registre observações livres sobre a agenda..."
        />
        <div className="validacao-impressao-acoes">
          <button type="button" disabled={ocupado} onClick={onCancelar}>
            Revisar avaliação
          </button>
          <button type="submit" className="validacao-primario" disabled={ocupado}>
            {ocupado ? "Concluindo..." : "Concluir avaliação"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
