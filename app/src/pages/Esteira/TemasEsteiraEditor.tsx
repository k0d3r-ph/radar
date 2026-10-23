import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { ChevronDown, ChevronUp, GripVertical, Plus, X } from "lucide-react";
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
  const moverCimaRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const moverBaixoRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [arrastandoIndex, setArrastandoIndex] = useState<number | null>(null);
  // Linha sobre a qual o item arrastado está, e se ele cairia antes ou depois
  // dela — decidido pela metade (acima/abaixo) em que o cursor está dentro da
  // linha, para o indicador mostrar exatamente onde a fase vai ficar.
  const [alvo, setAlvo] = useState<{ indice: number; posicao: "antes" | "depois" } | null>(null);
  // Campo a focar depois que a linha nova/removida for renderizada.
  const focarLinhaRef = useRef<number | null>(null);
  const setFocarLinha = (indice: number) => {
    focarLinhaRef.current = indice;
  };
  // Botão de mover a focar depois que a reordenação por teclado for renderizada,
  // para repetir o atalho sem o foco "ficar para trás" na posição antiga.
  const focarMoverRef = useRef<{ indice: number; direcao: "cima" | "baixo" } | null>(null);

  useEffect(() => {
    if (focarLinhaRef.current === null) return;
    temaRefs.current[focarLinhaRef.current]?.focus();
    focarLinhaRef.current = null;
  });

  useEffect(() => {
    if (!focarMoverRef.current) return;
    const { indice, direcao } = focarMoverRef.current;
    (direcao === "cima" ? moverCimaRefs : moverBaixoRefs).current[indice]?.focus();
    focarMoverRef.current = null;
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

  const reordenar = (origem: number, destino: number) => {
    if (origem === destino || destino < 0 || destino >= linhas.length) return;
    const novas = [...linhas];
    const [movida] = novas.splice(origem, 1);
    novas.splice(destino, 0, movida);
    aplicar(novas);
  };

  // Converte "antes/depois de qual linha" para o índice de inserção já
  // considerando que a linha de origem sai do array antes de a linha mover
  // entrar na nova posição.
  const indiceDeInsercao = (origem: number, indiceAlvo: number, posicao: "antes" | "depois") => {
    if (posicao === "antes") return origem < indiceAlvo ? indiceAlvo - 1 : indiceAlvo;
    return origem < indiceAlvo ? indiceAlvo : indiceAlvo + 1;
  };

  const mover = (indice: number, direcao: "cima" | "baixo") => {
    const destino = direcao === "cima" ? indice - 1 : indice + 1;
    reordenar(indice, destino);
    focarMoverRef.current = { indice: destino, direcao };
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
        <span />
        <span>Temas</span>
        <span>Data</span>
        <span />
        <span />
      </div>

      <ol
        className="temas-editor-lista"
        aria-label="Fases da esteira, em ordem"
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setAlvo(null);
        }}
      >
        {linhas.map((linha, i) => {
          const ultima = i === linhas.length - 1;
          const primeira = i === 0;
          const rotuloFase = linha.tema.trim() ? ` (${linha.tema.trim()})` : ` ${i + 1}`;
          return (
            <li
              key={i}
              className={[
                "temas-editor-linha",
                arrastandoIndex === i ? "arrastando" : "",
                alvo?.indice === i ? `temas-editor-linha--alvo-${alvo.posicao}` : "",
              ].filter(Boolean).join(" ")}
              draggable={!disabled}
              onDragStart={() => setArrastandoIndex(i)}
              onDragOver={(e) => {
                e.preventDefault();
                if (arrastandoIndex === null || arrastandoIndex === i) {
                  setAlvo(null);
                  return;
                }
                const limite = e.currentTarget.getBoundingClientRect();
                const posicao = e.clientY - limite.top < limite.height / 2 ? "antes" : "depois";
                setAlvo((anterior) =>
                  anterior?.indice === i && anterior.posicao === posicao ? anterior : { indice: i, posicao },
                );
              }}
              onDrop={() => {
                if (arrastandoIndex !== null && alvo) {
                  reordenar(arrastandoIndex, indiceDeInsercao(arrastandoIndex, alvo.indice, alvo.posicao));
                }
                setArrastandoIndex(null);
                setAlvo(null);
              }}
              onDragEnd={() => {
                setArrastandoIndex(null);
                setAlvo(null);
              }}
            >
              <span className="temas-editor-handle" aria-hidden="true" title="Arraste para reordenar">
                <GripVertical size={16} />
              </span>

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

              {!disabled && linhas.length > 1 ? (
                <span className="temas-editor-mover">
                  <button
                    ref={(el) => {
                      moverCimaRefs.current[i] = el;
                    }}
                    type="button"
                    className="temas-editor-mover-botao"
                    onClick={() => mover(i, "cima")}
                    disabled={primeira}
                    aria-label={`Mover fase${rotuloFase} para cima`}
                    title="Mover para cima"
                  >
                    <ChevronUp size={14} aria-hidden="true" />
                  </button>
                  <button
                    ref={(el) => {
                      moverBaixoRefs.current[i] = el;
                    }}
                    type="button"
                    className="temas-editor-mover-botao"
                    onClick={() => mover(i, "baixo")}
                    disabled={ultima}
                    aria-label={`Mover fase${rotuloFase} para baixo`}
                    title="Mover para baixo"
                  >
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                </span>
              ) : (
                <span aria-hidden="true" />
              )}

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
