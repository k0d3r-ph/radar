import { TOTAL_DIAS_APLICACAO } from "../../utils/aplicacaoTemas";
import type { LinhaAplicacaoTema } from "../../utils/aplicacaoTemas";

type Props = {
  linhas: LinhaAplicacaoTema[];
  /** Linha cuja marcação está sendo gravada; seus botões ficam bloqueados até concluir. */
  salvandoChave?: string | null;
  disabled?: boolean;
  onMarcar: (chave: string, dia: number | null) => void;
};

const DIAS = Array.from({ length: TOTAL_DIAS_APLICACAO }, (_, i) => i + 1);

function descreverLinha(linha: LinhaAplicacaoTema) {
  const temas = linha.temas.join(", ");
  return linha.data ? `${temas} (${linha.data})` : temas;
}

function motivoBloqueio(linha: LinhaAplicacaoTema, dia: number, disabled?: boolean) {
  if (!linha.realizado) return "Disponível depois que houver uma ocorrência de Treinamento com esses temas.";
  if (disabled) return "Somente treinadores podem marcar a aplicação.";
  if ((linha.diasDecorridos ?? 0) < dia) return `D-${dia} ainda não chegou para este treinamento.`;
  return null;
}

/**
 * Marca, para cada dia de treinamento, depois de quantos dias (D-1 … D-30) o
 * cliente aplicou na base os temas aprendidos. Só os dias com ocorrência de
 * Treinamento podem ser marcados; os blocos ainda planejados aparecem bloqueados.
 */
export function TabelaAplicacaoTemas({ linhas, salvandoChave, disabled, onMarcar }: Props) {
  if (linhas.length === 0) {
    return (
      <p className="aplicacao-temas-vazio">
        Cadastre os temas da esteira ou registre uma ocorrência de Treinamento para acompanhar a aplicação.
      </p>
    );
  }

  return (
    <div className="aplicacao-temas-scroll" role="region" aria-label="Aplicação dos temas na base" tabIndex={0}>
      <table className="aplicacao-temas-tabela">
        <thead>
          <tr>
            <th scope="col" className="aplicacao-temas-tema">
              Temas (data)
            </th>
            {DIAS.map((dia) => (
              <th scope="col" key={dia}>
                D-{dia}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) => {
            const descricao = descreverLinha(linha);
            const salvando = salvandoChave === linha.chave;
            return (
              <tr key={linha.chave} className={linha.realizado ? "" : "aplicacao-temas-linha--pendente"}>
                <th scope="row" className="aplicacao-temas-tema">
                  <span>{linha.temas.join(", ")}</span>
                  <small>
                    {linha.realizado
                      ? (linha.diasDecorridos ?? 0) < 1
                        ? `(${linha.data}) · marcação liberada a partir de amanhã (D-1)`
                        : `(${linha.data})`
                      : linha.data
                        ? `Previsto ${linha.data} · aguardando treinamento`
                        : "Aguardando treinamento"}
                  </small>
                </th>
                {DIAS.map((dia) => {
                  const marcado = linha.diaMarcado === dia;
                  const bloqueio = motivoBloqueio(linha, dia, disabled);
                  return (
                    <td key={dia}>
                      <button
                        type="button"
                        className={`aplicacao-temas-celula${marcado ? " aplicacao-temas-celula--marcada" : ""}`}
                        aria-pressed={marcado}
                        aria-label={`${descricao}: aplicado em D-${dia}${marcado ? " (marcado; clique para desmarcar)" : ""}`}
                        title={bloqueio ?? (marcado ? "Clique para desmarcar" : `Marcar aplicação em D-${dia}`)}
                        // Uma marcação já existente continua visível mesmo bloqueada.
                        disabled={!!bloqueio || salvando}
                        onClick={() => onMarcar(linha.chave, marcado ? null : dia)}
                      >
                        {marcado ? "✕" : ""}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
