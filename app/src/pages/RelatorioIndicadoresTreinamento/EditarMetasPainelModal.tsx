import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Target } from "lucide-react";
import "./EditarMetasPainelModal.css";

export interface IndicadorMetaEditavel {
  chave: string;
  titulo: string;
  menorEhMelhor: boolean;
  meta: number | null;
  /** Texto exibido ao lado do campo (ex.: "%", "/ 5", "clientes"). */
  unidade: string;
  minimo: number;
  maximo: number;
  casasDecimais: number;
}

interface Props {
  indicadores: IndicadorMetaEditavel[];
  onSalvar: (metas: Record<string, number>) => Promise<void>;
  onCancelar: () => void;
}

const formatarNumero = (valor: number, casas: number) =>
  valor.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas });

/** Aceita vírgula ou ponto como separador decimal ("4,8" ou "4.8"). */
function interpretarNumero(texto: string): number | null {
  const limpo = texto.trim().replace(/\s/g, "").replace(",", ".");
  if (!limpo || !/^-?\d+(\.\d+)?$/.test(limpo)) return null;
  return Number(limpo);
}

function validar(indicador: IndicadorMetaEditavel, texto: string): string | null {
  const valor = interpretarNumero(texto);
  if (valor === null) return "Informe um número.";
  if (valor < indicador.minimo || valor > indicador.maximo) {
    return `Use um valor entre ${formatarNumero(indicador.minimo, indicador.casasDecimais)} e ${formatarNumero(indicador.maximo, indicador.casasDecimais)}.`;
  }
  const casas = (String(valor).split(".")[1] ?? "").length;
  if (casas > indicador.casasDecimais) {
    return indicador.casasDecimais === 0
      ? "Use um número inteiro."
      : `Use no máximo ${indicador.casasDecimais} casa decimal.`;
  }
  return null;
}

/** Edição das metas do painel "Indicadores de Treinamento" (somente Master). */
export function EditarMetasPainelModal({ indicadores, onSalvar, onCancelar }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const primeiroCampoRef = useRef<HTMLInputElement>(null);
  const tituloId = useId();
  const descricaoId = useId();
  const prefixoId = useId();
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      indicadores.map((i) => [i.chave, i.meta === null ? "" : formatarNumero(i.meta, i.casasDecimais)]),
    ),
  );
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroGeral, setErroGeral] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focoAnterior = document.activeElement;
    dialog.showModal();
    primeiroCampoRef.current?.focus();
    return () => {
      dialog.close();
      if (focoAnterior instanceof HTMLElement && focoAnterior.isConnected) focoAnterior.focus({ preventScroll: true });
    };
  }, []);

  const erros = Object.fromEntries(indicadores.map((i) => [i.chave, validar(i, valores[i.chave] ?? "")]));
  const temErro = Object.values(erros).some(Boolean);

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    setTentouSalvar(true);
    setErroGeral("");
    if (temErro || salvando) return;
    setSalvando(true);
    try {
      await onSalvar(
        Object.fromEntries(indicadores.map((i) => [i.chave, interpretarNumero(valores[i.chave])!])),
      );
    } catch (error) {
      console.error("Erro ao salvar as metas do painel de treinamento:", error);
      setErroGeral("Não foi possível salvar as metas. Verifique sua conexão e tente novamente.");
      setSalvando(false);
    }
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      className="metas-painel-dialog"
      aria-labelledby={tituloId}
      aria-describedby={descricaoId}
      onCancel={(event) => {
        event.preventDefault();
        if (!salvando) onCancelar();
      }}
    >
      <form className="metas-painel-conteudo" onSubmit={salvar} noValidate>
        <Target size={26} aria-hidden="true" />
        <h2 id={tituloId}>Metas do painel</h2>
        <p id={descricaoId}>
          As metas definem quando cada card aparece como “Dentro da meta” ou “Fora da meta”. A
          alteração vale para todos que abrem o painel, inclusive as TVs, na próxima atualização.
        </p>

        <div className="metas-painel-campos">
          {indicadores.map((indicador, indice) => {
            const campoId = `${prefixoId}-${indicador.chave}`;
            const erro = tentouSalvar ? erros[indicador.chave] : null;
            return (
              <div className="metas-painel-campo" key={indicador.chave}>
                <label htmlFor={campoId}>{indicador.titulo}</label>
                <div className="metas-painel-entrada">
                  <span aria-hidden="true">{indicador.menorEhMelhor ? "≤" : "≥"}</span>
                  <input
                    ref={indice === 0 ? primeiroCampoRef : undefined}
                    id={campoId}
                    type="text"
                    inputMode={indicador.casasDecimais > 0 ? "decimal" : "numeric"}
                    autoComplete="off"
                    value={valores[indicador.chave] ?? ""}
                    disabled={salvando}
                    aria-invalid={!!erro}
                    aria-describedby={erro ? `${campoId}-erro` : `${campoId}-ajuda`}
                    onChange={(e) => setValores((v) => ({ ...v, [indicador.chave]: e.target.value }))}
                  />
                  <span className="metas-painel-unidade">{indicador.unidade}</span>
                </div>
                {erro ? (
                  <small id={`${campoId}-erro`} className="metas-painel-erro">{erro}</small>
                ) : (
                  <small id={`${campoId}-ajuda`}>
                    {indicador.menorEhMelhor ? "Dentro da meta até este valor." : "Dentro da meta a partir deste valor."}
                  </small>
                )}
              </div>
            );
          })}
        </div>

        {erroGeral && <p className="metas-painel-erro" role="alert">{erroGeral}</p>}

        <div className="metas-painel-acoes">
          <button type="button" onClick={onCancelar} disabled={salvando}>Cancelar</button>
          <button type="submit" disabled={salvando}>{salvando ? "Salvando..." : "Salvar metas"}</button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
