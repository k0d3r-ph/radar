import React, { useId, useState } from "react";
import { construirCurvaComLacunas } from "../utils/curvaGrafico";
import { calcularEscalaEixoY } from "../utils/escalaGrafico";
import "./LineChart.css";

export interface LineChartSeries {
  label: string;
  color: string;
  values: (number | null)[];
  pointDetails?: ({
    dateLabel: string;
    valueLabel: string;
    metrics: { label: string; value: string }[];
  } | null)[];
}

interface LineChartProps {
  title: string;
  categorias: string[];
  series: LineChartSeries[];
  exibirZerados?: boolean;
}

const WIDTH = 720;
const HEIGHT = 240;
const PADDING_LEFT = 36;
const PADDING_RIGHT = 16;
const PADDING_TOP = 16;
const PADDING_BOTTOM = 32;

export const LineChart: React.FC<LineChartProps> = ({ title, categorias, series, exibirZerados = false }) => {
  const [indiceHover, setHover] = useState<number | null>(null);
  const tooltipId = useId();

  const temDados = series.some((s) => s.values.some((v) => v !== null && (exibirZerados || v > 0)));
  const escalaY = calcularEscalaEixoY(series.flatMap((s) => s.values.filter((v): v is number => v !== null)));
  const n = categorias.length;
  const hover = indiceHover !== null && indiceHover < n ? indiceHover : null;

  const plotWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  const xFor = (idx: number) => PADDING_LEFT + (n <= 1 ? plotWidth / 2 : (idx / (n - 1)) * plotWidth);
  const yFor = (valor: number) => PADDING_TOP + plotHeight - (valor / escalaY.maximo) * plotHeight;

  const resumoAcessivel = `${title}. ${series
    .map((s) => {
      const totalSerie = s.values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
      const ultimoValor = s.values[s.values.length - 1] ?? 0;
      const ultimaCategoria = categorias[categorias.length - 1] ?? "";
      return `${s.label}: total ${totalSerie}, último valor ${ultimoValor}${ultimaCategoria ? ` (${ultimaCategoria})` : ""}`;
    })
    .join("; ")}`;

  // Com muitos pontos (ex.: 90 dias) os rótulos do eixo X se sobrepõem; exibe um a cada
  // `passoRotulo`, sempre mantendo o mais recente (último) visível.
  const passoRotulo = Math.max(1, Math.ceil(n / 16));

  return (
    <div className="line-chart-card">
      <h3 className="line-chart-title">{title}</h3>

      {!temDados ? (
        <div className="line-chart-empty-msg">Nenhum registro nesta seleção</div>
      ) : (
        <>
          <div className="line-chart-svg-wrapper" onMouseLeave={() => setHover(null)}>
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="line-chart-svg"
              preserveAspectRatio="xMidYMid meet"
              role="group"
              aria-label={resumoAcessivel}
            >
              {escalaY.marcacoes.map((valor) => {
                const y = yFor(valor);
                return (
                  <g key={valor}>
                    <line
                      x1={PADDING_LEFT}
                      x2={WIDTH - PADDING_RIGHT}
                      y1={y}
                      y2={y}
                      className="line-chart-grid-line"
                    />
                    <text x={PADDING_LEFT - 8} y={y + 4} textAnchor="end" className="line-chart-axis-label">
                      {valor.toLocaleString("pt-BR", { maximumFractionDigits: 12 })}
                    </text>
                  </g>
                );
              })}

              {categorias.map((cat, idx) => (n - 1 - idx) % passoRotulo === 0 && (
                <text
                  key={cat}
                  x={xFor(idx)}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                  className="line-chart-axis-label"
                >
                  {cat}
                </text>
              ))}

              {series.map((s, serieIdx) => {
                const caminho = construirCurvaComLacunas(
                  s.values.map((v, idx) => v === null ? null : ({ x: xFor(idx), y: yFor(v) })),
                  yFor(0),
                );
                return (
                  <path
                    key={s.label}
                    d={caminho}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    // A partir da 2ª série, um traço tracejado reforça a diferença
                    // entre linhas de cores parecidas (ex.: mesma cor-base ao comparar
                    // "Treinamento" com "Suporte") sem depender só da cor.
                    strokeDasharray={serieIdx > 0 ? "6 4" : undefined}
                    className="line-chart-line"
                  />
                );
              })}

              {series.map((s) =>
                s.values.map((v, idx) => v === null ? null : (
                  <circle
                    key={`${s.label}-${idx}`}
                    cx={xFor(idx)}
                    cy={yFor(v)}
                    r={hover === idx ? 3.5 : 2}
                    fill={s.color}
                    className="line-chart-point"
                  />
                ))
              )}

              {categorias.map((_, idx) => (
                <rect
                  key={`hover-${idx}`}
                  x={xFor(idx) - plotWidth / (2 * Math.max(1, n))}
                  y={PADDING_TOP}
                  width={plotWidth / Math.max(1, n)}
                  height={plotHeight}
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={`Consultar ${categorias[idx]}`}
                  aria-describedby={hover === idx ? tooltipId : undefined}
                  onMouseEnter={() => setHover(idx)}
                  onClick={() => setHover(idx)}
                  onFocus={() => setHover(idx)}
                  onBlur={() => setHover(null)}
                  onKeyDown={(event) => { if (event.key === "Escape") setHover(null); }}
                  className="line-chart-hit-area"
                />
              ))}

              {hover !== null && (
                <line
                  x1={xFor(hover)}
                  x2={xFor(hover)}
                  y1={PADDING_TOP}
                  y2={PADDING_TOP + plotHeight}
                  className="line-chart-hover-line"
                />
              )}
            </svg>

            {hover !== null && (
              <div
                id={tooltipId}
                role="tooltip"
                className="line-chart-tooltip"
                style={{
                  // Reserva a largura máxima do tooltip e mantém as bordas dentro do gráfico.
                  left: `clamp(8px, ${(xFor(hover) / WIDTH) * 100}%, calc(100% - 368px))`,
                }}
              >
                <strong>{categorias[hover]}</strong>
                {series.map((s) => {
                  const detalhe = s.pointDetails?.[hover];
                  return <div key={s.label} className="line-chart-tooltip-series">
                    <div className="line-chart-tooltip-row">
                      <span className="line-chart-tooltip-dot" style={{ background: s.color }} />
                      <span>{s.label}: {detalhe?.valueLabel ?? s.values[hover] ?? "—"}</span>
                    </div>
                    {detalhe && <>
                      <span className="line-chart-tooltip-date">{detalhe.dateLabel}</span>
                      {detalhe.metrics.map((metrica) => <div key={metrica.label} className="line-chart-tooltip-metric">
                        <span>{metrica.label}</span><b>{metrica.value}</b>
                      </div>)}
                    </>}
                    {s.pointDetails && !detalhe && <span className="line-chart-tooltip-date">Sem dia correspondente neste período.</span>}
                  </div>;
                })}
              </div>
            )}
          </div>

          <div className="line-chart-legend">
            {series.map((s) => (
              <span key={s.label} className="line-chart-legend-item">
                <span className="line-chart-legend-dot" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
