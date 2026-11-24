import { useState } from "react";
import { Pencil, X } from "lucide-react";
import {
  DIA_APLICACAO_ANTES_DO_TREINAMENTO,
  TOTAL_DIAS_APLICACAO,
  isSemAplicacaoMarcada,
} from "../../utils/aplicacaoTemas";
import type {
  ItemTemaAplicacao,
  LinhaAplicacaoTema,
} from "../../utils/aplicacaoTemas";

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

// D-0 (aplicou antes do treinamento) seguido de D-1 … D-30.
const DIAS = Array.from(
  { length: TOTAL_DIAS_APLICACAO + 1 },
  (_, i) => i + DIA_APLICACAO_ANTES_DO_TREINAMENTO,
);
const EXPLICACAO_D0 =
  "D-0: o cliente já aplicou este tema na base antes mesmo do treinamento.";
const ID_EXPLICACAO_D0 = "aplicacao-temas-explicacao-d0";

const rotuloDia = (dia: number) =>
  dia === DIA_APLICACAO_ANTES_DO_TREINAMENTO
    ? "antes do treinamento (D-0)"
    : `em D-${dia}`;

const chaveItem = (linha: LinhaAplicacaoTema, item: ItemTemaAplicacao) =>
  `${linha.chave}|${item.adicionadoId ?? item.chave}`;

function descreverLinha(linha: LinhaAplicacaoTema) {
  const temas = linha.temas.join(", ");
  return linha.data ? `${temas} (${linha.data})` : temas;
}

function motivoBloqueio(
  linha: LinhaAplicacaoTema,
  dia: number,
  disabled?: boolean,
) {
  if (!linha.realizado)
    return "Disponível depois que houver uma ocorrência de Treinamento com este tema.";
  if (dia === DIA_APLICACAO_ANTES_DO_TREINAMENTO)
    return disabled ? "Somente treinadores podem marcar a aplicação." : null;
  if (disabled) return "Somente treinadores podem marcar a aplicação.";
  if ((linha.diasDecorridos ?? 0) < dia)
    return `D-${dia} ainda não chegou para este treinamento.`;
  return null;
}

/**
 * Marca, para cada tema, depois de quantos dias (D-1 … D-30) do treinamento o
 * cliente o aplicou na base, ou D-0 se já aplicou antes — uma linha por tema. Temas
 * já ensinados, com o D-1 alcançado e sem marcação, ficam em vermelho. Só temas com ocorrência de
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
        Nenhum tema na tabela. Cadastre os temas da esteira, registre uma
        ocorrência de Treinamento ou use “Incluir tema”.
      </p>
    );
  }

  const iniciarEdicao = (
    linha: LinhaAplicacaoTema,
    item: ItemTemaAplicacao,
  ) => {
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
    <div
      className="aplicacao-temas-scroll"
      role="region"
      aria-label="Aplicação dos temas na base"
      tabIndex={0}
    >
      <table className="aplicacao-temas-tabela">
        <thead>
          <tr>
            <th scope="col" className="aplicacao-temas-tema">
              Tema (data)
            </th>
            {DIAS.map((dia) =>
              dia === DIA_APLICACAO_ANTES_DO_TREINAMENTO ? (
                <th scope="col" key={dia} className="aplicacao-temas-col-d0">
                  {/* Explicação no hover e no foco do teclado (não só no title). */}
                  <span
                    className="aplicacao-temas-dica"
                    tabIndex={0}
                    aria-describedby={ID_EXPLICACAO_D0}
                  >
                    <span aria-hidden="true">← </span>D-0
                    <span
                      id={ID_EXPLICACAO_D0}
                      role="tooltip"
                      className="aplicacao-temas-dica-texto"
                    >
                      {EXPLICACAO_D0}
                    </span>
                  </span>
                </th>
              ) : (
                <th scope="col" key={dia}>
                  D-{dia}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) => {
            const descricao = descreverLinha(linha);
            const salvando = salvandoChave === linha.chave;
            const semAplicacao = isSemAplicacaoMarcada(linha);
            const classeLinha = !linha.realizado
              ? "aplicacao-temas-linha--pendente"
              : semAplicacao
                ? "aplicacao-temas-linha--sem-aplicacao"
                : "";
            return (
              <tr key={linha.chave} className={classeLinha}>
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
                                onKeyDown={(e) =>
                                  e.key === "Escape" && cancelarEdicao()
                                }
                              />
                              <div className="aplicacao-temas-renomear-acoes">
                                <button
                                  type="submit"
                                  className="btn-small"
                                  disabled={salvandoAjuste}
                                >
                                  {salvandoAjuste ? "Salvando..." : "Salvar"}
                                </button>
                                <button
                                  type="button"
                                  className="btn-small"
                                  onClick={cancelarEdicao}
                                >
                                  Cancelar
                                </button>
                              </div>
                              {erro && (
                                <span
                                  id={erroId}
                                  role="alert"
                                  className="aplicacao-temas-erro"
                                >
                                  {erro}
                                </span>
                              )}
                              {item.nome !== item.original &&
                                !item.adicionadoId && (
                                  <span className="aplicacao-temas-original">
                                    Nome original: {item.original}
                                  </span>
                                )}
                            </form>
                          </li>
                        );
                      }
                      return (
                        <li key={id} className="aplicacao-temas-item">
                          <span className="aplicacao-temas-item-nome">
                            {item.nome}
                            {item.adicionadoId && (
                              <em className="aplicacao-temas-item-selo">
                                {" "}
                                · incluído
                              </em>
                            )}
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
                                title={
                                  item.adicionadoId
                                    ? "Excluir tema incluído"
                                    : "Retirar da tabela (dá para restaurar)"
                                }
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
                        ? `(${linha.data}) · D-1 liberado a partir de amanhã`
                        : semAplicacao
                          ? `(${linha.data}) · sem aplicação marcada`
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
                        aria-label={`${descricao}: aplicado ${rotuloDia(dia)}${marcado ? " (marcado; clique para desmarcar)" : ""}`}
                        title={
                          bloqueio ??
                          (marcado
                            ? "Clique para desmarcar"
                            : `Marcar aplicação ${rotuloDia(dia)}`)
                        }
                        // Uma marcação já existente continua visível mesmo bloqueada.
                        disabled={!!bloqueio || salvando}
                        onClick={() =>
                          onMarcar(linha.chave, marcado ? null : dia)
                        }
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
