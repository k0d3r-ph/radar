import React, { useState } from "react";
import { Link } from "react-router-dom";

export interface BarChartItem {
  label: string;
  value: number;
}

interface BarChartProps {
  title: string;
  data: BarChartItem[];
  onItemClick?: (label: string) => void;
  getItemHref?: (label: string) => string;
  selectedLabel?: string;
}

export const BarChart: React.FC<BarChartProps> = ({
  title,
  data,
  onItemClick,
  getItemHref,
  selectedLabel,
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const total = data.reduce((sum, item) => sum + item.value, 0);
  const maxValue = Math.max(1, ...data.map((item) => item.value));

  return (
    <div className="bar-chart-card">
      <h3 className="bar-chart-title">{title}</h3>

      {total === 0 ? (
        <div className="bar-chart-empty-msg">Nenhum registro nesta seleção</div>
      ) : (
        <div className="bar-chart-columns">
          {data.map((item, idx) => {
            if (item.value === 0) return null;

            const pct = (item.value / maxValue) * 100;
            const isHovered = hoveredIndex === idx;
            const isSelected = selectedLabel === item.label;
            const href = getItemHref?.(item.label);
            const colunaProps = {
              className: `bar-chart-col ${href ? "bar-chart-col-link" : ""} ${isHovered ? "bar-chart-col-hovered" : ""} ${isSelected ? "bar-chart-col-selected" : ""}`,
              onMouseEnter: () => setHoveredIndex(idx),
              onMouseLeave: () => setHoveredIndex(null),
            };
            const conteudo = (
              <>
                <span className="bar-chart-col-value">{item.value}</span>
                <div className="bar-chart-col-track">
                  <div
                    className="bar-chart-col-fill"
                    style={{ height: `${pct}%` }}
                  />
                </div>
                <span className="bar-chart-col-label" title={item.label}>
                  {item.label}
                </span>
              </>
            );

            if (href) {
              return (
                <Link
                  key={item.label}
                  {...colunaProps}
                  to={href}
                  aria-label={`Ver ocorrências: ${item.label} (${item.value})`}
                  title={`Ver ocorrências: ${item.label}`}
                  onClick={(event) => {
                    if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
                      onItemClick?.(item.label);
                    }
                  }}
                >
                  {conteudo}
                </Link>
              );
            }

            return (
              <div
                key={item.label}
                {...colunaProps}
                onClick={() => onItemClick && onItemClick(item.label)}
                role={onItemClick ? "button" : undefined}
                tabIndex={onItemClick ? 0 : undefined}
                onKeyDown={(event) => {
                  if (onItemClick && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    onItemClick(item.label);
                  }
                }}
                style={{ cursor: onItemClick ? "pointer" : "default" }}
              >
                {conteudo}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
