import React, { useState } from "react";

export interface DoughnutChartItem {
  label: string;
  value: number;
  color: string;
}

interface DoughnutChartProps {
  title: string;
  data: DoughnutChartItem[];
  onItemClick?: (label: string) => void;
  selectedLabel?: string;
}

export const DoughnutChart: React.FC<DoughnutChartProps> = ({ 
  title, 
  data, 
  onItemClick, 
  selectedLabel 
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const total = data.reduce((sum, item) => sum + item.value, 0);

  // SVG parameters
  const size = 160;
  const strokeWidth = 28;
  const radius = (size - strokeWidth) / 2; // radius = 66
  const circumference = 2 * Math.PI * radius; // ~414.69

  let accumulatedLength = 0;
  
  // Calculate starting percentages for slice text positioning
  let currentAccumulated = 0;
  const accumulatedPercents = data.map((item) => {
    const start = currentAccumulated;
    currentAccumulated += item.value / total;
    return start;
  });

  return (
    <div className="doughnut-chart-card">
      <h3 className="doughnut-chart-title">{title}</h3>
      
      {total === 0 ? (
        <div className="doughnut-chart-empty-container">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="transparent"
              stroke="rgba(255, 255, 255, 0.05)"
              strokeWidth={strokeWidth}
            />
            <text
              x="50%"
              y="50%"
              textAnchor="middle"
              dy=".3em"
              fill="#64748b"
              fontSize="14px"
              fontWeight="600"
            >
              Sem dados
            </text>
          </svg>
          <div className="doughnut-chart-empty-msg">Nenhuma ocorrência nesta seleção</div>
        </div>
      ) : (
        <div className="doughnut-chart-content">
          <div className="doughnut-chart-svg-wrapper">
            <svg 
              width={size} 
              height={size} 
              viewBox={`0 0 ${size} ${size}`}
            >
              {data.map((item, idx) => {
                if (item.value === 0) return null;
                const strokeLength = (item.value / total) * circumference;
                const strokeOffset = -accumulatedLength;
                accumulatedLength += strokeLength;

                const isHovered = hoveredIndex === idx;
                const isSelected = selectedLabel === item.label;

                return (
                  <circle
                    key={item.label}
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="transparent"
                    stroke={item.color}
                    strokeWidth={isSelected ? strokeWidth + 6 : (isHovered ? strokeWidth + 4 : strokeWidth)}
                    strokeDasharray={`${strokeLength} ${circumference}`}
                    strokeDashoffset={strokeOffset}
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                    style={{
                      transition: "stroke-width 0.2s cubic-bezier(0.4, 0, 0.2, 1), filter 0.2s ease",
                      cursor: onItemClick ? "pointer" : "default",
                      filter: isHovered || isSelected ? "drop-shadow(0px 0px 6px rgba(99,102,241,0.3))" : "none"
                    }}
                    onClick={() => onItemClick && onItemClick(item.label)}
                    onMouseEnter={() => setHoveredIndex(idx)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  />
                );
              })}

              {/* Render upright percentage values inside each chunk if percentage is >= 5% */}
              {data.map((item, idx) => {
                if (item.value === 0) return null;
                const percentage = (item.value / total) * 100;
                if (percentage < 5) return null;

                const P_mid = accumulatedPercents[idx] + (item.value / total) / 2;
                const alpha = -Math.PI / 2 + 2 * Math.PI * P_mid;
                const textX = size / 2 + radius * Math.cos(alpha);
                const textY = size / 2 + radius * Math.sin(alpha);

                return (
                  <text
                    key={`text-${item.label}`}
                    x={textX}
                    y={textY}
                    textAnchor="middle"
                    dy=".35em"
                    fill="#ffffff"
                    fontSize="10px"
                    fontWeight="800"
                    style={{
                      pointerEvents: "none",
                      textShadow: "0px 1px 2px rgba(0,0,0,0.6)"
                    }}
                  >
                    {percentage.toFixed(0)}%
                  </text>
                );
              })}
            </svg>
            
            <div className="doughnut-chart-center-text">
              {hoveredIndex !== null && data[hoveredIndex].value > 0 ? (
                <>
                  <span className="center-value" style={{ color: data[hoveredIndex].color }}>
                    {data[hoveredIndex].value}
                  </span>
                  <span className="center-label">
                    {((data[hoveredIndex].value / total) * 100).toFixed(0)}%
                  </span>
                </>
              ) : selectedLabel && data.find(d => d.label === selectedLabel)?.value ? (
                (() => {
                  const selItem = data.find(d => d.label === selectedLabel)!;
                  return (
                    <>
                      <span className="center-value" style={{ color: selItem.color }}>
                        {selItem.value}
                      </span>
                      <span className="center-label">
                        {((selItem.value / total) * 100).toFixed(0)}%
                      </span>
                    </>
                  );
                })()
              ) : (
                <>
                  <span className="center-value">{total}</span>
                  <span className="center-label">Total</span>
                </>
              )}
            </div>
          </div>

          <div className="doughnut-chart-legend">
            {data.map((item, idx) => {
              const percentage = total > 0 ? (item.value / total) * 100 : 0;
              const isHovered = hoveredIndex === idx;
              const isDisabled = item.value === 0;
              const isSelected = selectedLabel === item.label;

              return (
                <div 
                  key={item.label} 
                  className={`legend-item ${isHovered ? "legend-item-hovered" : ""} ${isSelected ? "legend-item-selected" : ""} ${isDisabled ? "legend-item-disabled" : ""}`}
                  onClick={() => !isDisabled && onItemClick && onItemClick(item.label)}
                  onMouseEnter={() => !isDisabled && setHoveredIndex(idx)}
                  onMouseLeave={() => !isDisabled && setHoveredIndex(null)}
                  style={{ 
                    opacity: hoveredIndex !== null && !isHovered ? 0.3 : (isDisabled ? 0.4 : 1),
                    transition: "all 0.2s ease",
                    cursor: onItemClick && !isDisabled ? "pointer" : "default"
                  }}
                >
                  <span 
                    className="legend-color-dot" 
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="legend-label" title={item.label}>
                    {item.label}
                  </span>
                  <span className="legend-value-group">
                    <strong className="legend-count">{item.value}</strong>
                    <span className="legend-percent">{percentage.toFixed(0)}%</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
