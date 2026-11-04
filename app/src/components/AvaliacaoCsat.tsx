import { Star } from "lucide-react";

interface AvaliacaoCsatProps {
  nota?: number;
  experiencia: "Bom" | "Ruim";
}

export function AvaliacaoCsat({ nota, experiencia }: AvaliacaoCsatProps) {
  if (
    typeof nota !== "number" ||
    !Number.isInteger(nota) ||
    nota < 1 ||
    nota > 5
  ) {
    return <>{experiencia}</>;
  }

  return (
    <span
      role="img"
      aria-label={`Nota ${nota} de 5 estrelas`}
      style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
    >
      <span
        aria-hidden="true"
        style={{ display: "inline-flex", alignItems: "center", gap: "2px" }}
      >
        {[1, 2, 3, 4, 5].map((valor) => (
          <Star
            key={valor}
            size={14}
            fill={nota >= valor ? "#eab308" : "none"}
            color="#eab308"
          />
        ))}
      </span>
      <span aria-hidden="true">({nota}/5)</span>
    </span>
  );
}
