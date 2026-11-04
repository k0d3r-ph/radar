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
    <section className="indicadores-comparativo indicadores-esperas" aria-label="Clientes suspensos ao fim do período">
      <h3>Clientes suspensos ao fim do período</h3>
      <p>
        Clientes cujo acesso estava suspenso em {fim.toLocaleDateString("pt-BR")}.
      </p>
      {suspensos.length === 0 ? (
        <p>Nenhum cliente estava suspenso no fim deste período e filtro.</p>
      ) : (
        <div className="relatorios-table-wrapper" role="region" aria-label="Clientes suspensos, tabela rolável" tabIndex={0}>
          <table className="relatorios-table">
            <caption>Clientes suspensos ao fim do período</caption>
            <thead>
              <tr>
                <th scope="col">Início da suspensão</th>
                <th scope="col">Cliente</th>
                <th scope="col">Treinador</th>
              </tr>
            </thead>
            <tbody>
              {suspensos.map((e, i) => (
                <tr key={`${e.empresa}-${e.data.getTime()}-${i}`}>
                  <td>{e.inicioDesconhecido ? "Não informada" : e.data.toLocaleDateString("pt-BR")}</td>
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
