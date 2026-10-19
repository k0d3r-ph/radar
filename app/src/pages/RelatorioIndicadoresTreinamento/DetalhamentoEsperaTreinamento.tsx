import { useMemo } from "react";
import { listarEsperasLongasTreinamento, type EventosIndicadoresTreinamento } from "../../utils/indicadoresTreinamento";
import { descreverMotivoEsperaTreinamento } from "../../utils/esperaTreinamento";
import { formatarNome } from "../../utils/formatarNome";

interface Props {
  eventos: EventosIndicadoresTreinamento;
  inicio: Date;
  fim: Date;
  treinador: string | null;
}

export function DetalhamentoEsperaTreinamento({ eventos, inicio, fim, treinador }: Props) {
  const esperas = useMemo(() => listarEsperasLongasTreinamento(eventos, inicio, fim, treinador), [eventos, inicio, fim, treinador]);
  const cliente = esperas.filter((e) => e.motivo === "cliente").length;
  const agenda = esperas.filter((e) => e.motivo === "agenda_treinador").length;
  return <section className="indicadores-comparativo indicadores-esperas" aria-label="Motivos das esperas longas">
    <h3>Contexto do tempo de espera</h3>
    <p>Treinamentos com espera de 3 dias úteis ou mais no período principal: {inicio.toLocaleDateString("pt-BR")} a {fim.toLocaleDateString("pt-BR")}.
      A média geral inclui todos os motivos.</p>
    <ul className="indicadores-esperas-resumo">
      <li>A pedido do cliente: <strong>{cliente}</strong></li>
      <li>Agenda do treinador: <strong>{agenda}</strong></li>
    </ul>
    {esperas.length === 0 ? <p>Nenhum treinamento com espera de 3 dias úteis ou mais neste período e filtro.</p> :
      <details><summary>Ver treinamentos e motivos ({esperas.length})</summary>
        <div className="relatorios-table-wrapper" role="region" aria-label="Treinamentos com espera longa, tabela rolável" tabIndex={0}>
          <table className="relatorios-table">
            <caption>Motivo da espera por treinamento</caption>
            <thead><tr><th scope="col">Data</th><th scope="col">Cliente</th><th scope="col">Treinador</th><th scope="col">Espera</th><th scope="col">Motivo</th></tr></thead>
            <tbody>{esperas.map((e, i) => <tr key={e.ocorrenciaId ?? `${e.empresa}-${e.data.getTime()}-${i}`}>
              <td>{e.data.toLocaleDateString("pt-BR")}</td><td>{e.empresa || "—"}</td><td>{formatarNome(e.treinador)}</td>
              <td>{e.dias} dias úteis</td><td>{e.motivo ? descreverMotivoEsperaTreinamento(e.motivo) : "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </details>}
  </section>;
}
