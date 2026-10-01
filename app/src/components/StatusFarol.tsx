import "./StatusFarol.css";
import type { StatusFarolType } from "../utils/monitoramento/calcularFarol";

type Props = {
  status: StatusFarolType;
};

export default function StatusFarol({ status }: Props) {
  if (status === "none") return null;

  const descricao = status === "laranja" ? "Laranja — checkpoint ativo" : `Status ${status}`;

  return <div className={`farol farol-${status}`} role="img" aria-label={descricao} title={descricao} />;
}
