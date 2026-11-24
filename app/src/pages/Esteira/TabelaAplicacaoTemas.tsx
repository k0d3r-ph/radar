import { useState } from "react";
import { Pencil, X } from "lucide-react";
import { TOTAL_DIAS_APLICACAO } from "../../utils/aplicacaoTemas";
import type { ItemTemaAplicacao, LinhaAplicacaoTema } from "../../utils/aplicacaoTemas";

type Props = {
  linhas: LinhaAplicacaoTema[];
  /** Linha cuja marcação está sendo gravada; seus botões ficam bloqueados até concluir. */
  salvandoChave?: string | null;
  /** Um ajuste de tema (renomear/retirar/incluir) está sendo gravado. */
  salvandoAjuste?: boolean;
  disabled?: boolean;
  onMarcar: (chave: string, dia: number | null) => void;
  /** Devolve a mensagem de erro do nome, ou null quando ele pode ser usado. */
  validarNome: (nome: string, item: ItemTemaAplicacao) => string | null;
  /** Resolve `true` quando o nome foi gravado. */
  onRenomear: (item: ItemTemaAplicacao, novoNome: string) => Promise<boolean>;
  onRemover: (linha: LinhaAplicacaoTema, item: ItemTemaAplicacao) => void;
};

const DIAS = Array.from({ length: TOTAL_DIAS_APLICACAO }, (_, i) => i + 1);

const chaveItem = (linha: LinhaAplicacaoTema, item: ItemTemaAplicacao) =>
  `${linha.chave}|${item.adicionadoId ?? item.chave}`;

function descreverLinha(linha: LinhaAplicacaoTema) {
  const temas = linha.temas.join(", ");
  return linha.data ? `${temas} (${linha.data})` : temas;
}

function motivoBloqueio(linha: LinhaAplicacaoTema, dia: number, disabled?: boolean) {
  if (!linha.realizado) return "Disponível depois que houver uma ocorrência de Treinamento com este tema.";
  if (disabled) return "Somente treinadores podem marcar a aplicação.";
  if ((linha.diasDecorridos ?? 0) < dia) return `D-${dia} ainda não chegou para este treinamento.`;
  return null;
}

/**
 * Marca, para cada tema, depois de quantos dias (D-1 … D-30) do treinamento o
 * cliente o aplicou na base — uma linha por tema. Só temas com ocorrência de
 * Treinamento (ou incluídos com data já passada) podem ser marcados; os ainda
 * planejados aparecem bloqueados. Cada tema pode ser renomeado ou retirado.
 */
export function TabelaAplicacaoTemas({
  linhas,
  salvandoChave,
  salvandoAjuste,
  disabled,
  onMarcar,
  validarNome,
  onRenomear,
  onRemover,
}: Props) {
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  if (linhas.length === 0) {
    return (
      <p className="aplicacao-temas-vazio">
        Nenhum tema na tabela. Cadastre os temas da esteira, registre uma ocorrência de Treinamento ou use “Incluir
        tema”.
      </p>
    );
  }

  const iniciarEdicao = (linha: LinhaAplicacaoTema, item: ItemTemaAplicacao) => {
    setEditando(chaveItem(linha, item));
    setRascunho(item.nome);
    setErro(null);
  };
  const cancelarEdicao = () => {
    setEditando(null);
    setErro(null);
  };

  const salvarEdicao = async (item: ItemTemaAplicacao) => {
    if (rascunho.trim() === item.nome) return cancelarEdicao();
    const mensagem = validarNome(rascunho, item);
    if (mensagem) return setErro(mensagem);
    if (await onRenomear(item, rascunho)) cancelarEdicao();
  };

  return (
    <div className="aplicacao-temas-scroll" role="region" aria-label="Aplicação dos temas na base" tabIndex={0}>
      <table className="aplicacao-temas-tabela">
        <thead>
          <tr>
            <th scope="col" className="aplicacao-temas-tema">
              Tema (data)
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
                  <ul className="aplicacao-temas-itens">
                    {linha.itens.map((item) => {
                      const id = chaveItem(linha, item);
                      if (editando === id) {
                        const erroId = `${id}-erro`;
                        return (
                          <li key={id}>
                            <form
                              className="aplicacao-temas-renomear"
                              onSubmit={(e) => {
                                e.preventDefault();
                                void salvarEdicao(item);
                              }}
                            >
                              <input
                                // Foco direto no campo ao abrir a edição.
                                autoFocus
                                value={rascunho}
                                maxLength={120}
                                aria-label={`Novo nome para ${item.nome}`}
                                aria-invalid={!!erro}
                                aria-describedby={erro ? erroId : undefined}
                                onChange={(e) => {
                                  setRascunho(e.target.value);
                                  setErro(null);
                                }}
                                onKeyDown={(e) => e.key === "Escape" && cancelarEdicao()}
                              />
                              <div className="aplicacao-temas-renomear-acoes">
                                <button type="submit" className="btn-small" disabled={salvandoAjuste}>
                                  {salvandoAjuste ? "Salvando..." : "Salvar"}
                                </button>
                                <button type="button" className="btn-small" onClick={cancelarEdicao}>
                                  Cancelar
                                </button>
                              </div>
                              {erro && (
                                <span id={erroId} role="alert" className="aplicacao-temas-erro">
                                  {erro}
                                </span>
                              )}
                              {item.nome !== item.original && !item.adicionadoId && (
                                <span className="aplicacao-temas-original">Nome original: {item.original}</span>
                              )}
                            </form>
                          </li>
                        );
                      }
                      return (
                        <li key={id} className="aplicacao-temas-item">
                          <span className="aplicacao-temas-item-nome">
                            {item.nome}
                            {item.adicionadoId && <em className="aplicacao-temas-item-selo"> · incluído</em>}
                          </span>
                          {!disabled && (
                            <span className="aplicacao-temas-item-acoes">
                              <button
                                type="button"
                                className="aplicacao-temas-icone"
                                aria-label={`Renomear o tema ${item.nome}`}
                                title="Renomear tema"
                                disabled={salvandoAjuste}
                                onClick={() => iniciarEdicao(linha, item)}
                              >
                                <Pencil size={13} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="aplicacao-temas-icone"
                                aria-label={
                                  item.adicionadoId
                                    ? `Excluir o tema incluído ${item.nome}`
                                    : `Retirar o tema ${item.nome} da tabela`
                                }
                                title={item.adicionadoId ? "Excluir tema incluído" : "Retirar da tabela (dá para restaurar)"}
                                disabled={salvandoAjuste}
                                onClick={() => onRemover(linha, item)}
                              >
                                <X size={13} aria-hidden="true" />
                              </button>
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
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
