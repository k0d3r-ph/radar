import React, { useState } from "react";
import "./LineChart.css";

export interface LineChartSeries {
  label: string;
  color: string;
  values: number[];
}

interface LineChartProps {
  title: string;
  categorias: string[];
  series: LineChartSeries[];
}

const WIDTH = 720;
const HEIGHT = 240;
const PADDING_LEFT = 36;
const PADDING_RIGHT = 16;
const PADDING_TOP = 16;
const PADDING_BOTTOM = 32;

export const LineChart: React.FC<LineChartProps> = ({ title, categorias, series }) => {
  const [hover, setHover] = useState<number | null>(null);

  const temDados = series.some((s) => s.values.some((v) => v > 0));
  const maxValor = Math.max(1, ...series.flatMap((s) => s.values));
  const n = categorias.length;

  const plotWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  const xFor = (idx: number) => PADDING_LEFT + (n <= 1 ? plotWidth / 2 : (idx / (n - 1)) * plotWidth);
  const yFor = (valor: number) => PADDING_TOP + plotHeight - (valor / maxValor) * plotHeight;

  const gridLines = 4;

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
          <div className="line-chart-svg-wrapper">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="line-chart-svg" preserveAspectRatio="xMidYMid meet">
              {Array.from({ length: gridLines + 1 }).map((_, i) => {
                const y = PADDING_TOP + (plotHeight / gridLines) * i;
                const valor = Math.round(maxValor - (maxValor / gridLines) * i);
                return (
                  <g key={i}>
                    <line
                      x1={PADDING_LEFT}
                      x2={WIDTH - PADDING_RIGHT}
                      y1={y}
                      y2={y}
                      className="line-chart-grid-line"
                    />
                    <text x={PADDING_LEFT - 8} y={y + 4} textAnchor="end" className="line-chart-axis-label">
                      {valor}
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

              {series.map((s) => {
                const pontos = s.values.map((v, idx) => `${xFor(idx)},${yFor(v)}`).join(" ");
                return (
                  <polyline
                    key={s.label}
                    points={pontos}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2.5}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    className="line-chart-line"
                  />
                );
              })}

              {series.map((s) =>
                s.values.map((v, idx) => (
                  <circle
                    key={`${s.label}-${idx}`}
                    cx={xFor(idx)}
                    cy={yFor(v)}
                    r={hover === idx ? 5 : 3.5}
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
                  onMouseEnter={() => setHover(idx)}
                  onMouseLeave={() => setHover(null)}
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
                className="line-chart-tooltip"
                style={{
                  left: `${(xFor(hover) / WIDTH) * 100}%`,
                  // Perto das bordas, ancora o tooltip para dentro do gráfico em vez de centralizar
                  transform: `translate(${
                    xFor(hover) / WIDTH > 0.7 ? "-100%" : xFor(hover) / WIDTH < 0.3 ? "0" : "-50%"
                  }, -100%)`,
                }}
              >
                <strong>{categorias[hover]}</strong>
                {series.map((s) => (
                  <div key={s.label} className="line-chart-tooltip-row">
                    <span className="line-chart-tooltip-dot" style={{ background: s.color }} />
                    {s.label}: {s.values[hover]}
                  </div>
                ))}
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
