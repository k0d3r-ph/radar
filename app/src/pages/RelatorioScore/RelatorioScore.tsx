import React, { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Download,
  BarChart3,
  Users,
  CheckCircle2,
  UserX,
} from "lucide-react";
import { listarEmpresas } from "../../services/empresas";
import type { Empresa } from "../../types";
import "./RelatorioScore.css";

interface ScoreFormAnswers {
  facilContato: "Sim" | "Não" | "";
  entraComputador: "Sim" | "Não" | "";
  compartilhaTela: "Sim" | "Não" | "";
  fazPerguntas: "Sim" | "Não" | "";
  recordaTemas: "Sim" | "Não" | "";
  faltouDoisDias: "Sim" | "Não" | "";
  estruturaNecessaria: "Sim" | "Não" | "";
  clienteReclamante: "Sim" | "Não" | "";
  clienteSumido: "Sim" | "Não" | "";
}

interface ScoreQuestionMeta {
  key: keyof ScoreFormAnswers;
  label: string;
  descSim: string;
  descNao: string;
}

const SCORE_QUESTIONS: ScoreQuestionMeta[] = [
  { key: "facilContato", label: "Contato com o cliente é fácil?", descSim: "Contato fácil", descNao: "Difícil contato" },
  { key: "entraComputador", label: "Cliente entra pelo computador?", descSim: "Entra pelo computador", descNao: "Não entra pelo computador" },
  { key: "compartilhaTela", label: "Cliente compartilha a tela?", descSim: "Compartilha a tela", descNao: "Não compartilha a tela" },
  { key: "fazPerguntas", label: "Cliente faz perguntas?", descSim: "Faz perguntas", descNao: "Não faz perguntas" },
  { key: "recordaTemas", label: "Cliente se recorda de temas anteriores?", descSim: "Se recorda de temas", descNao: "Não se recorda de temas" },
  { key: "faltouDoisDias", label: "Cliente faltou 2 dias seguidos?", descSim: "Faltou 2 dias seguidos", descNao: "Não faltou 2 dias seguidos" },
  { key: "estruturaNecessaria", label: "Cliente possui estrutura necessária?", descSim: "Possui estrutura necessária", descNao: "Não possui estrutura necessária" },
  { key: "clienteReclamante", label: "Cliente é reclamante?", descSim: "Cliente é reclamante", descNao: "Cliente não é reclamante" },
  { key: "clienteSumido", label: "Cliente sumiu?", descSim: "Cliente sumiu", descNao: "Cliente não sumiu" },
];

export const RelatorioScore: React.FC = () => {
  const [empresasList, setEmpresasList] = useState<Empresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [perguntaExpandida, setPerguntaExpandida] = useState<Record<string, boolean>>({});
  const [mostrarSemScore, setMostrarSemScore] = useState(false);

  // Trocado um `onSnapshot` na coleção inteira pelo carregamento em cache: o
  // listener cobrava uma leitura por cliente a cada abertura do relatório e não
  // se beneficiava da sincronização incremental. Um relatório não precisa de
  // tempo real — os dados acompanham o mesmo cache do resto do Radar.
  useEffect(() => {
    listarEmpresas()
      .then((lista) => {
        setEmpresasList(lista.filter((empresa) => empresa.id && !empresa.isOngoing));
      })
      .catch((error) => {
        console.error("Erro ao carregar empresas do relatório de score:", error);
        toast.error("Erro ao carregar dados dos clientes.");
      })
      .finally(() => setLoading(false));
  }, []);

  const reportData = useMemo(() => {
    const empresasComScore = empresasList.filter(
      (e) => e.scoreAnswers && typeof e.score === "number"
    );
    const empresasSemScore = empresasList.filter(
      (e) => !e.scoreAnswers || typeof e.score !== "number"
    );

    const totalCalculados = empresasComScore.length;
    const totalSemScore = empresasSemScore.length;
    const somaScores = empresasComScore.reduce((acc, curr) => acc + (curr.score || 0), 0);
    const mediaScore = totalCalculados > 0 ? somaScores / totalCalculados : 0;

    const statsPerQuestion = SCORE_QUESTIONS.map((q) => {
      const simList = empresasComScore.filter((e) => e.scoreAnswers[q.key] === "Sim");
      const naoList = empresasComScore.filter((e) => e.scoreAnswers[q.key] === "Não");

      const pctSim = totalCalculados > 0 ? (simList.length / totalCalculados) * 100 : 0;
      const pctNao = totalCalculados > 0 ? (naoList.length / totalCalculados) * 100 : 0;

      return {
        ...q,
        simCount: simList.length,
        naoCount: naoList.length,
        pctSim,
        pctNao,
        simClients: simList.map((e) => e.nomeEmpresa).sort(),
        naoClients: naoList.map((e) => e.nomeEmpresa).sort(),
      };
    });

    return {
      totalClientes: empresasList.length,
      totalCalculados,
      totalSemScore,
      clientesSemScore: empresasSemScore.map((e) => e.nomeEmpresa).sort(),
      mediaScore,
      questions: statsPerQuestion,
    };
  }, [empresasList]);

  const exportarRelatorioTXT = () => {
    const { totalClientes, totalCalculados, totalSemScore, clientesSemScore, mediaScore, questions } = reportData;
    const now = new Date();
    const dataFormatada = now.toLocaleDateString("pt-BR");
    const horaFormatada = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

    let content = `==================================================
RELATÓRIO GERAL DE SCORES DOS CLIENTES
Gerado em: ${dataFormatada} às ${horaFormatada}
==================================================

RESUMO GERAL:
- Total de clientes cadastrados: ${totalClientes}
- Clientes com score calculado: ${totalCalculados} (${totalClientes > 0 ? ((totalCalculados / totalClientes) * 100).toFixed(1) : 0}%)
- Clientes sem score calculado: ${totalSemScore} (${totalClientes > 0 ? ((totalSemScore / totalClientes) * 100).toFixed(1) : 0}%)
- Média dos scores calculados: ${mediaScore.toFixed(2)}

--------------------------------------------------
ESTATÍSTICAS POR PERGUNTA:
--------------------------------------------------
`;

    questions.forEach((q, index) => {
      content += `
${index + 1}. ${q.label}
   - ${q.descSim}: ${q.simCount} cliente(s) (${q.pctSim.toFixed(1)}%)
   - ${q.descNao}: ${q.naoCount} cliente(s) (${q.pctNao.toFixed(1)}%)
`;
    });

    content += `
==================================================
LISTA DOS CLIENTES E SEUS SCORES
==================================================
`;

    const empresasComScore = empresasList
      .filter((e) => e.scoreAnswers && typeof e.score === "number")
      .sort((a, b) => a.nomeEmpresa.localeCompare(b.nomeEmpresa));

    if (empresasComScore.length > 0) {
      empresasComScore.forEach((e) => {
        content += ` - ${e.nomeEmpresa}: ${e.score !== undefined ? e.score.toFixed(1) : "—"}\n`;
      });
    } else {
      content += ` (Nenhum cliente)\n`;
    }

    content += `
==================================================
CLIENTES SEM CÁLCULO DE SCORE (${totalSemScore})
==================================================
${clientesSemScore.length > 0 ? clientesSemScore.map(name => ` - ${name}`).join("\n") : " (Nenhum cliente)"}
`;

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio_scores_${now.toISOString().split("T")[0]}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="relatorio-score-container">
      {loading ? (
        <div className="relatorio-loader">
          <div className="spinner"></div>
          <p>Carregando dados do relatório...</p>
        </div>
      ) : (
        <div className="relatorio-score-content">
          {/* Grid de Resumo */}
          <div className="relatorio-summary-grid">
            <div className="relatorio-card summary-card">
              <div className="card-icon-wrapper">
                <Users size={24} />
              </div>
              <div className="card-data">
                <span className="card-value">{reportData.totalClientes}</span>
                <span className="card-label">Clientes Cadastrados</span>
              </div>
            </div>

            <div className="relatorio-card summary-card">
              <div className="card-icon-wrapper">
                <CheckCircle2 size={24} />
              </div>
              <div className="card-data">
                <span className="card-value">{reportData.totalCalculados}</span>
                <span className="card-label">Scores Calculados</span>
              </div>
            </div>

            <div className="relatorio-card summary-card">
              <div className="card-icon-wrapper">
                <BarChart3 size={24} />
              </div>
              <div className="card-data">
                <span className="card-value">{reportData.mediaScore.toFixed(2)}</span>
                <span className="card-label">Média de Score</span>
              </div>
            </div>

            <div className="relatorio-card summary-card">
              <div className="card-icon-wrapper">
                <UserX size={24} />
              </div>
              <div className="card-data">
                <span className="card-value">{reportData.totalSemScore}</span>
                <span className="card-label">Sem Score</span>
              </div>
            </div>
          </div>

          {/* Ação de Exportação */}
          <div className="relatorio-actions">
            <button className="btn-export-txt" onClick={exportarRelatorioTXT}>
              <Download size={18} />
              Exportar Relatório Completo (.txt)
            </button>
          </div>

          {/* Seção de Clientes Sem Score */}
          {reportData.clientesSemScore.length > 0 && (
            <div className="relatorio-card sem-score-card">
              <div
                className="sem-score-header"
                onClick={() => setMostrarSemScore((prev) => !prev)}
              >
                <div className="sem-score-title-wrapper">
                  <UserX size={20} />
                  <h3>Clientes sem Score Calculado ({reportData.totalSemScore})</h3>
                </div>
                {mostrarSemScore ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
              </div>

              {mostrarSemScore && (
                <div className="sem-score-content">
                  <p className="sem-score-desc">
                    Estes clientes estão cadastrados no sistema, mas ainda não tiveram o cálculo de score realizado (nenhum formulário respondido).
                  </p>
                  <div className="sem-score-list">
                    {reportData.clientesSemScore.map((nome) => (
                      <span key={nome} className="sem-score-badge">
                        {nome}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Listagem de Perguntas */}
          <div className="relatorio-questions-grid">
            {reportData.questions.map((q) => {
              const isSimExpanded = !!perguntaExpandida[`${q.key}_Sim`];
              const isNaoExpanded = !!perguntaExpandida[`${q.key}_Não`];

              return (
                <div key={q.key} className="relatorio-card question-card">
                  <h3 className="question-title">{q.label}</h3>

                  {/* Barra Dividida Percentual */}
                  <div className="question-progress-container">
                    <div className="split-progress-bar">
                      <div
                        className="bar-sim"
                        style={{ width: `${q.simCount || q.naoCount ? q.pctSim : 50}%` }}
                      />
                      <div
                        className="bar-nao"
                        style={{ width: `${q.simCount || q.naoCount ? q.pctNao : 50}%` }}
                      />
                    </div>
                    <div className="bar-labels">
                      <span className="label-sim">{q.pctSim.toFixed(0)}% Sim</span>
                      <span className="label-nao">{q.pctNao.toFixed(0)}% Não</span>
                    </div>
                  </div>

                  {/* Expansores de Listas de Clientes */}
                  <div className="question-expanders">
                    <div className="expander-group">
                      <button
                        type="button"
                        className={`btn-expander ${isSimExpanded ? "active" : ""}`}
                        onClick={() =>
                          setPerguntaExpandida((prev) => ({
                            ...prev,
                            [`${q.key}_Sim`]: !prev[`${q.key}_Sim`],
                          }))
                        }
                      >
                        <span className="toggle-label">
                          🟢 {q.descSim}: <strong>{q.simCount}</strong>
                        </span>
                        {isSimExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>

                      {isSimExpanded && (
                        <div className="clients-list-container">
                          {q.simClients.length > 0 ? (
                            <ul>
                              {q.simClients.map((c) => (
                                <li key={c}>{c}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="empty-list-msg">Nenhum cliente</p>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="expander-group">
                      <button
                        type="button"
                        className={`btn-expander ${isNaoExpanded ? "active" : ""}`}
                        onClick={() =>
                          setPerguntaExpandida((prev) => ({
                            ...prev,
                            [`${q.key}_Não`]: !prev[`${q.key}_Não`],
                          }))
                        }
                      >
                        <span className="toggle-label">
                          🔴 {q.descNao}: <strong>{q.naoCount}</strong>
                        </span>
                        {isNaoExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>

                      {isNaoExpanded && (
                        <div className="clients-list-container">
                          {q.naoClients.length > 0 ? (
                            <ul>
                              {q.naoClients.map((c) => (
                                <li key={c}>{c}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="empty-list-msg">Nenhum cliente</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
