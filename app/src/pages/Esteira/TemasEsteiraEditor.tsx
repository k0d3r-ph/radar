import { useEffect, useRef } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { Plus, X } from "lucide-react";
import {
  linhasTemaParaTextos,
  textosParaLinhasTema,
} from "../../utils/temasEsteira";
import type { LinhaTemaEsteira } from "../../utils/temasEsteira";

type Props = {
  temaText: string;
  dataText: string;
  onChange: (textos: { temaText: string; dataText: string }) => void;
  disabled?: boolean;
};

/** Campos de tema e data da esteira, um par por fase, adicionados pelo treinador. */
export function TemasEsteiraEditor({ temaText, dataText, onChange, disabled }: Props) {
  const linhas = textosParaLinhasTema(temaText, dataText);
  const temaRefs = useRef<(HTMLInputElement | null)[]>([]);
  // Campo a focar depois que a linha nova/removida for renderizada.
  const focarLinhaRef = useRef<number | null>(null);
  const setFocarLinha = (indice: number) => {
    focarLinhaRef.current = indice;
  };

  useEffect(() => {
    if (focarLinhaRef.current === null) return;
    temaRefs.current[focarLinhaRef.current]?.focus();
    focarLinhaRef.current = null;
  });

  const aplicar = (novas: LinhaTemaEsteira[]) => onChange(linhasTemaParaTextos(novas));

  const alterar = (indice: number, campo: keyof LinhaTemaEsteira, valor: string) =>
    aplicar(linhas.map((l, i) => (i === indice ? { ...l, [campo]: valor } : l)));

  const inserirDepois = (indice: number) => {
    aplicar([...linhas.slice(0, indice + 1), { tema: "", data: "" }, ...linhas.slice(indice + 1)]);
    setFocarLinha(indice + 1);
  };

  const remover = (indice: number) => {
    const restantes = linhas.filter((_, i) => i !== indice);
    aplicar(restantes.length ? restantes : [{ tema: "", data: "" }]);
    setFocarLinha(Math.min(indice, Math.max(0, restantes.length - 1)));
  };

  // Enter cria a próxima fase logo abaixo, para cadastrar a esteira só pelo teclado.
  const aoTeclar = (indice: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    inserirDepois(indice);
  };

  // Colar uma lista (um tema por linha) distribui os temas em campos a partir deste.
  const aoColarTema = (indice: number) => (e: ClipboardEvent<HTMLInputElement>) => {
    const texto = e.clipboardData.getData("text");
    if (!texto.includes("\n")) return;
    e.preventDefault();
    const colados = texto.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
    if (colados.length === 0) return;
    const atual = linhas[indice];
    const novas = colados.map((tema, i) => ({
      tema,
      data: i === 0 ? atual.data : "",
    }));
    const substituiAtual = !atual.tema.trim();
    aplicar([
      ...linhas.slice(0, substituiAtual ? indice : indice + 1),
      ...novas,
      ...linhas.slice(indice + 1),
    ]);
    setFocarLinha((substituiAtual ? indice : indice + 1) + novas.length - 1);
  };

  return (
    <div className="control-row temas-editor">
      <div className="temas-editor-cabecalho" aria-hidden="true">
        <span>Temas</span>
        <span>Data</span>
        <span />
      </div>

      <ol className="temas-editor-lista">
        {linhas.map((linha, i) => {
          const ultima = i === linhas.length - 1;
          return (
            <li key={i} className="temas-editor-linha">
              <div className="temas-editor-tema">
                <input
                  ref={(el) => {
                    temaRefs.current[i] = el;
                  }}
                  value={linha.tema}
                  onChange={(e) => alterar(i, "tema", e.target.value)}
                  onKeyDown={aoTeclar(i)}
                  onPaste={aoColarTema(i)}
                  placeholder={`Tema ${i + 1}`}
                  aria-label={`Tema da fase ${i + 1}`}
                  disabled={disabled}
                />
                {!disabled && (linhas.length > 1 || linha.tema || linha.data) && (
                  <button
                    type="button"
                    className="temas-editor-remover"
                    onClick={() => remover(i)}
                    aria-label={`Remover fase ${i + 1}${linha.tema.trim() ? ` (${linha.tema.trim()})` : ""}`}
                    title="Remover fase"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
              </div>

              <input
                className="temas-editor-data"
                value={linha.data}
                onChange={(e) => alterar(i, "data", e.target.value)}
                onKeyDown={aoTeclar(i)}
                placeholder="DD/MM"
                aria-label={`Data da fase ${i + 1}`}
                disabled={disabled}
              />

              {ultima && !disabled ? (
                <button
                  type="button"
                  className="temas-editor-adicionar"
                  onClick={() => inserirDepois(i)}
                  aria-label="Adicionar fase"
                  title="Adicionar fase (Enter)"
                >
                  <Plus size={18} aria-hidden="true" />
                </button>
              ) : (
                <span aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
