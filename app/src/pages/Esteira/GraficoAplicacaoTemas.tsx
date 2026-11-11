import { useEffect, useId, useRef, useState } from "react";
import { calcularEscalaEixoY } from "../../utils/escalaGrafico";
import type { LinhaAplicacaoTema } from "../../utils/aplicacaoTemas";

type Props = {
  linhas: LinhaAplicacaoTema[];
};

const ALTURA = 340;
const MARGEM_ESQUERDA = 56;
const MARGEM_DIREITA = 24;
const MARGEM_TOPO = 20;
const MARGEM_BASE = 92;
/** Largura reservada por ponto, para os nomes dos temas (longos) não se sobreporem. */
const LARGURA_POR_PONTO = 150;
const LARGURA_MINIMA = 720;
const MAX_CARACTERES_LINHA = 20;
const MAX_LINHAS_ROTULO = 3;

/** Quebra o nome dos temas em até 3 linhas, encerrando com reticências se sobrar texto. */
function quebrarRotulo(texto: string): string[] {
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of texto.split(/\s+/)) {
    const teste = atual ? `${atual} ${palavra}` : palavra;
    if (teste.length > MAX_CARACTERES_LINHA && atual) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = teste;
    }
  }
  if (atual) linhas.push(atual);
  if (linhas.length <= MAX_LINHAS_ROTULO) return linhas;
  const visiveis = linhas.slice(0, MAX_LINHAS_ROTULO);
  visiveis[MAX_LINHAS_ROTULO - 1] = `${visiveis[MAX_LINHAS_ROTULO - 1].slice(0, MAX_CARACTERES_LINHA - 1)}…`;
  return visiveis;
}

const formatarDias = (dias: number) =>
  `${dias.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dia${dias === 1 ? "" : "s"}`;

/**
 * Linha do tempo de aplicação: no eixo Y, depois de quantos dias (D-N) o cliente
 * aplicou na base; no eixo X, os temas de cada dia de treinamento, em ordem
 * cronológica. A linha tracejada de média ajuda a ver a variação entre os temas.
 */
export function GraficoAplicacaoTemas({ linhas }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const tooltipId = useId();
  // Largura disponível medida no container: o gráfico estica até ela sem escalar o
  // texto, e só rola na horizontal quando os temas não cabem.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [larguraDisponivel, setLarguraDisponivel] = useState(LARGURA_MINIMA);
  // O elemento medido troca entre o aviso de vazio e o gráfico; reobserva nessa troca.
  const temPontos = linhas.some((l) => l.realizado && l.diaMarcado !== undefined);
  useEffect(() => {
    const elemento = scrollRef.current;
    if (!elemento) return;
    const observar = new ResizeObserver(([entrada]) =>
      setLarguraDisponivel(Math.floor(entrada.contentRect.width)),
    );
    observar.observe(elemento);
    return () => observar.disconnect();
  }, [temPontos]);
  // Eixo X: dias realizados do primeiro ao último marcado. Os não marcados nesse
  // intervalo contam como não aplicados (valor 0, rótulo em vermelho); os anteriores ao
  // primeiro ou posteriores ao último ficam fora, por ainda não terem com o que comparar.
  const realizadas = linhas.filter((l) => l.realizado);
  const primeiro = realizadas.findIndex((l) => l.diaMarcado !== undefined);
  const ultimo = realizadas.findLastIndex((l) => l.diaMarcado !== undefined);
  const pontos = primeiro === -1 ? [] : realizadas.slice(primeiro, ultimo + 1);
  const marcados = pontos.filter(
    (l): l is LinhaAplicacaoTema & { diaMarcado: number } => l.diaMarcado !== undefined,
  );

  if (marcados.length === 0) {
    return (
      <p className="aplicacao-temas-vazio" ref={scrollRef}>
        O gráfico aparece quando houver ao menos uma aplicação marcada na tabela acima.
      </p>
    );
  }

  const largura = Math.max(larguraDisponivel, MARGEM_ESQUERDA + MARGEM_DIREITA + pontos.length * LARGURA_POR_PONTO);
  const larguraPlot = largura - MARGEM_ESQUERDA - MARGEM_DIREITA;
  const alturaPlot = ALTURA - MARGEM_TOPO - MARGEM_BASE;
  const escala = calcularEscalaEixoY(marcados.map((p) => p.diaMarcado));
  const faixa = larguraPlot / pontos.length;
  const xPara = (i: number) => MARGEM_ESQUERDA + (i + 0.5) * faixa;
  const yPara = (valor: number) => MARGEM_TOPO + alturaPlot - (valor / escala.maximo) * alturaPlot;

  // Não aplicado conta como 0, inclusive na média.
  const valor = (p: LinhaAplicacaoTema) => p.diaMarcado ?? 0;
  const naoAplicados = pontos.length - marcados.length;
  const media = pontos.reduce((soma, p) => soma + valor(p), 0) / pontos.length;
  // Mais rápido/demorado só entre os aplicados: um 0 de "não aplicado" não é o mais rápido.
  const menor = Math.min(...marcados.map((p) => p.diaMarcado));
  const maior = Math.max(...marcados.map((p) => p.diaMarcado));
  const indiceMenor = pontos.findIndex((p) => p.diaMarcado === menor);
  const indiceMaior = pontos.findIndex((p) => p.diaMarcado === maior);
  const caminho = pontos.map((p, i) => `${i === 0 ? "M" : "L"} ${xPara(i)} ${yPara(valor(p))}`).join(" ");
  const resumo = `Dias até a aplicação por tema. Média ${formatarDias(media)}, de ${formatarDias(menor)} a ${formatarDias(maior)}${naoAplicados ? `, ${naoAplicados} não aplicado(s) contados como 0` : ""}. ${pontos
    .map((p) => `${p.temas.join(", ")} (${p.data}): ${p.diaMarcado !== undefined ? `D-${p.diaMarcado}` : "não aplicado (0)"}`)
    .join("; ")}`;
  const pontoHover = hover !== null ? pontos[hover] : null;

  return (
    <div className="aplicacao-grafico">
      <div className="aplicacao-grafico-resumo">
        <span>
          Média <strong>{formatarDias(media)}</strong>
        </span>
        <span>
          Mais rápido <strong>{formatarDias(menor)}</strong>
        </span>
        <span>
          Mais demorado <strong>{formatarDias(maior)}</strong>
        </span>
        {naoAplicados > 0 && (
          <span className="aplicacao-grafico-resumo--nao-aplicado">
            Não aplicados <strong>{naoAplicados}</strong> (contam como 0 na média)
          </span>
        )}
      </div>

      <div className="aplicacao-grafico-scroll" ref={scrollRef} onMouseLeave={() => setHover(null)}>
        <div className="aplicacao-grafico-area" style={{ width: largura }}>
          <svg
            viewBox={`0 0 ${largura} ${ALTURA}`}
            width={largura}
            height={ALTURA}
            role="group"
            aria-label={resumo}
          >
            {escala.marcacoes.map((valor) => (
              <g key={valor}>
                <line
                  x1={MARGEM_ESQUERDA}
                  x2={largura - MARGEM_DIREITA}
                  y1={yPara(valor)}
                  y2={yPara(valor)}
                  className="aplicacao-grafico-grade"
                />
                <text x={MARGEM_ESQUERDA - 10} y={yPara(valor) + 4} textAnchor="end" className="aplicacao-grafico-eixo">
                  {valor}
                </text>
              </g>
            ))}

            <text
              transform={`translate(16 ${MARGEM_TOPO + alturaPlot / 2}) rotate(-90)`}
              textAnchor="middle"
              className="aplicacao-grafico-eixo"
            >
              Dias até aplicar
            </text>

            <line
              x1={MARGEM_ESQUERDA}
              x2={largura - MARGEM_DIREITA}
              y1={yPara(media)}
              y2={yPara(media)}
              className="aplicacao-grafico-media"
            />
            <text
              x={largura - MARGEM_DIREITA}
              y={yPara(media) - 6}
              textAnchor="end"
              className="aplicacao-grafico-media-rotulo"
            >
              Média {formatarDias(media)}
            </text>

            {hover !== null && (
              <line
                x1={xPara(hover)}
                x2={xPara(hover)}
                y1={MARGEM_TOPO}
                y2={MARGEM_TOPO + alturaPlot}
                className="aplicacao-grafico-cursor"
              />
            )}

            <path d={caminho} className="aplicacao-grafico-linha" />

            {pontos.map((p, i) => {
              const semMarcacao = p.diaMarcado === undefined;
              return (
                <g key={p.chave}>
                  <circle
                    cx={xPara(i)}
                    cy={yPara(valor(p))}
                    r={hover === i ? 6 : 4.5}
                    className={`aplicacao-grafico-ponto${semMarcacao ? " aplicacao-grafico-ponto--nao-aplicado" : ""}`}
                  />
                  {/* Rótulo direto só nos extremos; os demais valores ficam no eixo e no tooltip. */}
                  {p.diaMarcado !== undefined && (i === indiceMenor || i === indiceMaior) && (
                    <text x={xPara(i)} y={yPara(p.diaMarcado) - 12} textAnchor="middle" className="aplicacao-grafico-valor">
                      D-{p.diaMarcado}
                    </text>
                  )}
                  <text
                    x={xPara(i)}
                    y={MARGEM_TOPO + alturaPlot + 22}
                    textAnchor="middle"
                    className={`aplicacao-grafico-tema${semMarcacao ? " aplicacao-grafico-tema--sem-marcacao" : ""}`}
                  >
                    {quebrarRotulo(p.temas.join(", ")).map((linha, idx) => (
                      <tspan key={idx} x={xPara(i)} dy={idx === 0 ? 0 : 15}>
                        {linha}
                      </tspan>
                    ))}
                  </text>
                  {/* O texto "não aplicado" acompanha o vermelho, para não depender só da cor. */}
                  <text
                    x={xPara(i)}
                    y={ALTURA - 8}
                    textAnchor="middle"
                    className={`aplicacao-grafico-data${semMarcacao ? " aplicacao-grafico-tema--sem-marcacao" : ""}`}
                  >
                    {semMarcacao ? `${p.data} · não aplicado` : p.data}
                  </text>
                </g>
              );
            })}

            {pontos.map((p, i) => (
              <rect
                key={`alvo-${p.chave}`}
                x={xPara(i) - faixa / 2}
                y={MARGEM_TOPO}
                width={faixa}
                height={alturaPlot}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${p.temas.join(", ")} (${p.data}): ${p.diaMarcado !== undefined ? `aplicado em D-${p.diaMarcado}` : "não aplicado, contado como 0"}`}
                aria-describedby={hover === i ? tooltipId : undefined}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                onKeyDown={(e) => e.key === "Escape" && setHover(null)}
                className="aplicacao-grafico-alvo"
              />
            ))}
          </svg>

          {pontoHover && hover !== null && (
            <div
              id={tooltipId}
              role="tooltip"
              className="aplicacao-grafico-tooltip"
              style={{
                left: Math.min(Math.max(xPara(hover), 130), largura - 130),
                top: Math.max(8, yPara(valor(pontoHover)) - 96),
              }}
            >
              <strong>{pontoHover.temas.join(", ")}</strong>
              <span>Treinamento em {pontoHover.data}</span>
              {pontoHover.diaMarcado === undefined ? (
                <span>Não aplicado (conta como 0). Se o cliente aplicou, marque o D-N na tabela acima.</span>
              ) : (
                <span>
                  Aplicado em <b>D-{pontoHover.diaMarcado}</b>
                  {" · "}
                  {pontoHover.diaMarcado === media
                    ? "na média"
                    : `${formatarDias(Math.abs(pontoHover.diaMarcado - media))} ${pontoHover.diaMarcado > media ? "acima" : "abaixo"} da média`}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
