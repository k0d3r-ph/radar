import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Calendar,
  Clock,
  AlertCircle,
  CheckCircle,
  PlayCircle,
  Search,
  Building,
  GraduationCap,
  Sparkles,
  User,
  Activity,
  Flame,
  UserCheck,
  Award,
  Info,
  FileText,
  Star,
  XCircle,
  UserX
} from "lucide-react";
import type { Empresa, Ocorrencia } from "../../types";
import { formatarNome } from "../../utils/formatarNome";
import "./RelatorioJornadaCliente.css";

interface RelatorioJornadaClienteProps {
  empresas: Empresa[];
  ocorrencias: Ocorrencia[];
}

interface StageInterval {
  stage: "Em treinamento" | "Checkpoint" | "Sem próximo passo definido" | "Finalizado";
  startDate: Date;
  endDate: Date;
  days: number;
  slaBreached: boolean;
  active: boolean;
  ocorrencia?: Ocorrencia;
  ocorrenciaFinalizadora?: Ocorrencia;
}

export const RelatorioJornadaCliente: React.FC<RelatorioJornadaClienteProps> = ({
  empresas,
  ocorrencias,
}) => {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [manualStageIndex, setManualStageIndex] = useState<number | null>(null);

  // Auxiliar para converter "yyyy-mm-dd" em Date
  const parseDataLocal = (dataStr: string): Date | null => {
    if (!dataStr) return null;
    const parts = dataStr.split("-").map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  };

  // Formata o período de permanência de forma resumida para a régua
  const formatarPeriodoResumido = (start: Date, end: Date, active: boolean, isFinalizado: boolean, stage: string) => {
    const formatDayMonth = (d: Date) => {
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      return `${day}/${month}`;
    };

    const startStr = formatDayMonth(start);
    // Para etapas ativas "Sem próximo passo definido", o término continua indefinido ("Andamento")
    if (active && !isFinalizado && stage === "Sem próximo passo definido") {
      return `${startStr} - Andamento`;
    }
    const endStr = formatDayMonth(end);
    if (startStr === endStr) {
      return startStr;
    }
    return `${startStr} a ${endStr}`;
  };

  // Verifica se a etapa de treinamento foi cancelada ou marcada como ausente
  const obterStatusTreinamento = (item: StageInterval): "cancelado" | "ausente" | "agendado" | "realizado" => {
    if (item.stage !== "Em treinamento") return "realizado";
    
    const contemTema = (oc: Ocorrencia | undefined, termo: string) => {
      return oc?.temaOcorrencia?.some(t => t.trim().toLowerCase() === termo.toLowerCase()) ?? false;
    };

    const isCancelado = contemTema(item.ocorrencia, "cancelado") || contemTema(item.ocorrenciaFinalizadora, "cancelado");
    const isAusente = contemTema(item.ocorrencia, "ausente") || contemTema(item.ocorrenciaFinalizadora, "ausente");

    if (isCancelado) return "cancelado";
    if (isAusente) return "ausente";
    if (item.ocorrenciaFinalizadora) return "realizado";
    return "agendado";
  };

  // 1. Calcula a jornada de um cliente específico
  const calcularJornada = (empresa: Empresa): StageInterval[] => {
    const startJourney = parseDataLocal(empresa.dataEntrada);
    if (!startJourney) return [];

    const startJourneyTime = startJourney.getTime();
    const endJourneyDate = empresa.dataFinalizacao ? parseDataLocal(empresa.dataFinalizacao) : null;
    
    // Define o fim da jornada analisada. Se a esteira estiver aberta, a data limite deve cobrir agendamentos futuros.
    let endJourneyTime = endJourneyDate ? endJourneyDate.getTime() : Date.now();
    if (!endJourneyDate) {
      const maxScheduled = ocorrencias
        .filter((o) => o.empresa.trim().toLowerCase() === empresa.nomeEmpresa.trim().toLowerCase())
        .reduce((max, o) => Math.max(max, o.dataOcorrencia || 0), 0);
      if (maxScheduled > endJourneyTime) {
        endJourneyTime = maxScheduled;
      }
    }

    // Filtra ocorrências da empresa de tipos relevantes
    const relevantOcs = ocorrencias
      .filter(
        (o) =>
          o.empresa.trim().toLowerCase() === empresa.nomeEmpresa.trim().toLowerCase() &&
          ["Treinamento", "Informativa", "Checkpoint"].includes(o.tipo)
      )
      .map((o) => {
        const createdAt = o.createdAt ?? o.dataOcorrencia ?? 0;
        const dataOcorrencia = o.dataOcorrencia ?? 0;
        return {
          ...o,
          createdAtTime: createdAt,
          dataOcorrenciaTime: dataOcorrencia,
        };
      })
      // Filtra com data de criação válida e ignora ocorrências Informativas sem agendamento definido
      .filter((o) => {
        if (o.createdAtTime <= 0) return false;
        if (o.tipo === "Informativa" && o.dataOcorrenciaTime <= 0) return false;
        return true;
      })
      // Ordena por criação
      .sort((a, b) => a.createdAtTime - b.createdAtTime);

    const stages: StageInterval[] = [];
    let currentTime = startJourneyTime;

    for (let i = 0; i < relevantOcs.length; i++) {
      const oc = relevantOcs[i];
      const creationTime = oc.createdAtTime;
      const scheduledTime = oc.dataOcorrenciaTime;

      // Se a ocorrência foi gerada após o fim da jornada, encerra a análise
      if (creationTime > endJourneyTime) {
        break;
      }

      // Se houver um gap entre currentTime e a criação da ocorrência, o cliente ficou sem próximo passo definido
      if (creationTime > currentTime) {
        const diffMs = creationTime - currentTime;
        // Só considera gap real se tiver durado pelo menos 24 horas (evita registrar gaps para reagendamentos rápidos de poucas horas)
        if (diffMs >= 24 * 60 * 60 * 1000) {
          const days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
          stages.push({
            stage: "Sem próximo passo definido",
            startDate: new Date(currentTime),
            endDate: new Date(creationTime),
            days,
            slaBreached: diffMs > 4 * 24 * 60 * 60 * 1000, // SLA de 4 dias
            active: false,
            ocorrenciaFinalizadora: oc,
          });
        }
        currentTime = creationTime;
      }

      // Determina o tipo de etapa
      let stageType: "Em treinamento" | "Checkpoint" | "Sem próximo passo definido";
      if (oc.tipo === "Checkpoint") {
        stageType = "Checkpoint";
      } else {
        // Treinamento ou Informativa
        if (scheduledTime > 0) {
          stageType = "Em treinamento";
        } else {
          // Se não há agendamento válido definido, ignora a transição e segue na etapa atual
          continue;
        }
      }

      // A etapa encerra no agendamento por padrão
      let stageEndTime = scheduledTime;
      let ocorrenciaFinalizadora: Ocorrencia | undefined = undefined;

      // Procura na lista subsequente qual ocorrência encerra esta etapa
      for (let j = i + 1; j < relevantOcs.length; j++) {
        const nextOc = relevantOcs[j];

        // Caso A: Se for um Treinamento sem data de agendamento (conclusão do treinamento)
        if (nextOc.tipo === "Treinamento" && nextOc.dataOcorrenciaTime <= 0) {
          stageEndTime = nextOc.createdAtTime;
          ocorrenciaFinalizadora = nextOc;
          break;
        }

        // Caso B: Se for uma nova ocorrência que inicia outra etapa (Checkpoint ou Treinamento/Informativa com agendamento)
        // Se ela foi criada antes da data prevista de término da etapa atual, ela corta a etapa atual!
        const isNewStageTrigger = nextOc.tipo === "Checkpoint" || nextOc.dataOcorrenciaTime > 0;
        if (isNewStageTrigger) {
          if (nextOc.createdAtTime < stageEndTime) {
            stageEndTime = nextOc.createdAtTime;
          }
          break;
        }
      }

      // Limita pelo fim da jornada do cliente
      if (stageEndTime > endJourneyTime) {
        stageEndTime = endJourneyTime;
      }

      if (stageEndTime >= currentTime) {
        const diffMs = stageEndTime - currentTime;
        const days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
        stages.push({
          stage: stageType,
          startDate: new Date(currentTime),
          endDate: new Date(stageEndTime),
          days,
          slaBreached: false,
          active: false,
          ocorrencia: oc,
          ocorrenciaFinalizadora,
        });
        currentTime = stageEndTime;
      }
    }

    // Se após processar todas as ocorrências ainda não chegamos ao fim da jornada
    if (currentTime < endJourneyTime) {
      const diffMs = endJourneyTime - currentTime;
      const days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      stages.push({
        stage: "Sem próximo passo definido",
        startDate: new Date(currentTime),
        endDate: new Date(endJourneyTime),
        days,
        slaBreached: diffMs > 4 * 24 * 60 * 60 * 1000,
        active: false,
      });
      currentTime = endJourneyTime;
    }

    // Mescla etapas consecutivas do mesmo tipo (por exemplo, Em treinamento seguido de Em treinamento em caso de reagendamento)
    const mergedStages: StageInterval[] = [];
    for (const current of stages) {
      if (mergedStages.length === 0) {
        mergedStages.push(current);
      } else {
        const last = mergedStages[mergedStages.length - 1];
        
        // Regra de Negócio: Só mescla etapas consecutivas do mesmo tipo se elas terminarem no MESMO dia (como reagendamentos no mesmo dia).
        // Se forem agendadas para dias diferentes, devem ficar individualizadas na régua para histórico de agendamentos.
        const lastEndDay = last.endDate.toLocaleDateString("pt-BR");
        const currentEndDay = current.endDate.toLocaleDateString("pt-BR");
        const isSameDay = lastEndDay === currentEndDay;

        if (last.stage === current.stage && isSameDay) {
          // Mescla as etapas estendendo a data final da primeira
          last.endDate = current.endDate;
          const diffMs = last.endDate.getTime() - last.startDate.getTime();
          last.days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
          if (last.stage === "Sem próximo passo definido") {
            last.slaBreached = diffMs > 4 * 24 * 60 * 60 * 1000;
          }
          last.active = last.active || current.active;
          // Atualiza as ocorrências vinculadas para a mais recente
          if (current.ocorrencia) {
            last.ocorrencia = current.ocorrencia;
          }
          if (current.ocorrenciaFinalizadora) {
            last.ocorrenciaFinalizadora = current.ocorrenciaFinalizadora;
          }
        } else {
          mergedStages.push(current);
        }
      }
    }

    // Se o cliente tem data de finalização, adiciona a etapa Finalizado
    if (endJourneyDate) {
      mergedStages.push({
        stage: "Finalizado",
        startDate: endJourneyDate,
        endDate: endJourneyDate,
        days: 0,
        slaBreached: false,
        active: false,
      });
    }

    // Marca a última etapa como ativa se o cliente ainda estiver em aberto (sem dataFinalizacao)
    if (!empresa.dataFinalizacao && mergedStages.length > 0) {
      mergedStages[mergedStages.length - 1].active = true;
    }

    return mergedStages;
  };

  // 2. Filtra e processa os dados de todas as empresas para a visão consolidada
  const dadosGeraisClientes = useMemo(() => {
    return empresas
      .filter((emp) => !emp.isOngoing)
      .map((emp) => {
      const jornada = calcularJornada(emp);
      const isFinalizado = !!emp.dataFinalizacao;
      const currentStageObj = jornada.find((s) => s.active) || (isFinalizado ? jornada[jornada.length - 1] : null);

      let slaEstouradoAtual = false;
      let diasNaEtapaAtual = 0;

      if (currentStageObj) {
        diasNaEtapaAtual = currentStageObj.days;
        if (currentStageObj.stage === "Sem próximo passo definido" && !isFinalizado) {
          // Se está atualmente sem próximo passo e a duração até hoje é > 4 dias
          const startJourneyTime = currentStageObj.startDate.getTime();
          const tempoSemPasso = Date.now() - startJourneyTime;
          slaEstouradoAtual = tempoSemPasso > 4 * 24 * 60 * 60 * 1000;
          diasNaEtapaAtual = Math.max(0, Math.floor(tempoSemPasso / (1000 * 60 * 60 * 24)));
        }
      }

      // Conta o total de estouros de SLA na jornada inteira
      const totalEstourosSLA = jornada.filter((s) => s.stage === "Sem próximo passo definido" && s.slaBreached).length;

      return {
        ...emp,
        jornada,
        etapaAtual: currentStageObj ? currentStageObj.stage : "Sem informações",
        diasNaEtapaAtual,
        slaEstouradoAtual,
        totalEstourosSLA,
        isFinalizado,
      };
    });
  }, [empresas, ocorrencias]);

  // 3. Clientes ativos (esteira em aberto)
  const clientesAtivos = useMemo(() => {
    return dadosGeraisClientes.filter((c) => !c.isFinalizado && !c.isOngoing);
  }, [dadosGeraisClientes]);

  // 4. Contagem de KPIs
  const kpiTotalAtivos = clientesAtivos.length;

  const kpiSemProximoPasso = useMemo(() => {
    return clientesAtivos.filter((c) => c.etapaAtual === "Sem próximo passo definido").length;
  }, [clientesAtivos]);

  const kpiForaSla = useMemo(() => {
    return clientesAtivos.filter((c) => c.etapaAtual === "Sem próximo passo definido" && c.slaEstouradoAtual).length;
  }, [clientesAtivos]);

  // 5. Filtro de pesquisa na lista (todos os clientes, incluindo finalizados)
  const clientesFiltrados = useMemo(() => {
    return dadosGeraisClientes.filter(
      (c) =>
        c.nomeEmpresa.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.responsavel && c.responsavel.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  }, [dadosGeraisClientes, searchQuery]);

  // 6. Dados da empresa selecionada (pode ser ativa ou concluída)
  const empresaSelecionadaObj = useMemo(() => {
    if (!selectedCompanyId) return null;
    return dadosGeraisClientes.find((c) => c.id === selectedCompanyId) || null;
  }, [selectedCompanyId, dadosGeraisClientes]);

  // Define a jornada da empresa selecionada
  const jornadaSelecionada = empresaSelecionadaObj ? empresaSelecionadaObj.jornada : [];

  const trackRef = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);
  const [trackWidth, setTrackWidth] = useState<number>(800);

  useEffect(() => {
    const updatePoints = () => {
      const track = trackRef.current;
      if (!track) return;

      const width = track.getBoundingClientRect().width;
      setTrackWidth(width);

      const circles = track.querySelectorAll(".jornada-step-circle");
      const trackRect = track.getBoundingClientRect();
      const newPoints = Array.from(circles).map((circle) => {
        const rect = circle.getBoundingClientRect();
        return {
          x: rect.left - trackRect.left + rect.width / 2,
          y: rect.top - trackRect.top + rect.height / 2,
        };
      });
      setPoints(newPoints);
    };

    let rAFId = window.requestAnimationFrame(updatePoints);

    const observer = new ResizeObserver(() => {
      updatePoints();
    });
    if (trackRef.current) {
      observer.observe(trackRef.current);
    }

    window.addEventListener("resize", updatePoints);
    return () => {
      window.cancelAnimationFrame(rAFId);
      observer.disconnect();
      window.removeEventListener("resize", updatePoints);
    };
  }, [jornadaSelecionada, selectedCompanyId]);

  const pathD = useMemo(() => {
    return points.reduce((acc, ponto, index, arr) => {
      if (index === 0) {
        return `M ${ponto.x} ${ponto.y}`;
      }

      const anterior = arr[index - 1];
      const mesmaLinha = Math.abs(ponto.y - anterior.y) < 15;

      if (mesmaLinha) {
        return `${acc} L ${ponto.x} ${ponto.y}`;
      }

      // Se a largura do track for pequena (celular), as etapas se empilham e usamos linha reta vertical simples
      if (trackWidth < 550) {
        return `${acc} L ${ponto.x} ${ponto.y}`;
      }

      // Caso contrário, desenha a curva suave (U-turn) conectando as linhas
      const isRightSide = anterior.x > trackWidth / 2;
      const curvaOffset = 60; // Raio/offset do arco da curva

      let c1x, c2x;
      if (isRightSide) {
        const maxX = Math.max(anterior.x, ponto.x);
        c1x = maxX + curvaOffset;
        c2x = maxX + curvaOffset;
      } else {
        const minX = Math.min(anterior.x, ponto.x);
        c1x = minX - curvaOffset;
        c2x = minX - curvaOffset;
      }

      const c1y = anterior.y;
      const c2y = ponto.y;

      return `${acc} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ponto.x} ${ponto.y}`;
    }, "");
  }, [points, trackWidth]);

  // Define o índice selecionado de etapa de forma dinâmica
  const selectedStageIndex = useMemo(() => {
    if (jornadaSelecionada.length === 0) return null;
    if (manualStageIndex !== null && manualStageIndex < jornadaSelecionada.length) {
      return manualStageIndex;
    }
    // Por padrão, seleciona a última etapa (ou a ativa se houver)
    const activeIdx = jornadaSelecionada.findIndex((s) => s.active);
    return activeIdx !== -1 ? activeIdx : jornadaSelecionada.length - 1;
  }, [jornadaSelecionada, manualStageIndex]);

  // Etapa selecionada para exibição no card de foco
  const etapaSelecionada = useMemo(() => {
    if (selectedStageIndex === null || selectedStageIndex >= jornadaSelecionada.length) return null;
    return jornadaSelecionada[selectedStageIndex];
  }, [jornadaSelecionada, selectedStageIndex]);

  const focusStatus = useMemo(() => {
    if (!etapaSelecionada) return "realizado";
    return obterStatusTreinamento(etapaSelecionada);
  }, [etapaSelecionada]);


  // ─────────────────────────────────────────────────────────────────
  // Diagnóstico automático da jornada
  // ─────────────────────────────────────────────────────────────────
  interface DiagnosticoItem {
    tipo: "ok" | "alerta" | "critico" | "info";
    emoji: string;
    titulo: string;
    descricao: string;
  }

  const diagnostico = useMemo((): DiagnosticoItem[] => {
    if (!empresaSelecionadaObj || jornadaSelecionada.length === 0) return [];

    const itens: DiagnosticoItem[] = [];
    const jornada = jornadaSelecionada.filter((s) => s.stage !== "Finalizado");

    // ─── 1. Treinamentos cancelados/ausentes consecutivos ───────────
    const treinamentos = jornada.filter((s) => s.stage === "Em treinamento");
    let maxConsecutivosCancelados = 0;
    let sequenciaAtualCancelados = 0;
    let maxConsecutivosAusentes = 0;
    let sequenciaAtualAusentes = 0;
    let totalCancelados = 0;
    let totalAusentes = 0;

    for (const t of treinamentos) {
      const status = obterStatusTreinamento(t);
      if (status === "cancelado") {
        totalCancelados++;
        sequenciaAtualCancelados++;
        sequenciaAtualAusentes = 0;
        maxConsecutivosCancelados = Math.max(maxConsecutivosCancelados, sequenciaAtualCancelados);
      } else if (status === "ausente") {
        totalAusentes++;
        sequenciaAtualAusentes++;
        sequenciaAtualCancelados = 0;
        maxConsecutivosAusentes = Math.max(maxConsecutivosAusentes, sequenciaAtualAusentes);
      } else {
        sequenciaAtualCancelados = 0;
        sequenciaAtualAusentes = 0;
      }
    }

    if (maxConsecutivosCancelados >= 3) {
      itens.push({
        tipo: "critico",
        emoji: "🚨",
        titulo: `${maxConsecutivosCancelados} cancelamentos consecutivos`,
        descricao: `O cliente acumulou ${maxConsecutivosCancelados} treinamentos cancelados em sequência, indicando dificuldade séria de comprometimento com a agenda.`,
      });
    } else if (maxConsecutivosCancelados === 2) {
      itens.push({
        tipo: "alerta",
        emoji: "⚠️",
        titulo: "2 cancelamentos consecutivos",
        descricao: "Dois treinamentos seguidos foram cancelados. Atenção para evitar que o padrão se repita.",
      });
    } else if (totalCancelados > 0) {
      itens.push({
        tipo: "info",
        emoji: "ℹ️",
        titulo: `${totalCancelados} treinamento${totalCancelados > 1 ? "s" : ""} cancelado${totalCancelados > 1 ? "s" : ""} no total`,
        descricao: "Houve cancelamentos pontuais, mas sem sequência crítica contínua.",
      });
    }

    if (maxConsecutivosAusentes >= 2) {
      itens.push({
        tipo: maxConsecutivosAusentes >= 3 ? "critico" : "alerta",
        emoji: maxConsecutivosAusentes >= 3 ? "🚨" : "⚠️",
        titulo: `${maxConsecutivosAusentes} ausências consecutivas`,
        descricao: `O cliente faltou sem aviso em ${maxConsecutivosAusentes} treinamentos seguidos, o que pode indicar desengajamento.`,
      });
    } else if (totalAusentes > 0) {
      itens.push({
        tipo: "info",
        emoji: "👤",
        titulo: `${totalAusentes} ausência${totalAusentes > 1 ? "s" : ""} registrada${totalAusentes > 1 ? "s" : ""}`,
        descricao: "Houve ausências pontuais sem aviso ao longo da jornada.",
      });
    }

    // ─── 2. Períodos sem próximo passo definido ─────────────────────
    const semPassos = jornada.filter((s) => s.stage === "Sem próximo passo definido");
    const semPassoSLAViolados = semPassos.filter((s) => s.slaBreached);
    const totalDiasSemPasso = semPassos.reduce((acc, s) => acc + s.days, 0);

    if (semPassoSLAViolados.length >= 3) {
      itens.push({
        tipo: "critico",
        emoji: "🔴",
        titulo: `${semPassoSLAViolados.length} violações de SLA`,
        descricao: `O cliente ficou sem próximo passo agendado por mais de 4 dias em ${semPassoSLAViolados.length} momentos distintos da jornada.`,
      });
    } else if (semPassoSLAViolados.length > 0) {
      itens.push({
        tipo: "alerta",
        emoji: "🟠",
        titulo: `${semPassoSLAViolados.length} violação${semPassoSLAViolados.length > 1 ? "ões" : ""} de SLA (> 4 dias sem passo)`,
        descricao: `Em ${semPassoSLAViolados.length} momento${semPassoSLAViolados.length > 1 ? "s" : ""} o cliente ficou sem agendamento por mais de 4 dias.`,
      });
    }

    if (totalDiasSemPasso > 15) {
      itens.push({
        tipo: "alerta",
        emoji: "⏳",
        titulo: `${totalDiasSemPasso} dias acumulados sem passo definido`,
        descricao: "O cliente passou um total significativo de dias da jornada sem um próximo agendamento definido.",
      });
    }

    // ─── 3. Checkpoints ────────────────────────────────────────────
    const checkpoints = jornada.filter((s) => s.stage === "Checkpoint");
    if (checkpoints.length > 0) {
      itens.push({
        tipo: "info",
        emoji: "📅",
        titulo: `${checkpoints.length} checkpoint${checkpoints.length > 1 ? "s" : ""} de acompanhamento`,
        descricao: `Foram criados ${checkpoints.length} checkpoint${checkpoints.length > 1 ? "s" : ""} para checar o status do cliente em datas específicas (ex: retorno de viagem, disponibilidade futura).`,
      });
    }

    // ─── 4. Cadência de treinamentos realizados ─────────────────────
    const treinamentosRealizados = treinamentos.filter((t) => {
      const s = obterStatusTreinamento(t);
      return s === "realizado" || s === "agendado";
    });

    if (treinamentosRealizados.length >= 1) {
      itens.push({
        tipo: "ok",
        emoji: "🎓",
        titulo: `${treinamentosRealizados.length} treinamento${treinamentosRealizados.length > 1 ? "s" : ""} concluído${treinamentosRealizados.length > 1 ? "s" : ""}`,
        descricao: `O cliente participou de ${treinamentosRealizados.length} ${treinamentosRealizados.length > 1 ? "sessões" : "sessão"} de treinamento realizadas com sucesso.`,
      });
    }

    // ─── 5. Estado atual: preso sem passo ───────────────────────────
    const etapaAtiva = jornada.find((s) => s.active);
    if (etapaAtiva?.stage === "Sem próximo passo definido" && !empresaSelecionadaObj.isFinalizado) {
      const diasPreso = Math.floor((Date.now() - etapaAtiva.startDate.getTime()) / (1000 * 60 * 60 * 24));
      if (diasPreso > 4) {
        itens.push({
          tipo: "critico",
          emoji: "🔴",
          titulo: `Atualmente sem passo definido há ${diasPreso} dias`,
          descricao: "O cliente está parado agora e já ultrapassou o SLA recomendado de 4 dias. É urgente definir um próximo agendamento.",
        });
      } else if (diasPreso > 0) {
        itens.push({
          tipo: "alerta",
          emoji: "⏰",
          titulo: `Sem próximo passo há ${diasPreso} dia${diasPreso > 1 ? "s" : ""}`,
          descricao: "O cliente está aguardando agendamento. Ainda está dentro do SLA, mas atenção para não ultrapassar 4 dias.",
        });
      }
    }

    // ─── 6. Jornada saudável (sem alertas) ─────────────────────────
    const temProblema = itens.some((i) => i.tipo === "critico" || i.tipo === "alerta");
    if (!temProblema && treinamentosRealizados.length > 0) {
      itens.push({
        tipo: "ok",
        emoji: "🌟",
        titulo: "Jornada saudável",
        descricao: "Nenhum padrão de risco detectado. O cliente está progredindo de forma regular e sem interrupções críticas.",
      });
    }

    return itens;
  }, [empresaSelecionadaObj, jornadaSelecionada]);

  // Handler para quando seleciona da lista rápida
  const selecionarEmpresa = (id: string) => {
    setSelectedCompanyId(id);
    setManualStageIndex(null); // Reseta a seleção manual do stepper
  };

  const getStageClass = (stage: string) => {
    switch (stage) {
      case "Em treinamento":
        return "treinamento";
      case "Checkpoint":
        return "checkpoint";
      case "Sem próximo passo definido":
        return "sem-passo";
      case "Finalizado":
        return "finalizado";
      default:
        return "";
    }
  };

  // Ícone dinâmico baseado na etapa
  const renderStageIcon = (stage: string, size = 18, statusTreinamento?: string) => {
    switch (stage) {
      case "Em treinamento":
        if (statusTreinamento === "cancelado") {
          return (
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: size, height: size }}>
              <GraduationCap size={size} />
              <svg
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  pointerEvents: "none",
                }}
                viewBox={`0 0 ${size} ${size}`}
              >
                <line
                  x1={size * 0.15}
                  y1={size * 0.85}
                  x2={size * 0.85}
                  y2={size * 0.15}
                  stroke="#ef4444"
                  strokeWidth={size * 0.125}
                  strokeLinecap="round"
                />
              </svg>
            </div>
          );
        }
        if (statusTreinamento === "ausente") {
          return <UserX size={size} />;
        }
        return <GraduationCap size={size} />;
      case "Checkpoint":
        return <Award size={size} />;
      case "Sem próximo passo definido":
        return <AlertCircle size={size} />;
      case "Finalizado":
        return <CheckCircle size={size} />;
      default:
        return <Info size={size} />;
    }
  };

  return (
    <div className="jornada-container">
      {/* 1. KPIs Consolidados */}
      <div className="jornada-kpis-grid">
        <div className="jornada-kpi-card info-card">
          <div className="jornada-kpi-header">
            <span className="jornada-kpi-label">Ativos na Esteira</span>
            <Activity className="jornada-kpi-icon" size={20} />
          </div>
          <span className="jornada-kpi-value">{kpiTotalAtivos}</span>
          <span className="jornada-kpi-desc">Implantações em aberto</span>
        </div>

        <div className="jornada-kpi-card info-card" style={{ borderLeftColor: "#f59e0b" }}>
          <div className="jornada-kpi-header">
            <span className="jornada-kpi-label">Sem Próximo Passo</span>
            <Clock className="jornada-kpi-icon" size={20} style={{ color: "#fbbf24" }} />
          </div>
          <span className="jornada-kpi-value">{kpiSemProximoPasso}</span>
          <span className="jornada-kpi-desc">Clientes aguardando agendamento</span>
        </div>

        <div className={`jornada-kpi-card alert-card ${kpiForaSla > 0 ? "glowing-alert" : ""}`}>
          <div className="jornada-kpi-header">
            <span className="jornada-kpi-label">Fora do SLA (&gt; 4 dias)</span>
            <Flame className="jornada-kpi-icon" size={20} />
          </div>
          <span className="jornada-kpi-value" style={{ color: kpiForaSla > 0 ? "#f87171" : "#f1f5f9" }}>
            {kpiForaSla}
          </span>
          <span className="jornada-kpi-desc">Sem passo definido há mais de 4 dias</span>
        </div>
      </div>

      {/* 2. Área principal */}
      <div className="jornada-main-layout">
        {/* Lado Esquerdo: Lista de Clientes Ativos */}
        <div className="jornada-section-card">
          <h3 className="jornada-section-title">
            <Building size={18} />
            Clientes na Esteira
          </h3>

          <div className="jornada-search-wrapper">
            <input
              type="text"
              placeholder="Buscar cliente ou treinador..."
              className="jornada-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Search className="jornada-search-icon" size={16} />
          </div>

          <div className="jornada-clients-list">
            {clientesFiltrados.length > 0 ? (
              clientesFiltrados.map((c) => {
                const isSlaBreached = c.etapaAtual === "Sem próximo passo definido" && c.slaEstouradoAtual;
                let badgeClass = getStageClass(c.etapaAtual);
                if (isSlaBreached) badgeClass = "sem-passo-erro";

                let stageText = c.etapaAtual;
                if (c.etapaAtual === "Em treinamento") {
                  const currentStageObj = c.jornada.find((s) => s.active) || (c.isFinalizado ? c.jornada[c.jornada.length - 1] : null);
                  if (currentStageObj) {
                    const statusTreinamento = obterStatusTreinamento(currentStageObj);
                    if (statusTreinamento === "cancelado") {
                      stageText = "Treinamento Cancelado";
                      badgeClass = "treinamento-cancelado";
                    } else if (statusTreinamento === "ausente") {
                      stageText = "Treinamento Ausente";
                      badgeClass = "treinamento-ausente";
                    }
                  }
                }

                return (
                  <button
                    key={c.id}
                    className={`jornada-client-item ${selectedCompanyId === c.id ? "selected" : ""}`}
                    onClick={() => selecionarEmpresa(c.id || "")}
                  >
                    <div className="jornada-client-info">
                      <span className="jornada-client-name">{c.nomeEmpresa}</span>
                      <span className="jornada-client-meta">
                        Treinador: {formatarNome(c.responsavel) || "Não definido"}
                      </span>
                    </div>
                    <span className={`jornada-client-stage-badge ${badgeClass}`}>
                      {isSlaBreached ? "SLA Violado" : stageText}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="jornada-empty-state" style={{ padding: "2rem 1rem" }}>
                <p>Nenhum cliente ativo encontrado.</p>
              </div>
            )}
          </div>
        </div>

        {/* Lado Direito: Detalhamento da Jornada */}
        <div className="jornada-section-card" style={{ flexGrow: 1 }}>
          <h3 className="jornada-section-title">
            <Sparkles size={18} />
            Jornada de Capacitação
          </h3>

          {empresaSelecionadaObj ? (
            <div className="jornada-detail-card">
              {/* Informações consolidadas da empresa */}
              <div className="jornada-detail-info-header" style={{ textAlign: "left", marginBottom: "0.5rem" }}>
                <h4 className="jornada-detail-company-title">
                  {empresaSelecionadaObj.nomeEmpresa}
                </h4>
              </div>

              <div className="jornada-detail-info-grid">
                <div className="jornada-detail-info-item">
                  <span>Treinador</span>
                  <strong>
                    <User size={12} style={{ marginRight: 4 }} />
                    {formatarNome(empresaSelecionadaObj.responsavel) || "—"}
                  </strong>
                </div>
                <div className="jornada-detail-info-item">
                  <span>CS Responsável</span>
                  <strong>
                    <UserCheck size={12} style={{ marginRight: 4 }} />
                    {formatarNome(empresaSelecionadaObj.csResponsavel) || "—"}
                  </strong>
                </div>
                <div className="jornada-detail-info-item">
                  <span>Início</span>
                  <strong>
                    {empresaSelecionadaObj.dataEntrada
                      ? new Date(
                          parseDataLocal(empresaSelecionadaObj.dataEntrada)!
                        ).toLocaleDateString("pt-BR")
                      : "—"}
                  </strong>
                </div>
                <div className="jornada-detail-info-item">
                  <span>Status da Esteira</span>
                  <strong style={{ color: empresaSelecionadaObj.isFinalizado ? "#10b981" : "#3b82f6" }}>
                    {empresaSelecionadaObj.isFinalizado ? "Concluído" : "Em aberto"}
                  </strong>
                </div>
                {empresaSelecionadaObj.totalEstourosSLA > 0 && (
                  <div className="jornada-detail-info-item">
                    <span>Estouros de SLA</span>
                    <strong style={{ color: "#ef4444" }}>
                      {empresaSelecionadaObj.totalEstourosSLA} {empresaSelecionadaObj.totalEstourosSLA === 1 ? "vez" : "vezes"}
                    </strong>
                  </div>
                )}
              </div>

              {/* ========================================================
                 DIAGNÓSTICO AUTOMÁTICO DA JORNADA
                 ======================================================== */}
              {diagnostico.length > 0 && (
                <div className="jornada-diagnostico">
                  <h5 className="jornada-diagnostico-title">
                    <Activity size={14} style={{ marginRight: 6 }} />
                    Diagnóstico da Jornada
                  </h5>
                  <div className="jornada-diagnostico-lista">
                    {diagnostico.map((item, i) => (
                      <div key={i} className={`jornada-diagnostico-item diag-${item.tipo}`}>
                        <span className="diag-emoji">{item.emoji}</span>
                        <div className="diag-content">
                          <strong className="diag-titulo">{item.titulo}</strong>
                          <span className="diag-desc">{item.descricao}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ========================================================
                 STEPPER HORIZONTAL INTERATIVO
                 ======================================================== */}
              <div className="jornada-stepper-container">
                <div className={`jornada-stepper-track ${trackWidth >= 550 ? "use-grid" : ""}`} ref={trackRef}>
                  {points.length > 1 && (
                    <svg
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: "100%",
                        pointerEvents: "none",
                        zIndex: 1,
                      }}
                    >
                      <path
                        d={pathD}
                        fill="none"
                        className="jornada-stepper-line"
                        strokeWidth={3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                  {jornadaSelecionada.map((item, idx) => {
                    const isSlaBreached = item.stage === "Sem próximo passo definido" && item.slaBreached;
                    const isSelected = selectedStageIndex === idx;
                    const statusTreinamento = obterStatusTreinamento(item);
                    const statusClass = statusTreinamento === "cancelado" ? "cancelado" : statusTreinamento === "ausente" ? "ausente" : "";

                    const isUseGrid = trackWidth >= 550;
                    const row = Math.floor(idx / 5);
                    const col = isUseGrid && row % 2 !== 0 ? 4 - (idx % 5) : idx % 5;
                    const nodeStyle = isUseGrid ? {
                      gridRow: row + 1,
                      gridColumn: col + 1,
                    } : undefined;

                    return (
                      <button
                        key={idx}
                        style={nodeStyle}
                        className={`jornada-step-node ${getStageClass(item.stage)} ${statusClass} ${
                          isSlaBreached ? "sla-violated" : ""
                        } ${isSelected ? "selected-node" : ""}`}
                        onClick={() => setManualStageIndex(idx)}
                      >
                        <div className="jornada-step-circle">
                          {renderStageIcon(item.stage, 16, statusTreinamento)}
                          {item.active && !empresaSelecionadaObj.isFinalizado && (
                            <div className="jornada-step-active-pulse" />
                          )}
                        </div>
                        <span className="jornada-step-name">
                          {item.stage === "Finalizado"
                            ? "Finalizado"
                            : item.stage === "Em treinamento" && statusTreinamento === "cancelado"
                            ? "Treinamento Cancelado"
                            : item.stage === "Em treinamento" && statusTreinamento === "ausente"
                            ? "Treinamento Ausente"
                            : item.stage}
                        </span>
                        {item.stage !== "Finalizado" ? (
                          <>
                            <span className="jornada-step-date">
                              {formatarPeriodoResumido(
                                item.startDate,
                                item.endDate,
                                item.active,
                                empresaSelecionadaObj.isFinalizado,
                                item.stage
                              )}
                            </span>
                            <span className="jornada-step-date" style={{ fontSize: "0.68rem", opacity: 0.8, marginTop: "1px", fontWeight: 600 }}>
                              {item.days} {item.days === 1 ? "dia" : "dias"}
                            </span>
                          </>
                        ) : (
                          <span className="jornada-step-date">
                            {item.startDate.toLocaleDateString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                            })}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ========================================================
                 NOVO: CARD DE FOCO DINÂMICO
                 ======================================================== */}
              {etapaSelecionada && (
                <div className="jornada-focus-card">
                  <div className="jornada-focus-header">
                    <div className="jornada-focus-title-group">
                      <h4 className="jornada-focus-title">
                        {etapaSelecionada.stage === "Finalizado"
                          ? "🏁 Esteira Finalizada"
                          : etapaSelecionada.stage === "Em treinamento" && focusStatus === "cancelado"
                          ? "❌ Treinamento Cancelado"
                          : etapaSelecionada.stage === "Em treinamento" && focusStatus === "ausente"
                          ? "⚠️ Treinamento Ausente"
                          : etapaSelecionada.stage}
                      </h4>
                      <div className="jornada-focus-badges">
                        {etapaSelecionada.active && (
                          <span className="jornada-stage-badge em-andamento">
                            <Activity size={12} style={{ marginRight: 5 }} />
                            Etapa Atual
                          </span>
                        )}
                        {etapaSelecionada.stage === "Em treinamento" && focusStatus === "cancelado" && (
                          <span className="jornada-stage-badge cancelado" style={{ background: "rgba(239,68,68,0.15)", color: "#f87171", borderColor: "rgba(239,68,68,0.3)" }}>
                            <AlertCircle size={12} style={{ marginRight: 5 }} />
                            Cancelado
                          </span>
                        )}
                        {etapaSelecionada.stage === "Em treinamento" && focusStatus === "ausente" && (
                          <span className="jornada-stage-badge ausente" style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24", borderColor: "rgba(245,158,11,0.3)" }}>
                            <AlertCircle size={12} style={{ marginRight: 5 }} />
                            Ausente
                          </span>
                        )}
                        {!etapaSelecionada.active && etapaSelecionada.stage !== "Finalizado" &&
                         !(etapaSelecionada.stage === "Em treinamento" && (focusStatus === "cancelado" || focusStatus === "ausente")) && (
                          <span className="jornada-stage-badge concluido">
                            <CheckCircle size={12} style={{ marginRight: 5 }} />
                            Concluída
                          </span>
                        )}
                        {etapaSelecionada.stage === "Sem próximo passo definido" && (
                          <span
                            className={`jornada-stage-badge ${
                              etapaSelecionada.slaBreached ? "sla-status-breached" : "sla-status-ok"
                            }`}
                          >
                            {etapaSelecionada.slaBreached ? (
                              <>
                                <Flame size={12} style={{ marginRight: 5 }} />
                                SLA Violado
                              </>
                            ) : (
                              <>
                                <CheckCircle size={12} style={{ marginRight: 5 }} />
                                SLA OK
                              </>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="jornada-focus-grid">
                    <div className="jornada-focus-item">
                      <span>
                        <Calendar size={12} />
                        Data de Início
                      </span>
                      <strong>
                        {etapaSelecionada.startDate.toLocaleDateString("pt-BR")}{" "}
                        {etapaSelecionada.startDate.toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </strong>
                    </div>

                    {etapaSelecionada.stage !== "Finalizado" && (
                      <>
                        <div className="jornada-focus-item">
                          <span>
                            <Calendar size={12} />
                            Data de Fim
                          </span>
                          <strong>
                            {etapaSelecionada.active && !empresaSelecionadaObj.isFinalizado && etapaSelecionada.stage === "Sem próximo passo definido"
                              ? "Em andamento"
                              : `${etapaSelecionada.endDate.toLocaleDateString("pt-BR")} ${etapaSelecionada.endDate.toLocaleTimeString("pt-BR", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}`}
                          </strong>
                        </div>

                        <div className="jornada-focus-item">
                          <span>
                            <Clock size={12} />
                            Duração Acumulada
                          </span>
                          <strong>
                            {etapaSelecionada.days} {etapaSelecionada.days === 1 ? "dia" : "dias"}
                          </strong>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Alerta específico de estouro de SLA */}
                  {etapaSelecionada.stage === "Sem próximo passo definido" && etapaSelecionada.slaBreached && (
                    <div className="jornada-focus-sla-alert">
                      <AlertCircle className="jornada-focus-sla-icon" size={18} />
                      <div>
                        <strong>Atenção: Limite de SLA Excedido!</strong> O cliente permaneceu{" "}
                        {etapaSelecionada.days} dias consecutivos sem um próximo passo de agendamento definido.
                        O prazo limite recomendado para esta etapa é de no máximo <strong>4 dias</strong>.
                      </div>
                    </div>
                  )}

                  {/* Detalhes da ocorrência vinculada (se aplicável) */}
                  {etapaSelecionada.ocorrencia && (
                    <div className="jornada-focus-ocorrencia-section">
                      <h5 className="jornada-focus-oc-header">
                        <FileText size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                        Ocorrência Vinculada
                      </h5>

                      <div className="jornada-focus-grid" style={{ background: "none", padding: 0, border: "none" }}>
                        <div className="jornada-focus-item" style={{ background: "rgba(15,23,42,0.15)" }}>
                          <span>Tipo de Registro</span>
                          <strong>{etapaSelecionada.ocorrencia.tipo}</strong>
                        </div>
                        <div className="jornada-focus-item" style={{ background: "rgba(15,23,42,0.15)" }}>
                          <span>Responsável pelo Registro</span>
                          <strong>{formatarNome(etapaSelecionada.ocorrencia.responsavel)}</strong>
                        </div>
                        {etapaSelecionada.ocorrencia.idSeqFormatted && (
                          <div className="jornada-focus-item" style={{ background: "rgba(15,23,42,0.15)" }}>
                            <span>Código Sequencial</span>
                            <strong>{etapaSelecionada.ocorrencia.idSeqFormatted}</strong>
                          </div>
                        )}
                      </div>

                      {etapaSelecionada.ocorrencia.descricao && (
                        <div className="jornada-focus-desc">
                          <h5>Detalhamento do Treinador</h5>
                          <p>{etapaSelecionada.ocorrencia.descricao}</p>
                        </div>
                      )}

                      {etapaSelecionada.ocorrencia.temaOcorrencia &&
                        etapaSelecionada.ocorrencia.temaOcorrencia.length > 0 && (
                          <div className="jornada-focus-temas">
                            <h5>Temas Abordados</h5>
                            <div className="temas-selecionados">
                              {etapaSelecionada.ocorrencia.temaOcorrencia.map((tema) => (
                                <span
                                  key={tema}
                                  className={`tema-tag ${
                                    ["Ausente", "Cancelado"].includes(tema) ? "tema-tag-alerta" : ""
                                  }`}
                                >
                                  {tema}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                      {etapaSelecionada.ocorrencia.tipo === "Treinamento" &&
                        etapaSelecionada.ocorrencia.treinamentoNotas &&
                        etapaSelecionada.ocorrencia.treinamentoNotas.length > 0 && (
                          <div className="jornada-focus-csat">
                            <h5>Notas de Satisfação (CSAT)</h5>
                            <div className="csat-notas-container">
                              {etapaSelecionada.ocorrencia.treinamentoNotas.map((nota, nIdx) => (
                                <span key={nIdx} className="csat-nota-badge">
                                  Nota {nIdx + 1}: {nota}
                                </span>
                              ))}
                              {etapaSelecionada.ocorrencia.treinamentoNotaMedia !== undefined &&
                                etapaSelecionada.ocorrencia.treinamentoNotaMedia !== null && (
                                  <span className="csat-media-badge">
                                    <Star size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />
                                    Média: {etapaSelecionada.ocorrencia.treinamentoNotaMedia}
                                  </span>
                                )}
                            </div>
                          </div>
                        )}
                      {etapaSelecionada.ocorrencia.atualizacoes &&
                        etapaSelecionada.ocorrencia.atualizacoes.length > 0 && (
                          <div className="hist-atualizacoes" style={{ marginTop: "1rem" }}>
                            <h5 style={{ fontSize: "0.8rem", color: "#64748b", textTransform: "uppercase", margin: "0 0 0.5rem 0", fontWeight: 700 }}>
                              Atualizações / Comentários ({etapaSelecionada.ocorrencia.atualizacoes.length})
                            </h5>
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                              {etapaSelecionada.ocorrencia.atualizacoes.map((at, i) => (
                                <div key={i} className="hist-atualizacao-item" style={{ padding: "8px 12px" }}>
                                  <span className="hist-atualizacao-meta">
                                    Atualização em{" "}
                                    {new Date(at.updatedAt || at.createdAt || 0).toLocaleDateString("pt-BR")}{" "}
                                    {new Date(at.updatedAt || at.createdAt || 0).toLocaleTimeString("pt-BR", {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                    {at.responsavel ? ` · ${formatarNome(at.responsavel)}` : ""}
                                  </span>
                                  <p style={{ margin: 0, fontSize: "0.88rem", whiteSpace: "pre-wrap" }}>{at.descricao}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                    </div>
                  )}

                  {/* Detalhes da ocorrência que finalizou a etapa (se aplicável, exceto para Sem próximo passo definido para evitar duplicidade com a etapa seguinte) */}
                  {etapaSelecionada.ocorrenciaFinalizadora && etapaSelecionada.stage !== "Sem próximo passo definido" && (
                    <div className="jornada-focus-ocorrencia-section" style={{ borderTop: "1px solid rgba(255, 255, 255, 0.05)", paddingTop: "1.25rem", marginTop: "1.25rem" }}>
                      <h5 className="jornada-focus-oc-header">
                        <FileText size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                        {etapaSelecionada.stage === "Sem próximo passo definido" 
                          ? "Ocorrência de Resolução (Agendamento)" 
                          : "Ocorrência de Conclusão / Finalização"}
                      </h5>
                      <p style={{ fontSize: "0.85rem", color: "#94a3b8", marginBottom: "0.75rem", marginTop: "-0.25rem" }}>
                        {etapaSelecionada.stage === "Sem próximo passo definido"
                          ? 'Esta etapa "Sem próximo passo definido" foi encerrada pelo agendamento da seguinte ocorrência:'
                          : 'Esta etapa foi encerrada/concluída pela seguinte ocorrência:'}
                      </p>

                      <div className="jornada-focus-grid" style={{ background: "none", padding: 0, border: "none" }}>
                        <div className="jornada-focus-item" style={{ background: "rgba(15,23,42,0.15)" }}>
                          <span>Tipo de Registro</span>
                          <strong>{etapaSelecionada.ocorrenciaFinalizadora.tipo}</strong>
                        </div>
                        <div className="jornada-focus-item" style={{ background: "rgba(15,23,42,0.15)" }}>
                          <span>Responsável pelo Registro</span>
                          <strong>{formatarNome(etapaSelecionada.ocorrenciaFinalizadora.responsavel)}</strong>
                        </div>
                        {etapaSelecionada.ocorrenciaFinalizadora.idSeqFormatted && (
                          <div className="jornada-focus-item" style={{ background: "rgba(15,23,42,0.15)" }}>
                            <span>Código Sequencial</span>
                            <strong>{etapaSelecionada.ocorrenciaFinalizadora.idSeqFormatted}</strong>
                          </div>
                        )}
                      </div>

                      {etapaSelecionada.ocorrenciaFinalizadora.descricao && (
                        <div className="jornada-focus-desc">
                          <h5>Detalhamento do Treinador</h5>
                          <p>{etapaSelecionada.ocorrenciaFinalizadora.descricao}</p>
                        </div>
                      )}

                      {etapaSelecionada.ocorrenciaFinalizadora.temaOcorrencia &&
                        etapaSelecionada.ocorrenciaFinalizadora.temaOcorrencia.length > 0 && (
                          <div className="jornada-focus-temas">
                            <h5>Temas Abordados</h5>
                            <div className="temas-selecionados">
                              {etapaSelecionada.ocorrenciaFinalizadora.temaOcorrencia.map((tema) => (
                                <span
                                  key={tema}
                                  className={`tema-tag ${
                                    ["Ausente", "Cancelado"].includes(tema) ? "tema-tag-alerta" : ""
                                  }`}
                                >
                                  {tema}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      {etapaSelecionada.ocorrenciaFinalizadora.atualizacoes &&
                        etapaSelecionada.ocorrenciaFinalizadora.atualizacoes.length > 0 && (
                          <div className="hist-atualizacoes" style={{ marginTop: "1rem" }}>
                            <h5 style={{ fontSize: "0.8rem", color: "#64748b", textTransform: "uppercase", margin: "0 0 0.5rem 0", fontWeight: 700 }}>
                              Atualizações / Comentários ({etapaSelecionada.ocorrenciaFinalizadora.atualizacoes.length})
                            </h5>
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                              {etapaSelecionada.ocorrenciaFinalizadora.atualizacoes.map((at, i) => (
                                <div key={i} className="hist-atualizacao-item" style={{ padding: "8px 12px" }}>
                                  <span className="hist-atualizacao-meta">
                                    Atualização em{" "}
                                    {new Date(at.updatedAt || at.createdAt || 0).toLocaleDateString("pt-BR")}{" "}
                                    {new Date(at.updatedAt || at.createdAt || 0).toLocaleTimeString("pt-BR", {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                    {at.responsavel ? ` · ${formatarNome(at.responsavel)}` : ""}
                                  </span>
                                  <p style={{ margin: 0, fontSize: "0.88rem", whiteSpace: "pre-wrap" }}>{at.descricao}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                    </div>
                  )}


                </div>
              )}
            </div>
          ) : (
            <div className="jornada-empty-state">
              <Building className="jornada-empty-icon" size={48} />
              <p style={{ fontWeight: 600, fontSize: "1.1rem" }}>Nenhum cliente selecionado</p>
              <p style={{ fontSize: "0.9rem", margin: 0 }}>
                Selecione um cliente na lista lateral para visualizar o detalhamento cronológico de sua trilha de capacitação.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
