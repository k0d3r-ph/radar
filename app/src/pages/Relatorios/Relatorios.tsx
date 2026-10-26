import React, { useState, useEffect, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { LineChart } from "../../components/LineChart";
import {
  Download,
  Calendar,
  AlertCircle,
  Clock,
  PlayCircle,
  CheckCircle,
  ShieldAlert,
  Eye,
  GraduationCap,
  Star,
  Wrench,
  Cpu,
  TrendingUp,
  Play,
  Pause,
  PauseCircle,
} from "lucide-react";
import "../Historico/Historico.css";
import {
  listarEmpresas,
  salvarEmpresas,
  isEmpresaInterna,
} from "../../services/empresas";
import { listarOcorrencias } from "../../services/ocorrencias";
import {
  calcularDiasNaEsteira,
  calcularDiasCongeladosPorCheckpoint,
  calcularFarol,
  calcularProgressoPorFases,
  calcularTME,
  calcularTotalFases,
  obterUltimoTreinamento,
} from "../../utils/monitoramento";
import type { Empresa, Ocorrencia } from "../../types";
import type { StatusFarolType } from "../../utils/monitoramento";
import { formatarNome } from "../../utils/formatarNome";
import { estaDentroDoExpediente } from "../../utils/expediente";
import { obterInfoTipoOcorrencia } from "../../utils/empresaUtils";
import { filtrarEmpresasContatosSuporte, obterCategoriaContatoSuporte } from "../../utils/contatosSuporte";
import "./Relatorios.css";
import { RelatorioScore } from "../RelatorioScore/RelatorioScore";
import { RelatorioJornadaCliente } from "../RelatorioJornadaCliente/RelatorioJornadaCliente";
import { RelatorioAging } from "../RelatorioAging/RelatorioAging";
import { RelatorioIndicadoresTreinamento } from "../RelatorioIndicadoresTreinamento/RelatorioIndicadoresTreinamento";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { usePendenciasClock } from "../../hooks/usePendenciasClock";

// Carência aplicada antes de considerar um cliente "sem próximo passo definido"
// após o horário de um agendamento (mesma regra usada na Jornada do Cliente).
const CARENCIA_SEM_PROXIMO_PASSO_MS = 6 * 60 * 60 * 1000;

type DecorredEmpresa = Empresa & {
  alerta: boolean;
  tme: number | null;
  progresso: number;
  farol: StatusFarolType;
  dias: number;
};

const TIPO_CLASS: Record<string, string> = {
  Informativa: "tipo--informativa",
  Financeira: "tipo--financeira",
  Comercial: "tipo--comercial",
  Treinamento: "tipo--treinamento",
  Checkpoint: "tipo--checkpoint",
  "Mudança de score": "tipo--mudanca-score",
  Problema: "tipo--problema",
  Dúvida: "tipo--duvida",
  Solicitação: "tipo--solicitacao",
};

const DEPARTAMENTO_CLASS: Record<string, string> = {
  Treinamento: "departamento-treinamento",
  CS: "departamento-cs",
  Suporte: "departamento-suporte",
  Hardware: "departamento-hardware",
  Comercial: "departamento-comercial",
};

const DEPARTAMENTO_ICONES: Record<string, React.ReactNode> = {
  Treinamento: <GraduationCap size={14} />,
  CS: <Star size={14} />,
  Suporte: <Wrench size={14} />,
  Hardware: <Cpu size={14} />,
  Comercial: <TrendingUp size={14} />,
};

function getOcorrenciaTimestamp(o: Ocorrencia): number {
  if ((o.tipo === "Problema" || o.tipo === "Dúvida" || o.departamento === "Suporte") && o.dataOcorrencia && o.dataOcorrencia > 0) {
    return o.dataOcorrencia;
  }
  return o.createdAt ?? o.dataOcorrencia ?? 0;
}

function obterDataUmaSemanaAtras(dataStr: string): string {
  if (!dataStr) return "";
  const [y, m, d] = dataStr.split("-").map(Number);
  const data = new Date(y, m - 1, d);
  data.setDate(data.getDate() - 7);
  const year = data.getFullYear();
  const month = String(data.getMonth() + 1).padStart(2, "0");
  const day = String(data.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatarDataISO(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const Relatorios: React.FC = () => {
  const navigate = useNavigate();
  const { role } = useAuth();
  const [activeTab, setActiveTab] = useState<
    "esteira" | "score" | "jornada" | "executiva" | "aging" | "indicadores"
  >("esteira");

  useEffect(() => {
    if (role === "painel" && activeTab !== "esteira") {
      setActiveTab("esteira");
    }
  }, [role, activeTab]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const agoraPendencias = usePendenciasClock(empresas);
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
  const [numSemanasGrafico, setNumSemanasGrafico] = useState<number>(8);
  const [numDiasGrafico, setNumDiasGrafico] = useState<number>(30);
  const [granularidadeGrafico, setGranularidadeGrafico] = useState<"semana" | "dia">("semana");
  const [tiposVisiveisGrafico, setTiposVisiveisGrafico] = useState({
    duvidas: true,
    problemas: true,
    solicitacoes: true,
    semClassificacao: true,
  });
  const [clienteFiltroGrafico, setClienteFiltroGrafico] = useState<string>("");
  const [expedienteFiltroGrafico, setExpedienteFiltroGrafico] = useState<"ambos" | "dentro" | "fora">("ambos");
  // Switch (desativado por padrão): quando ativo, cada tipo (Dúvidas/Problemas/Solicitações)
  // ganha uma segunda linha com os mesmos totais registrados pelo Treinamento, para comparar.
  const [compararTreinamento, setCompararTreinamento] = useState<boolean>(false);
  const [dataComparacao, setDataComparacao] = useState<string>(() => {
    const today = new Date();
    today.setDate(today.getDate() - 7);
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  });
  const [ocorrenciaSelecionada, setOcorrenciaSelecionada] = useState<Ocorrencia | null>(null);
  const [isAutoplayActive, setIsAutoplayActive] = useState<boolean>(false);
  const [intervaloSegundos, setIntervaloSegundos] = useState<number>(30);
  const [autoplayTimer, setAutoplayTimer] = useState<number>(30);



  const carregarDados = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    try {
      const [empresasLista, ocorrenciasLista] = await Promise.all([
        listarEmpresas(),
        listarOcorrencias(),
      ]);
      setEmpresas(empresasLista.filter((e) => !isEmpresaInterna(e)));
      setOcorrencias(ocorrenciasLista);
    } catch (error) {
      console.error("Erro ao carregar dados:", error);
      toast.error("Erro ao carregar dados dos relatórios.");
    } finally {
      if (!silencioso) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAutoplayActive || activeTab !== "esteira") {
      setAutoplayTimer(intervaloSegundos);
      return;
    }

    const interval = setInterval(() => {
      if (autoplayTimer <= 1) {
        setKpiSelecionado((current) => (current + 1) % 6);
        setAutoplayTimer(intervaloSegundos);
      } else {
        setAutoplayTimer(autoplayTimer - 1);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isAutoplayActive, autoplayTimer, activeTab, intervaloSegundos]);

  // Recarrega os dados periodicamente enquanto o modo painel/TV está ativo,
  // numa cadência própria e fixa — o intervalo de rotação do KPI acima pode
  // ser configurado em poucos segundos (é só o carrossel visual), mas recarregar
  // dados nesse ritmo não teria efeito real (listarEmpresas/listarOcorrencias
  // já têm cache de 5 min) e só gera chamadas desnecessárias.
  const RECARGA_AUTOPLAY_MS = 5 * 60 * 1000;
  useEffect(() => {
    if (!isAutoplayActive || activeTab !== "esteira") return;
    const intervalId = setInterval(() => {
      carregarDados(true);
    }, RECARGA_AUTOPLAY_MS);
    return () => clearInterval(intervalId);
  }, [isAutoplayActive, activeTab, carregarDados]);

  useEffect(() => {
    setAutoplayTimer(intervaloSegundos);
  }, [kpiSelecionado, intervaloSegundos]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

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

  const dataInicioSemanaStr = useMemo(() => {
    return limitesSemana ? formatarDataISO(limitesSemana.inicio) : "";
  }, [limitesSemana]);

  const dataFimSemanaStr = useMemo(() => {
    return limitesSemana ? formatarDataISO(limitesSemana.fim) : "";
  }, [limitesSemana]);

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
        pendencia: empresa.pendencia,
        agora: agoraPendencias,
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
        dias: calcularDiasNaEsteira(
          empresa.dataEntrada,
          progresso,
          dataBase,
          empresa.dataFinalizacao,
          empresa.isSuspended,
          empresa.dataSuspensao,
          empresa.diasSuspensoAcumulado,
          calcularDiasCongeladosPorCheckpoint(ocorrencias, empresa.nomeEmpresa),
        ),
      };
    });
  }, [empresas, ocorrencias, agoraPendencias]);

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
      return !e.isOngoing && !e.isCancelled && dataEntradaDate && dataEntradaDate >= inicio && dataEntradaDate <= fim;
    });
  }, [dadosEmpresas, limitesSemana]);

  const concluidosNaSemana = useMemo(() => {
    if (!limitesSemana) return [];
    const { inicio, fim } = limitesSemana;
    return dadosEmpresas.filter((e) => {
      const dataFinalizacaoDate = parseDataLocal(e.dataFinalizacao || "");
      return (
        !e.isOngoing &&
        !e.isCancelled &&
        dataFinalizacaoDate &&
        dataFinalizacaoDate >= inicio &&
        dataFinalizacaoDate <= fim
      );
    });
  }, [dadosEmpresas, limitesSemana]);

  // Total, lista e gráfico compartilham a mesma carteira, inclusive no comparativo.
  const empresasContatosSuporte = useMemo(
    () => filtrarEmpresasContatosSuporte(dadosEmpresas),
    [dadosEmpresas],
  );
  const nomesEmpresasContatosSuporte = useMemo(
    () => new Set(empresasContatosSuporte.map((e) => e.nomeEmpresa.trim().toLowerCase())),
    [empresasContatosSuporte],
  );

  const contatosSuporte = useMemo(() => {
    if (!limitesSemana) return [];
    const { inicio, fim } = limitesSemana;
    const statsMap = new Map<
      string,
      {
        dentro: { duvidas: number; problemas: number; solicitacoes: number; semClassificacao: number; total: number };
        fora: { duvidas: number; problemas: number; solicitacoes: number; semClassificacao: number; total: number };
        total: number;
      }
    >();

    ocorrencias.forEach((o) => {
      if (o.departamento === "Suporte") {
        const categoria = obterCategoriaContatoSuporte(o);
        if (categoria) {
          const t = o.dataOcorrencia || o.createdAt || 0;
          if (t >= inicio.getTime() && t <= fim.getTime()) {
            const dateObj = new Date(t);
            const hour = dateObj.getHours();
            const day = dateObj.getDay();
            const isWeekend = day === 0 || day === 6;
            const isFora = isWeekend || hour >= 18 || hour < 9;

            const key = o.empresa.trim().toLowerCase();
            const stats = statsMap.get(key) || {
              dentro: { duvidas: 0, problemas: 0, solicitacoes: 0, semClassificacao: 0, total: 0 },
              fora: { duvidas: 0, problemas: 0, solicitacoes: 0, semClassificacao: 0, total: 0 },
              total: 0,
            };

            const alvo = isFora ? stats.fora : stats.dentro;
            alvo[categoria] += 1;
            alvo.total += 1;
            stats.total += 1;
            statsMap.set(key, stats);
          }
        }
      }
    });

    return empresasContatosSuporte
      .filter((e) => statsMap.has(e.nomeEmpresa.trim().toLowerCase()))
      .map((e) => {
        const stats = statsMap.get(e.nomeEmpresa.trim().toLowerCase())!;
        return {
          ...e,
          dentroExpediente: stats.dentro,
          foraExpediente: stats.fora,
          totalContatos: stats.total,
        };
      });
  }, [empresasContatosSuporte, ocorrencias, limitesSemana]);

  const semProximoPasso = useMemo(() => {
    if (!limitesSemana) return [];
    const fimTimestamp = limitesSemana.fim.getTime();
    const agora = Date.now();
    const limiteCorte = fimTimestamp > agora ? agora : fimTimestamp;
    // Só considera "sem próximo passo" após uma carência de 6h do horário agendado,
    // para não marcar o cliente como sem passo definido logo após o horário da agenda
    // (ex: agenda às 14:00 não deve virar "sem próximo passo" às 14:01, apenas às 20:00).
    const limiteCorteComCarencia = limiteCorte - CARENCIA_SEM_PROXIMO_PASSO_MS;

    return dadosEmpresas.filter((e) => {
      // 1. Deve ter entrado antes/durante a semana
      const entradaDate = parseDataLocal(e.dataEntrada);
      if (!entradaDate || entradaDate.getTime() > fimTimestamp) return false;

      // 2. Não deve ter sido finalizado até o fim da semana
      if (e.dataFinalizacao) {
        const finalizacaoDate = parseDataLocal(e.dataFinalizacao);
        if (finalizacaoDate && finalizacaoDate.getTime() <= fimTimestamp) return false;
      }

      // 3. Status live (ongoing/suspenso/concluído/cancelado) - Exclui suspensos que vão para o painel de CS
      if (e.isOngoing || e.isSuspended || e.isCancelled || e.progresso >= 100) return false;

      // 4. Sem agendamento futuro em relação ao limite de corte (com carência de 6h)
      const ocorrenciasDaEmpresa = ocorrencias.filter(
        (o) => o.empresa.trim().toLowerCase() === e.nomeEmpresa.trim().toLowerCase()
      );
      const temAgendamentoFuturo = ocorrenciasDaEmpresa.some(
        (o) =>
          (o.tipo === "Informativa" || o.tipo === "Treinamento" || o.tipo === "Checkpoint") &&
          o.dataOcorrencia &&
          o.dataOcorrencia > limiteCorteComCarencia
      );

      return !temAgendamentoFuturo;
    });
  }, [dadosEmpresas, ocorrencias, limitesSemana]);

  const semProximoPassoComparacao = useMemo(() => {
    if (!limitesSemanaComparacao) return [];
    const fimTimestamp = limitesSemanaComparacao.fim.getTime();
    const agora = Date.now();
    const limiteCorte = fimTimestamp > agora ? agora : fimTimestamp;
    const limiteCorteComCarencia = limiteCorte - CARENCIA_SEM_PROXIMO_PASSO_MS;

    return dadosEmpresas.filter((e) => {
      // 1. Deve ter entrado antes/durante a semana de comparação
      const entradaDate = parseDataLocal(e.dataEntrada);
      if (!entradaDate || entradaDate.getTime() > fimTimestamp) return false;

      // 2. Não deve ter sido finalizado até o fim da semana de comparação
      if (e.dataFinalizacao) {
        const finalizacaoDate = parseDataLocal(e.dataFinalizacao);
        if (finalizacaoDate && finalizacaoDate.getTime() <= fimTimestamp) return false;
      }

      // 3. Status live (ongoing/suspenso/concluído/cancelado) - Exclui suspensos
      if (e.isOngoing || e.isSuspended || e.isCancelled || e.progresso >= 100) return false;

      // 4. Sem agendamento futuro em relação ao limite de corte (com carência de 6h)
      const ocorrenciasDaEmpresa = ocorrencias.filter(
        (o) => o.empresa.trim().toLowerCase() === e.nomeEmpresa.trim().toLowerCase()
      );
      const temAgendamentoFuturo = ocorrenciasDaEmpresa.some(
        (o) =>
          (o.tipo === "Informativa" || o.tipo === "Treinamento" || o.tipo === "Checkpoint") &&
          o.dataOcorrencia &&
          o.dataOcorrencia > limiteCorteComCarencia
      );

      return !temAgendamentoFuturo;
    });
  }, [dadosEmpresas, ocorrencias, limitesSemanaComparacao]);

  const emAcompanhamentoCS = useMemo(() => {
    if (!limitesSemana) return [];
    const fimTimestamp = limitesSemana.fim.getTime();
    const agora = Date.now();
    const limiteCorte = fimTimestamp > agora ? agora : fimTimestamp;

    return dadosEmpresas.filter((e) => {
      // 1. Deve ter entrado antes/durante a semana
      const entradaDate = parseDataLocal(e.dataEntrada);
      if (!entradaDate || entradaDate.getTime() > fimTimestamp) return false;

      // 2. Não deve ter sido finalizado até o fim da semana
      if (e.dataFinalizacao) {
        const finalizacaoDate = parseDataLocal(e.dataFinalizacao);
        if (finalizacaoDate && finalizacaoDate.getTime() <= fimTimestamp) return false;
      }

      // 3. Deve ser suspenso e não cancelado
      if (!e.isSuspended || e.isCancelled) return false;
      if (e.isOngoing || e.progresso >= 100) return false;

      // 4. Sem agendamento futuro em relação ao limite de corte
      const ocorrenciasDaEmpresa = ocorrencias.filter(
        (o) => o.empresa.trim().toLowerCase() === e.nomeEmpresa.trim().toLowerCase()
      );
      const temAgendamentoFuturo = ocorrenciasDaEmpresa.some(
        (o) =>
          (o.tipo === "Informativa" || o.tipo === "Treinamento" || o.tipo === "Checkpoint") &&
          o.dataOcorrencia &&
          o.dataOcorrencia > limiteCorte
      );

      return !temAgendamentoFuturo;
    });
  }, [dadosEmpresas, ocorrencias, limitesSemana]);

  const emAcompanhamentoCSComparacao = useMemo(() => {
    if (!limitesSemanaComparacao) return [];
    const fimTimestamp = limitesSemanaComparacao.fim.getTime();
    const agora = Date.now();
    const limiteCorte = fimTimestamp > agora ? agora : fimTimestamp;

    return dadosEmpresas.filter((e) => {
      // 1. Deve ter entrado antes/durante a semana de comparação
      const entradaDate = parseDataLocal(e.dataEntrada);
      if (!entradaDate || entradaDate.getTime() > fimTimestamp) return false;

      // 2. Não deve ter sido finalizado até o fim da semana de comparação
      if (e.dataFinalizacao) {
        const finalizacaoDate = parseDataLocal(e.dataFinalizacao);
        if (finalizacaoDate && finalizacaoDate.getTime() <= fimTimestamp) return false;
      }

      // 3. Deve ser suspenso e não cancelado
      if (!e.isSuspended || e.isCancelled) return false;
      if (e.isOngoing || e.progresso >= 100) return false;

      // 4. Sem agendamento futuro em relação ao limite de corte
      const ocorrenciasDaEmpresa = ocorrencias.filter(
        (o) => o.empresa.trim().toLowerCase() === e.nomeEmpresa.trim().toLowerCase()
      );
      const temAgendamentoFuturo = ocorrenciasDaEmpresa.some(
        (o) =>
          (o.tipo === "Informativa" || o.tipo === "Treinamento" || o.tipo === "Checkpoint") &&
          o.dataOcorrencia &&
          o.dataOcorrencia > limiteCorte
      );

      return !temAgendamentoFuturo;
    });
  }, [dadosEmpresas, ocorrencias, limitesSemanaComparacao]);

  const acimaDoPrazo = useMemo(() => {
    if (!limitesSemana) return [];
    const fimTimestamp = limitesSemana.fim.getTime();
    const agora = Date.now();
    const limiteCorte = fimTimestamp > agora ? agora : fimTimestamp;

    return dadosEmpresas.filter((e) => {
      // 1. Deve ter entrado antes/durante a semana
      const entradaDate = parseDataLocal(e.dataEntrada);
      if (!entradaDate || entradaDate.getTime() > fimTimestamp) return false;

      // 2. Não deve ter sido finalizado até o fim da semana
      if (e.dataFinalizacao) {
        const finalizacaoDate = parseDataLocal(e.dataFinalizacao);
        if (finalizacaoDate && finalizacaoDate.getTime() <= fimTimestamp) return false;
      }

      // 3. Status live (ongoing/suspenso/concluído/cancelado)
      if (e.isOngoing || e.isCancelled || e.progresso >= 100) return false;

      // 4. Calcular dias na esteira até a data de referência/corte
      const diasNaSemana = Math.floor((limiteCorte - entradaDate.getTime()) / (1000 * 60 * 60 * 24));
      return diasNaSemana > 60;
    });
  }, [dadosEmpresas, limitesSemana]);

  const acimaDoPrazoComparacao = useMemo(() => {
    if (!limitesSemanaComparacao) return [];
    const fimTimestamp = limitesSemanaComparacao.fim.getTime();
    const agora = Date.now();
    const limiteCorte = fimTimestamp > agora ? agora : fimTimestamp;

    return dadosEmpresas.filter((e) => {
      // 1. Deve ter entrado antes/durante a semana de comparação
      const entradaDate = parseDataLocal(e.dataEntrada);
      if (!entradaDate || entradaDate.getTime() > fimTimestamp) return false;

      // 2. Não deve ter sido finalizado até o fim da semana de comparação
      if (e.dataFinalizacao) {
        const finalizacaoDate = parseDataLocal(e.dataFinalizacao);
        if (finalizacaoDate && finalizacaoDate.getTime() <= fimTimestamp) return false;
      }

      // 3. Status live (ongoing/suspenso/concluído/cancelado)
      if (e.isOngoing || e.isCancelled || e.progresso >= 100) return false;

      // 4. Calcular dias na esteira até a data de referência/corte de comparação
      const diasNaSemana = Math.floor((limiteCorte - entradaDate.getTime()) / (1000 * 60 * 60 * 24));
      return diasNaSemana > 60;
    });
  }, [dadosEmpresas, limitesSemanaComparacao]);

  const riscoChurn = useMemo(() => {
    if (!limitesSemana) return [];
    const { fim } = limitesSemana;

    return dadosEmpresas
      .filter((e) => {
        const ocorrenciasAlertaDaEmpresa = ocorrencias.filter(
          (o) =>
            o.empresa.trim().toLowerCase() === e.nomeEmpresa.trim().toLowerCase() &&
            (o.alerta === true || o.retirarAlerta === true)
        );

        const ultimaOcorrenciaAlertaNaSemana = ocorrenciasAlertaDaEmpresa
          .filter((o) => (o.dataOcorrencia || o.createdAt || 0) <= fim.getTime())
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
          if (ocorrenciasAlertaDaEmpresa.length > 0) {
            temAlertaNaSemana = false;
          } else {
            temAlertaNaSemana = !!e.alerta;
          }
        }

        return !e.isOngoing && !e.isCancelled && temAlertaNaSemana;
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



  const entraramNaSemanaComparacao = useMemo(() => {
    if (!limitesSemanaComparacao) return [];
    const { inicio, fim } = limitesSemanaComparacao;
    return dadosEmpresas.filter((e) => {
      const dataEntradaDate = parseDataLocal(e.dataEntrada);
      return !e.isOngoing && !e.isCancelled && dataEntradaDate && dataEntradaDate >= inicio && dataEntradaDate <= fim;
    });
  }, [dadosEmpresas, limitesSemanaComparacao]);

  const concluidosNaSemanaComparacao = useMemo(() => {
    if (!limitesSemanaComparacao) return [];
    const { inicio, fim } = limitesSemanaComparacao;
    return dadosEmpresas.filter((e) => {
      const dataFinalizacaoDate = parseDataLocal(e.dataFinalizacao || "");
      return (
        !e.isOngoing &&
        !e.isCancelled &&
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
        dentro: { duvidas: number; problemas: number; solicitacoes: number; semClassificacao: number; total: number };
        fora: { duvidas: number; problemas: number; solicitacoes: number; semClassificacao: number; total: number };
        total: number;
      }
    >();

    ocorrencias.forEach((o) => {
      if (o.departamento === "Suporte") {
        const categoria = obterCategoriaContatoSuporte(o);
        if (categoria) {
          const t = o.dataOcorrencia || o.createdAt || 0;
          if (t >= inicio.getTime() && t <= fim.getTime()) {
            const dateObj = new Date(t);
            const hour = dateObj.getHours();
            const day = dateObj.getDay();
            const isWeekend = day === 0 || day === 6;
            const isFora = isWeekend || hour >= 18 || hour < 9;

            const key = o.empresa.trim().toLowerCase();
            const stats = statsMap.get(key) || {
              dentro: { duvidas: 0, problemas: 0, solicitacoes: 0, semClassificacao: 0, total: 0 },
              fora: { duvidas: 0, problemas: 0, solicitacoes: 0, semClassificacao: 0, total: 0 },
              total: 0,
            };

            const alvo = isFora ? stats.fora : stats.dentro;
            alvo[categoria] += 1;
            alvo.total += 1;
            stats.total += 1;
            statsMap.set(key, stats);
          }
        }
      }
    });

    return empresasContatosSuporte
      .filter((e) => statsMap.has(e.nomeEmpresa.trim().toLowerCase()))
      .map((e) => {
        const stats = statsMap.get(e.nomeEmpresa.trim().toLowerCase())!;
        return {
          ...e,
          dentroExpediente: stats.dentro,
          foraExpediente: stats.fora,
          totalContatos: stats.total,
        };
      });
  }, [empresasContatosSuporte, ocorrencias, limitesSemanaComparacao]);

  const riscoChurnComparacao = useMemo(() => {
    if (!limitesSemanaComparacao) return [];
    const { fim } = limitesSemanaComparacao;

    return dadosEmpresas
      .filter((e) => {
        const ocorrenciasAlertaDaEmpresa = ocorrencias.filter(
          (o) =>
            o.empresa.trim().toLowerCase() === e.nomeEmpresa.trim().toLowerCase() &&
            (o.alerta === true || o.retirarAlerta === true)
        );

        const ultimaOcorrenciaAlertaNaSemana = ocorrenciasAlertaDaEmpresa
          .filter((o) => (o.dataOcorrencia || o.createdAt || 0) <= fim.getTime())
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
          if (ocorrenciasAlertaDaEmpresa.length > 0) {
            temAlertaNaSemana = false;
          } else {
            temAlertaNaSemana = !!e.alerta;
          }
        }

        return !e.isOngoing && !e.isCancelled && temAlertaNaSemana;
      });
  }, [dadosEmpresas, ocorrencias, limitesSemanaComparacao]);

  const totalContatosSuporte = useMemo(() => {
    return contatosSuporte.reduce((acc, curr) => acc + (curr as any).totalContatos, 0);
  }, [contatosSuporte]);

  const totalContatosSuporteComp = useMemo(() => {
    return contatosSuporteComparacao.reduce((acc, curr) => acc + (curr as any).totalContatos, 0);
  }, [contatosSuporteComparacao]);

  const totalDuvidas = useMemo(() => {
    return contatosSuporte.reduce((acc, curr) => acc + (curr as any).dentroExpediente.duvidas + (curr as any).foraExpediente.duvidas, 0);
  }, [contatosSuporte]);

  const totalDuvidasComp = useMemo(() => {
    return contatosSuporteComparacao.reduce((acc, curr) => acc + (curr as any).dentroExpediente.duvidas + (curr as any).foraExpediente.duvidas, 0);
  }, [contatosSuporteComparacao]);

  const totalProblemas = useMemo(() => {
    return contatosSuporte.reduce((acc, curr) => acc + (curr as any).dentroExpediente.problemas + (curr as any).foraExpediente.problemas, 0);
  }, [contatosSuporte]);

  const totalProblemasComp = useMemo(() => {
    return contatosSuporteComparacao.reduce((acc, curr) => acc + (curr as any).dentroExpediente.problemas + (curr as any).foraExpediente.problemas, 0);
  }, [contatosSuporteComparacao]);

  const totalSolicitacoes = useMemo(() => {
    return contatosSuporte.reduce((acc, curr) => acc + (curr as any).dentroExpediente.solicitacoes + (curr as any).foraExpediente.solicitacoes, 0);
  }, [contatosSuporte]);

  const totalSolicitacoesComp = useMemo(() => {
    return contatosSuporteComparacao.reduce((acc, curr) => acc + (curr as any).dentroExpediente.solicitacoes + (curr as any).foraExpediente.solicitacoes, 0);
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

  // Evolução semanal ou diária do volume de dúvidas, problemas e solicitações (período configurável)
  const evolucaoSuporte = useMemo(() => {
    if (!limitesSemana)
      return {
        categorias: [] as string[],
        duvidasSuporte: [] as number[],
        duvidasTreinamento: [] as number[],
        problemasSuporte: [] as number[],
        problemasTreinamento: [] as number[],
        solicitacoesSuporte: [] as number[],
        solicitacoesTreinamento: [] as number[],
        semClassificacaoSuporte: [] as number[],
        semClassificacaoTreinamento: [] as number[],
      };

    const periodos: { inicio: Date; fim: Date }[] = [];
    if (granularidadeGrafico === "dia") {
      // Termina no fim da semana selecionada, sem avançar além de hoje (evita dias futuros zerados)
      const fimHoje = new Date();
      fimHoje.setHours(23, 59, 59, 999);
      const ultimoDia = limitesSemana.fim.getTime() < fimHoje.getTime() ? new Date(limitesSemana.fim) : fimHoje;
      for (let i = numDiasGrafico - 1; i >= 0; i--) {
        const inicio = new Date(ultimoDia);
        inicio.setDate(inicio.getDate() - i);
        inicio.setHours(0, 0, 0, 0);
        const fim = new Date(inicio);
        fim.setHours(23, 59, 59, 999);
        periodos.push({ inicio, fim });
      }
    } else {
      for (let i = numSemanasGrafico - 1; i >= 0; i--) {
        const inicio = new Date(limitesSemana.inicio);
        inicio.setDate(inicio.getDate() - i * 7);
        const fim = new Date(inicio);
        fim.setDate(inicio.getDate() + 6);
        fim.setHours(23, 59, 59, 999);
        periodos.push({ inicio, fim });
      }
    }

    const categorias = periodos.map((p) => p.inicio.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }));
    // Cada tipo é contado separadamente por departamento, para comparar se os
    // contatos de dúvidas/problemas/solicitações com o Suporte estão maiores
    // do que os mesmos tipos registrados pelo Treinamento.
    const duvidasSuporte = new Array(periodos.length).fill(0);
    const duvidasTreinamento = new Array(periodos.length).fill(0);
    const problemasSuporte = new Array(periodos.length).fill(0);
    const problemasTreinamento = new Array(periodos.length).fill(0);
    const solicitacoesSuporte = new Array(periodos.length).fill(0);
    const solicitacoesTreinamento = new Array(periodos.length).fill(0);
    const semClassificacaoSuporte = new Array(periodos.length).fill(0);
    const semClassificacaoTreinamento = new Array(periodos.length).fill(0);

    const clienteFiltro = clienteFiltroGrafico.trim().toLowerCase();

    ocorrencias.forEach((o) => {
      const eSuporte = o.departamento === "Suporte";
      const eTreinamento = o.departamento === "Treinamento";
      if (!eSuporte && !eTreinamento) return;
      if (!nomesEmpresasContatosSuporte.has((o.empresa || "").trim().toLowerCase())) return;
      if (clienteFiltro && !(o.empresa || "").trim().toLowerCase().includes(clienteFiltro)) return;

      const categoria = obterCategoriaContatoSuporte(o);
      if (!categoria) return;

      const t = o.dataOcorrencia || o.createdAt || 0;
      if (
        expedienteFiltroGrafico !== "ambos" &&
        estaDentroDoExpediente(t) !== (expedienteFiltroGrafico === "dentro")
      ) return;
      const idx = periodos.findIndex((p) => t >= p.inicio.getTime() && t <= p.fim.getTime());
      if (idx === -1) return;

      if (categoria === "duvidas") {
        if (eSuporte) duvidasSuporte[idx] += 1;
        else duvidasTreinamento[idx] += 1;
      } else if (categoria === "problemas") {
        if (eSuporte) problemasSuporte[idx] += 1;
        else problemasTreinamento[idx] += 1;
      } else if (categoria === "solicitacoes") {
        if (eSuporte) solicitacoesSuporte[idx] += 1;
        else solicitacoesTreinamento[idx] += 1;
      } else {
        if (eSuporte) semClassificacaoSuporte[idx] += 1;
        else semClassificacaoTreinamento[idx] += 1;
      }
    });

    return {
      categorias,
      duvidasSuporte,
      duvidasTreinamento,
      problemasSuporte,
      problemasTreinamento,
      solicitacoesSuporte,
      solicitacoesTreinamento,
      semClassificacaoSuporte,
      semClassificacaoTreinamento,
    };
  }, [ocorrencias, nomesEmpresasContatosSuporte, limitesSemana, granularidadeGrafico, numSemanasGrafico, numDiasGrafico, clienteFiltroGrafico, expedienteFiltroGrafico]);

  const seriesGraficoSuporte = useMemo(() => {
    const todas = [
      {
        chave: "duvidas" as const,
        label: "Dúvidas",
        corSuporte: "#3b82f6",
        corTreinamento: "#93c5fd",
        valuesSuporte: evolucaoSuporte.duvidasSuporte,
        valuesTreinamento: evolucaoSuporte.duvidasTreinamento,
      },
      {
        chave: "problemas" as const,
        label: "Problemas",
        corSuporte: "#ef4444",
        corTreinamento: "#fca5a5",
        valuesSuporte: evolucaoSuporte.problemasSuporte,
        valuesTreinamento: evolucaoSuporte.problemasTreinamento,
      },
      {
        chave: "solicitacoes" as const,
        label: "Solicitações",
        corSuporte: "#10b981",
        corTreinamento: "#6ee7b7",
        valuesSuporte: evolucaoSuporte.solicitacoesSuporte,
        valuesTreinamento: evolucaoSuporte.solicitacoesTreinamento,
      },
      {
        chave: "semClassificacao" as const,
        label: "Sem classificação",
        corSuporte: "#94a3b8",
        corTreinamento: "#cbd5e1",
        valuesSuporte: evolucaoSuporte.semClassificacaoSuporte,
        valuesTreinamento: evolucaoSuporte.semClassificacaoTreinamento,
      },
    ];

    const series: { chave: string; label: string; color: string; values: number[] }[] = [];
    todas
      .filter((tipo) => tiposVisiveisGrafico[tipo.chave])
      .forEach((tipo) => {
        series.push({
          chave: `${tipo.chave}-suporte`,
          label: compararTreinamento ? `${tipo.label} (Suporte)` : tipo.label,
          color: tipo.corSuporte,
          values: tipo.valuesSuporte,
        });
        if (compararTreinamento) {
          series.push({
            chave: `${tipo.chave}-treinamento`,
            label: `${tipo.label} (Treinamento)`,
            color: tipo.corTreinamento,
            values: tipo.valuesTreinamento,
          });
        }
      });
    return series;
  }, [evolucaoSuporte, tiposVisiveisGrafico, compararTreinamento]);

  const tituloGraficoSuporte = useMemo(() => {
    const nomes = (
      [
        { chave: "duvidas" as const, label: "dúvidas" },
        { chave: "problemas" as const, label: "problemas" },
        { chave: "solicitacoes" as const, label: "solicitações" },
        { chave: "semClassificacao" as const, label: "contatos sem classificação" },
      ]
    )
      .filter((tipo) => tiposVisiveisGrafico[tipo.chave])
      .map((tipo) => tipo.label);
    const listaTipos =
      nomes.length <= 1 ? nomes.join("") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
    const sufixoComparacao = compararTreinamento ? " — Suporte vs. Treinamento" : "";
    const sufixoExpediente = expedienteFiltroGrafico === "ambos"
      ? ""
      : expedienteFiltroGrafico === "dentro" ? " — Dentro do expediente" : " — Fora do expediente";
    const base = `Evolução ${granularidadeGrafico === "dia" ? "diária" : "semanal"} de ${listaTipos}${sufixoComparacao}${sufixoExpediente}`;
    return clienteFiltroGrafico ? `${base} — ${clienteFiltroGrafico}` : base;
  }, [tiposVisiveisGrafico, compararTreinamento, granularidadeGrafico, clienteFiltroGrafico, expedienteFiltroGrafico]);

  // Lista de clientes com contato de suporte ou treinamento registrado (para o filtro do gráfico)
  const clientesComContatoSuporte = useMemo(() => {
    const nomes = new Set<string>();
    ocorrencias.forEach((o) => {
      if ((o.departamento === "Suporte" || o.departamento === "Treinamento") && o.empresa &&
        nomesEmpresasContatosSuporte.has(o.empresa.trim().toLowerCase())) {
        nomes.add(o.empresa.trim());
      }
    });
    return Array.from(nomes).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [ocorrencias, nomesEmpresasContatosSuporte]);

  const formatarDiferenca = (atual: number, anterior: number, menorEhMelhor = false) => {
    if (anterior === 0) {
      if (atual === 0) return { texto: "0%", classe: "diff-neutral", diff: 0 };
      const texto = `+${atual} (novos)`;
      const classe = menorEhMelhor ? "diff-negative" : "diff-positive";
      return { texto, classe, diff: 100 };
    }
    const diff = ((atual - anterior) / anterior) * 100;
    const sinal = diff > 0 ? "+" : "";
    const texto = `${sinal}${diff.toFixed(0)}%`;
    let classe = "diff-neutral";
    if (diff > 0) {
      classe = menorEhMelhor ? "diff-negative" : "diff-positive";
    } else if (diff < 0) {
      classe = menorEhMelhor ? "diff-positive" : "diff-negative";
    }
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
      desc: `Dúvidas: ${totalDuvidas} | Problemas: ${totalProblemas} | Solicitações: ${totalSolicitacoes}`,
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
      ehSazonal: true,
    },
    {
      titulo: "Em acompanhamento com CS",
      valor: emAcompanhamentoCS.length,
      desc: "Suspensos temporariamente",
      icone: <PauseCircle size={22} color="#f59e0b" />,
      lista: emAcompanhamentoCS,
      ehSazonal: true,
    },
    {
      titulo: "Acima do prazo",
      valor: acimaDoPrazo.length,
      desc: "Onboarding > 60d",
      icone: <AlertCircle size={22} color="#f59e0b" />,
      lista: acimaDoPrazo,
      ehSazonal: true,
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
      const pctTotal = formatarDiferenca(totalContatosSuporte, totalContatosSuporteComp, true);
      const pctDuvidas = formatarDiferenca(totalDuvidas, totalDuvidasComp, true);
      const pctProblemas = formatarDiferenca(totalProblemas, totalProblemasComp, true);
      const pctSolicitacoes = formatarDiferenca(totalSolicitacoes, totalSolicitacoesComp, true);
      const pctDentro = formatarDiferenca(dentroExpedienteTotal, dentroExpedienteTotalComp, true);
      const pctFora = formatarDiferenca(foraExpedienteTotal, foraExpedienteTotalComp, true);

      const entrouComp = entraramNaSemanaComparacao.length;
      const pctEntrou = formatarDiferenca(entraramNaSemana.length, entrouComp);

      const concluiuComp = concluidosNaSemanaComparacao.length;
      const pctConcluiu = formatarDiferenca(concluidosNaSemana.length, concluiuComp);

      const churnComp = riscoChurnComparacao.length;
      const pctChurn = formatarDiferenca(riscoChurn.length, churnComp, true);

      const semPassoComp = semProximoPassoComparacao.length;
      const pctSemPasso = formatarDiferenca(semProximoPasso.length, semPassoComp, true);

      const emAcompCSComp = emAcompanhamentoCSComparacao.length;
      const pctEmAcompCS = formatarDiferenca(emAcompanhamentoCS.length, emAcompCSComp, true);

      const acimaPrazoComp = acimaDoPrazoComparacao.length;
      const pctAcimaPrazo = formatarDiferenca(acimaDoPrazo.length, acimaPrazoComp, true);

      comparacaoStr = `
==================================================
COMPARATIVO COM A SEMANA DE: ${limitesSemanaComparacao.inicio.toLocaleDateString("pt-BR")} a ${limitesSemanaComparacao.fim.toLocaleDateString("pt-BR")}
==================================================
1. Entraram na esteira: ${entraramNaSemana.length} vs ${entrouComp} (${pctEntrou.texto})
2. Concluíram a esteira: ${concluidosNaSemana.length} vs ${concluiuComp} (${pctConcluiu.texto})
3. Sem próximo passo: ${semProximoPasso.length} vs ${semPassoComp} (${pctSemPasso.texto})
4. Em acompanhamento com CS: ${emAcompanhamentoCS.length} vs ${emAcompCSComp} (${pctEmAcompCS.texto})
5. Acima do prazo: ${acimaDoPrazo.length} vs ${acimaPrazoComp} (${pctAcimaPrazo.texto})
6. Risco de Churn: ${riscoChurn.length} vs ${churnComp} (${pctChurn.texto})

CONTATOS COM SUPORTE:
- Total: ${totalContatosSuporte} vs ${totalContatosSuporteComp} (${pctTotal.texto})
- Dúvidas: ${totalDuvidas} vs ${totalDuvidasComp} (${pctDuvidas.texto})
- Problemas: ${totalProblemas} vs ${totalProblemasComp} (${pctProblemas.texto})
- Solicitações: ${totalSolicitacoes} vs ${totalSolicitacoesComp} (${pctSolicitacoes.texto})
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
3. Contatos com suporte (atendimento Suporte): ${totalContatosSuporte} (Dúvidas: ${totalDuvidas}, Problemas: ${totalProblemas}, Solicitações: ${totalSolicitacoes})
4. Clientes sem próximo passo (farol vermelho): ${semProximoPasso.length}
5. Clientes em acompanhamento com CS (suspensos): ${emAcompanhamentoCS.length}
6. Clientes acima do prazo de onboarding (> 60 dias): ${acimaDoPrazo.length}
7. Casos com risco de churn (Clientes em Alerta): ${riscoChurn.length}

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
3. CONTATOS COM SUPORTE (${totalContatosSuporte} - Dúvidas: ${totalDuvidas}, Problemas: ${totalProblemas}, Solicitações: ${totalSolicitacoes})
${contatosSuporte.length > 0
        ? contatosSuporte
          .map(
            (e) =>
              ` - ${e.nomeEmpresa}\n   Treinador: ${formatarNome(e.responsavel) || "-"}\n   CS: ${formatarNome(e.csResponsavel) || "-"}\n   Dentro do Expediente: ${(e as any).dentroExpediente.total} (Dúvidas: ${(e as any).dentroExpediente.duvidas}, Problemas: ${(e as any).dentroExpediente.problemas}, Solicitações: ${(e as any).dentroExpediente.solicitacoes}, Sem classificação: ${(e as any).dentroExpediente.semClassificacao})\n   Fora do Expediente: ${(e as any).foraExpediente.total} (Dúvidas: ${(e as any).foraExpediente.duvidas}, Problemas: ${(e as any).foraExpediente.problemas}, Solicitações: ${(e as any).foraExpediente.solicitacoes}, Sem classificação: ${(e as any).foraExpediente.semClassificacao})\n   Total de Contatos: ${(e as any).totalContatos}\n   Valor do Contrato: ${e.valorContrato !== undefined ? `R$ ${e.valorContrato.toFixed(2)}` : "—"}\n`
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
5. CLIENTES EM ACOMPANHAMENTO COM CS (${emAcompanhamentoCS.length})
${emAcompanhamentoCS.length > 0
        ? emAcompanhamentoCS
          .map(
            (e) =>
              ` - ${e.nomeEmpresa}\n   Treinador: ${formatarNome(e.responsavel) || "-"}\n   CS: ${formatarNome(e.csResponsavel) || "-"}\n   Progresso: ${e.progresso}%\n   Valor do Contrato: ${e.valorContrato !== undefined ? `R$ ${e.valorContrato.toFixed(2)}` : "—"}\n`
          )
          .join("\n")
        : " - Nenhum cliente suspenso nesta semana.\n"
      }
6. CLIENTES ACIMA DO PRAZO DE ONBOARDING (> 60 dias) (${acimaDoPrazo.length})
${acimaDoPrazo.length > 0
        ? acimaDoPrazo
          .map(
            (e) =>
              ` - ${e.nomeEmpresa}\n   Treinador: ${formatarNome(e.responsavel) || "-"}\n   CS: ${formatarNome(e.csResponsavel) || "-"}\n   Data de Entrada: ${e.dataEntrada || "-"}\n   Dias na Esteira: ${e.dias} dias\n   Valor do Contrato: ${e.valorContrato !== undefined ? `R$ ${e.valorContrato.toFixed(2)}` : "—"}\n`
          )
          .join("\n")
        : " - Nenhum cliente acima do prazo de 60 dias.\n"
      }
7. CASOS COM RISCO DE CHURN (Clientes em Alerta) (${riscoChurn.length})
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

  // Filtra a lista do KPI selecionado pelo mesmo filtro de cliente usado no gráfico
  // de evolução de dúvidas/problemas/solicitações (kpiSelecionado === 2).
  const listaTabelaFiltrada = useMemo(() => {
    if (kpiSelecionado !== 2) return selectedKpi.lista;
    const termo = clienteFiltroGrafico.trim().toLowerCase();
    if (!termo) return selectedKpi.lista;
    return selectedKpi.lista.filter((e) =>
      e.nomeEmpresa.trim().toLowerCase().includes(termo)
    );
  }, [selectedKpi, kpiSelecionado, clienteFiltroGrafico]);

  return (
    <div className="relatorios-page">
      <div className="relatorios-glow"></div>

      <header className="relatorios-header">
        <h1>
          {activeTab === "esteira"
            ? "Visão Geral"
            : activeTab === "jornada"
              ? "Jornada do Cliente"
              : activeTab === "executiva"
                ? "Visão Executiva"
                : activeTab === "aging"
                  ? "Aging da Esteira"
                  : activeTab === "indicadores"
                    ? "Indicadores de Treinamento"
                    : "Relatório Geral de Scores"}
        </h1>
        <p>
          {activeTab === "esteira"
            ? "Indicadores consolidados sobre o andamento e status das implantações dos clientes."
            : activeTab === "jornada"
              ? "Acompanhamento do progresso, etapas de treinamento e checkpoints de capacitação dos clientes."
              : activeTab === "executiva"
                ? "Panorama consolidado para tomada de decisão estratégica."
                : activeTab === "aging"
                  ? "Tempo de permanência dos clientes na esteira de capacitação, por faixa de dias e treinador."
                  : activeTab === "indicadores"
                    ? "KPIs de treinamentos, CSAT, suporte e carteira de clientes, por treinador, dia ou semana."
                    : "Estatísticas consolidadas e listagem de clientes baseadas no último cálculo de score."}
        </p>
      </header>

      {/* Sub-abas de Navegação */}
      <div className="relatorios-tabs">
        <button
          className={`relatorios-tab-btn ${activeTab === "esteira" ? "active" : ""}`}
          onClick={() => setActiveTab("esteira")}
        >
          Visão Geral
        </button>
        {role !== "painel" && (
          <>
            <button
              className={`relatorios-tab-btn ${activeTab === "score" ? "active" : ""}`}
              onClick={() => setActiveTab("score")}
            >
              Scores dos Clientes
            </button>
            <button
              className={`relatorios-tab-btn ${activeTab === "jornada" ? "active" : ""}`}
              onClick={() => setActiveTab("jornada")}
            >
              Jornada do Cliente
            </button>
            <button
              className={`relatorios-tab-btn ${activeTab === "executiva" ? "active" : ""}`}
              onClick={() => setActiveTab("executiva")}
            >
              Visão Executiva
            </button>
            <button
              className={`relatorios-tab-btn ${activeTab === "aging" ? "active" : ""}`}
              onClick={() => setActiveTab("aging")}
            >
              Aging da Esteira
            </button>
            <button
              className={`relatorios-tab-btn ${activeTab === "indicadores" ? "active" : ""}`}
              onClick={() => setActiveTab("indicadores")}
            >
              Indicadores de Treinamento
            </button>
          </>
        )}
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
                  const novaData = e.target.value;
                  setDataReferencia(novaData);
                  setDataComparacao(obterDataUmaSemanaAtras(novaData));
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

            <div className="autoplay-controls">
              <button
                type="button"
                className={`btn-autoplay ${isAutoplayActive ? "active" : ""}`}
                onClick={() => setIsAutoplayActive(!isAutoplayActive)}
                title={isAutoplayActive ? "Pausar rotação automática" : "Iniciar rotação automática"}
              >
                {isAutoplayActive ? (
                  <>
                    <Pause size={14} />
                    <span>Autoplay Ativo</span>
                    <span className="autoplay-timer-badge">{autoplayTimer}s</span>
                  </>
                ) : (
                  <>
                    <Play size={14} />
                    <span>Autoplay</span>
                  </>
                )}
              </button>

              <div className="autoplay-interval-wrapper">
                <label htmlFor="autoplay-interval">Intervalo:</label>
                <input
                  id="autoplay-interval"
                  type="number"
                  min={5}
                  max={300}
                  value={intervaloSegundos}
                  onChange={(e) => {
                    const val = Math.max(5, parseInt(e.target.value) || 5);
                    setIntervaloSegundos(val);
                  }}
                  title="Intervalo de rotação em segundos (mínimo 5s)"
                />
                <span className="unit">s</span>
              </div>
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
                    else if (idx === 3) valorComp = semProximoPassoComparacao.length;
                    else if (idx === 4) valorComp = emAcompanhamentoCSComparacao.length;
                    else if (idx === 5) valorComp = acimaDoPrazoComparacao.length;
                    else if (idx === 6) valorComp = riscoChurnComparacao.length;

                    const menorEhMelhor = idx === 2 || idx === 3 || idx === 4 || idx === 5 || idx === 6;
                    diffResult = formatarDiferenca(kpi.valor, valorComp, menorEhMelhor);
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

              {kpiSelecionado === 2 && (
                <div className="line-chart-filtro-semanas">
                  <label htmlFor="granularidade-grafico">Visualizar por:</label>
                  <select
                    id="granularidade-grafico"
                    value={granularidadeGrafico}
                    onChange={(e) => setGranularidadeGrafico(e.target.value as "semana" | "dia")}
                  >
                    <option value="semana">Semana</option>
                    <option value="dia">Dia</option>
                  </select>
                  <label htmlFor="num-semanas-grafico">Período do gráfico:</label>
                  {granularidadeGrafico === "semana" ? (
                    <select
                      id="num-semanas-grafico"
                      value={numSemanasGrafico}
                      onChange={(e) => setNumSemanasGrafico(Number(e.target.value))}
                    >
                      <option value={4}>Últimas 4 semanas</option>
                      <option value={8}>Últimas 8 semanas</option>
                      <option value={12}>Últimas 12 semanas</option>
                      <option value={16}>Últimas 16 semanas</option>
                      <option value={26}>Últimas 26 semanas</option>
                      <option value={52}>Últimas 52 semanas</option>
                    </select>
                  ) : (
                    <select
                      id="num-semanas-grafico"
                      value={numDiasGrafico}
                      onChange={(e) => setNumDiasGrafico(Number(e.target.value))}
                    >
                      <option value={7}>Últimos 7 dias</option>
                      <option value={14}>Últimos 14 dias</option>
                      <option value={30}>Últimos 30 dias</option>
                      <option value={60}>Últimos 60 dias</option>
                      <option value={90}>Últimos 90 dias</option>
                    </select>
                  )}
                  <label htmlFor="expediente-filtro-grafico">Expediente:</label>
                  <select
                    id="expediente-filtro-grafico"
                    value={expedienteFiltroGrafico}
                    onChange={(e) => setExpedienteFiltroGrafico(e.target.value as "ambos" | "dentro" | "fora")}
                    title="Expediente: segunda a sexta, das 09h às 18h"
                  >
                    <option value="ambos">Ambos</option>
                    <option value="dentro">Dentro do expediente</option>
                    <option value="fora">Fora do expediente</option>
                  </select>
                  <label htmlFor="cliente-filtro-grafico">Cliente:</label>
                  <input
                    id="cliente-filtro-grafico"
                    type="text"
                    list="clientes-filtro-grafico-lista"
                    placeholder="Pesquisar cliente..."
                    value={clienteFiltroGrafico}
                    onChange={(e) => setClienteFiltroGrafico(e.target.value)}
                  />
                  <datalist id="clientes-filtro-grafico-lista">
                    {clientesComContatoSuporte.map((nome) => (
                      <option key={nome} value={nome} />
                    ))}
                  </datalist>
                  <div className="line-chart-filtro-tipos">
                    {(
                      [
                        { chave: "duvidas", label: "Dúvidas", color: "#3b82f6" },
                        { chave: "problemas", label: "Problemas", color: "#ef4444" },
                        { chave: "solicitacoes", label: "Solicitações", color: "#10b981" },
                        { chave: "semClassificacao", label: "Sem classificação", color: "#94a3b8" },
                      ] as const
                    ).map((tipo) => {
                      const marcado = tiposVisiveisGrafico[tipo.chave];
                      // Não deixa desmarcar o último tipo visível (o gráfico ficaria vazio)
                      const ultimoMarcado =
                        marcado && Object.values(tiposVisiveisGrafico).filter(Boolean).length === 1;
                      return (
                        <label key={tipo.chave} className="line-chart-filtro-tipo">
                          <input
                            type="checkbox"
                            checked={marcado}
                            disabled={ultimoMarcado}
                            style={{ accentColor: tipo.color }}
                            onChange={(e) =>
                              setTiposVisiveisGrafico((prev) => ({ ...prev, [tipo.chave]: e.target.checked }))
                            }
                          />
                          {tipo.label}
                        </label>
                      );
                    })}
                  </div>

                  <div className="line-chart-filtro-switches">
                    <label
                      className="relatorio-switch-label"
                      title="Quando ativo, cada tipo marcado acima ganha uma segunda linha comparando com os mesmos contatos registrados pelo Treinamento."
                    >
                      <span>Comparar com Treinamento</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={compararTreinamento}
                        className={`relatorio-switch ${compararTreinamento ? "relatorio-switch--ativo" : ""}`}
                        onClick={() => setCompararTreinamento((prev) => !prev)}
                      >
                        <span className="relatorio-switch-bolinha" />
                      </button>
                    </label>
                  </div>
                </div>
              )}

              {kpiSelecionado === 2 && (
                <LineChart
                  title={tituloGraficoSuporte}
                  categorias={evolucaoSuporte.categorias}
                  series={seriesGraficoSuporte}
                />
              )}

              {/* Section de detalhamento */}
              <div className="relatorio-detalhe-section">
                <div className="relatorio-detalhe-header">
                  <h3>
                    📋 {selectedKpi.titulo} {kpiSelecionado === 2 ? `(Total: ${totalContatosSuporte} | Dúvidas: ${totalDuvidas} | Problemas: ${totalProblemas} | Solicitações: ${totalSolicitacoes})` : `(${selectedKpi.valor})`}
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
                        const pctTotalResult = formatarDiferenca(totalContatosSuporte, totalContatosSuporteComp, true);
                        const pctDuvidasResult = formatarDiferenca(totalDuvidas, totalDuvidasComp, true);
                        const pctProblemasResult = formatarDiferenca(totalProblemas, totalProblemasComp, true);
                        const pctSolicitacoesResult = formatarDiferenca(totalSolicitacoes, totalSolicitacoesComp, true);
                        const pctDentroResult = formatarDiferenca(dentroExpedienteTotal, dentroExpedienteTotalComp, true);
                        const pctForaResult = formatarDiferenca(foraExpedienteTotal, foraExpedienteTotalComp, true);

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
                              <span className="comp-item-label">Total de Dúvidas</span>
                              <div className="comp-item-values">
                                <span className="comp-val-atual">{totalDuvidas}</span>
                                <span className="comp-val-separator">vs</span>
                                <span className="comp-val-anterior">{totalDuvidasComp}</span>
                              </div>
                              <span className={`comp-item-pct ${pctDuvidasResult.classe}`}>
                                {pctDuvidasResult.texto} {pctDuvidasResult.diff > 0 ? "a mais" : pctDuvidasResult.diff < 0 ? "a menos" : "sem alteração"}
                              </span>
                            </div>

                            <div className="comparacao-card-item">
                              <span className="comp-item-label">Total de Problemas</span>
                              <div className="comp-item-values">
                                <span className="comp-val-atual">{totalProblemas}</span>
                                <span className="comp-val-separator">vs</span>
                                <span className="comp-val-anterior">{totalProblemasComp}</span>
                              </div>
                              <span className={`comp-item-pct ${pctProblemasResult.classe}`}>
                                {pctProblemasResult.texto} {pctProblemasResult.diff > 0 ? "a mais" : pctProblemasResult.diff < 0 ? "a menos" : "sem alteração"}
                              </span>
                            </div>

                            <div className="comparacao-card-item">
                              <span className="comp-item-label">Total de Solicitações</span>
                              <div className="comp-item-values">
                                <span className="comp-val-atual">{totalSolicitacoes}</span>
                                <span className="comp-val-separator">vs</span>
                                <span className="comp-val-anterior">{totalSolicitacoesComp}</span>
                              </div>
                              <span className={`comp-item-pct ${pctSolicitacoesResult.classe}`}>
                                {pctSolicitacoesResult.texto} {pctSolicitacoesResult.diff > 0 ? "a mais" : pctSolicitacoesResult.diff < 0 ? "a menos" : "sem alteração"}
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
                  {listaTabelaFiltrada.length > 0 ? (
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
                        {listaTabelaFiltrada.map((e) => (
                          <tr key={e.id}>
                            <td style={{ fontWeight: 600 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                <span>{e.nomeEmpresa}</span>
                                {e.alerta && (e as any).ocorrenciaAlertaId && (
                                  <button
                                    className="relatorio-alert-badge"
                                    onClick={() => {
                                      const oc = ocorrencias.find((o) => o.id === (e as any).ocorrenciaAlertaId);
                                      if (oc) {
                                        setOcorrenciaSelecionada(oc);
                                      } else {
                                        toast.error("Ocorrência não encontrada.");
                                      }
                                    }}
                                    title="Clique para ver a ocorrência de alerta"
                                    style={{
                                      background: "rgba(239, 68, 68, 0.2)",
                                      color: "var(--lt-texto-f87171, #f87171)",
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
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", fontSize: "0.75rem", color: "var(--lt-texto-a1a1aa, #a1a1aa)" }}>
                                      {(e as any).dentroExpediente.semClassificacao > 0 && (
                                        <button
                                          className="btn-secondary btn-small"
                                          title="Revisar contatos sem classificação"
                                          onClick={() => navigate(`/historico?empresa=${encodeURIComponent(e.nomeEmpresa)}&tipo=__sem_classificacao__&depto=Suporte&dataInicio=${dataInicioSemanaStr}&dataFim=${dataFimSemanaStr}&expediente=dentro`)}
                                        >
                                          Sem classificação: {(e as any).dentroExpediente.semClassificacao}
                                        </button>
                                      )}
                                      <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                                        D: {(e as any).dentroExpediente.duvidas}
                                        {(e as any).dentroExpediente.duvidas > 0 && (
                                          <button
                                            onClick={() => navigate(`/historico?empresa=${encodeURIComponent(e.nomeEmpresa)}&tipo=Dúvida&dataInicio=${dataInicioSemanaStr}&dataFim=${dataFimSemanaStr}&expediente=dentro`)}
                                            style={{
                                              background: "rgba(59, 130, 246, 0.15)",
                                              color: "var(--lt-texto-60a5fa, #60a5fa)",
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
                                            onClick={() => navigate(`/historico?empresa=${encodeURIComponent(e.nomeEmpresa)}&tipo=Problema&dataInicio=${dataInicioSemanaStr}&dataFim=${dataFimSemanaStr}&expediente=dentro`)}
                                            style={{
                                              background: "rgba(239, 68, 68, 0.15)",
                                              color: "var(--lt-texto-f87171, #f87171)",
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
                                      <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                                        S: {(e as any).dentroExpediente.solicitacoes}
                                        {(e as any).dentroExpediente.solicitacoes > 0 && (
                                          <button
                                            onClick={() => navigate(`/historico?empresa=${encodeURIComponent(e.nomeEmpresa)}&tipo=Solicitação&dataInicio=${dataInicioSemanaStr}&dataFim=${dataFimSemanaStr}&expediente=dentro`)}
                                            style={{
                                              background: "rgba(16, 185, 129, 0.15)",
                                              color: "var(--lt-texto-34d399, #34d399)",
                                              border: "1px solid rgba(16, 185, 129, 0.25)",
                                              borderRadius: "4px",
                                              padding: "1px 4px",
                                              cursor: "pointer",
                                              display: "inline-flex",
                                              alignItems: "center"
                                            }}
                                            title="Ver solicitações"
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
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", fontSize: "0.75rem", color: "var(--lt-texto-a1a1aa, #a1a1aa)" }}>
                                      {(e as any).foraExpediente.semClassificacao > 0 && (
                                        <button
                                          className="btn-secondary btn-small"
                                          title="Revisar contatos sem classificação"
                                          onClick={() => navigate(`/historico?empresa=${encodeURIComponent(e.nomeEmpresa)}&tipo=__sem_classificacao__&depto=Suporte&dataInicio=${dataInicioSemanaStr}&dataFim=${dataFimSemanaStr}&expediente=fora`)}
                                        >
                                          Sem classificação: {(e as any).foraExpediente.semClassificacao}
                                        </button>
                                      )}
                                      <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                                        D: {(e as any).foraExpediente.duvidas}
                                        {(e as any).foraExpediente.duvidas > 0 && (
                                          <button
                                            onClick={() => navigate(`/historico?empresa=${encodeURIComponent(e.nomeEmpresa)}&tipo=Dúvida&dataInicio=${dataInicioSemanaStr}&dataFim=${dataFimSemanaStr}&expediente=fora`)}
                                            style={{
                                              background: "rgba(59, 130, 246, 0.15)",
                                              color: "var(--lt-texto-60a5fa, #60a5fa)",
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
                                            onClick={() => navigate(`/historico?empresa=${encodeURIComponent(e.nomeEmpresa)}&tipo=Problema&dataInicio=${dataInicioSemanaStr}&dataFim=${dataFimSemanaStr}&expediente=fora`)}
                                            style={{
                                              background: "rgba(239, 68, 68, 0.15)",
                                              color: "var(--lt-texto-f87171, #f87171)",
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
                                      <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                                        S: {(e as any).foraExpediente.solicitacoes}
                                        {(e as any).foraExpediente.solicitacoes > 0 && (
                                          <button
                                            onClick={() => navigate(`/historico?empresa=${encodeURIComponent(e.nomeEmpresa)}&tipo=Solicitação&dataInicio=${dataInicioSemanaStr}&dataFim=${dataFimSemanaStr}&expediente=fora`)}
                                            style={{
                                              background: "rgba(16, 185, 129, 0.15)",
                                              color: "var(--lt-texto-34d399, #34d399)",
                                              border: "1px solid rgba(16, 185, 129, 0.25)",
                                              borderRadius: "4px",
                                              padding: "1px 4px",
                                              cursor: "pointer",
                                              display: "inline-flex",
                                              alignItems: "center"
                                            }}
                                            title="Ver solicitações"
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
                                  <span style={{ fontWeight: 600, color: e.progresso >= 100 ? "var(--lt-texto-10b981, #10b981)" : "var(--lt-texto-f59e0b, #f59e0b)" }}>
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
                      <p>
                        {kpiSelecionado === 2 && clienteFiltroGrafico.trim()
                          ? "Nenhum cliente encontrado para essa busca."
                          : "Nenhum cliente atende aos critérios deste indicador nesta semana."}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      ) : activeTab === "score" ? (
        <RelatorioScore />
      ) : activeTab === "executiva" ? (
        <div className="relatorio-empty">
          <span className="relatorio-empty-icon">📊</span>
          <p>Visão Executiva em construção.</p>
        </div>
      ) : activeTab === "aging" ? (
        <RelatorioAging />
      ) : activeTab === "indicadores" ? (
        <RelatorioIndicadoresTreinamento />
      ) : (
        <RelatorioJornadaCliente empresas={empresas} ocorrencias={ocorrencias} />
      )}

      {ocorrenciaSelecionada && (
        <div className="hist-detail-overlay">
          <div className="hist-detail-card">
            <div className="hist-detail-header">
              <h2>Detalhes da interação {ocorrenciaSelecionada.idSeqFormatted ? `(${ocorrenciaSelecionada.idSeqFormatted})` : ""}</h2>
              <button onClick={() => setOcorrenciaSelecionada(null)}>✕</button>
            </div>

            <div className="hist-detail-grid">
              {(() => {
                if (ocorrenciaSelecionada.alerta) {
                  if (ocorrenciaSelecionada.alertaResolvidoPorId) {
                    const resDoc = ocorrencias.find((o) => o.id === ocorrenciaSelecionada.alertaResolvidoPorId);
                    return (
                      <div style={{ gridColumn: "span 2", marginBottom: "10px" }}>
                        <span style={{ color: "var(--lt-texto-16a34a, #16a34a)", fontWeight: "bold", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                          ✅🚨 Alerta Solucionado {resDoc ? `em ${new Date(getOcorrenciaTimestamp(resDoc)).toLocaleDateString("pt-BR")}` : ""}.
                          {resDoc && (
                            <button
                              style={{
                                textDecoration: "underline",
                                color: "#2563eb",
                                background: "none",
                                border: "none",
                                padding: 0,
                                cursor: "pointer",
                                fontWeight: "bold",
                                fontSize: "0.85rem",
                                marginLeft: "5px",
                              }}
                              onClick={() => setOcorrenciaSelecionada(resDoc)}
                            >
                              Ver ocorrência de resolução
                            </button>
                          )}
                        </span>
                      </div>
                    );
                  } else {
                    return (
                      <div style={{ gridColumn: "span 2", marginBottom: "10px" }}>
                        <span style={{ color: "#dc2626", fontWeight: "bold", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "6px" }}>
                          🚨 Ocorrência marcada como Alerta Ativo
                        </span>
                      </div>
                    );
                  }
                }
                if (ocorrenciaSelecionada.retirarAlerta) {
                  const origDoc = ocorrencias.find((o) => o.id === ocorrenciaSelecionada.alertaOriginalId);
                  return (
                    <div style={{ gridColumn: "span 2", marginBottom: "10px" }}>
                      <span style={{ color: "var(--lt-texto-16a34a, #16a34a)", fontWeight: "bold", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        ✅ Ocorrência marcada como Resolução de Alerta.
                        {origDoc && (
                          <span style={{ color: "#475569", display: "flex", alignItems: "center", gap: "5px", flexWrap: "wrap" }}>
                            Resolução do alerta criado em {new Date(getOcorrenciaTimestamp(origDoc)).toLocaleDateString("pt-BR")}.
                            <button
                              style={{
                                textDecoration: "underline",
                                color: "#2563eb",
                                background: "none",
                                border: "none",
                                padding: 0,
                                cursor: "pointer",
                                fontWeight: "bold",
                                fontSize: "0.85rem",
                              }}
                              onClick={() => setOcorrenciaSelecionada(origDoc)}
                            >
                              Ver ocorrência do alerta original
                            </button>
                          </span>
                        )}
                      </span>
                    </div>
                  );
                }
                return null;
              })()}

              <div>
                <span>Empresa</span>
                <strong>{ocorrenciaSelecionada.empresa}</strong>
              </div>

              <div>
                <span>Departamento</span>
                <strong style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <span className={`hist-item-departamento ${DEPARTAMENTO_CLASS[ocorrenciaSelecionada.departamento ?? ""] || ""}`}>
                    {ocorrenciaSelecionada.departamento && DEPARTAMENTO_ICONES[ocorrenciaSelecionada.departamento] && (
                      <span className="departamento-icon">
                        {DEPARTAMENTO_ICONES[ocorrenciaSelecionada.departamento]}
                      </span>
                    )}
                    {ocorrenciaSelecionada.departamento || "—"}
                  </span>
                </strong>
              </div>

              <div>
                <span>Tipo</span>
                {(() => {
                  const tipoInfo = obterInfoTipoOcorrencia(ocorrenciaSelecionada);
                  return (
                    <strong className={`hist-item-tipo hist-item-tipo-detail ${tipoInfo.className}`}>
                      {tipoInfo.label}
                    </strong>
                  );
                })()}
              </div>

              <div>
                <span>Responsável</span>
                <strong>{formatarNome(ocorrenciaSelecionada.responsavel) || "—"}</strong>
              </div>

              <div>
                <span>Data da ocorrência</span>
                <strong>
                  {new Date(getOcorrenciaTimestamp(ocorrenciaSelecionada)).toLocaleDateString("pt-BR")}{" "}
                  {new Date(getOcorrenciaTimestamp(ocorrenciaSelecionada)).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </strong>
              </div>

              {ocorrenciaSelecionada.createdAt && ocorrenciaSelecionada.dataOcorrencia > 0 && ocorrenciaSelecionada.tipo !== "Problema" && ocorrenciaSelecionada.tipo !== "Dúvida" && ocorrenciaSelecionada.departamento !== "Suporte" && (
                <div>
                  <span>
                    {ocorrenciaSelecionada.tipo === "Informativa" || ocorrenciaSelecionada.tipo === "Treinamento"
                      ? "Data do próximo treinamento"
                      : ocorrenciaSelecionada.tipo === "Checkpoint"
                        ? "Data do checkpoint"
                        : "Data do agendamento"}
                  </span>
                  <strong>
                    {new Date(ocorrenciaSelecionada.dataOcorrencia).toLocaleDateString("pt-BR")}{" "}
                    {new Date(ocorrenciaSelecionada.dataOcorrencia).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </strong>
                </div>
              )}

              {ocorrenciaSelecionada.tipo === "Treinamento" && (
                <>
                  {ocorrenciaSelecionada.treinamentoDataSolicitacao && (
                    <div>
                      <span>Data de solicitação</span>
                      <strong>
                        {(() => {
                          if (ocorrenciaSelecionada.treinamentoDataSolicitacao.includes("-")) {
                            const [y, m, d] = ocorrenciaSelecionada.treinamentoDataSolicitacao.split("-");
                            return `${d}/${m}/${y}`;
                          }
                          return ocorrenciaSelecionada.treinamentoDataSolicitacao;
                        })()}
                      </strong>
                    </div>
                  )}
                  {ocorrenciaSelecionada.treinamentoTempoAgenda && (
                    <div>
                      <span>Tempo de agenda</span>
                      <strong>{ocorrenciaSelecionada.treinamentoTempoAgenda}</strong>
                    </div>
                  )}
                  {ocorrenciaSelecionada.treinamentoSolicitante && (
                    <div>
                      <span>Solicitante</span>
                      <strong>{ocorrenciaSelecionada.treinamentoSolicitante}</strong>
                    </div>
                  )}
                  {ocorrenciaSelecionada.treinamentoResultados && ocorrenciaSelecionada.treinamentoResultados.length > 0 && (
                    <div style={{ gridColumn: "span 2", alignItems: "flex-start", textAlign: "left" }}>
                      <span style={{ textAlign: "left" }}>Resultado do CSAT</span>
                      <div style={{ display: "flex", flexDirection: "row", gap: "8px", alignItems: "center", justifyContent: "flex-start", marginTop: "4px", flexWrap: "wrap", width: "100%" }}>
                        {ocorrenciaSelecionada.treinamentoResultados.map((resultado, idx) => (
                          <span
                            key={idx}
                            style={{
                              background: resultado === "Bom" ? "#ecfdf5" : "#fef2f2",
                              border: resultado === "Bom" ? "1px solid #a7f3d0" : "1px solid #fecaca",
                              color: resultado === "Bom" ? "#065f46" : "#991b1b",
                              padding: "4px 8px",
                              borderRadius: "6px",
                              fontSize: "0.85rem",
                              fontWeight: "600"
                            }}
                          >
                            {resultado}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {ocorrenciaSelecionada.treinamentoNotas && ocorrenciaSelecionada.treinamentoNotas.length > 0 && (
                    <div style={{ gridColumn: "span 2", alignItems: "flex-start", textAlign: "left" }}>
                      <span style={{ textAlign: "left" }}>Notas do Treinamento (CSAT, modelo antigo)</span>
                      <div style={{ display: "flex", flexDirection: "row", gap: "8px", alignItems: "center", justifyContent: "flex-start", marginTop: "4px", flexWrap: "wrap", width: "100%" }}>
                        {ocorrenciaSelecionada.treinamentoNotas.map((nota, idx) => (
                          <span
                            key={idx}
                            style={{
                              background: "#f1f5f9",
                              border: "1px solid #cbd5e1",
                              color: "#334155",
                              padding: "4px 8px",
                              borderRadius: "6px",
                              fontSize: "0.85rem",
                              fontWeight: "600"
                            }}
                          >
                            Nota {idx + 1}: {nota}
                          </span>
                        ))}
                        {ocorrenciaSelecionada.treinamentoNotaMedia !== undefined && ocorrenciaSelecionada.treinamentoNotaMedia !== null && (
                          <span
                            style={{
                              background: "#ecfdf5",
                              border: "1px solid #a7f3d0",
                              color: "#065f46",
                              padding: "4px 8px",
                              borderRadius: "6px",
                              fontSize: "0.85rem",
                              fontWeight: "700"
                            }}
                          >
                            Média: {ocorrenciaSelecionada.treinamentoNotaMedia}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              {ocorrenciaSelecionada.temaOcorrencia && ocorrenciaSelecionada.temaOcorrencia.length > 0 && (
                <div className="hist-detail-desc">
                  <span>Temas abordados</span>
                  <div className="temas-selecionados">
                    {ocorrenciaSelecionada.temaOcorrencia.map((tema) => (
                      <span
                        key={tema}
                        className={`tema-tag ${["Ausente", "Cancelado"].includes(tema) ? "tema-tag-alerta" : ""}`}
                      >
                        {tema}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="hist-detail-desc" style={{ marginTop: "16px" }}>
              <span>Descrição</span>
              <p style={{ whiteSpace: "pre-wrap" }}>
                {ocorrenciaSelecionada.descricao}
              </p>
            </div>

            {ocorrenciaSelecionada.atualizacoes && ocorrenciaSelecionada.atualizacoes.length > 0 && (
              <div className="hist-atualizacoes" style={{ marginTop: "20px" }}>
                {ocorrenciaSelecionada.atualizacoes.map((at, i) => (
                  <div key={i} className="hist-atualizacao-item">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span className="hist-atualizacao-meta">
                        Atualização em{" "}
                        {new Date(at.updatedAt).toLocaleDateString("pt-BR")}{" "}
                        {new Date(at.updatedAt).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {at.responsavel ? ` · ${formatarNome(at.responsavel)}` : ""}
                      </span>
                    </div>
                    <p style={{ whiteSpace: "pre-wrap", marginTop: "4px" }}>{at.descricao}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="botoes" style={{ marginTop: "24px", display: "flex", gap: "8px" }}>

              <button className="btn-secondary btn-small" onClick={() => setOcorrenciaSelecionada(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
