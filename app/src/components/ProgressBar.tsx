import { useEffect, useRef } from "react";
import "./ProgressBar.css";

interface Props {
  value: number;
  fillColor?: string;
}

export default function ProgressBar({ value, fillColor }: Props) {
  const fillRef = useRef<HTMLDivElement>(null);
  const clamped = Math.min(value, 100);

  useEffect(() => {
    if (fillRef.current) {
      fillRef.current.style.width = "0%";
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (fillRef.current) {
            fillRef.current.style.width = `${clamped}%`;
          }
        });
      });
    }
  }, [clamped]);

  return (
    <div className="progress-container">
      <div
        className="progress-bar-wrapper"
        tabIndex={0}
        role="img"
        aria-label={`Progresso: ${Math.round(value)}%`}
      >
        <div
          ref={fillRef}
          className="progress-fill"
          style={{ backgroundColor: fillColor }}
        />
        <span className="progress-tooltip">
          {Math.round(value)}%
        </span>
      </div>
    </div>
  );
}
