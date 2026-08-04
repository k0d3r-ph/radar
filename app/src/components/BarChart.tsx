import React, { useState } from "react";

export interface BarChartItem {
  label: string;
  value: number;
}

interface BarChartProps {
  title: string;
  data: BarChartItem[];
  onItemClick?: (label: string) => void;
  selectedLabel?: string;
}

export const BarChart: React.FC<BarChartProps> = ({
  title,
  data,
  onItemClick,
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

            return (
              <div
                key={item.label}
                className={`bar-chart-col ${isHovered ? "bar-chart-col-hovered" : ""} ${isSelected ? "bar-chart-col-selected" : ""}`}
                onClick={() => onItemClick && onItemClick(item.label)}
                onMouseEnter={() => setHoveredIndex(idx)}
                onMouseLeave={() => setHoveredIndex(null)}
                style={{ cursor: onItemClick ? "pointer" : "default" }}
              >
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
