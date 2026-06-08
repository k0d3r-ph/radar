import { useEffect, useRef } from "react";
import "./ProgressBar.css";

interface Props {
  value: number;
}

export default function ProgressBar({ value }: Props) {
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
      <div className="progress-bar-wrapper">
        <div ref={fillRef} className="progress-fill" />
        <span className="progress-tooltip">
          {Math.round(value)}%
        </span>
      </div>
    </div>
  );
}

