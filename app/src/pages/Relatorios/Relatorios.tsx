import React, { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
  Download,
  Calendar,
  AlertCircle,
  Clock,
  PlayCircle,
  CheckCircle,
  ShieldAlert,
} from "lucide-react";
import { listarEmpresas } from "../../services/empresas";
import { listarOcorrencias } from "../../services/ocorrencias";
import {
  calcularDiasNaEsteira,
  calcularFarol,
  calcularProgressoPorFases,
  calcularTME,
  calcularTotalFases,
  obterUltimoTreinamento,
} from "../../utils/monitoramento";
import type { Empresa, Ocorrencia } from "../../types";
import { formatarNome } from "../../utils/formatarNome";
import "./Relatorios.css";

type DecorredEmpresa = Empresa & {
  alerta: boolean;
  tme: number | null;
  progresso: number;
  farol: "vermelho" | "amarelo" | "verde" | "none";
  dias: number;
};

export const Relatorios: React.FC = () => {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataReferencia, setDataReferencia] = useState(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  });
  const [kpiSelecionado, setKpiSelecionado] = useState<number>(0);

  useEffect(() => {
    async function carregarDados() {
      setLoading(true);
      try {
        const [empresasLista, ocorrenciasLista] = await Promise.all([
          listarEmpresas(),
          listarOcorrencias(),
        ]);
        setEmpresas(empresasLista);
        setOcorrencias(ocorrenciasLista);
      } catch (error) {
        console.error("Erro ao carregar dados:", error);
        toast.error("Erro ao carregar dados dos relatórios.");
      } finally {
        setLoading(false);
      }
    }
    carregarDados();
  }, []);

  // Limites da semana selecionada (de Domingo a Sábado)
  const limitesSemana = useMemo(() => {
    if (!dataReferencia) return null;
    const [y, m, d] = dataReferencia.split("-").map(Number);
    const dataRef = new Date(y, m - 1, d);
    
    const diaDaSemana = dataRef.getDay(); // 0 = Domingo, 6 = Sábado
    
    // Começo da semana (Domingo 00:00:00)
    const inicio = new Date(dataRef);
    inicio.setDate(dataRef.getDate() - diaDaSemana);
    inicio.setHours(0, 0, 0, 0);
    
    // Fim da semana (Sábado 23:59:59)
    const fim = new Date(inicio);
    fim.setDate(inicio.getDate() + 6);
    fim.setHours(23, 59, 59, 999);
    
    return { inicio, fim };
  }, [dataReferencia]);

  // Decora os dados das empresas calculando progresso, farol, etc.
  const dadosEmpresas = useMemo<DecorredEmpresa[]>(() => {
    return empresas.map((empresa) => {
      const ultimoTreinamento = obterUltimoTreinamento(
        ocorrencias,
        empresa.nomeEmpresa
      );

      const dataBase =
        ultimoTreinamento?.dataOcorrencia || ultimoTreinamento?.createdAt;

      const tme = calcularTME(dataBase);

      const totalFases = calcularTotalFases(empresa.temaText);

      const progresso = calcularProgressoPorFases(
        empresa.currentPhase,
        totalFases
      );

      const ultimaOcorrenciaAlerta = ocorrencias
        .filter(
          (o) =>
            o.empresa.trim().toLowerCase() === empresa.nomeEmpresa.trim().toLowerCase() &&
            (o.alerta === true || o.retirarAlerta === true)
        )
        .sort(
          (a, b) =>
            (b.createdAt ?? b.dataOcorrencia ?? 0) -
            (a.createdAt ?? a.dataOcorrencia ?? 0)
        )[0];

      let temAlerta = false;
      if (ultimaOcorrenciaAlerta) {
        if (ultimaOcorrenciaAlerta.alerta === true) {
          temAlerta = true;
        }
      } else {
        temAlerta = !!empresa.alerta;
      }

      const farol = calcularFarol({
        progresso,
        tme,
        alerta: temAlerta,
      });

      return {
        ...empresa,
        alerta: temAlerta,
        tme,
        progresso,
        farol,
        dias: calcularDiasNaEsteira(empresa.dataEntrada, progresso, dataBase),
      };
    });
  }, [empresas, ocorrencias]);

  // Auxiliar para converter "yyyy-mm-dd" em Date
  const parseDataLocal = (dataStr: string): Date | null => {
    if (!dataStr) return null;
    const parts = dataStr.split("-").map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  };
  // KPIs
  const entraramNaSemana = useMemo(() => {
    if (!limitesSemana) return [];
    const { inicio, fim } = limitesSemana;
    return dadosEmpresas.filter((e) => {
      const dataEntradaDate = parseDataLocal(e.dataEntrada);
      return !e.isOngoing && dataEntradaDate && dataEntradaDate >= inicio && dataEntradaDate <= fim;
    });
  }, [dadosEmpresas, limitesSemana]);

  const concluidosNaSemana = useMemo(() => {
    if (!limitesSemana) return [];
    const { inicio, fim } = limitesSemana;
    return dadosEmpresas.filter((e) => {
      if (!e.dataFinalizacao) return false;
      const dataFinalizacaoDate = parseDataLocal(e.dataFinalizacao);
      return !e.isOngoing && dataFinalizacaoDate && dataFinalizacaoDate >= inicio && dataFinalizacaoDate <= fim;
    });
  }, [dadosEmpresas, limitesSemana]);

  const ativosNoFimDeSemana = useMemo(() => {
    if (!limitesSemana) return [];
    const { inicio, fim } = limitesSemana;
    const empresasNomes = new Set<string>();

    ocorrencias.forEach((o) => {
      if (o.departamento === "Suporte") {
        const t = o.createdAt ?? o.dataOcorrencia ?? 0;
        if (t >= inicio.getTime() && t <= fim.getTime()) {
          const dia = new Date(t).getDay();
          if (dia === 0 || dia === 6) {
            empresasNomes.add(o.empresa.trim().toLowerCase());
          }
        }
      }
    });

    return dadosEmpresas.filter((e) =>
      !e.isOngoing && empresasNomes.has(e.nomeEmpresa.trim().toLowerCase())
    );
  }, [dadosEmpresas, ocorrencias, limitesSemana]);

  const semProximoPasso = useMemo(() => {
    return dadosEmpresas.filter(
      (e) =>
        !e.isOngoing &&
        e.farol === "vermelho" &&
        ((e.progresso > 0 && e.progresso < 100) || e.alerta === true)
    );
  }, [dadosEmpresas]);

  const acimaDoPrazo = useMemo(() => {
    return dadosEmpresas.filter(
      (e) => !e.isOngoing && e.progresso > 0 && e.progresso < 100 && e.dias > 60
    );
  }, [dadosEmpresas]);

  const riscoChurn = useMemo(() => {
    return dadosEmpresas.filter((e) => !e.isOngoing && e.alerta === true);
  }, [dadosEmpresas]);

  const kpis = [
    {
      titulo: "Entraram na semana",
      valor: entraramNaSemana.length,
      desc: "Novos na esteira",
      icone: <PlayCircle size={22} />,
      lista: entraramNaSemana,
      ehSazonal: true,
    },
    {
      titulo: "Concluíram na semana",
      valor: concluidosNaSemana.length,
      desc: "Finalizados",
      icone: <CheckCircle size={22} />,
      lista: concluidosNaSemana,
      ehSazonal: true,
    },
    {
      titulo: "Ativos no Fim de Semana",
      valor: ativosNoFimDeSemana.length,
      desc: "Suporte no FdS",
      icone: <Clock size={22} />,
      lista: ativosNoFimDeSemana,
      ehSazonal: true,
    },
    {
      titulo: "Sem próximo passo",
      valor: semProximoPasso.length,
      desc: "Farol vermelho",
      icone: <AlertCircle size={22} />,
      lista: semProximoPasso,
      ehSazonal: false,
    },
    {
      titulo: "Acima do prazo",
      valor: acimaDoPrazo.length,
      desc: "Onboarding > 60d",
      icone: <AlertCircle size={22} color="#f59e0b" />,
      lista: acimaDoPrazo,
      ehSazonal: false,
    },
    {
      titulo: "Risco de churn",
      valor: riscoChurn.length,
      desc: "Clientes em alerta",
      icone: <ShieldAlert size={22} color="#ef4444" />,
      lista: riscoChurn,
      ehSazonal: false,
    },
  ];

  const exportarTXT = () => {
    if (!limitesSemana) return;
    const now = new Date();
    const dataGen = now.toLocaleDateString("pt-BR");
    const horaGen = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const semanaStr = `${limitesSemana.inicio.toLocaleDateString("pt-BR")} a ${limitesSemana.fim.toLocaleDateString("pt-BR")}`;

    let content = `==================================================
RELATÓRIO DE ACOMPANHAMENTO DA ESTEIRA DE CAPACITAÇÃO
Gerado em: ${dataGen} às ${horaGen}
Semana de Referência: ${semanaStr}
==================================================

RESUMO DOS INDICADORES:
1. Clientes que entraram na esteira na semana: ${entraramNaSemana.length}
2. Clientes que concluíram a esteira na semana: ${concluidosNaSemana.length}
3. Clientes ativos no fim de semana (atendimento Suporte): ${ativosNoFimDeSemana.length}
4. Clientes sem próximo passo (farol vermelho): ${semProximoPasso.length}
5. Clientes acima do prazo de onboarding (> 60 dias): ${acimaDoPrazo.length}
6. Casos com risco de churn (Clientes em Alerta): ${riscoChurn.length}

==================================================
DETALHAMENTO DOS INDICADORES:
==================================================

1. CLIENTES QUE ENTRARAM NA ESTEIRA NA SEMANA (${entraramNaSemana.length})
${
  entraramNaSemana.length > 0
    ? entraramNaSemana
        .map(
          (e) =>
            ` - ${e.nomeEmpresa}\n   Treinador: ${formatarNome(e.responsavel) || "-"}\n   CS: ${formatarNome(e.csResponsavel) || "-"}\n   Data de Entrada: ${e.dataEntrada || "-"}\n   Valor do Contrato: ${e.valorContrato !== undefined ? `R$ ${e.valorContrato.toFixed(2)}` : "—"}\n`
        )
        .join("\n")
    : " - Nenhum cliente registrado nesta semana.\n"
}
2. CLIENTES QUE CONCLUÍRAM A ESTEIRA NA SEMANA (${concluidosNaSemana.length})
${
  concluidosNaSemana.length > 0
    ? concluidosNaSemana
        .map(
          (e) =>
            ` - ${e.nomeEmpresa}\n   Treinador: ${formatarNome(e.responsavel) || "-"}\n   CS: ${formatarNome(e.csResponsavel) || "-"}\n   Data de Entrada: ${e.dataEntrada || "-"}\n   Data de Finalização: ${e.dataFinalizacao || "-"}\n   Valor do Contrato: ${e.valorContrato !== undefined ? `R$ ${e.valorContrato.toFixed(2)}` : "—"}\n`
        )
        .join("\n")
    : " - Nenhum cliente concluído nesta semana.\n"
}
3. CLIENTES ATIVOS NO FIM DE SEMANA (${ativosNoFimDeSemana.length})
${
  ativosNoFimDeSemana.length > 0
    ? ativosNoFimDeSemana
        .map(
          (e) =>
            ` - ${e.nomeEmpresa}\n   Treinador: ${formatarNome(e.responsavel) || "-"}\n   CS: ${formatarNome(e.csResponsavel) || "-"}\n   Valor do Contrato: ${e.valorContrato !== undefined ? `R$ ${e.valorContrato.toFixed(2)}` : "—"}\n`
        )
        .join("\n")
    : " - Nenhum atendimento de suporte no fim de semana registrado nesta semana.\n"
}
4. CLIENTES SEM PRÓXIMO PASSO (${semProximoPasso.length})
${
  semProximoPasso.length > 0
    ? semProximoPasso
        .map(
          (e) =>
            ` - ${e.nomeEmpresa}\n   Treinador: ${formatarNome(e.responsavel) || "-"}\n   CS: ${formatarNome(e.csResponsavel) || "-"}\n   Progresso: ${e.progresso}%\n   Valor do Contrato: ${e.valorContrato !== undefined ? `R$ ${e.valorContrato.toFixed(2)}` : "—"}\n`
        )
        .join("\n")
    : " - Nenhum cliente com farol vermelho e em progresso/alerta.\n"
}
5. CLIENTES ACIMA DO PRAZO DE ONBOARDING (> 60 dias) (${acimaDoPrazo.length})
${
  acimaDoPrazo.length > 0
    ? acimaDoPrazo
        .map(
          (e) =>
            ` - ${e.nomeEmpresa}\n   Treinador: ${formatarNome(e.responsavel) || "-"}\n   CS: ${formatarNome(e.csResponsavel) || "-"}\n   Data de Entrada: ${e.dataEntrada || "-"}\n   Dias na Esteira: ${e.dias} dias\n   Valor do Contrato: ${e.valorContrato !== undefined ? `R$ ${e.valorContrato.toFixed(2)}` : "—"}\n`
        )
        .join("\n")
    : " - Nenhum cliente acima do prazo de 60 dias.\n"
}
6. CASOS COM RISCO DE CHURN (Clientes em Alerta) (${riscoChurn.length})
${
  riscoChurn.length > 0
    ? riscoChurn
        .map(
          (e) =>
            ` - ${e.nomeEmpresa}\n   Treinador: ${formatarNome(e.responsavel) || "-"}\n   CS: ${formatarNome(e.csResponsavel) || "-"}\n   Progresso: ${e.progresso}%\n   Valor do Contrato: ${e.valorContrato !== undefined ? `R$ ${e.valorContrato.toFixed(2)}` : "—"}\n`
        )
        .join("\n")
    : " - Nenhum cliente ativo em alerta atualmente.\n"
}
`;

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio_esteira_${dataReferencia}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const selectedKpi = kpis[kpiSelecionado];

  return (
    <div className="relatorios-page">
      <div className="relatorios-glow"></div>

      <header className="relatorios-header">
        <h1>Relatórios de Acompanhamento</h1>
        <p>Indicadores consolidados sobre o andamento e status das implantações dos clientes.</p>
      </header>

      {/* Filtro de Data */}
      <div className="relatorios-filtros">
        <label htmlFor="data-referencia">Data de referência:</label>
        <input
          id="data-referencia"
          type="date"
          value={dataReferencia}
          onChange={(e) => {
            setDataReferencia(e.target.value);
            // Ao mudar a data, mantém o KPI selecionado ou volta pro inicial se for conveniente
          }}
        />
        {limitesSemana && (
          <span className="semana-info-badge">
            <Calendar size={14} style={{ marginRight: "6px", verticalAlign: "middle" }} />
            Semana: {limitesSemana.inicio.toLocaleDateString("pt-BR")} até {limitesSemana.fim.toLocaleDateString("pt-BR")}
          </span>
        )}
      </div>

      {loading ? (
        <div className="relatorio-loader">
          <div className="spinner"></div>
          <p>Carregando dados dos relatórios...</p>
        </div>
      ) : (
        <>
          {/* Grid de KPIs */}
          <div className="relatorios-grid">
            {kpis.map((kpi, idx) => (
              <div
                key={idx}
                className={`relatorio-kpi-card ${kpiSelecionado === idx ? "active" : ""}`}
                onClick={() => setKpiSelecionado(idx)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="kpi-label">{kpi.titulo}</span>
                  <span style={{ opacity: 0.8 }}>{kpi.icone}</span>
                </div>
                <div className="kpi-value-row">
                  <span className="kpi-value">{kpi.valor}</span>
                </div>
                <span className="kpi-desc">
                  {kpi.desc} {kpi.ehSazonal && " (esta semana)"}
                </span>
              </div>
            ))}
          </div>

          {/* Section de detalhamento */}
          <div className="relatorio-detalhe-section">
            <div className="relatorio-detalhe-header">
              <h3>
                📋 {selectedKpi.titulo} ({selectedKpi.valor})
              </h3>
              <button className="btn-export-txt" onClick={exportarTXT}>
                <Download size={16} />
                Exportar TXT
              </button>
            </div>

            <div className="relatorios-table-wrapper">
              {selectedKpi.lista.length > 0 ? (
                <table className="relatorios-table">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Treinador</th>
                      <th>CS Responsável</th>
                      <th>Progresso</th>
                      <th>Dias na Esteira</th>
                      <th style={{ textAlign: "right" }}>Valor de Contrato</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedKpi.lista.map((e) => (
                      <tr key={e.id}>
                        <td style={{ fontWeight: 600 }}>{e.nomeEmpresa}</td>
                        <td>{formatarNome(e.responsavel) || "—"}</td>
                        <td>{formatarNome(e.csResponsavel) || "—"}</td>
                        <td>
                          <span style={{ fontWeight: 600, color: e.progresso >= 100 ? "#10b981" : "#f59e0b" }}>
                            {e.progresso}%
                          </span>
                        </td>
                        <td>{e.dias} dias</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>
                          {e.valorContrato !== undefined && e.valorContrato !== null
                            ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(e.valorContrato)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="relatorio-empty">
                  <span className="relatorio-empty-icon">📁</span>
                  <p>Nenhum cliente atende aos critérios deste indicador nesta semana.</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
