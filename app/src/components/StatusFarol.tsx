import "./StatusFarol.css";
import type { StatusFarolType } from "../utils/monitoramento/calcularFarol";

type Props = {
  status: StatusFarolType;
  pendencia?: string;
};

export default function StatusFarol({ status, pendencia }: Props) {
  if (status === "none") return null;

  const descricao = status === "laranja" ? `Pendência: ${pendencia || 'Não informada'}` : `Status ${status}`;

  return <div className={`farol farol-${status}`} role="img" aria-label={descricao} title={descricao} />;
}
