import { Fragment, useEffect, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { CalendarClock, ChevronDown, ChevronUp, GripVertical, Link2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  agruparLinhasEmBlocos,
  formatarDataDigitada,
  incrementarReagendamentoSeDataAlterada,
  linhasTemaParaTextos,
  textosParaLinhasTema,
} from "../../utils/temasEsteira";
import type { LinhaTemaEsteira } from "../../utils/temasEsteira";
import { isDiaUtilComFeriados } from "../../utils/feriados";
import { avancarDiasUteisComFeriados } from "../../utils/prazoTreinamento";

type Props = {
  temaText: string;
  dataText: string;
  blocoText: string;
  reagendamentosText?: string;
  onChange: (textos: {
    temaText: string;
    dataText: string;
    blocoText: string;
    reagendamentosText: string;
  }) => void;
  /** Cadência (dias úteis) usada para recalcular as datas das fases seguintes a
   * partir de uma data ajustada numa fase intermediária. */
  cadenciaDiasTreinamento?: string;
  disabled?: boolean;
};

/** Campos de tema e data da esteira, um par por fase, adicionados pelo treinador. */
export function TemasEsteiraEditor({ temaText, dataText, blocoText, reagendamentosText, onChange, cadenciaDiasTreinamento, disabled }: Props) {
  const linhas = textosParaLinhasTema(temaText, dataText, blocoText, reagendamentosText);
  const temaRefs = useRef<(HTMLInputElement | null)[]>([]);
  const moverCimaRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const moverBaixoRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [arrastandoIndex, setArrastandoIndex] = useState<number | null>(null);
  // Linha sobre a qual o item arrastado está, e se ele cairia antes ou depois
  // dela — decidido pela metade (acima/abaixo) em que o cursor está dentro da
  // linha, para o indicador mostrar exatamente onde a fase vai ficar.
  const [alvo, setAlvo] = useState<{ indice: number; posicao: "antes" | "depois" } | null>(null);
  // Fase em que o seletor de "ajustar data e recalcular as seguintes" está aberto, e
  // a nova data (com ano) escolhida nele.
  const [recalculoAberto, setRecalculoAberto] = useState<number | null>(null);
  const [dataRecalculo, setDataRecalculo] = useState("");
  const dataEmEdicaoRef = useRef<{ indice: number; original: string } | null>(
    null,
  );
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
    aplicar([...linhas.slice(0, indice + 1), { tema: "", data: "", reagendamentos: 0, mesmoDiaDoProximo: false }, ...linhas.slice(indice + 1)]);
    setFocarLinha(indice + 1);
  };

  const remover = (indice: number) => {
    const restantes = linhas.filter((_, i) => i !== indice);
    aplicar(restantes.length ? restantes : [{ tema: "", data: "", reagendamentos: 0, mesmoDiaDoProximo: false }]);
    setFocarLinha(Math.min(indice, Math.max(0, restantes.length - 1)));
  };

  const alternarMesmoDia = (indice: number) =>
    aplicar(linhas.map((l, i) => (i === indice ? { ...l, mesmoDiaDoProximo: !l.mesmoDiaDoProximo } : l)));

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
      reagendamentos: i === 0 ? atual.reagendamentos : 0,
      mesmoDiaDoProximo: i === 0 ? atual.mesmoDiaDoProximo : false,
    }));
    const substituiAtual = !atual.tema.trim();
    aplicar([
      ...linhas.slice(0, substituiAtual ? indice : indice + 1),
      ...novas,
      ...linhas.slice(indice + 1),
    ]);
    setFocarLinha((substituiAtual ? indice : indice + 1) + novas.length - 1);
  };

  // Quando o cliente não pode mais num dia já planejado (ex.: treinamento marcado
  // para o dia 16 precisa ir pro dia 17), ajusta a data real dessa fase (e das demais
  // do mesmo bloco/dia) e recalcula as fases seguintes a partir dela pela cadência
  // configurada — sem tocar nas fases anteriores a este bloco.
  const recalcularAPartirDe = (indice: number) => {
    const cadencia = parseInt(cadenciaDiasTreinamento || "", 10);
    if (!cadencia || cadencia <= 0) {
      toast.error("Informe a cadência entre treinamentos (dias úteis) para recalcular as datas seguintes.");
      return;
    }
    if (!dataRecalculo) {
      toast.error("Informe a nova data desta fase.");
      return;
    }
    const [ano, mes, dia] = dataRecalculo.split("-").map(Number);
    let cursor = new Date(ano, mes - 1, dia);
    while (!isDiaUtilComFeriados(cursor)) {
      cursor.setDate(cursor.getDate() + 1);
    }

    const blocos = agruparLinhasEmBlocos(linhas);
    const indiceBlocoAncora = blocos.findIndex((indicesDoBloco) => indicesDoBloco.includes(indice));
    if (indiceBlocoAncora === -1) return;

    const novasLinhas = [...linhas];
    blocos.forEach((indicesDoBloco, indiceBloco) => {
      if (indiceBloco < indiceBlocoAncora) return;
      if (indiceBloco > indiceBlocoAncora) {
        cursor = avancarDiasUteisComFeriados(cursor, cadencia);
      }
      const dataFormatada = `${String(cursor.getDate()).padStart(2, "0")}/${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      indicesDoBloco.forEach((idx) => {
        novasLinhas[idx] = { ...novasLinhas[idx], data: dataFormatada };
      });
    });

    const dataAnterior = linhas[indice].data;
    const reagendadas = incrementarReagendamentoSeDataAlterada(
      novasLinhas,
      indice,
      dataAnterior,
    );
    aplicar(reagendadas);
    setRecalculoAberto(null);
    setDataRecalculo("");
    toast.success("Data ajustada. As fases seguintes foram recalculadas pela cadência.");
  };

  // Cor do bloco (grupo de fases unidas no "mesmo dia") de cada linha, alternando a
  // cada novo bloco — para que blocos consecutivos não pareçam um único grupo contínuo.
  // -1 = linha fora de qualquer bloco.
  const QUANTIDADE_CORES_BLOCO = 4;
  const corBlocoPorIndice: number[] = [];
  let proximaCor = 0;
  linhas.forEach((linha, i) => {
    const noMesmoBlocoDoAnterior = i > 0 && linhas[i - 1].mesmoDiaDoProximo;
    const inicioBloco = linha.mesmoDiaDoProximo && !noMesmoBlocoDoAnterior;
    if (inicioBloco) {
      corBlocoPorIndice[i] = proximaCor % QUANTIDADE_CORES_BLOCO;
      proximaCor++;
    } else if (noMesmoBlocoDoAnterior) {
      corBlocoPorIndice[i] = corBlocoPorIndice[i - 1];
    } else {
      corBlocoPorIndice[i] = -1;
    }
  });

  return (
    <div className="control-row temas-editor">
      <div className="temas-editor-cabecalho" aria-hidden="true">
        <span />
        <span>Temas</span>
        <span>Data</span>
        <span />
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
          const noMesmoBlocoDoAnterior = !primeira && linhas[i - 1].mesmoDiaDoProximo;
          const corBloco = corBlocoPorIndice[i];
          return (
            <Fragment key={i}>
            <li
              className={[
                "temas-editor-linha",
                arrastandoIndex === i ? "arrastando" : "",
                alvo?.indice === i ? `temas-editor-linha--alvo-${alvo.posicao}` : "",
                linha.mesmoDiaDoProximo ? "temas-editor-linha--inicio-bloco" : "",
                noMesmoBlocoDoAnterior ? "temas-editor-linha--meio-bloco" : "",
                corBloco > 0 ? `temas-editor-linha--bloco-${corBloco}` : "",
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
                onFocus={() => {
                  dataEmEdicaoRef.current = { indice: i, original: linha.data };
                }}
                onChange={(e) =>
                  alterar(i, "data", formatarDataDigitada(e.target.value))
                }
                onBlur={() => {
                  const edicao = dataEmEdicaoRef.current;
                  if (!edicao || edicao.indice !== i) return;
                  dataEmEdicaoRef.current = null;
                  aplicar(
                    incrementarReagendamentoSeDataAlterada(
                      linhas,
                      i,
                      edicao.original,
                    ),
                  );
                }}
                onKeyDown={aoTeclar(i)}
                placeholder="DD/MM"
                aria-label={`Data da fase ${i + 1}`}
                disabled={disabled}
              />

              {!disabled && !ultima ? (
                <button
                  type="button"
                  className="temas-editor-recalcular-botao"
                  onClick={() => {
                    setRecalculoAberto(recalculoAberto === i ? null : i);
                    setDataRecalculo("");
                  }}
                  aria-expanded={recalculoAberto === i}
                  aria-label={`Ajustar a data da fase${rotuloFase} e recalcular as fases seguintes`}
                  title="Ajustar esta data e recalcular as datas seguintes pela cadência"
                >
                  <CalendarClock size={16} aria-hidden="true" />
                </button>
              ) : (
                <span aria-hidden="true" />
              )}

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
            {recalculoAberto === i && (
              <li className="temas-editor-recalculo">
                <label htmlFor={`temas-editor-recalculo-data-${i}`}>
                  Nova data da fase{rotuloFase}:
                </label>
                <input
                  id={`temas-editor-recalculo-data-${i}`}
                  type="date"
                  value={dataRecalculo}
                  onChange={(e) => setDataRecalculo(e.target.value)}
                />
                <button type="button" className="btn-secondary" onClick={() => recalcularAPartirDe(i)}>
                  Aplicar e recalcular seguintes
                </button>
                <button
                  type="button"
                  className="temas-editor-recalculo-cancelar"
                  onClick={() => {
                    setRecalculoAberto(null);
                    setDataRecalculo("");
                  }}
                  aria-label="Cancelar ajuste de data"
                  title="Cancelar"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            )}
            {!ultima && (
              <li className="temas-editor-conector" aria-hidden={disabled}>
                <button
                  type="button"
                  className={[
                    "temas-editor-conector-botao",
                    linha.mesmoDiaDoProximo ? "ativo" : "",
                    linha.mesmoDiaDoProximo && corBloco > 0 ? `temas-editor-conector-botao--bloco-${corBloco}` : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => alternarMesmoDia(i)}
                  disabled={disabled}
                  aria-pressed={linha.mesmoDiaDoProximo}
                  aria-label={
                    linha.mesmoDiaDoProximo
                      ? `Fase${rotuloFase} está no mesmo dia da próxima. Clique para separar.`
                      : `Unir fase${rotuloFase} no mesmo dia da próxima`
                  }
                  title={linha.mesmoDiaDoProximo ? "Mesmo dia da próxima fase — clique para separar" : "Unir com a próxima fase no mesmo dia"}
                >
                  <Link2 size={12} aria-hidden="true" />
                  {linha.mesmoDiaDoProximo ? "Mesmo dia" : "Unir ao próximo"}
                </button>
              </li>
            )}
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}
