import { useMemo } from "react";
import { listarClientesSuspensosNoPeriodo, type EventosIndicadoresTreinamento } from "../../utils/indicadoresTreinamento";
import { formatarNome } from "../../utils/formatarNome";

interface Props {
  eventos: EventosIndicadoresTreinamento;
  inicio: Date;
  fim: Date;
  treinador: string | null;
}

export function DetalhamentoClientesSuspensos({ eventos, inicio, fim, treinador }: Props) {
  const suspensos = useMemo(
    () => listarClientesSuspensosNoPeriodo(eventos, inicio, fim, treinador),
    [eventos, inicio, fim, treinador],
  );
  return (
    <section className="indicadores-comparativo indicadores-esperas" aria-label="Clientes suspensos no período">
      <h3>Clientes suspensos no período</h3>
      <p>
        Suspensões iniciadas entre {inicio.toLocaleDateString("pt-BR")} e {fim.toLocaleDateString("pt-BR")},
        pela data de suspensão registrada no cadastro do cliente.
      </p>
      {suspensos.length === 0 ? (
        <p>Nenhum cliente suspenso neste período e filtro.</p>
      ) : (
        <div className="relatorios-table-wrapper" role="region" aria-label="Clientes suspensos, tabela rolável" tabIndex={0}>
          <table className="relatorios-table">
            <caption>Clientes suspensos por data</caption>
            <thead>
              <tr>
                <th scope="col">Data da suspensão</th>
                <th scope="col">Cliente</th>
                <th scope="col">Treinador</th>
              </tr>
            </thead>
            <tbody>
              {suspensos.map((e, i) => (
                <tr key={`${e.empresa}-${e.data.getTime()}-${i}`}>
                  <td>{e.data.toLocaleDateString("pt-BR")}</td>
                  <td>{e.empresa}</td>
                  <td>{formatarNome(e.treinador)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
