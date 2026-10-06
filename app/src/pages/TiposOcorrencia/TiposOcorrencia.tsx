import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  HelpCircle,
  ClipboardList,
  Tag,
  AlertTriangle,
} from "lucide-react";
import {
  listarTemas,
  PERFIS_TABULACAO,
  perfisPadraoTema,
  atualizarPerfisTema,
  criarTema,
  editarTema,
  removerTema,
  TIPOS_PADRAO_SISTEMA,
} from "../../services/temasOcorrencia";
import type { CategoriaTema, TemaOcorrencia } from "../../services/temasOcorrencia";
import "./TiposOcorrencia.css";

const CATEGORIAS: {
  chave: CategoriaTema;
  titulo: string;
  icone: React.ReactNode;
  placeholder: string;
}[] = [
  {
    chave: "pendencia",
    titulo: "Tipos de Pendência",
    icone: <AlertTriangle size={18} />,
    placeholder: "Pesquisar ou criar novo tipo de pendência...",
  },
  {
    chave: "tipo",
    titulo: "Tipos de Ocorrência",
    icone: <Tag size={18} />,
    placeholder: "Pesquisar ou criar novo tipo...",
  },
  {
    chave: "duvida",
    titulo: "Assuntos de Dúvida",
    icone: <HelpCircle size={18} />,
    placeholder: "Pesquisar ou adicionar novo assunto...",
  },
  {
    chave: "solicitacao",
    titulo: "Assuntos de Solicitação",
    icone: <ClipboardList size={18} />,
    placeholder: "Pesquisar ou adicionar novo assunto...",
  },
];

// Nomes dos tipos originais do sistema: renomear ou excluir um deles no card
// "Tipos de Ocorrência" remove a regra de negócio associada a esse nome
// exato (cálculo de score, assunto obrigatório etc.) — o item continua
// existindo, só passa a se comportar como um tipo genérico.
const NOMES_TIPOS_SISTEMA = new Set(TIPOS_PADRAO_SISTEMA);

export const TiposOcorrencia: React.FC = () => {
  const [temas, setTemas] = useState<Record<CategoriaTema, TemaOcorrencia[]>>({
    duvida: [],
    solicitacao: [],
    tipo: [],
    pendencia: [],
  });
  const [novoNome, setNovoNome] = useState<Record<CategoriaTema, string>>({
    duvida: "",
    solicitacao: "",
    tipo: "",
    pendencia: "",
  });
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<CategoriaTema | null>(null);
  const [confirmarExclusao, setConfirmarExclusao] = useState<TemaOcorrencia | null>(null);
  const [removendoId, setRemovendoId] = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nomeEdicao, setNomeEdicao] = useState("");
  const [salvandoPerfisId, setSalvandoPerfisId] = useState<string | null>(null);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  const carregarTudo = async (forceRefresh = false) => {
    setCarregando(true);
    try {
      const [tipo, duvida, solicitacao, pendencia] = await Promise.all([
        listarTemas("tipo", forceRefresh),
        listarTemas("duvida", forceRefresh),
        listarTemas("solicitacao", forceRefresh),
        listarTemas("pendencia", forceRefresh),
      ]);
      setTemas({ tipo, duvida, solicitacao, pendencia });
    } catch (error) {
      console.error("Erro ao carregar tipos de dúvida/solicitação:", error);
      toast.error("Não foi possível carregar a lista de assuntos.");
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarTudo();
  }, []);

  const handleAdicionar = async (categoria: CategoriaTema) => {
    const nome = novoNome[categoria].trim();
    if (!nome) return;

    setSalvando(categoria);
    try {
      await criarTema(nome, categoria);
      setNovoNome((prev) => ({ ...prev, [categoria]: "" }));
      await carregarTudo(true);
      toast.success("Item adicionado com sucesso.");
    } catch (error) {
      const mensagem =
        error instanceof Error ? error.message : "Erro ao adicionar item.";
      toast.error(mensagem);
    } finally {
      setSalvando(null);
    }
  };

  const iniciarEdicao = (tema: TemaOcorrencia) => {
    setEditandoId(tema.id);
    setNomeEdicao(tema.nome);
  };

  const cancelarEdicao = () => {
    setEditandoId(null);
    setNomeEdicao("");
  };

  const confirmarEdicao = async (tema: TemaOcorrencia) => {
    const nome = nomeEdicao.trim();
    if (!nome || nome === tema.nome) {
      cancelarEdicao();
      return;
    }

    setSalvandoEdicao(true);
    try {
      await editarTema(tema.id, nome, tema.categoria);
      await carregarTudo(true);
      toast.success("Item renomeado com sucesso.");
      cancelarEdicao();
    } catch (error) {
      const mensagem =
        error instanceof Error ? error.message : "Erro ao renomear item.";
      toast.error(mensagem);
    } finally {
      setSalvandoEdicao(false);
    }
  };

  const alterarPerfil = async (tema: TemaOcorrencia, perfil: string, marcado: boolean) => {
    const atuais = tema.perfisDisponiveis ?? perfisPadraoTema(tema);
    const perfis = marcado ? [...atuais, perfil] : atuais.filter((p) => p !== perfil);
    setSalvandoPerfisId(tema.id);
    try {
      await atualizarPerfisTema(tema, perfis);
      setTemas((prev) => ({ ...prev, [tema.categoria]: prev[tema.categoria].map((t) =>
        t.id === tema.id ? { ...t, perfisDisponiveis: perfis } : t) }));
    } catch {
      toast.error("Não foi possível salvar os perfis disponíveis.");
    } finally {
      setSalvandoPerfisId(null);
    }
  };

  const handleConfirmarExclusao = async () => {
    if (!confirmarExclusao) return;
    setRemovendoId(confirmarExclusao.id);
    try {
      await removerTema(confirmarExclusao.id, confirmarExclusao.categoria);
      await carregarTudo(true);
      toast.success("Item removido com sucesso.");
    } catch (error) {
      console.error("Erro ao remover item:", error);
      toast.error("Não foi possível remover o item.");
    } finally {
      setRemovendoId(null);
      setConfirmarExclusao(null);
    }
  };

  return (
    <div className="tipos-ocorrencia-page">
      <header className="tipos-ocorrencia-header">
        <h1>Tabulações</h1>
        <p>
          Gerencie os tipos de pendências dos clientes, os tipos de ocorrência
          e os assuntos de Dúvida e Solicitação usados no Histórico.
        </p>
      </header>

      {carregando ? (
        <p className="tipos-ocorrencia-carregando">Carregando...</p>
      ) : (
        <div className="tipos-ocorrencia-grid">
          {CATEGORIAS.map(({ chave, titulo, icone, placeholder }) => {
            const busca = novoNome[chave].trim().toLowerCase();
            const temasFiltrados = busca
              ? temas[chave].filter((t) => t.nome.toLowerCase().includes(busca))
              : temas[chave];
            const jaExiste = temas[chave].some(
              (t) => t.nome.toLowerCase() === busca,
            );

            return (
              <section className="tipos-ocorrencia-card" key={chave}>
                <h2>
                  {icone}
                  {titulo}
                </h2>

                <div className="tipos-ocorrencia-form">
                  <input
                    type="text"
                    placeholder={placeholder}
                    value={novoNome[chave]}
                    onChange={(e) =>
                      setNovoNome((prev) => ({ ...prev, [chave]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !jaExiste) handleAdicionar(chave);
                    }}
                    disabled={salvando === chave}
                  />
                  <button
                    type="button"
                    className="tipos-ocorrencia-btn-add"
                    onClick={() => handleAdicionar(chave)}
                    disabled={
                      salvando === chave || !novoNome[chave].trim() || jaExiste
                    }
                    title={jaExiste ? "Esse item já está cadastrado" : undefined}
                  >
                    <Plus size={16} />
                    {salvando === chave ? "Adicionando..." : "Adicionar"}
                  </button>
                </div>

                {jaExiste && (
                  <p className="tipos-ocorrencia-aviso-existente">
                    Esse item já está cadastrado — veja na lista abaixo.
                  </p>
                )}

                {chave === "tipo" && (
                  <p className="tipos-ocorrencia-aviso-sistema">
                    Os tipos marcados com <AlertTriangle size={11} /> têm
                    comportamento especial no Histórico (cálculo de score,
                    campos obrigatórios etc.). Renomear ou excluir remove
                    esse comportamento para o item.
                  </p>
                )}

                <ul className="tipos-ocorrencia-lista">
                  {temasFiltrados.length === 0 && (
                    <li className="tipos-ocorrencia-vazio">
                      {busca
                        ? "Nenhum item encontrado para essa pesquisa."
                        : "Nenhum item cadastrado."}
                    </li>
                  )}
                  {temasFiltrados.map((tema) => (
                    <li key={tema.id} className="tipos-ocorrencia-item">
                      {editandoId === tema.id ? (
                        <>
                          <input
                            type="text"
                            className="tipos-ocorrencia-input-edicao"
                            value={nomeEdicao}
                            autoFocus
                            onChange={(e) => setNomeEdicao(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") confirmarEdicao(tema);
                              if (e.key === "Escape") cancelarEdicao();
                            }}
                            disabled={salvandoEdicao}
                          />
                          <div className="tipos-ocorrencia-acoes-edicao">
                            <button
                              type="button"
                              className="tipos-ocorrencia-btn-confirmar"
                              title="Salvar"
                              onClick={() => confirmarEdicao(tema)}
                              disabled={salvandoEdicao}
                            >
                              <Check size={15} />
                            </button>
                            <button
                              type="button"
                              className="tipos-ocorrencia-btn-cancelar-inline"
                              title="Cancelar"
                              onClick={cancelarEdicao}
                              disabled={salvandoEdicao}
                            >
                              <X size={15} />
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="tipos-ocorrencia-item-nome">
                            {tema.nome}
                            {chave === "tipo" &&
                              NOMES_TIPOS_SISTEMA.has(tema.nome) && (
                                <AlertTriangle
                                  size={11}
                                  className="tipos-ocorrencia-icone-aviso"
                                  aria-label="Tipo com comportamento especial no Histórico"
                                />
                              )}
                          </span>
                          <div className="tipos-ocorrencia-acoes">
                            <button
                              type="button"
                              className="tipos-ocorrencia-btn-editar"
                              title="Renomear"
                              onClick={() => iniciarEdicao(tema)}
                              disabled={removendoId === tema.id}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              className="tipos-ocorrencia-btn-remove"
                              title="Excluir"
                              onClick={() => setConfirmarExclusao(tema)}
                              disabled={removendoId === tema.id}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </>
                      )}
                      <fieldset className="tipos-ocorrencia-perfis" disabled={salvandoPerfisId !== null || salvandoEdicao || removendoId !== null}>
                        <legend>Disponível para</legend>
                        {PERFIS_TABULACAO.map((perfil) => (
                          <label key={perfil.id}>
                            <input type="checkbox"
                              checked={(tema.perfisDisponiveis ?? perfisPadraoTema(tema)).includes(perfil.id)}
                              onChange={(e) => alterarPerfil(tema, perfil.id, e.target.checked)} />
                            {perfil.nome}
                          </label>
                        ))}
                      </fieldset>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {confirmarExclusao && (
        <div
          className="tipos-ocorrencia-modal-overlay"
          onClick={() => setConfirmarExclusao(null)}
        >
          <div
            className="tipos-ocorrencia-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tipos-ocorrencia-modal-header">
              <AlertTriangle size={22} className="tipos-ocorrencia-modal-icon" />
              <h2>Confirmar exclusão</h2>
            </div>
            <p>
              Tem certeza que deseja excluir{" "}
              <strong>"{confirmarExclusao.nome}"</strong>? Essa ação não pode
              ser desfeita.
            </p>
            <div className="tipos-ocorrencia-modal-actions">
              <button
                type="button"
                className="tipos-ocorrencia-btn-cancelar"
                onClick={() => setConfirmarExclusao(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="tipos-ocorrencia-btn-excluir"
                onClick={handleConfirmarExclusao}
                disabled={removendoId === confirmarExclusao.id}
              >
                {removendoId === confirmarExclusao.id ? "Excluindo..." : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
