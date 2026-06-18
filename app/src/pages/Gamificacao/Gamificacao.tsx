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
  Edit2,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { formatarNome } from "../../utils/formatarNome";
import { listarUsuarios } from "../../services/auth";
import type { UsuarioDocument } from "../../services/auth";
import {
  listarLancamentosPontos,
  removerLancamentoPonto,
  salvarLancamentoPonto,
  atualizarLancamentoPonto,
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

  // Treinamento extra states
  const [treinamentoEmpresa, setTreinamentoEmpresa] = useState("");
  const [treinamentoTema, setTreinamentoTema] = useState("");
  const [treinamentoDataSolicitacao, setTreinamentoDataSolicitacao] = useState("");
  const [treinamentoDataRealizacao, setTreinamentoDataRealizacao] = useState("");
  const [treinamentoTempoAgenda, setTreinamentoTempoAgenda] = useState("");
  const [treinamentoSolicitante, setTreinamentoSolicitante] = useState("CS");
  const [treinamentoNotas, setTreinamentoNotas] = useState<string[]>([]);

  // Edit states
  const [editingEntry, setEditingEntry] = useState<LancamentoPonto | null>(null);
  const [editEmpresa, setEditEmpresa] = useState("");
  const [editTema, setEditTema] = useState("");
  const [editDataSolicitacao, setEditDataSolicitacao] = useState("");
  const [editDataRealizacao, setEditDataRealizacao] = useState("");
  const [editTempoAgenda, setEditTempoAgenda] = useState("");
  const [editSolicitante, setEditSolicitante] = useState("CS");
  const [editNotas, setEditNotas] = useState<string[]>([]);
  const [editDescricao, setEditDescricao] = useState("");

  // Helper functions for dynamic notes (Create)
  const handleAddNota = () => setTreinamentoNotas([...treinamentoNotas, ""]);
  const handleUpdateNota = (index: number, val: string) => {
    const copy = [...treinamentoNotas];
    copy[index] = val;
    setTreinamentoNotas(copy);
  };
  const handleRemoveNota = (index: number) => setTreinamentoNotas(treinamentoNotas.filter((_, i) => i !== index));

  // Helper functions for dynamic notes (Edit)
  const handleAddEditNota = () => setEditNotas([...editNotas, ""]);
  const handleUpdateEditNota = (index: number, val: string) => {
    const copy = [...editNotas];
    copy[index] = val;
    setEditNotas(copy);
  };
  const handleRemoveEditNota = (index: number) => setEditNotas(editNotas.filter((_, i) => i !== index));

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
        const trainerEntries = entries.filter((e) => e.treinadorId === t.uid);
        const baseScore = trainerEntries.reduce((acc, curr) => acc + curr.pontos, 0);

        // Filter realized trainings (excluding canceled/absent)
        const realizedTrainings = trainerEntries.filter(
          (e) =>
            e.tipoAcao === "treinamento" &&
            e.treinamentoTema &&
            e.treinamentoTema.toLowerCase() !== "cancelado" &&
            e.treinamentoTema.toLowerCase() !== "ausente"
        );

        // Count realized trainings that have CSAT responses
        const answeredTrainings = realizedTrainings.filter(
          (e) => e.treinamentoNotas && e.treinamentoNotas.length > 0
        );

        const totalTrainingsCount = realizedTrainings.length;
        const answeredTrainingsCount = answeredTrainings.length;
        const taxaResposta = totalTrainingsCount > 0 ? answeredTrainingsCount / totalTrainingsCount : 0;

        let bonus = 0;
        if (taxaResposta >= 0.90) bonus = 0.30;
        else if (taxaResposta >= 0.80) bonus = 0.20;
        else if (taxaResposta >= 0.70) bonus = 0.10;

        const score = parseFloat((baseScore * (1 + bonus)).toFixed(1));
        const qtdAcoes = trainerEntries.length;

        return {
          ...t,
          baseScore,
          score,
          qtdAcoes,
          totalTrainingsCount,
          answeredTrainingsCount,
          taxaResposta,
          bonusPercentage: Math.round(bonus * 100),
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

    if (selectedActionType === "treinamento") {
      if (!treinamentoEmpresa) {
        toast.error("Selecione a empresa.");
        return;
      }
      if (!treinamentoTema.trim()) {
        toast.error("Digite o tema do treinamento.");
        return;
      }
      if (!treinamentoDataSolicitacao || !treinamentoDataRealizacao) {
        toast.error("Preencha as datas de solicitação e realização.");
        return;
      }
      if (!treinamentoTempoAgenda.trim()) {
        toast.error("Preencha o tempo de agenda.");
        return;
      }
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

      let finalDescricao = "";
      let pontosAAplicar = actionConfig.pontos;
      let validNotas: number[] = [];
      let computedMedia: number | null = null;

      if (selectedActionType === "treinamento") {
        const isZeroPoints =
          treinamentoTema.trim().toLowerCase() === "cancelado" ||
          treinamentoTema.trim().toLowerCase() === "ausente";

        if (isZeroPoints) {
          pontosAAplicar = 0;
        }

        const formatarDataInput = (dataStr: string) => {
          if (!dataStr) return "";
          const [y, m, d] = dataStr.split("-");
          return `${d}/${m}/${y}`;
        };

        const dataSol = formatarDataInput(treinamentoDataSolicitacao);
        const dataReal = formatarDataInput(treinamentoDataRealizacao);

        validNotas = treinamentoNotas
          .map((n) => parseInt(n, 10))
          .filter((n) => !isNaN(n));

        if (validNotas.some((n) => n < 0 || n > 10)) {
          toast.error("As notas devem ser valores inteiros entre 0 e 10.");
          setSubmitting(false);
          return;
        }

        computedMedia = validNotas.length > 0
          ? parseFloat((validNotas.reduce((sum, n) => sum + n, 0) / validNotas.length).toFixed(2))
          : null;

        finalDescricao = `Empresa: ${treinamentoEmpresa} | Tema: ${treinamentoTema.trim()} | Solicitado: ${dataSol} | Realizado: ${dataReal} | Tempo: ${treinamentoTempoAgenda.trim()} | Solicitante: ${treinamentoSolicitante}`;

        if (validNotas.length > 0) {
          finalDescricao += ` | Notas: [${validNotas.join(", ")}] (Média: ${computedMedia})`;
        }

        if (descricao.trim()) {
          finalDescricao += ` | Obs: ${descricao.trim()}`;
        }
      } else {
        finalDescricao = descricao.trim();
      }

      await salvarLancamentoPonto({
        treinadorId: trainer.uid,
        treinadorNome: formatarNome(trainer.nome) || trainer.email,
        tipoAcao: selectedActionType,
        pontos: pontosAAplicar,
        descricao: finalDescricao,
        criadoPorId: user?.uid || "",
        criadoPorNome,
        ...(selectedActionType === "treinamento" ? {
          treinamentoEmpresa,
          treinamentoTema: treinamentoTema.trim(),
          treinamentoDataSolicitacao,
          treinamentoDataRealizacao,
          treinamentoTempoAgenda: treinamentoTempoAgenda.trim(),
          treinamentoSolicitante,
          treinamentoNotas: validNotas,
          treinamentoNotaMedia: computedMedia,
        } : {})
      });

      toast.success("Pontuação registrada com sucesso!");
      setDescricao("");
      setTreinamentoEmpresa("");
      setTreinamentoTema("");
      setTreinamentoDataSolicitacao("");
      setTreinamentoDataRealizacao("");
      setTreinamentoTempoAgenda("");
      setTreinamentoSolicitante("CS");
      setTreinamentoNotas([]);
      
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

  const handleStartEdit = (entry: LancamentoPonto) => {
    setEditingEntry(entry);
    setEditEmpresa(entry.treinamentoEmpresa || "");
    setEditTema(entry.treinamentoTema || "");
    setEditDataSolicitacao(entry.treinamentoDataSolicitacao || "");
    setEditDataRealizacao(entry.treinamentoDataRealizacao || "");
    setEditTempoAgenda(entry.treinamentoTempoAgenda || "");
    setEditSolicitante(entry.treinamentoSolicitante || "CS");
    setEditNotas(entry.treinamentoNotas ? entry.treinamentoNotas.map(String) : []);
    
    let obs = "";
    if (entry.tipoAcao === "treinamento" && entry.descricao) {
      const parts = entry.descricao.split(" | Obs: ");
      if (parts.length > 1) {
        obs = parts[1];
      }
    } else {
      obs = entry.descricao || "";
    }
    setEditDescricao(obs);
  };

  const handleSalvarEdicao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntry || !editingEntry.id) return;

    setSubmitting(true);
    try {
      let finalDescricao = "";
      let pontosAAplicar = editingEntry.pontos;
      let extraData: Partial<LancamentoPonto> = {};

      if (editingEntry.tipoAcao === "treinamento") {
        if (!editEmpresa) {
          toast.error("Preencha a empresa.");
          setSubmitting(false);
          return;
        }
        if (!editTema.trim()) {
          toast.error("Preencha o tema.");
          setSubmitting(false);
          return;
        }
        if (!editDataSolicitacao || !editDataRealizacao) {
          toast.error("Preencha as datas.");
          setSubmitting(false);
          return;
        }
        if (!editTempoAgenda.trim()) {
          toast.error("Preencha o tempo de agenda.");
          setSubmitting(false);
          return;
        }

        const isZeroPoints =
          editTema.trim().toLowerCase() === "cancelado" ||
          editTema.trim().toLowerCase() === "ausente";

        const actionConfig = ACOES_DISPONIVEIS.find((a) => a.tipo === "treinamento");
        pontosAAplicar = isZeroPoints ? 0 : (actionConfig?.pontos ?? 1);

        const formatarDataInput = (dataStr: string) => {
          if (!dataStr) return "";
          const [y, m, d] = dataStr.split("-");
          return `${d}/${m}/${y}`;
        };

        const dataSol = formatarDataInput(editDataSolicitacao);
        const dataReal = formatarDataInput(editDataRealizacao);

        const validNotas = editNotas
          .map((n) => parseInt(n, 10))
          .filter((n) => !isNaN(n));

        if (validNotas.some((n) => n < 0 || n > 10)) {
          toast.error("As notas devem ser valores inteiros entre 0 e 10.");
          setSubmitting(false);
          return;
        }

        const computedMedia = validNotas.length > 0
          ? parseFloat((validNotas.reduce((sum, n) => sum + n, 0) / validNotas.length).toFixed(2))
          : null;

        finalDescricao = `Empresa: ${editEmpresa} | Tema: ${editTema.trim()} | Solicitado: ${dataSol} | Realizado: ${dataReal} | Tempo: ${editTempoAgenda.trim()} | Solicitante: ${editSolicitante}`;

        if (validNotas.length > 0) {
          finalDescricao += ` | Notas: [${validNotas.join(", ")}] (Média: ${computedMedia})`;
        }
        if (editDescricao.trim()) {
          finalDescricao += ` | Obs: ${editDescricao.trim()}`;
        }

        extraData = {
          treinamentoEmpresa: editEmpresa,
          treinamentoTema: editTema.trim(),
          treinamentoDataSolicitacao: editDataSolicitacao,
          treinamentoDataRealizacao: editDataRealizacao,
          treinamentoTempoAgenda: editTempoAgenda.trim(),
          treinamentoSolicitante: editSolicitante,
          treinamentoNotas: validNotas,
          treinamentoNotaMedia: computedMedia,
        };
      } else {
        finalDescricao = editDescricao.trim();
      }

      await atualizarLancamentoPonto(editingEntry.id, {
        descricao: finalDescricao,
        pontos: pontosAAplicar,
        ...extraData,
      });

      toast.success("Lançamento atualizado com sucesso!");
      setEditingEntry(null);
      // Reload points list
      const novaLista = await listarLancamentosPontos();
      setEntries(novaLista);
    } catch (error) {
      console.error("Erro ao atualizar lançamento:", error);
      toast.error("Erro ao salvar alterações.");
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
                          <div>
                            {t.qtdAcoes} {t.qtdAcoes === 1 ? "atividade registrada" : "atividades registradas"}
                          </div>
                          {t.totalTrainingsCount > 0 && (
                            <div className="csat-rate-info" style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px" }}>
                              CSAT Taxa Resposta: <strong>{Math.round(t.taxaResposta * 100)}%</strong> ({t.answeredTrainingsCount}/{t.totalTrainingsCount})
                              {t.bonusPercentage > 0 && (
                                <span className="bonus-pill" style={{ marginLeft: "6px", color: "#34d399", background: "rgba(16, 185, 129, 0.1)", padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: "bold" }}>
                                  +{t.bonusPercentage}% Bônus
                                </span>
                              )}
                            </div>
                          )}
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
                        <React.Fragment key={acao.tipo}>
                          <label
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

                          {isSelected && acao.tipo === "treinamento" && (
                            <div className="treinamento-subform inline-subform">
                              <div className="form-grid-2">
                                <div className="input-group">
                                  <label htmlFor="treinamento-empresa">Nome da Empresa *</label>
                                  <input
                                    type="text"
                                    id="treinamento-empresa"
                                    placeholder="Digite o nome da empresa..."
                                    value={treinamentoEmpresa}
                                    onChange={(e) => setTreinamentoEmpresa(e.target.value)}
                                    required
                                  />
                                </div>

                                <div className="input-group">
                                  <label htmlFor="treinamento-tema">Tema *</label>
                                  <input
                                    type="text"
                                    id="treinamento-tema"
                                    placeholder="Digite o tema (ou Cancelado/Ausente)..."
                                    value={treinamentoTema}
                                    onChange={(e) => setTreinamentoTema(e.target.value)}
                                    required
                                  />
                                </div>
                              </div>

                              <div className="form-grid-2">
                                <div className="input-group">
                                  <label htmlFor="treinamento-data-solicitacao">Data de Solicitação *</label>
                                  <input
                                    type="date"
                                    id="treinamento-data-solicitacao"
                                    value={treinamentoDataSolicitacao}
                                    onChange={(e) => setTreinamentoDataSolicitacao(e.target.value)}
                                    required
                                  />
                                </div>

                                <div className="input-group">
                                  <label htmlFor="treinamento-data-realizacao">Data da Realização *</label>
                                  <input
                                    type="date"
                                    id="treinamento-data-realizacao"
                                    value={treinamentoDataRealizacao}
                                    onChange={(e) => setTreinamentoDataRealizacao(e.target.value)}
                                    required
                                  />
                                </div>
                              </div>

                              <div className="form-grid-2">
                                <div className="input-group">
                                  <label htmlFor="treinamento-tempo-agenda">Tempo de Agenda *</label>
                                  <input
                                    type="time"
                                    id="treinamento-tempo-agenda"
                                    value={treinamentoTempoAgenda}
                                    onChange={(e) => setTreinamentoTempoAgenda(e.target.value)}
                                    required
                                  />
                                </div>

                                <div className="input-group">
                                  <label htmlFor="treinamento-solicitante">Quem Solicitou *</label>
                                  <div className="input-wrapper">
                                    <select
                                      id="treinamento-solicitante"
                                      value={treinamentoSolicitante}
                                      onChange={(e) => setTreinamentoSolicitante(e.target.value)}
                                      required
                                    >
                                      <option value="CS">CS</option>
                                      <option value="Cliente">Cliente</option>
                                      <option value="Suporte">Suporte</option>
                                      <option value="Comercial">Comercial</option>
                                      <option value="Hardware">Hardware</option>
                                      <option value="Aplicações">Aplicações</option>
                                    </select>
                                  </div>
                                </div>
                              </div>

                              <div className="treinamento-notas-section">
                                <div className="notas-section-header">
                                  <label>Notas dos Participantes (CSAT Opcional)</label>
                                  <button
                                    type="button"
                                    className="btn-add-nota-icon"
                                    onClick={handleAddNota}
                                    title="Adicionar Nota"
                                  >
                                    + Adicionar Nota
                                  </button>
                                </div>
                                {treinamentoNotas.length === 0 ? (
                                  <span className="no-notas-msg">Nenhuma nota registrada (treinamento sem resposta CSAT).</span>
                                ) : (
                                  <div className="notas-inputs-grid">
                                    {treinamentoNotas.map((nota, idx) => (
                                      <div key={idx} className="nota-input-row">
                                        <input
                                          type="number"
                                          className="nota-input-field"
                                          placeholder={`Nota ${idx + 1} (0 a 10)`}
                                          min="0"
                                          max="10"
                                          step="1"
                                          value={nota}
                                          onChange={(e) => handleUpdateNota(idx, e.target.value)}
                                          required
                                        />
                                        <button
                                          type="button"
                                          className="btn-remove-nota-icon"
                                          onClick={() => handleRemoveNota(idx)}
                                          title="Remover nota"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </React.Fragment>
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
                              <div className="action-buttons-wrapper">
                                {(role === "master" || (entry.treinadorId === user?.uid && entry.criadoPorId === user?.uid)) && (
                                  <button
                                    className="btn-edit-entry"
                                    onClick={() => handleStartEdit(entry)}
                                    title="Editar lançamento"
                                  >
                                    <Edit2 size={14} />
                                  </button>
                                )}
                                {(role === "master" || entry.criadoPorId === user?.uid) && (
                                  <button
                                    className="btn-delete-entry"
                                    onClick={() => setConfirmarExclusaoId(entry.id || null)}
                                    title="Remover lançamento"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </div>
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

      {/* Modal de Edição de Lançamento */}
      {editingEntry && (
        <div className="confirm-overlay" onClick={() => setEditingEntry(null)}>
          <form className="edit-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSalvarEdicao}>
            <div className="edit-modal-header">
              <Edit2 className="card-icon" size={22} />
              <h2>Editar Lançamento</h2>
            </div>
            
            <div className="edit-modal-body">
              {editingEntry.tipoAcao === "treinamento" ? (
                <>
                  <div className="form-grid-2">
                    <div className="input-group">
                      <label htmlFor="edit-treinamento-empresa">Nome da Empresa *</label>
                      <input
                        type="text"
                        id="edit-treinamento-empresa"
                        value={editEmpresa}
                        onChange={(e) => setEditEmpresa(e.target.value)}
                        required
                      />
                    </div>

                    <div className="input-group">
                      <label htmlFor="edit-treinamento-tema">Tema *</label>
                      <input
                        type="text"
                        id="edit-treinamento-tema"
                        value={editTema}
                        onChange={(e) => setEditTema(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-grid-2">
                    <div className="input-group">
                      <label htmlFor="edit-treinamento-data-solicitacao">Data de Solicitação *</label>
                      <input
                        type="date"
                        id="edit-treinamento-data-solicitacao"
                        value={editDataSolicitacao}
                        onChange={(e) => setEditDataSolicitacao(e.target.value)}
                        required
                      />
                    </div>

                    <div className="input-group">
                      <label htmlFor="edit-treinamento-data-realizacao">Data da Realização *</label>
                      <input
                        type="date"
                        id="edit-treinamento-data-realizacao"
                        value={editDataRealizacao}
                        onChange={(e) => setEditDataRealizacao(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-grid-2">
                    <div className="input-group">
                      <label htmlFor="edit-treinamento-tempo-agenda">Tempo de Agenda *</label>
                      <input
                        type="time"
                        id="edit-treinamento-tempo-agenda"
                        value={editTempoAgenda}
                        onChange={(e) => setEditTempoAgenda(e.target.value)}
                        required
                      />
                    </div>

                    <div className="input-group">
                      <label htmlFor="edit-treinamento-solicitante">Quem Solicitou *</label>
                      <select
                        id="edit-treinamento-solicitante"
                        value={editSolicitante}
                        onChange={(e) => setEditSolicitante(e.target.value)}
                        required
                      >
                        <option value="CS">CS</option>
                        <option value="Cliente">Cliente</option>
                        <option value="Suporte">Suporte</option>
                        <option value="Comercial">Comercial</option>
                        <option value="Hardware">Hardware</option>
                        <option value="Aplicações">Aplicações</option>
                      </select>
                    </div>
                  </div>

                              <div className="treinamento-notas-section">
                                <div className="notas-section-header">
                                  <label>Notas dos Participantes (CSAT Opcional)</label>
                                  <button
                                    type="button"
                                    className="btn-add-nota-icon"
                                    onClick={handleAddEditNota}
                                    title="Adicionar Nota"
                                  >
                                    + Adicionar Nota
                                  </button>
                                </div>
                                {editNotas.length === 0 ? (
                                  <span className="no-notas-msg">Nenhuma nota registrada (treinamento sem resposta CSAT).</span>
                                ) : (
                                  <div className="notas-inputs-grid">
                                    {editNotas.map((nota, idx) => (
                                      <div key={idx} className="nota-input-row">
                                        <input
                                          type="number"
                                          className="nota-input-field"
                                          placeholder={`Nota ${idx + 1} (0 a 10)`}
                                          min="0"
                                          max="10"
                                          step="1"
                                          value={nota}
                                          onChange={(e) => handleUpdateEditNota(idx, e.target.value)}
                                          required
                                        />
                                        <button
                                          type="button"
                                          className="btn-remove-nota-icon"
                                          onClick={() => handleRemoveEditNota(idx)}
                                          title="Remover nota"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                  <div className="input-group">
                    <label htmlFor="edit-descricao-input">Observações (Opcional)</label>
                    <textarea
                      id="edit-descricao-input"
                      placeholder="Ex: Treinamento avançado de APIs..."
                      value={editDescricao}
                      onChange={(e) => setEditDescricao(e.target.value)}
                      maxLength={150}
                      rows={2}
                    />
                  </div>
                </>
              ) : (
                <div className="input-group">
                  <label htmlFor="edit-descricao-geral">Descrição / Detalhes *</label>
                  <textarea
                    id="edit-descricao-geral"
                    placeholder="Ex: Documentação de onboarding revisada..."
                    value={editDescricao}
                    onChange={(e) => setEditDescricao(e.target.value)}
                    required
                    maxLength={150}
                    rows={4}
                  />
                </div>
              )}
            </div>

            <div className="edit-modal-actions">
              <button type="submit" className="btn-edit-confirm" disabled={submitting}>
                {submitting ? <div className="spinner"></div> : "Salvar Alterações"}
              </button>
              <button
                type="button"
                className="btn-cancelar-confirm"
                onClick={() => setEditingEntry(null)}
                disabled={submitting}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
