import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, HelpCircle, ClipboardList, AlertTriangle } from "lucide-react";
import {
  listarTemas,
  criarTema,
  removerTema,
} from "../../services/temasOcorrencia";
import type { CategoriaTema, TemaOcorrencia } from "../../services/temasOcorrencia";
import "./TiposOcorrencia.css";

const CATEGORIAS: { chave: CategoriaTema; titulo: string; icone: React.ReactNode }[] = [
  { chave: "duvida", titulo: "Assuntos de Dúvida", icone: <HelpCircle size={18} /> },
  { chave: "solicitacao", titulo: "Assuntos de Solicitação", icone: <ClipboardList size={18} /> },
];

export const TiposOcorrencia: React.FC = () => {
  const [temas, setTemas] = useState<Record<CategoriaTema, TemaOcorrencia[]>>({
    duvida: [],
    solicitacao: [],
  });
  const [novoNome, setNovoNome] = useState<Record<CategoriaTema, string>>({
    duvida: "",
    solicitacao: "",
  });
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<CategoriaTema | null>(null);
  const [confirmarExclusao, setConfirmarExclusao] = useState<TemaOcorrencia | null>(null);
  const [removendoId, setRemovendoId] = useState<string | null>(null);

  const carregarTudo = async (forceRefresh = false) => {
    setCarregando(true);
    try {
      const [duvida, solicitacao] = await Promise.all([
        listarTemas("duvida", forceRefresh),
        listarTemas("solicitacao", forceRefresh),
      ]);
      setTemas({ duvida, solicitacao });
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
        <h1>Tipos de Ocorrência</h1>
        <p>
          Gerencie os assuntos disponíveis para seleção nas ocorrências de
          Dúvida e Solicitação no Histórico.
        </p>
      </header>

      {carregando ? (
        <p className="tipos-ocorrencia-carregando">Carregando...</p>
      ) : (
        <div className="tipos-ocorrencia-grid">
          {CATEGORIAS.map(({ chave, titulo, icone }) => {
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
                    placeholder="Pesquisar ou adicionar novo assunto..."
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
                    title={jaExiste ? "Esse assunto já está cadastrado" : undefined}
                  >
                    <Plus size={16} />
                    {salvando === chave ? "Adicionando..." : "Adicionar"}
                  </button>
                </div>

                {jaExiste && (
                  <p className="tipos-ocorrencia-aviso-existente">
                    Esse assunto já está cadastrado — veja na lista abaixo.
                  </p>
                )}

                <ul className="tipos-ocorrencia-lista">
                  {temasFiltrados.length === 0 && (
                    <li className="tipos-ocorrencia-vazio">
                      {busca
                        ? "Nenhum assunto encontrado para essa pesquisa."
                        : "Nenhum assunto cadastrado."}
                    </li>
                  )}
                  {temasFiltrados.map((tema) => (
                    <li key={tema.id} className="tipos-ocorrencia-item">
                      <span>{tema.nome}</span>
                      <button
                        type="button"
                        className="tipos-ocorrencia-btn-remove"
                        title="Excluir"
                        onClick={() => setConfirmarExclusao(tema)}
                        disabled={removendoId === tema.id}
                      >
                        <Trash2 size={15} />
                      </button>
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
              Tem certeza que deseja excluir o assunto{" "}
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
                {removendoId === confirmarExclusao.id
                  ? "Excluindo..."
                  : "Excluir assunto"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
