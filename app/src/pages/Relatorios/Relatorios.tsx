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
  Eye,
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
import { RelatorioScore } from "../RelatorioScore/RelatorioScore";
import { useNavigate } from "react-router-dom";

type DecorredEmpresa = Empresa & {
  alerta: boolean;
  tme: number | null;
  progresso: number;
  farol: "vermelho" | "amarelo" | "verde" | "none";
  dias: number;
};

export const Relatorios: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"esteira" | "score">("esteira");
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
  const [dataComparacao, setDataComparacao] = useState<string>("");

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
            (b.dataOcorrencia || b.createdAt || 0) -
            (a.dataOcorrencia || a.createdAt || 0)
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
        dataFinalizacao: empresa.dataFinalizacao,
        dataFollowUpFinal: empresa.dataFollowUpFinal,
      });

      let ocorrenciaAlertaId = (empresa as any).ocorrenciaAlertaId;
      if (ultimaOcorrenciaAlerta && ultimaOcorrenciaAlerta.alerta === true) {
        ocorrenciaAlertaId = ultimaOcorrenciaAlerta.id;
      }

      return {
        ...empresa,
        alerta: temAlerta,
        ocorrenciaAlertaId,
        tme,
        progresso,
        farol,
        dias: calcularDiasNaEsteira(empresa.dataEntrada, progresso, dataBase, empresa.dataFinalizacao),
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
      return !e.isOngoing && !e.isSuspended && dataEntradaDate && dataEntradaDate >= inicio && dataEntradaDate <= fim;
    });
  }, [dadosEmpresas, limitesSemana]);

  const concluidosNaSemana = useMemo(() => {
    if (!limitesSemana) return [];
    const { inicio, fim } = limitesSemana;
    return dadosEmpresas.filter((e) => {
      const dataFinalizacaoDate = parseDataLocal(e.dataFinalizacao || "");
      return (
        !e.isOngoing &&
        !e.isSuspended &&
        dataFinalizacaoDate &&
        dataFinalizacaoDate >= inicio &&
        dataFinalizacaoDate <= fim
      );
    });
  }, [dadosEmpresas, limitesSemana]);

  const contatosSuporte = useMemo(() => {
    if (!limitesSemana) return [];
    const { inicio, fim } = limitesSemana;
    const statsMap = new Map<
      string,
      {
        dentro: { duvidas: number; problemas: number; total: number };
        fora: { duvidas: number; problemas: number; total: number };
        total: number;
      }
    >();

    ocorrencias.forEach((o) => {
      if (o.departamento === "Suporte") {
        const tipoLower = (o.tipo || "").toLowerCase();
        const eDuvida = tipoLower.includes("duvida") || tipoLower.includes("dúvida");
        const eProblema = tipoLower.includes("problema");

        if (eDuvida || eProblema) {
          const t = o.dataOcorrencia || o.createdAt || 0;
          if (t >= inicio.getTime() && t <= fim.getTime()) {
            const dateObj = new Date(t);
            const hour = dateObj.getHours();
            const day = dateObj.getDay();
            const isWeekend = day === 0 || day === 6;
            const isFora = isWeekend || hour >= 18 || hour < 9;

            const key = o.empresa.trim().toLowerCase();
            const stats = statsMap.get(key) || {
              dentro: { duvidas: 0, problemas: 0, total: 0 },
              fora: { duvidas: 0, problemas: 0, total: 0 },
              total: 0,
            };

            if (isFora) {
              if (eDuvida) stats.fora.duvidas += 1;
              else stats.fora.problemas += 1;
              stats.fora.total += 1;
            } else {
              if (eDuvida) stats.dentro.duvidas += 1;
              else stats.dentro.problemas += 1;
              stats.dentro.total += 1;
            }
            stats.total += 1;
            statsMap.set(key, stats);
          }
        }
      }
    });

    return dadosEmpresas
      .filter((e) => !e.isOngoing && !e.isSuspended && statsMap.has(e.nomeEmpresa.trim().toLowerCase()))
      .map((e) => {
        const stats = statsMap.get(e.nomeEmpresa.trim().toLowerCase())!;
        return {
          ...e,
          dentroExpediente: stats.dentro,
          foraExpediente: stats.fora,
          totalContatos: stats.total,
        };
      });
  }, [dadosEmpresas, ocorrencias, limitesSemana]);

  const semProximoPasso = useMemo(() => {
    return dadosEmpresas.filter(
      (e) =>
        !e.isOngoing &&
        !e.isSuspended &&
        e.farol === "vermelho" &&
        ((e.progresso > 0 && e.progresso < 100) || e.alerta === true)
    );
  }, [dadosEmpresas]);

  const acimaDoPrazo = useMemo(() => {
    return dadosEmpresas.filter(
      (e) =>
        !e.isOngoing &&
        !e.isSuspended &&
        e.progresso > 0 &&
        e.progresso < 100 &&
        (!e.dataFinalizacao || e.dataFinalizacao.trim() === "") &&
        e.dias > 60
    );
  }, [dadosEmpresas]);

  const riscoChurn = useMemo(() => {
    if (!limitesSemana) return [];
    const { fim } = limitesSemana;

    return dadosEmpresas
      .filter((e) => {
        // Encontra a ocorrência mais recente de alerta/retirarAlerta até o fim da semana
        const ultimaOcorrenciaAlertaNaSemana = ocorrencias
          .filter(
            (o) =>
              o.empresa.trim().toLowerCase() === e.nomeEmpresa.trim().toLowerCase() &&
              (o.alerta === true || o.retirarAlerta === true) &&
              (o.dataOcorrencia || o.createdAt || 0) <= fim.getTime()
          )
          .sort(
            (a, b) =>
              (b.dataOcorrencia || b.createdAt || 0) -
              (a.dataOcorrencia || a.createdAt || 0)
          )[0];

        let temAlertaNaSemana = false;
        if (ultimaOcorrenciaAlertaNaSemana) {
          if (ultimaOcorrenciaAlertaNaSemana.alerta === true) {
            temAlertaNaSemana = true;
          }
        } else {
          temAlertaNaSemana = !!e.alerta;
        }

        // Mantém cliente em alerta mesmo que esteja suspenso
        return !e.isOngoing && temAlertaNaSemana;
      })
      .map((e) => {
        // Para garantir que o badge de alerta mostre a ocorrência correta na semana
        const ultimaOcorrenciaAlertaNaSemana = ocorrencias
          .filter(
            (o) =>
              o.empresa.trim().toLowerCase() === e.nomeEmpresa.trim().toLowerCase() &&
              (o.alerta === true || o.retirarAlerta === true) &&
              (o.dataOcorrencia || o.createdAt || 0) <= fim.getTime()
          )
          .sort(
            (a, b) =>
              (b.dataOcorrencia || b.createdAt || 0) -
              (a.dataOcorrencia || a.createdAt || 0)
          )[0];

        let ocorrenciaAlertaId = (e as any).ocorrenciaAlertaId;
        if (ultimaOcorrenciaAlertaNaSemana && ultimaOcorrenciaAlertaNaSemana.alerta === true) {
          ocorrenciaAlertaId = ultimaOcorrenciaAlertaNaSemana.id;
        }

        return {
          ...e,
          alerta: true,
          ocorrenciaAlertaId,
        };
      });
  }, [dadosEmpresas, ocorrencias, limitesSemana]);

  const limitesSemanaComparacao = useMemo(() => {
    if (!dataComparacao) return null;
    const [y, m, d] = dataComparacao.split("-").map(Number);
    const dataRef = new Date(y, m - 1, d);
    const diaDaSemana = dataRef.getDay();

    const inicio = new Date(dataRef);
    inicio.setDate(dataRef.getDate() - diaDaSemana);
    inicio.setHours(0, 0, 0, 0);

    const fim = new Date(inicio);
    fim.setDate(inicio.getDate() + 6);
    fim.setHours(23, 59, 59, 999);

    return { inicio, fim };
  }, [dataComparacao]);

  const entraramNaSemanaComparacao = useMemo(() => {
    if (!limitesSemanaComparacao) return [];
    const { inicio, fim } = limitesSemanaComparacao;
    return dadosEmpresas.filter((e) => {
      const dataEntradaDate = parseDataLocal(e.dataEntrada);
      return !e.isOngoing && !e.isSuspended && dataEntradaDate && dataEntradaDate >= inicio && dataEntradaDate <= fim;
    });
  }, [dadosEmpresas, limitesSemanaComparacao]);

  const concluidosNaSemanaComparacao = useMemo(() => {
    if (!limitesSemanaComparacao) return [];
    const { inicio, fim } = limitesSemanaComparacao;
    return dadosEmpresas.filter((e) => {
      const dataFinalizacaoDate = parseDataLocal(e.dataFinalizacao || "");
      return (
        !e.isOngoing &&
        !e.isSuspended &&
        dataFinalizacaoDate &&
        dataFinalizacaoDate >= inicio &&
        dataFinalizacaoDate <= fim
      );
    });
  }, [dadosEmpresas, limitesSemanaComparacao]);

  const contatosSuporteComparacao = useMemo(() => {
    if (!limitesSemanaComparacao) return [];
    const { inicio, fim } = limitesSemanaComparacao;
    const statsMap = new Map<
      string,
      {
        dentro: { duvidas: number; problemas: number; total: number };
        fora: { duvidas: number; problemas: number; total: number };
        total: number;
      }
    >();

    ocorrencias.forEach((o) => {
      if (o.departamento === "Suporte") {
        const tipoLower = (o.tipo || "").toLowerCase();
        const eDuvida = tipoLower.includes("duvida") || tipoLower.includes("dúvida");
        const eProblema = tipoLower.includes("problema");

        if (eDuvida || eProblema) {
          const t = o.dataOcorrencia || o.createdAt || 0;
          if (t >= inicio.getTime() && t <= fim.getTime()) {
            const dateObj = new Date(t);
            const hour = dateObj.getHours();
            const day = dateObj.getDay();
            const isWeekend = day === 0 || day === 6;
            const isFora = isWeekend || hour >= 18 || hour < 9;

            const key = o.empresa.trim().toLowerCase();
            const stats = statsMap.get(key) || {
              dentro: { duvidas: 0, problemas: 0, total: 0 },
              fora: { duvidas: 0, problemas: 0, total: 0 },
              total: 0,
            };

            if (isFora) {
              if (eDuvida) stats.fora.duvidas += 1;
              else stats.fora.problemas += 1;
              stats.fora.total += 1;
            } else {
              if (eDuvida) stats.dentro.duvidas += 1;
              else stats.dentro.problemas += 1;
              stats.dentro.total += 1;
            }
            stats.total += 1;
            statsMap.set(key, stats);
          }
        }
      }
    });

    return dadosEmpresas
      .filter((e) => !e.isOngoing && !e.isSuspended && statsMap.has(e.nomeEmpresa.trim().toLowerCase()))
      .map((e) => {
        const stats = statsMap.get(e.nomeEmpresa.trim().toLowerCase())!;
        return {
          ...e,
          dentroExpediente: stats.dentro,
          foraExpediente: stats.fora,
          totalContatos: stats.total,
        };
      });
  }, [dadosEmpresas, ocorrencias, limitesSemanaComparacao]);

  const riscoChurnComparacao = useMemo(() => {
    if (!limitesSemanaComparacao) return [];
    const { fim } = limitesSemanaComparacao;

    return dadosEmpresas
      .filter((e) => {
        const ultimaOcorrenciaAlertaNaSemana = ocorrencias
          .filter(
            (o) =>
              o.empresa.trim().toLowerCase() === e.nomeEmpresa.trim().toLowerCase() &&
              (o.alerta === true || o.retirarAlerta === true) &&
              (o.dataOcorrencia || o.createdAt || 0) <= fim.getTime()
          )
          .sort(
            (a, b) =>
              (b.dataOcorrencia || b.createdAt || 0) -
              (a.dataOcorrencia || a.createdAt || 0)
          )[0];

        let temAlertaNaSemana = false;
        if (ultimaOcorrenciaAlertaNaSemana) {
          if (ultimaOcorrenciaAlertaNaSemana.alerta === true) {
            temAlertaNaSemana = true;
          }
        } else {
          temAlertaNaSemana = !!e.alerta;
        }

        return !e.isOngoing && temAlertaNaSemana;
      });
  }, [dadosEmpresas, ocorrencias, limitesSemanaComparacao]);

  const totalContatosSuporte = useMemo(() => {
    return contatosSuporte.reduce((acc, curr) => acc + (curr as any).totalContatos, 0);
  }, [contatosSuporte]);

  const totalContatosSuporteComp = useMemo(() => {
    return contatosSuporteComparacao.reduce((acc, curr) => acc + (curr as any).totalContatos, 0);
  }, [contatosSuporteComparacao]);

  const foraExpedienteTotal = useMemo(() => {
    return contatosSuporte.reduce((acc, curr) => acc + (curr as any).foraExpediente.total, 0);
  }, [contatosSuporte]);

  const foraExpedienteTotalComp = useMemo(() => {
    return contatosSuporteComparacao.reduce((acc, curr) => acc + (curr as any).foraExpediente.total, 0);
  }, [contatosSuporteComparacao]);

  const dentroExpedienteTotal = useMemo(() => {
    return contatosSuporte.reduce((acc, curr) => acc + (curr as any).dentroExpediente.total, 0);
  }, [contatosSuporte]);

  const dentroExpedienteTotalComp = useMemo(() => {
    return contatosSuporteComparacao.reduce((acc, curr) => acc + (curr as any).dentroExpediente.total, 0);
  }, [contatosSuporteComparacao]);

  const formatarDiferenca = (atual: number, anterior: number) => {
    if (anterior === 0) {
      if (atual === 0) return { texto: "0%", classe: "diff-neutral", diff: 0 };
      return { texto: `+${atual} (novos)`, classe: "diff-positive", diff: 100 };
    }
    const diff = ((atual - anterior) / anterior) * 100;
    const sinal = diff > 0 ? "+" : "";
    const texto = `${sinal}${diff.toFixed(0)}%`;
    const classe = diff > 0 ? "diff-positive" : diff < 0 ? "diff-negative" : "diff-neutral";
    return { texto, classe, diff };
  };

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
      titulo: "Contato com suporte",
      valor: totalContatosSuporte,
      desc: "Atendimento suporte",
      icone: <Clock size={22} />,
      lista: contatosSuporte,
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
      ehSazonal: true,
    },
  ];

  const exportarTXT = () => {
    if (!limitesSemana) return;
    const now = new Date();
    const dataGen = now.toLocaleDateString("pt-BR");
    const horaGen = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const semanaStr = `${limitesSemana.inicio.toLocaleDateString("pt-BR")} a ${limitesSemana.fim.toLocaleDateString("pt-BR")}`;

    let comparacaoStr = "";
    if (dataComparacao && limitesSemanaComparacao) {
      const pctTotal = formatarDiferenca(totalContatosSuporte, totalContatosSuporteComp);
      const pctDentro = formatarDiferenca(dentroExpedienteTotal, dentroExpedienteTotalComp);
      const pctFora = formatarDiferenca(foraExpedienteTotal, foraExpedienteTotalComp);

      const entrouComp = entraramNaSemanaComparacao.length;
      const pctEntrou = formatarDiferenca(entraramNaSemana.length, entrouComp);

      const concluiuComp = concluidosNaSemanaComparacao.length;
      const pctConcluiu = formatarDiferenca(concluidosNaSemana.length, concluiuComp);

      const churnComp = riscoChurnComparacao.length;
      const pctChurn = formatarDiferenca(riscoChurn.length, churnComp);

      comparacaoStr = `
==================================================
COMPARATIVO COM A SEMANA DE: ${limitesSemanaComparacao.inicio.toLocaleDateString("pt-BR")} a ${limitesSemanaComparacao.fim.toLocaleDateString("pt-BR")}
==================================================
1. Entraram na esteira: ${entraramNaSemana.length} vs ${entrouComp} (${pctEntrou.texto})
2. Concluíram a esteira: ${concluidosNaSemana.length} vs ${concluiuComp} (${pctConcluiu.texto})
3. Risco de Churn: ${riscoChurn.length} vs ${churnComp} (${pctChurn.texto})

CONTATOS COM SUPORTE:
- Total: ${totalContatosSuporte} vs ${totalContatosSuporteComp} (${pctTotal.texto})
- Dentro do Expediente: ${dentroExpedienteTotal} vs ${dentroExpedienteTotalComp} (${pctDentro.texto})
- Fora do Expediente: ${foraExpedienteTotal} vs ${foraExpedienteTotalComp} (${pctFora.texto})
==================================================
`;
    }

    let content = `==================================================
RELATÓRIO DE ACOMPANHAMENTO DA ESTEIRA DE CAPACITAÇÃO
Gerado em: ${dataGen} às ${horaGen}
Semana de Referência: ${semanaStr}
==================================================
${comparacaoStr}
RESUMO DOS INDICADORES:
1. Clientes que entraram na esteira na semana: ${entraramNaSemana.length}
2. Clientes que concluíram a esteira na semana: ${concluidosNaSemana.length}
3. Contatos com suporte (atendimento Suporte): ${totalContatosSuporte}
4. Clientes sem próximo passo (farol vermelho): ${semProximoPasso.length}
5. Clientes acima do prazo de onboarding (> 60 dias): ${acimaDoPrazo.length}
6. Casos com risco de churn (Clientes em Alerta): ${riscoChurn.length}

==================================================
DETALHAMENTO DOS INDICADORES:
==================================================

1. CLIENTES QUE ENTRARAM NA ESTEIRA NA SEMANA (${entraramNaSemana.length})
${entraramNaSemana.length > 0
        ? entraramNaSemana
          .map(
            (e) =>
              ` - ${e.nomeEmpresa}\n   Treinador: ${formatarNome(e.responsavel) || "-"}\n   CS: ${formatarNome(e.csResponsavel) || "-"}\n   Data de Entrada: ${e.dataEntrada || "-"}\n   Valor do Contrato: ${e.valorContrato !== undefined ? `R$ ${e.valorContrato.toFixed(2)}` : "—"}\n`
          )
          .join("\n")
        : " - Nenhum cliente registrado nesta semana.\n"
      }
2. CLIENTES QUE CONCLUÍRAM A ESTEIRA NA SEMANA (${concluidosNaSemana.length})
${concluidosNaSemana.length > 0
        ? concluidosNaSemana
          .map(
            (e) =>
              ` - ${e.nomeEmpresa}\n   Treinador: ${formatarNome(e.responsavel) || "-"}\n   CS: ${formatarNome(e.csResponsavel) || "-"}\n   Data de Entrada: ${e.dataEntrada || "-"}\n   Data de Finalização: ${e.dataFinalizacao || "-"}\n   Valor do Contrato: ${e.valorContrato !== undefined ? `R$ ${e.valorContrato.toFixed(2)}` : "—"}\n`
          )
          .join("\n")
        : " - Nenhum cliente concluído nesta semana.\n"
      }
3. CONTATOS COM SUPORTE (${totalContatosSuporte})
${contatosSuporte.length > 0
        ? contatosSuporte
          .map(
            (e) =>
              ` - ${e.nomeEmpresa}\n   Treinador: ${formatarNome(e.responsavel) || "-"}\n   CS: ${formatarNome(e.csResponsavel) || "-"}\n   Dentro do Expediente: ${(e as any).dentroExpediente.total} (Dúvidas: ${(e as any).dentroExpediente.duvidas}, Problemas: ${(e as any).dentroExpediente.problemas})\n   Fora do Expediente: ${(e as any).foraExpediente.total} (Dúvidas: ${(e as any).foraExpediente.duvidas}, Problemas: ${(e as any).foraExpediente.problemas})\n   Total de Contatos: ${(e as any).totalContatos}\n   Valor do Contrato: ${e.valorContrato !== undefined ? `R$ ${e.valorContrato.toFixed(2)}` : "—"}\n`
          )
          .join("\n")
        : " - Nenhum atendimento de suporte registrado nesta semana.\n"
      }
4. CLIENTES SEM PRÓXIMO PASSO (${semProximoPasso.length})
${semProximoPasso.length > 0
        ? semProximoPasso
          .map(
            (e) =>
              ` - ${e.nomeEmpresa}\n   Treinador: ${formatarNome(e.responsavel) || "-"}\n   CS: ${formatarNome(e.csResponsavel) || "-"}\n   Progresso: ${e.progresso}%\n   Valor do Contrato: ${e.valorContrato !== undefined ? `R$ ${e.valorContrato.toFixed(2)}` : "—"}\n`
          )
          .join("\n")
        : " - Nenhum cliente com farol vermelho e em progresso/alerta.\n"
      }
5. CLIENTES ACIMA DO PRAZO DE ONBOARDING (> 60 dias) (${acimaDoPrazo.length})
${acimaDoPrazo.length > 0
        ? acimaDoPrazo
          .map(
            (e) =>
              ` - ${e.nomeEmpresa}\n   Treinador: ${formatarNome(e.responsavel) || "-"}\n   CS: ${formatarNome(e.csResponsavel) || "-"}\n   Data de Entrada: ${e.dataEntrada || "-"}\n   Dias na Esteira: ${e.dias} dias\n   Valor do Contrato: ${e.valorContrato !== undefined ? `R$ ${e.valorContrato.toFixed(2)}` : "—"}\n`
          )
          .join("\n")
        : " - Nenhum cliente acima do prazo de 60 dias.\n"
      }
6. CASOS COM RISCO DE CHURN (Clientes em Alerta) (${riscoChurn.length})
${riscoChurn.length > 0
        ? riscoChurn
          .map(
            (e) =>
              ` - ${e.nomeEmpresa}\n   Treinador: ${formatarNome(e.responsavel) || "-"}\n   CS: ${formatarNome(e.csResponsavel) || "-"}\n   Progresso: ${e.progresso}%\n   Valor do Contrato: ${e.valorContrato !== undefined ? `R$ ${e.valorContrato.toFixed(2)}` : "—"}\n`
          )
          .join("\n")
        : " - Nenhum cliente em alerta nesta semana.\n"
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
        <h1>{activeTab === "esteira" ? "Relatórios de Acompanhamento" : "Relatório Geral de Scores"}</h1>
        <p>
          {activeTab === "esteira"
            ? "Indicadores consolidados sobre o andamento e status das implantações dos clientes."
            : "Estatísticas consolidadas e listagem de clientes baseadas no último cálculo de score."}
        </p>
      </header>

      {/* Sub-abas de Navegação */}
      <div className="relatorios-tabs">
        <button
          className={`relatorios-tab-btn ${activeTab === "esteira" ? "active" : ""}`}
          onClick={() => setActiveTab("esteira")}
        >
          Acompanhamento da Esteira
        </button>
        <button
          className={`relatorios-tab-btn ${activeTab === "score" ? "active" : ""}`}
          onClick={() => setActiveTab("score")}
        >
          Scores dos Clientes
        </button>
      </div>

      {activeTab === "esteira" ? (
        <>
          {/* Filtro de Data */}
          <div className="relatorios-filtros">
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <label htmlFor="data-referencia">Data de referência:</label>
              <input
                id="data-referencia"
                type="date"
                value={dataReferencia}
                onChange={(e) => {
                  setDataReferencia(e.target.value);
                }}
              />
              {limitesSemana && (
                <span className="semana-info-badge">
                  <Calendar size={14} style={{ marginRight: "6px", verticalAlign: "middle" }} />
                  Semana: {limitesSemana.inicio.toLocaleDateString("pt-BR")} até {limitesSemana.fim.toLocaleDateString("pt-BR")}
                </span>
              )}
            </div>

            <div className="comparacao-filtro-container">
              <label htmlFor="data-comparacao">Comparar com semana de:</label>
              <input
                id="data-comparacao"
                type="date"
                value={dataComparacao}
                onChange={(e) => setDataComparacao(e.target.value)}
              />
              {dataComparacao && limitesSemanaComparacao && (
                <span className="semana-info-badge comparacao-badge">
                  <Calendar size={14} style={{ marginRight: "6px", verticalAlign: "middle" }} />
                  Comp.: {limitesSemanaComparacao.inicio.toLocaleDateString("pt-BR")} até {limitesSemanaComparacao.fim.toLocaleDateString("pt-BR")}
                </span>
              )}
              {dataComparacao && (
                <button
                  type="button"
                  className="btn-limpar-comparacao"
                  onClick={() => setDataComparacao("")}
                  title="Limpar comparação"
                >
                  ✕
                </button>
              )}
            </div>
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
                {kpis.map((kpi, idx) => {
                  let diffResult = null;
                  if (dataComparacao && kpi.ehSazonal) {
                    let valorComp = 0;
                    if (idx === 0) valorComp = entraramNaSemanaComparacao.length;
                    else if (idx === 1) valorComp = concluidosNaSemanaComparacao.length;
                    else if (idx === 2) valorComp = totalContatosSuporteComp;
                    else if (idx === 5) valorComp = riscoChurnComparacao.length;
                    
                    diffResult = formatarDiferenca(kpi.valor, valorComp);
                  }

                  return (
                    <div
                      key={idx}
                      className={`relatorio-kpi-card ${kpiSelecionado === idx ? "active" : ""}`}
                      onClick={() => setKpiSelecionado(idx)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span className="kpi-label">{kpi.titulo}</span>
                        <span style={{ opacity: 0.8 }}>{kpi.icone}</span>
                      </div>
                      <div className="kpi-value-row" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", width: "100%" }}>
                        <span className="kpi-value">{kpi.valor}</span>
                        {diffResult && (
                          <span className={`kpi-comparison-badge ${diffResult.classe}`}>
                            {diffResult.texto}
                          </span>
                        )}
                      </div>
                      <span className="kpi-desc">
                        {kpi.desc} {kpi.ehSazonal && " (esta semana)"}
                      </span>
                      {diffResult && (
                        <span className="kpi-desc" style={{ fontSize: "0.75rem", opacity: 0.7 }}>
                          vs semana comp.
                        </span>
                      )}
                    </div>
                  );
                })}
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

                {kpiSelecionado === 2 && dataComparacao && (
                  <div className="relatorio-comparacao-container">
                    <div className="comparacao-header">
                      <h4>Comparativo com a semana de {limitesSemanaComparacao?.inicio.toLocaleDateString("pt-BR")} a {limitesSemanaComparacao?.fim.toLocaleDateString("pt-BR")}</h4>
                    </div>
                    <div className="comparacao-cards-grid">
                      {(() => {
                        const pctTotalResult = formatarDiferenca(totalContatosSuporte, totalContatosSuporteComp);
                        const pctDentroResult = formatarDiferenca(dentroExpedienteTotal, dentroExpedienteTotalComp);
                        const pctForaResult = formatarDiferenca(foraExpedienteTotal, foraExpedienteTotalComp);

                        return (
                          <>
                            <div className="comparacao-card-item">
                              <span className="comp-item-label">Total de Contatos</span>
                              <div className="comp-item-values">
                                <span className="comp-val-atual">{totalContatosSuporte}</span>
                                <span className="comp-val-separator">vs</span>
                                <span className="comp-val-anterior">{totalContatosSuporteComp}</span>
                              </div>
                              <span className={`comp-item-pct ${pctTotalResult.classe}`}>
                                {pctTotalResult.texto} {pctTotalResult.diff > 0 ? "a mais" : pctTotalResult.diff < 0 ? "a menos" : "sem alteração"}
                              </span>
                            </div>

                            <div className="comparacao-card-item">
                              <span className="comp-item-label">Dentro do Expediente</span>
                              <div className="comp-item-values">
                                <span className="comp-val-atual">{dentroExpedienteTotal}</span>
                                <span className="comp-val-separator">vs</span>
                                <span className="comp-val-anterior">{dentroExpedienteTotalComp}</span>
                              </div>
                              <span className={`comp-item-pct ${pctDentroResult.classe}`}>
                                {pctDentroResult.texto} {pctDentroResult.diff > 0 ? "a mais" : pctDentroResult.diff < 0 ? "a menos" : "sem alteração"}
                              </span>
                            </div>

                            <div className="comparacao-card-item highlight-card">
                              <span className="comp-item-label">Fora do Expediente</span>
                              <div className="comp-item-values">
                                <span className="comp-val-atual">{foraExpedienteTotal}</span>
                                <span className="comp-val-separator">vs</span>
                                <span className="comp-val-anterior">{foraExpedienteTotalComp}</span>
                              </div>
                              <span className={`comp-item-pct ${pctForaResult.classe}`}>
                                {pctForaResult.texto} {pctForaResult.diff > 0 ? "a mais" : pctForaResult.diff < 0 ? "a menos" : "sem alteração"}
                              </span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}

                <div className="relatorios-table-wrapper">
                  {selectedKpi.lista.length > 0 ? (
                    <table className="relatorios-table">
                      <thead>
                        {kpiSelecionado === 2 ? (
                          <tr>
                            <th>Cliente</th>
                            <th>Treinador</th>
                            <th>CS Responsável</th>
                            <th style={{ textAlign: "center" }}>Dentro do Expediente</th>
                            <th style={{ textAlign: "center" }}>Fora do Expediente</th>
                            <th style={{ textAlign: "center" }}>Total</th>
                            <th style={{ textAlign: "right" }}>Valor de Contrato</th>
                          </tr>
                        ) : (
                          <tr>
                            <th>Cliente</th>
                            <th>Treinador</th>
                            <th>CS Responsável</th>
                            <th>Progresso</th>
                            <th>Dias na Esteira</th>
                            <th style={{ textAlign: "right" }}>Valor de Contrato</th>
                          </tr>
                        )}
                      </thead>
                      <tbody>
                        {selectedKpi.lista.map((e) => (
                          <tr key={e.id}>
                            <td style={{ fontWeight: 600 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                <span>{e.nomeEmpresa}</span>
                                {e.alerta && (e as any).ocorrenciaAlertaId && (
                                  <button
                                    className="relatorio-alert-badge"
                                    onClick={() => navigate(`/historico?empresa=${encodeURIComponent(e.nomeEmpresa)}&ocorrencia=${(e as any).ocorrenciaAlertaId}`)}
                                    title="Clique para ver a ocorrência de alerta"
                                    style={{
                                      background: "rgba(239, 68, 68, 0.2)",
                                      color: "#f87171",
                                      border: "1px solid rgba(239, 68, 68, 0.4)",
                                      borderRadius: "6px",
                                      padding: "2px 6px",
                                      fontSize: "0.75rem",
                                      fontWeight: 600,
                                      cursor: "pointer",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "4px"
                                    }}
                                  >
                                    <AlertCircle size={12} />
                                    Ver Ocorrência
                                  </button>
                                )}
                              </div>
                            </td>
                            <td>{formatarNome(e.responsavel) || "—"}</td>
                            <td>{formatarNome(e.csResponsavel) || "—"}</td>
                            {kpiSelecionado === 2 ? (
                              <>
                                <td style={{ textAlign: "center" }}>
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
                                    <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>
                                      {(e as any).dentroExpediente.total}
                                    </span>
                                    <div style={{ display: "flex", gap: "6px", fontSize: "0.75rem", color: "#a1a1aa" }}>
                                      <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                                        D: {(e as any).dentroExpediente.duvidas}
                                        {(e as any).dentroExpediente.duvidas > 0 && (
                                          <button
                                            onClick={() => navigate(`/historico?empresa=${encodeURIComponent(e.nomeEmpresa)}&tipo=Dúvida`)}
                                            style={{
                                              background: "rgba(59, 130, 246, 0.15)",
                                              color: "#60a5fa",
                                              border: "1px solid rgba(59, 130, 246, 0.25)",
                                              borderRadius: "4px",
                                              padding: "1px 4px",
                                              cursor: "pointer",
                                              display: "inline-flex",
                                              alignItems: "center"
                                            }}
                                            title="Ver dúvidas"
                                          >
                                            <Eye size={10} />
                                          </button>
                                        )}
                                      </span>
                                      <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                                        P: {(e as any).dentroExpediente.problemas}
                                        {(e as any).dentroExpediente.problemas > 0 && (
                                          <button
                                            onClick={() => navigate(`/historico?empresa=${encodeURIComponent(e.nomeEmpresa)}&tipo=Problema`)}
                                            style={{
                                              background: "rgba(239, 68, 68, 0.15)",
                                              color: "#f87171",
                                              border: "1px solid rgba(239, 68, 68, 0.25)",
                                              borderRadius: "4px",
                                              padding: "1px 4px",
                                              cursor: "pointer",
                                              display: "inline-flex",
                                              alignItems: "center"
                                            }}
                                            title="Ver problemas"
                                          >
                                            <Eye size={10} />
                                          </button>
                                        )}
                                      </span>
                                    </div>
                                  </div>
                                </td>
                                <td style={{ textAlign: "center" }}>
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
                                    <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>
                                      {(e as any).foraExpediente.total}
                                    </span>
                                    <div style={{ display: "flex", gap: "6px", fontSize: "0.75rem", color: "#a1a1aa" }}>
                                      <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                                        D: {(e as any).foraExpediente.duvidas}
                                        {(e as any).foraExpediente.duvidas > 0 && (
                                          <button
                                            onClick={() => navigate(`/historico?empresa=${encodeURIComponent(e.nomeEmpresa)}&tipo=Dúvida`)}
                                            style={{
                                              background: "rgba(59, 130, 246, 0.15)",
                                              color: "#60a5fa",
                                              border: "1px solid rgba(59, 130, 246, 0.25)",
                                              borderRadius: "4px",
                                              padding: "1px 4px",
                                              cursor: "pointer",
                                              display: "inline-flex",
                                              alignItems: "center"
                                            }}
                                            title="Ver dúvidas"
                                          >
                                            <Eye size={10} />
                                          </button>
                                        )}
                                      </span>
                                      <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                                        P: {(e as any).foraExpediente.problemas}
                                        {(e as any).foraExpediente.problemas > 0 && (
                                          <button
                                            onClick={() => navigate(`/historico?empresa=${encodeURIComponent(e.nomeEmpresa)}&tipo=Problema`)}
                                            style={{
                                              background: "rgba(239, 68, 68, 0.15)",
                                              color: "#f87171",
                                              border: "1px solid rgba(239, 68, 68, 0.25)",
                                              borderRadius: "4px",
                                              padding: "1px 4px",
                                              cursor: "pointer",
                                              display: "inline-flex",
                                              alignItems: "center"
                                            }}
                                            title="Ver problemas"
                                          >
                                            <Eye size={10} />
                                          </button>
                                        )}
                                      </span>
                                    </div>
                                  </div>
                                </td>
                                <td style={{ textAlign: "center", fontWeight: 700, fontSize: "1rem" }}>
                                  {(e as any).totalContatos}
                                </td>
                              </>
                            ) : (
                              <>
                                <td>
                                  <span style={{ fontWeight: 600, color: e.progresso >= 100 ? "#10b981" : "#f59e0b" }}>
                                    {e.progresso}%
                                  </span>
                                </td>
                                <td>{e.dias} dias</td>
                              </>
                            )}
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
        </>
      ) : (
        <RelatorioScore />
      )}

    </div>
  );
};
