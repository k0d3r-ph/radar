import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Trophy,
  PlusCircle,
  Trash2,
  Award,
  AlertTriangle,
  History,
  TrendingUp,
  User,
  Star,
  Shield,
  FileText,
  Settings,
  AlertOctagon,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { formatarNome } from "../../utils/formatarNome";
import { listarUsuarios } from "../../services/auth";
import type { UsuarioDocument } from "../../services/auth";
import {
  listarLancamentosPontos,
  removerLancamentoPonto,
  salvarLancamentoPonto,
} from "../../services/gamificacao";
import type { LancamentoPonto } from "../../types";
import "./Gamificacao.css";

const ACOES_DISPONIVEIS = [
  {
    tipo: "treinamento",
    label: "Treinamento realizado",
    pontos: 1,
    descricao: "Realização de treinamento para a equipe ou clientes.",
    icon: Star,
    colorClass: "ponto-positivo",
  },
  {
    tipo: "nova_doc",
    label: "Nova documentação aprovada",
    pontos: 3,
    descricao: "Criação de novos artigos, playbooks ou bases de conhecimento.",
    icon: FileText,
    colorClass: "ponto-destaque",
  },
  {
    tipo: "att_doc",
    label: "Atualização relevante de documentação",
    pontos: 1,
    descricao: "Melhorias ou correções significativas em documentos existentes.",
    icon: FileText,
    colorClass: "ponto-positivo",
  },
  {
    tipo: "ferramenta_aut",
    label: "Ferramenta ou automação aprovada",
    pontos: 5,
    descricao: "Desenvolvimento e aprovação de scripts, automações ou ferramentas internas.",
    icon: Settings,
    colorClass: "ponto-premium",
  },
  {
    tipo: "chamado_falha",
    label: "Chamado decorrente de falha de treinamento comprovada",
    pontos: -1,
    descricao: "Incidente ou problema gerado por gap direto de treinamento comprovado.",
    icon: AlertOctagon,
    colorClass: "ponto-negativo",
  },
] as const;

export const Gamificacao: React.FC = () => {
  const { user, userName, role } = useAuth();
  const [trainers, setTrainers] = useState<UsuarioDocument[]>([]);
  const [entries, setEntries] = useState<LancamentoPonto[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const acoesFiltradas = useMemo(() => {
    if (role === "treinador") {
      return ACOES_DISPONIVEIS.filter((a) => a.tipo === "treinamento");
    }
    return ACOES_DISPONIVEIS;
  }, [role]);

  // Form states
  const [selectedTrainerUid, setSelectedTrainerUid] = useState("");
  const [selectedActionType, setSelectedActionType] = useState<
    "treinamento" | "nova_doc" | "att_doc" | "ferramenta_aut" | "chamado_falha"
  >("treinamento");
  const [descricao, setDescricao] = useState("");

  // Delete modal state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmarExclusaoId, setConfirmarExclusaoId] = useState<string | null>(null);

  const carregarDados = async () => {
    try {
      setLoading(true);
      const [listaUsuarios, listaPontos] = await Promise.all([
        listarUsuarios(),
        listarLancamentosPontos(),
      ]);

      // Filter only users with "treinador" or "master" role who completed their first access
      const apenasTreinadores = listaUsuarios.filter(
        (u) => (u.role === "treinador" || u.role === "master") && !u.needsPasswordChange
      );
      setTrainers(apenasTreinadores);
      setEntries(listaPontos);

      // Default the selected trainer in the form
      if (user && apenasTreinadores.some((t) => t.uid === user.uid)) {
        setSelectedTrainerUid(user.uid);
      } else if (apenasTreinadores.length > 0) {
        setSelectedTrainerUid(apenasTreinadores[0].uid);
      }
    } catch (error: any) {
      console.error("Erro ao carregar dados de gamificação:", error);
      toast.error(`Erro ao carregar dados: ${error?.message || error}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, [user, role]);

  // Compute scores and rank trainers
  const rankedTrainers = useMemo(() => {
    return trainers
      .map((t) => {
        const score = entries
          .filter((e) => e.treinadorId === t.uid)
          .reduce((acc, curr) => acc + curr.pontos, 0);

        const qtdAcoes = entries.filter((e) => e.treinadorId === t.uid).length;

        return {
          ...t,
          score,
          qtdAcoes,
        };
      })
      .sort((a, b) => b.score - a.score || a.nome.localeCompare(b.nome));
  }, [trainers, entries]);

  const handleLancar = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedTrainerUid || !selectedActionType) {
      toast.error("Preencha todos os campos do lançamento.");
      return;
    }

    if (role === "treinador" && selectedTrainerUid !== user?.uid) {
      toast.error("Você só pode lançar pontos para si mesmo.");
      return;
    }

    const trainer = trainers.find((t) => t.uid === selectedTrainerUid);
    const actionConfig = acoesFiltradas.find((a) => a.tipo === selectedActionType);

    if (!trainer || !actionConfig) {
      toast.error("Treinador ou ação inválida.");
      return;
    }

    setSubmitting(true);
    try {
      const criadoPorNome = userName || user?.email || "Sistema";

      await salvarLancamentoPonto({
        treinadorId: trainer.uid,
        treinadorNome: formatarNome(trainer.nome) || trainer.email,
        tipoAcao: selectedActionType,
        pontos: actionConfig.pontos,
        descricao: descricao.trim(),
        criadoPorId: user?.uid || "",
        criadoPorNome,
      });

      toast.success("Pontuação registrada com sucesso!");
      setDescricao("");
      // Reload points list
      const novaLista = await listarLancamentosPontos();
      setEntries(novaLista);
    } catch (error: any) {
      console.error("Erro ao registrar lançamento:", error);
      toast.error("Erro ao salvar os pontos.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleExcluir = async (id: string) => {
    setDeletingId(id);
    try {
      await removerLancamentoPonto(id);
      toast.success("Lançamento cancelado com sucesso!");
      setConfirmarExclusaoId(null);
      // Reload points list
      const novaLista = await listarLancamentosPontos();
      setEntries(novaLista);
    } catch (error) {
      console.error("Erro ao excluir lançamento:", error);
      toast.error("Erro ao remover o lançamento.");
    } finally {
      setDeletingId(null);
    }
  };

  const formatarData = (timestamp: number) => {
    return new Date(timestamp).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const entryParaExcluir = entries.find((e) => e.id === confirmarExclusaoId);

  return (
    <div className="gamificacao-page">
      <div className="gamificacao-glow"></div>

      <header className="gamificacao-header">
        <h1>Gamificação dos Treinadores</h1>
        <p>Acompanhe o ranking de pontos e lance novas atividades realizadas pela equipe.</p>
      </header>

      {loading ? (
        <div className="page-loader">
          <div className="spinner"></div>
          <p>Carregando dados da gamificação...</p>
        </div>
      ) : (
        <div className="gamificacao-grid">
          {/* Coluna da Esquerda: Ranking */}
          <section className="gamificacao-card ranking-section">
            <div className="section-header">
              <h2>
                <Trophy size={20} className="card-icon gold-glow" />
                Placar de Líderes
              </h2>
              <span className="badge-count">
                {rankedTrainers.length} {rankedTrainers.length === 1 ? "Treinador" : "Treinadores"}
              </span>
            </div>

            {rankedTrainers.length === 0 ? (
              <p className="no-data-msg">Nenhum treinador cadastrado no sistema.</p>
            ) : (
              <div className="ranking-list">
                {rankedTrainers.map((t, index) => {
                  const isTop1 = index === 0;
                  const isTop2 = index === 1;
                  const isTop3 = index === 2;

                  let rankClass = "rank-other";
                  let TrophyIcon = null;

                  if (isTop1) {
                    rankClass = "rank-first";
                    TrophyIcon = <Trophy className="trophy-gold" size={24} />;
                  } else if (isTop2) {
                    rankClass = "rank-second";
                    TrophyIcon = <Award className="trophy-silver" size={22} />;
                  } else if (isTop3) {
                    rankClass = "rank-third";
                    TrophyIcon = <Award className="trophy-bronze" size={20} />;
                  }

                  return (
                    <div key={t.uid} className={`ranking-item ${rankClass}`}>
                      <div className="ranking-position">
                        {TrophyIcon ? TrophyIcon : <span className="position-number">{index + 1}</span>}
                      </div>

                      <div className="ranking-details">
                        <div className="ranking-name">
                          {formatarNome(t.nome) || t.email}
                          {t.uid === user?.uid && <span className="me-badge">Você</span>}
                        </div>
                        <div className="ranking-sub">
                          {t.qtdAcoes} {t.qtdAcoes === 1 ? "atividade registrada" : "atividades registradas"}
                        </div>
                      </div>

                      <div className="ranking-score-wrapper">
                        <span className={`ranking-score ${t.score >= 0 ? "positive-score" : "negative-score"}`}>
                          {t.score > 0 ? `+${t.score}` : t.score}
                        </span>
                        <span className="score-label">pts</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Coluna da Direita: Lançar e Histórico */}
          <div className="actions-column">
            {/* Bloco 1: Lançar Pontos */}
            <section className="gamificacao-card lancar-section">
              <h2>
                <PlusCircle size={20} className="card-icon" />
                Registrar Nova Ação
              </h2>

              <form onSubmit={handleLancar} className="lancar-form">
                <div className="input-group">
                  <label htmlFor={role === "master" ? "trainer-select" : "trainer-input"}>Treinador</label>
                  <div className="input-wrapper">
                    <User className="input-icon" size={18} />
                    {role === "master" ? (
                      <select
                        id="trainer-select"
                        value={selectedTrainerUid}
                        onChange={(e) => setSelectedTrainerUid(e.target.value)}
                        required
                        disabled={submitting}
                      >
                        {trainers.map((t) => (
                          <option key={t.uid} value={t.uid}>
                            {formatarNome(t.nome) || t.email}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        id="trainer-input"
                        value={userName || user?.email || ""}
                        readOnly
                        disabled
                        className="input-disabled"
                      />
                    )}
                  </div>
                </div>

                <div className="input-group">
                  <label>Ação Realizada</label>
                  <div className="acoes-radio-group">
                    {acoesFiltradas.map((acao) => {
                      const Icon = acao.icon;
                      const isSelected = selectedActionType === acao.tipo;
                      return (
                        <label
                          key={acao.tipo}
                          className={`acao-radio-card ${isSelected ? "selected" : ""} ${acao.colorClass}`}
                        >
                          <input
                            type="radio"
                            name="acao-tipo"
                            value={acao.tipo}
                            checked={isSelected}
                            onChange={() => setSelectedActionType(acao.tipo)}
                            disabled={submitting}
                          />
                          <div className="acao-radio-content">
                            <div className="acao-radio-left">
                              <Icon className="acao-icon" size={18} />
                              <div className="acao-radio-text">
                                <span className="acao-label">{acao.label}</span>
                                <span className="acao-desc">{acao.descricao}</span>
                              </div>
                            </div>
                            <span className="acao-points-badge">
                              {acao.pontos > 0 ? `+${acao.pontos}` : acao.pontos}
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="input-group">
                  <label htmlFor="descricao-input">Descrição / Detalhes (Opcional)</label>
                  <textarea
                    id="descricao-input"
                    placeholder="Ex: Treinamento avançado de APIs, Documentação de onboarding revisada..."
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                    disabled={submitting}
                    maxLength={150}
                    rows={2}
                  />
                </div>

                <button type="submit" className="btn-primary lancar-submit-btn" disabled={submitting}>
                  {submitting ? <div className="spinner"></div> : "Lançar Pontuação"}
                </button>
              </form>
            </section>

            {/* Bloco 2: Histórico Recente */}
            <section className="gamificacao-card historico-section">
              <div className="section-header">
                <h2>
                  <History size={20} className="card-icon" />
                  Atividades Recentes
                </h2>
              </div>

              {entries.length === 0 ? (
                <p className="no-data-msg">Nenhum lançamento de pontos registrado ainda.</p>
              ) : (
                <div className="table-responsive">
                  <table className="gamificacao-table">
                    <thead>
                      <tr>
                        <th>Treinador</th>
                        <th>Ação</th>
                        <th>Detalhes</th>
                        <th>Data</th>
                        <th className="points-col">Pontos</th>
                        <th className="action-col"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => {
                        const actionConfig = ACOES_DISPONIVEIS.find((a) => a.tipo === entry.tipoAcao);
                        return (
                          <tr key={entry.id}>
                            <td className="trainer-cell">{entry.treinadorNome}</td>
                            <td className="action-cell">
                              <span className="action-label-text">
                                {actionConfig ? actionConfig.label : entry.tipoAcao}
                              </span>
                            </td>
                            <td className="desc-cell" title={entry.descricao}>
                              {entry.descricao || "—"}
                            </td>
                            <td className="date-cell">{formatarData(entry.dataLancamento)}</td>
                            <td className="points-cell">
                              <span
                                className={`points-tag ${
                                  entry.pontos > 0 ? "tag-positive" : "tag-negative"
                                }`}
                              >
                                {entry.pontos > 0 ? `+${entry.pontos}` : entry.pontos}
                              </span>
                            </td>
                            <td className="action-col">
                              {(role === "master" || entry.criadoPorId === user?.uid) && (
                                <button
                                  className="btn-delete-entry"
                                  onClick={() => setConfirmarExclusaoId(entry.id || null)}
                                  title="Remover lançamento"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão de Lançamento */}
      {confirmarExclusaoId && entryParaExcluir && (
        <div className="confirm-overlay" onClick={() => setConfirmarExclusaoId(null)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-modal-header">
              <AlertTriangle className="confirm-modal-icon warning" size={24} />
              <h2>Confirmar Cancelamento</h2>
            </div>
            <p className="confirm-modal-text">
              Deseja realmente cancelar o lançamento de <strong>{entryParaExcluir.pontos > 0 ? `+${entryParaExcluir.pontos}` : entryParaExcluir.pontos} pontos</strong> para{" "}
              <strong>{entryParaExcluir.treinadorNome}</strong>? A pontuação será ajustada no ranking imediatamente.
            </p>
            <div className="confirm-modal-actions">
              <button
                className="btn-excluir-confirm"
                onClick={() => handleExcluir(entryParaExcluir.id!)}
                disabled={deletingId !== null}
              >
                {deletingId ? <div className="spinner"></div> : "Confirmar exclusão"}
              </button>
              <button
                className="btn-cancelar-confirm"
                onClick={() => setConfirmarExclusaoId(null)}
                disabled={deletingId !== null}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
