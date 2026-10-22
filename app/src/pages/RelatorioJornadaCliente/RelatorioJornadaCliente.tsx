import React, { useState, useMemo, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Calendar,
  Clock,
  AlertCircle,
  CheckCircle,
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
  UserX,
  HelpCircle,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  ArrowLeft,
} from "lucide-react";
import type { Empresa, Ocorrencia } from "../../types";
import { formatarNome } from "../../utils/formatarNome";
import { obterInfoTipoOcorrencia } from "../../utils/empresaUtils";
import { calcularScoreEfetivo, obterTipoEfetivo } from "../../utils/score";
import {
  construirLinhaTempoScore,
  fatiarIntervaloPorTipo,
  formatarScore,
  type CausaMudanca,
  type MudancaTipoScore,
  type TipoScore,
} from "../../utils/historicoScore";
import "./RelatorioJornadaCliente.css";

const DIA_MS = 24 * 60 * 60 * 1000;

type FiltroLista = "abertos" | "semPasso" | "sla" | "safety" | "viraramSafety" | "todos";

type Selecao = { tipo: "etapa"; indice: number } | { tipo: "mudanca"; indice: number } | null;

const COR_TIPO: Record<"Fast" | "Safety" | "nulo", string> = {
  Fast: "#10b981",
  Safety: "#ef4444",
  nulo: "rgba(148, 163, 184, 0.55)",
};

const classeTipo = (tipo: TipoScore | null) => (tipo === "Fast" ? "fast" : tipo === "Safety" ? "safety" : "sem-score");
const rotuloTipo = (tipo: TipoScore | null) => tipo ?? "Sem score";

function tituloMudanca(m: MudancaTipoScore): string {
  if (m.de === null) return `Primeira classificação: ${rotuloTipo(m.para)}`;
  if (m.para === null) return "Score marcado como Neutro";
  return m.para === "Safety" ? "Virou Safety" : "Voltou para Fast";
}

interface ResumoCliente {
  isFinalizado: boolean;
  isCancelled?: boolean;
  etapaAtual: string;
  slaEstouradoAtual: boolean;
  tipoAtual: TipoScore | null;
  virouSafetyRecente: boolean;
}

const emAberto = (c: ResumoCliente) => !c.isFinalizado && !c.isCancelled;
const semPassoAgora = (c: ResumoCliente) => emAberto(c) && c.etapaAtual === "Sem próximo passo definido";
const foraDoSla = (c: ResumoCliente) => semPassoAgora(c) && c.slaEstouradoAtual;

const CRITERIOS_LISTA: Record<FiltroLista, (c: ResumoCliente) => boolean> = {
  abertos: emAberto,
  semPasso: semPassoAgora,
  sla: foraDoSla,
  safety: (c) => emAberto(c) && c.tipoAtual === "Safety",
  viraramSafety: (c) => emAberto(c) && c.virouSafetyRecente,
  todos: () => true,
};

/** Mais críticos primeiro: fora do SLA, sem próximo passo, Safety, demais em aberto e encerrados. */
function prioridadeCliente(c: ResumoCliente): number {
  if (foraDoSla(c)) return 0;
  if (semPassoAgora(c)) return 1;
  if (emAberto(c)) return c.tipoAtual === "Safety" ? 2 : 3;
  return c.isFinalizado ? 4 : 5;
}

type Ponto = { x: number; y: number };

/**
 * Caminho de uma linha da régua entre dois nós: reta na mesma fileira (ou em telas
 * estreitas) e curva em "U" na virada de fileira. `pontoEm` devolve a posição a uma
 * fração do caminho, para posicionar os marcadores de mudança de tipo.
 */
function geometriaConector(a: Ponto, b: Ponto, larguraTrilha: number) {
  const reta = Math.abs(b.y - a.y) < 15 || larguraTrilha < 680;
  if (reta) {
    return {
      d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`,
      pontoEm: (p: number) => ({ x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p }),
    };
  }
  const ladoDireito = a.x > larguraTrilha / 2;
  const deslocamento = 60;
  const cx = ladoDireito ? Math.max(a.x, b.x) + deslocamento : Math.min(a.x, b.x) - deslocamento;
  const pontoBezier = (p: number) => {
    const q = 1 - p;
    return {
      x: q * q * q * a.x + 3 * q * q * p * cx + 3 * q * p * p * cx + p * p * p * b.x,
      y: q * q * q * a.y + 3 * q * q * p * a.y + 3 * q * p * p * b.y + p * p * p * b.y,
    };
  };
  // As cores SVG usam comprimento do caminho; a posição do quadrado usa a mesma medida.
  const amostras = Array.from({ length: 81 }, (_, i) => pontoBezier(i / 80));
  const distancias = [0];
  for (let i = 1; i < amostras.length; i++) {
    distancias.push(distancias[i - 1] + Math.hypot(amostras[i].x - amostras[i - 1].x, amostras[i].y - amostras[i - 1].y));
  }
  return {
    d: `M ${a.x} ${a.y} C ${cx} ${a.y}, ${cx} ${b.y}, ${b.x} ${b.y}`,
    pontoEm: (p: number) => {
      const alvo = Math.max(0, Math.min(1, p)) * distancias[80];
      const indice = Math.max(1, distancias.findIndex((d) => d >= alvo));
      const fracao = (alvo - distancias[indice - 1]) / (distancias[indice] - distancias[indice - 1] || 1);
      return pontoBezier((indice - 1 + fracao) / 80);
    },
  };
}

interface RelatorioJornadaClienteProps {
  empresas: Empresa[];
  ocorrencias: Ocorrencia[];
}

interface StageInterval {
  stage: "Agendamento realizado" | "Em treinamento" | "Checkpoint" | "Sem próximo passo definido" | "Finalizado" | "Suspenso" | "Cliente Cancelado";
  startDate: Date;
  endDate: Date;
  days: number;
  slaBreached: boolean;
  active: boolean;
  ocorrencia?: Ocorrencia;
  ocorrenciaFinalizadora?: Ocorrencia;
  problemasDuvidas?: Ocorrencia[];
}

export const RelatorioJornadaCliente: React.FC<RelatorioJornadaClienteProps> = ({
  empresas,
  ocorrencias,
}) => {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filtroLista, setFiltroLista] = useState<FiltroLista>("abertos");
  const [selecao, setSelecao] = useState<Selecao>(null);
  const detalheMudancaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selecao?.tipo === "mudanca") {
      detalheMudancaRef.current?.focus({ preventScroll: true });
      detalheMudancaRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selecao]);
  // Reavalia a expiração das reduções mesmo enquanto o relatório permanece aberto.
  const [agoraRelatorio, setAgoraRelatorio] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setAgoraRelatorio(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Auxiliar para converter "yyyy-mm-dd" em Date
  const parseDataLocal = (dataStr: string): Date | null => {
    if (!dataStr) return null;
    const parts = dataStr.split("-").map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  };

  // Conta apenas dias úteis (segunda a sexta) entre dois timestamps, ignorando finais de semana.
  // Usado para a etapa "Sem próximo passo definido", já que o SLA de 4 dias é comercial: um cliente
  // que entra na quinta e só tem retorno na segunda não deve estourar o SLA por causa do fim de semana.
  const calcularDiasUteis = (startMs: number, endMs: number): number => {
    if (endMs <= startMs) return 0;
    const cur = new Date(startMs);
    cur.setHours(0, 0, 0, 0);
    const endDay = new Date(endMs);
    endDay.setHours(0, 0, 0, 0);
    const endTime = endDay.getTime();
    let count = 0;
    while (cur.getTime() < endTime) {
      cur.setDate(cur.getDate() + 1);
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6) count++;
    }
    return count;
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
    if (item.stage !== "Em treinamento" && item.stage !== "Agendamento realizado") return "realizado";
    
    const contemTema = (oc: Ocorrencia | undefined, termo: string) => {
      return oc?.temaOcorrencia?.some(t => t.trim().toLowerCase() === termo.toLowerCase()) ?? false;
    };

    // O status da etapa depende apenas da ocorrência que a INICIOU. A ocorrência
    // que a FINALIZA (ocorrenciaFinalizadora) pertence a um evento seguinte e não
    // deve "contaminar" retroativamente o status desta etapa (ver calcularJornada:
    // ocorrências de Cancelado/Ausente sem reagendamento ganham etapa própria).
    const isCancelado = contemTema(item.ocorrencia, "cancelado");
    const isAusente = contemTema(item.ocorrencia, "ausente");

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

    // Filtra ocorrências da empresa de tipos relevantes (incluindo retorno de suspensão)
    const relevantOcs = ocorrencias
      .filter(
        (o) =>
          o.empresa.trim().toLowerCase() === empresa.nomeEmpresa.trim().toLowerCase() &&
          (["Treinamento", "Informativa", "Checkpoint"].includes(o.tipo) ||
            o.retornarEsteira === true)
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
        // Ocorrências de retorno de suspensão sempre passam (não precisam de data agendada)
        if (o.retornarEsteira) return true;
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

      // Se a ocorrência é de retorno de suspensão, o período ANTERIOR é de suspensão (não de "sem passo").
      // Tratamos ela aqui antes do bloco de gap, para que o gap não seja incorretamente classificado.
      if (oc.retornarEsteira) {
        // O período de suspensão vai de currentTime até a criação desta ocorrência
        const suspensaoEnd = Math.min(creationTime, endJourneyTime);
        if (suspensaoEnd > currentTime) {
          const diffMs = suspensaoEnd - currentTime;
          const daysSusp = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
          stages.push({
            stage: "Suspenso",
            startDate: new Date(currentTime),
            endDate: new Date(suspensaoEnd),
            days: daysSusp,
            slaBreached: false,
            active: false,
            ocorrenciaFinalizadora: oc,
          });
          currentTime = suspensaoEnd;
        }
        continue;
      }

      // Se houver um gap entre currentTime e a criação da ocorrência, o cliente ficou sem próximo passo definido
      if (creationTime > currentTime) {
        const diffMs = creationTime - currentTime;
        // Só considera gap real se tiver durado pelo menos 24 horas (evita registrar gaps para reagendamentos rápidos de poucas horas)
        if (diffMs >= 24 * 60 * 60 * 1000) {
          const days = calcularDiasUteis(currentTime, creationTime);
          stages.push({
            stage: "Sem próximo passo definido",
            startDate: new Date(currentTime),
            endDate: new Date(creationTime),
            days,
            slaBreached: days > 4, // SLA de 4 dias úteis
            active: false,
            ocorrenciaFinalizadora: oc,
          });
        }
        currentTime = creationTime;
      }


      // Determina o tipo de etapa
      let stageType: StageInterval["stage"];
      if (oc.tipo === "Checkpoint") {
        stageType = "Checkpoint";
      } else {
        // Treinamento ou Informativa
        if (scheduledTime > 0) {
          stageType = oc.tipo === "Informativa" ? "Agendamento realizado" : "Em treinamento";
        } else {
          // Sem agendamento válido definido: normalmente é apenas o relato de
          // conclusão da etapa anterior (via ocorrenciaFinalizadora, abaixo) e não
          // avança a régua. Porém, se for um relato de Cancelamento/Ausência, ele
          // representa um evento próprio e deve aparecer como uma etapa distinta
          // na régua — não pode ficar escondido nem ser confundido com a etapa
          // anterior (que pode ter sido concluída normalmente).
          const isCanceladoOuAusente = oc.temaOcorrencia?.some(
            (t) => t.trim().toLowerCase() === "cancelado" || t.trim().toLowerCase() === "ausente"
          );
          if (oc.tipo === "Treinamento" && isCanceladoOuAusente) {
            stages.push({
              stage: "Em treinamento",
              startDate: new Date(currentTime),
              endDate: new Date(currentTime),
              days: 0,
              slaBreached: false,
              active: false,
              ocorrencia: oc,
            });
          }
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
    // Só considera "sem próximo passo" após uma carência de 6h do horário agendado, para não
    // marcar o cliente como sem passo definido logo após o início do treinamento (ex: treino às
    // 10:00 não deve virar "sem próximo passo" às 10:01, apenas a partir das 16:00).
    const CARENCIA_SEM_PROXIMO_PASSO_MS = 6 * 60 * 60 * 1000;
    if (currentTime < endJourneyTime && endJourneyTime - currentTime >= CARENCIA_SEM_PROXIMO_PASSO_MS) {
      const days = calcularDiasUteis(currentTime, endJourneyTime);
      stages.push({
        stage: "Sem próximo passo definido",
        startDate: new Date(currentTime),
        endDate: new Date(endJourneyTime),
        days,
        slaBreached: days > 4,
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

        // Etapas que representam um Cancelamento/Ausência são eventos distintos e
        // nunca devem ser mescladas de volta na etapa anterior, mesmo se caírem
        // no mesmo dia (senão voltaríamos a "contaminar" a etapa anterior).
        const currentEhCanceladoOuAusente = current.ocorrencia?.temaOcorrencia?.some(
          (t) => t.trim().toLowerCase() === "cancelado" || t.trim().toLowerCase() === "ausente"
        ) ?? false;

        if (last.stage === current.stage && isSameDay && !currentEhCanceladoOuAusente) {
          // Mescla as etapas estendendo a data final da primeira
          last.endDate = current.endDate;
          if (last.stage === "Sem próximo passo definido") {
            last.days = calcularDiasUteis(last.startDate.getTime(), last.endDate.getTime());
            last.slaBreached = last.days > 4;
          } else {
            const diffMs = last.endDate.getTime() - last.startDate.getTime();
            last.days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
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

    // Associa dúvidas/problemas registrados a cada etapa, de acordo com o período em que ocorreram
    const problemasEDuvidas = ocorrencias
      .filter(
        (o) =>
          o.empresa.trim().toLowerCase() === empresa.nomeEmpresa.trim().toLowerCase() &&
          (o.tipo === "Problema" || o.tipo === "Dúvida")
      )
      .map((o) => ({ ocorrencia: o, timeRef: o.createdAt ?? o.dataOcorrencia ?? 0 }))
      .filter((o) => o.timeRef > 0)
      .sort((a, b) => a.timeRef - b.timeRef);

    for (const stage of mergedStages) {
      const encontrados = problemasEDuvidas
        .filter((o) => o.timeRef >= stage.startDate.getTime() && o.timeRef <= stage.endDate.getTime())
        .map((o) => o.ocorrencia);
      if (encontrados.length > 0) {
        stage.problemasDuvidas = encontrados;
      }
    }

    // Se o cliente está atualmente suspenso (e não cancelado), adiciona a etapa Suspenso como ativa ao final
    if (empresa.isSuspended && !empresa.dataFinalizacao && !empresa.isCancelled) {
      const suspensaoStart = Math.max(currentTime, startJourneyTime);
      const agora = Date.now();
      if (agora >= suspensaoStart) {
        const diffMs = agora - suspensaoStart;
        const daysSusp = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
        mergedStages.push({
          stage: "Suspenso",
          startDate: new Date(suspensaoStart),
          endDate: new Date(agora),
          days: daysSusp,
          slaBreached: false,
          active: true,
        });
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

    // Se o cliente foi cancelado, adiciona a etapa Cliente Cancelado ao final
    if (empresa.isCancelled) {
      const cancelDate = endJourneyDate ?? new Date(currentTime);
      mergedStages.push({
        stage: "Cliente Cancelado",
        startDate: cancelDate,
        endDate: cancelDate,
        days: 0,
        slaBreached: false,
        active: false,
      });
    }

    // Marca a última etapa como ativa se o cliente ainda estiver em aberto (sem dataFinalizacao e sem cancelamento)
    if (!empresa.dataFinalizacao && !empresa.isCancelled && mergedStages.length > 0) {
      mergedStages[mergedStages.length - 1].active = true;
    }

    return mergedStages;
  };

  // 2. Filtra e processa os dados de todas as empresas para a visão consolidada
  const dadosGeraisClientes = useMemo(() => {
    const agora = Math.max(agoraRelatorio, Date.now());
    return empresas
      .filter((emp) => !emp.isOngoing)
      .map((emp) => {
      const jornada = calcularJornada(emp);
      const isFinalizado = !!emp.dataFinalizacao;
      const isCancelado = !!emp.isCancelled;
      const currentStageObj = jornada.find((s) => s.active) || ((isFinalizado || isCancelado) ? jornada[jornada.length - 1] : null);

      let slaEstouradoAtual = false;
      let diasNaEtapaAtual = 0;

      if (currentStageObj) {
        diasNaEtapaAtual = currentStageObj.days;
        if (currentStageObj.stage === "Sem próximo passo definido" && !isFinalizado) {
          // Se está atualmente sem próximo passo e a duração até hoje é > 4 dias úteis
          const startJourneyTime = currentStageObj.startDate.getTime();
          const diasUteis = calcularDiasUteis(startJourneyTime, Date.now());
          slaEstouradoAtual = diasUteis > 4;
          diasNaEtapaAtual = diasUteis;
        }
      }

      // Conta o total de estouros de SLA na jornada inteira
      const totalEstourosSLA = jornada.filter((s) => s.stage === "Sem próximo passo definido" && s.slaBreached).length;

      // Linha Fast/Safety cobre da entrada até hoje (ou até o último marco, se encerrada).
      const inicioLinha = jornada[0]?.startDate.getTime() ?? parseDataLocal(emp.dataEntrada)?.getTime() ?? agora;
      const fimLinha = isFinalizado || isCancelado
        ? Math.max(inicioLinha, ...jornada.map((s) => s.endDate.getTime()))
        : agora;
      const linhaScore = construirLinhaTempoScore(emp, ocorrencias, inicioLinha, fimLinha, agora);
      const limiteRecente = agora - 30 * DIA_MS;

      return {
        ...emp,
        jornada,
        etapaAtual: currentStageObj ? currentStageObj.stage : "Sem informações",
        diasNaEtapaAtual,
        slaEstouradoAtual,
        totalEstourosSLA,
        isFinalizado,
        linhaScore,
        tipoAtual: (obterTipoEfetivo(emp, agora) || null) as TipoScore | null,
        scoreAtual: calcularScoreEfetivo(emp, agora) ?? null,
        virouSafetyRecente: linhaScore.mudancas.some(
          (m) => m.de === "Fast" && m.para === "Safety" && m.data >= limiteRecente,
        ),
      };
    });
  }, [empresas, ocorrencias, agoraRelatorio]);

  const contagens = useMemo(() => {
    const resultado = {} as Record<FiltroLista, number>;
    (Object.keys(CRITERIOS_LISTA) as FiltroLista[]).forEach((chave) => {
      resultado[chave] = dadosGeraisClientes.filter(CRITERIOS_LISTA[chave]).length;
    });
    return resultado;
  }, [dadosGeraisClientes]);

  const clientesFiltrados = useMemo(() => {
    const termo = searchQuery.trim().toLowerCase();
    return dadosGeraisClientes
      .filter(CRITERIOS_LISTA[filtroLista])
      .filter(
        (c) =>
          !termo ||
          c.nomeEmpresa.toLowerCase().includes(termo) ||
          (c.responsavel || "").toLowerCase().includes(termo),
      )
      .sort((a, b) => prioridadeCliente(a) - prioridadeCliente(b) || a.nomeEmpresa.localeCompare(b.nomeEmpresa, "pt-BR"));
  }, [dadosGeraisClientes, searchQuery, filtroLista]);

  // 6. Dados da empresa selecionada (pode ser ativa ou concluída)
  const empresaSelecionadaObj = useMemo(() => {
    if (!selectedCompanyId) return null;
    return dadosGeraisClientes.find((c) => c.id === selectedCompanyId) || null;
  }, [selectedCompanyId, dadosGeraisClientes]);

  // Define a jornada da empresa selecionada
  const jornadaSelecionada = useMemo(() => empresaSelecionadaObj?.jornada ?? [], [empresaSelecionadaObj]);
  const mostrarMarcoAtual = !!empresaSelecionadaObj && !empresaSelecionadaObj.isFinalizado && !empresaSelecionadaObj.isCancelled &&
    (jornadaSelecionada.at(-1)?.startDate.getTime() ?? Infinity) < empresaSelecionadaObj.linhaScore.fim;

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

    const rAFId = window.requestAnimationFrame(updatePoints);

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

  const linhaSelecionada = empresaSelecionadaObj?.linhaScore ?? null;

  // Cada linha entre duas etapas representa o período da etapa de origem e é pintada com
  // a classificação (Fast/Safety) vigente em cada parte desse período.
  const conectores = useMemo(() => {
    if (!linhaSelecionada || points.length < 2) return [];
    return points.slice(0, -1).map((origem, i) => {
      const geometria = geometriaConector(origem, points[i + 1], trackWidth);
      const de = jornadaSelecionada[i]?.startDate.getTime() ?? 0;
      const ate = jornadaSelecionada[i + 1]?.startDate.getTime() ?? linhaSelecionada.fim;
      const marcadores = ate > de
        ? linhaSelecionada.mudancas
            .map((mudanca, indice) => ({ mudanca, indice }))
            .filter(({ mudanca }) => mudanca.data > de && mudanca.data <= ate)
            .map(({ mudanca, indice }) => ({
              indice,
              mudanca,
              ...geometria.pontoEm((mudanca.data - de) / (ate - de)),
            }))
        : [];
      return { d: geometria.d, fatias: fatiarIntervaloPorTipo(linhaSelecionada, de, ate), marcadores };
    });
  }, [linhaSelecionada, points, trackWidth, jornadaSelecionada]);

  // Define o índice selecionado de etapa de forma dinâmica
  const selectedStageIndex = useMemo(() => {
    if (jornadaSelecionada.length === 0 || selecao?.tipo === "mudanca") return null;
    if (selecao?.tipo === "etapa" && selecao.indice < jornadaSelecionada.length) {
      return selecao.indice;
    }
    // Por padrão, seleciona a última etapa (ou a ativa se houver)
    const activeIdx = jornadaSelecionada.findIndex((s) => s.active);
    return activeIdx !== -1 ? activeIdx : jornadaSelecionada.length - 1;
  }, [jornadaSelecionada, selecao]);

  const mudancaSelecionada =
    selecao?.tipo === "mudanca" ? linhaSelecionada?.mudancas[selecao.indice] ?? null : null;

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
    // Agendas só contam como sessões realizadas quando há uma ocorrência de
    // treinamento finalizadora; o agendamento, sozinho, não comprova realização.
    const treinamentos = jornada.filter((s) => s.stage === "Em treinamento" || s.stage === "Agendamento realizado");
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
        titulo: `${semPassoSLAViolados.length} ${semPassoSLAViolados.length === 1 ? "violação" : "violações"} de SLA (> 4 dias sem passo)`,
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
      return s === "realizado";
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
      const diasPreso = calcularDiasUteis(etapaAtiva.startDate.getTime(), Date.now());
      if (diasPreso > 4) {
        itens.push({
          tipo: "critico",
          emoji: "🔴",
          titulo: `Atualmente sem passo definido há ${diasPreso} dias úteis`,
          descricao: "O cliente está parado agora e já ultrapassou o SLA recomendado de 4 dias úteis. É urgente definir um próximo agendamento.",
        });
      } else if (diasPreso > 0) {
        itens.push({
          tipo: "alerta",
          emoji: "⏰",
          titulo: `Sem próximo passo há ${diasPreso} dia${diasPreso > 1 ? "s" : ""} úteis`,
          descricao: "O cliente está aguardando agendamento. Ainda está dentro do SLA, mas atenção para não ultrapassar 4 dias úteis.",
        });
      }
    }

    // ─── 6. Classificação Fast/Safety ───────────────────────────────
    const quedasSafety = empresaSelecionadaObj.linhaScore.mudancas.filter((m) => m.de === "Fast" && m.para === "Safety");
    if (empresaSelecionadaObj.tipoAtual === "Safety" && !empresaSelecionadaObj.isFinalizado && !empresaSelecionadaObj.isCancelled) {
      itens.push({
        tipo: "alerta",
        emoji: "🛡️",
        titulo: `Atualmente Safety (score ${formatarScore(empresaSelecionadaObj.scoreAtual)})`,
        descricao: "O cliente está abaixo de 6 pontos. Clique nos quadrados da régua para ver o que derrubou o score.",
      });
    }
    if (quedasSafety.length >= 2) {
      itens.push({
        tipo: "alerta",
        emoji: "📉",
        titulo: `Caiu para Safety ${quedasSafety.length} vezes`,
        descricao: "A classificação oscilou ao longo da jornada; vale verificar o padrão de dúvidas e as respostas do score.",
      });
    }

    // ─── 7. Jornada saudável (sem alertas) ─────────────────────────
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
    setSelecao(null);
  };

  const getStageClass = (stage: string) => {
    switch (stage) {
      case "Em treinamento":
        return "treinamento";
      case "Agendamento realizado":
        return "checkpoint";
      case "Checkpoint":
        return "checkpoint";
      case "Sem próximo passo definido":
        return "sem-passo";
      case "Finalizado":
        return "finalizado";
      case "Suspenso":
        return "suspenso";
      case "Cliente Cancelado":
        return "ciente-cancelado";
      default:
        return "";
    }
  };

  // Ícone dinâmico baseado na etapa
  const renderStageIcon = (stage: string, size = 18, statusTreinamento?: string) => {
    switch (stage) {
      case "Agendamento realizado":
        return <Calendar size={size} />;
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
      case "Suspenso":
        return <HelpCircle size={size} />;
      case "Cliente Cancelado":
        return <XCircle size={size} />;
      default:
        return <Info size={size} />;
    }
  };

  return (
    <div className="jornada-container">
      <header className="jornada-introducao">
        <h2>Jornada do cliente</h2>
        <p>Identifique clientes que precisam de atenção e entenda o que mudou durante a capacitação.</p>
      </header>
      {/* 1. Indicadores — cada um filtra a lista de clientes */}
      <div className="jornada-kpis-grid" role="group" aria-label="Indicadores da esteira (clique para filtrar a lista)">
        {(
          [
            { chave: "abertos", rotulo: "Em aberto", desc: "Implantações em andamento", icone: <Activity size={20} />, tom: "info" },
            { chave: "semPasso", rotulo: "Sem próximo passo", desc: "Aguardando agendamento", icone: <Clock size={20} />, tom: "aviso" },
            { chave: "sla", rotulo: "Fora do SLA", desc: "Sem passo há mais de 4 dias úteis", icone: <Flame size={20} />, tom: "critico" },
            { chave: "safety", rotulo: "Safety agora", desc: "Em aberto com score abaixo de 6", icone: <ShieldAlert size={20} />, tom: "critico" },
            { chave: "viraramSafety", rotulo: "Viraram Safety", desc: "Caíram de Fast nos últimos 30 dias", icone: <TrendingDown size={20} />, tom: "aviso" },
          ] as { chave: FiltroLista; rotulo: string; desc: string; icone: React.ReactNode; tom: string }[]
        ).map((kpi) => (
          <button
            key={kpi.chave}
            type="button"
            className={`jornada-kpi-card tom-${kpi.tom} ${filtroLista === kpi.chave ? "ativo" : ""} ${
              kpi.tom === "critico" && contagens[kpi.chave] > 0 ? "com-ocorrencias" : ""
            }`}
            aria-pressed={filtroLista === kpi.chave}
            onClick={() => setFiltroLista(filtroLista === kpi.chave ? "abertos" : kpi.chave)}
          >
            <span className="jornada-kpi-header">
              <span className="jornada-kpi-label">{kpi.rotulo}</span>
              <span className="jornada-kpi-icon" aria-hidden="true">{kpi.icone}</span>
            </span>
            <span className="jornada-kpi-value">{contagens[kpi.chave]}</span>
            <span className="jornada-kpi-desc">{kpi.desc}</span>
          </button>
        ))}
      </div>

      {/* 2. Área principal */}
      <div className="jornada-main-layout">
        {/* Lado Esquerdo: Lista de Clientes */}
        <div className="jornada-section-card">
          <h3 className="jornada-section-title">
            <Building size={18} />
            Clientes
          </h3>

          <div className="jornada-search-wrapper">
            <input
              type="text"
              placeholder="Buscar cliente ou treinador..."
              aria-label="Buscar cliente ou treinador"
              className="jornada-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Search className="jornada-search-icon" size={16} />
          </div>

          <div className="jornada-filtros-lista" role="group" aria-label="Filtrar lista de clientes">
            {(
              [
                ["abertos", "Em aberto"],
                ["sla", "Fora do SLA"],
                ["semPasso", "Sem passo"],
                ["safety", "Safety"],
                ["viraramSafety", "Viraram Safety"],
                ["todos", "Todos"],
              ] as [FiltroLista, string][]
            ).map(([chave, rotulo]) => (
              <button
                key={chave}
                type="button"
                className={`jornada-filtro-chip ${filtroLista === chave ? "ativo" : ""}`}
                aria-pressed={filtroLista === chave}
                onClick={() => setFiltroLista(chave)}
              >
                {rotulo} <span className="jornada-filtro-qtd">{contagens[chave]}</span>
              </button>
            ))}
          </div>
          <p className="jornada-lista-ordem">Ordenado pelos mais críticos primeiro.</p>

          <div className="jornada-clients-list">
            {clientesFiltrados.length > 0 ? (
              clientesFiltrados.map((c) => {
                const isSlaBreached = c.etapaAtual === "Sem próximo passo definido" && c.slaEstouradoAtual;
                let badgeClass = getStageClass(c.etapaAtual);
                if (isSlaBreached) badgeClass = "sem-passo-erro";

                // Clientes cancelados sempre mostram o badge "Cancelado"
                let stageText = c.etapaAtual;
                if (c.isCancelled) {
                  badgeClass = "ciente-cancelado";
                  stageText = "Cancelado";
                } else if (c.etapaAtual === "Em treinamento") {
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
                        {formatarNome(c.responsavel) || "Sem treinador"}
                        {!c.isFinalizado && !c.isCancelled && c.etapaAtual !== "Sem informações" &&
                          ` · ${c.diasNaEtapaAtual} ${c.diasNaEtapaAtual === 1 ? "dia" : "dias"} na etapa`}
                      </span>
                    </div>
                    <div className="jornada-client-badges">
                      <span className={`jornada-tipo-pill ${classeTipo(c.tipoAtual)}`}>
                        {rotuloTipo(c.tipoAtual)}
                      </span>
                      <span className={`jornada-client-stage-badge ${badgeClass}`}>
                        {isSlaBreached ? "SLA Violado" : stageText}
                      </span>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="jornada-empty-state" style={{ padding: "2rem 1rem" }}>
                <p>
                  {searchQuery.trim()
                    ? "Nenhum cliente encontrado para essa busca neste filtro."
                    : "Nenhum cliente neste filtro."}
                </p>
                {filtroLista !== "todos" && (
                  <button type="button" className="jornada-link-btn" onClick={() => setFiltroLista("todos")}>
                    Ver todos os clientes
                  </button>
                )}
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
                  <strong style={{
                    color: empresaSelecionadaObj.isCancelled
                      ? "var(--lt-texto-ef4444, #ef4444)"
                      : empresaSelecionadaObj.isFinalizado
                      ? "var(--lt-texto-10b981, #10b981)"
                      : "var(--lt-texto-3b82f6, #3b82f6)"
                  }}>
                    {empresaSelecionadaObj.isCancelled
                      ? "Cancelado"
                      : empresaSelecionadaObj.isFinalizado
                      ? "Concluído"
                      : "Em aberto"}
                  </strong>
                </div>
                <div className="jornada-detail-info-item">
                  <span>Classificação atual</span>
                  <strong>
                    <span className={`jornada-tipo-pill ${classeTipo(empresaSelecionadaObj.tipoAtual)}`}>
                      {rotuloTipo(empresaSelecionadaObj.tipoAtual)}
                    </span>
                    {empresaSelecionadaObj.scoreAtual !== null && (
                      <span className="jornada-score-valor">score {formatarScore(empresaSelecionadaObj.scoreAtual)}</span>
                    )}
                  </strong>
                </div>
                {empresaSelecionadaObj.totalEstourosSLA > 0 && (
                  <div className="jornada-detail-info-item">
                    <span>Estouros de SLA</span>
                    <strong style={{ color: "var(--lt-texto-ef4444, #ef4444)" }}>
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
                 FAIXA DE CLASSIFICAÇÃO (FAST/SAFETY) AO LONGO DO TEMPO
                 ======================================================== */}
              {linhaSelecionada && (() => {
                const duracao = Math.max(1, linhaSelecionada.fim - linhaSelecionada.inicio);
                const posicao = (t: number) => `${((t - linhaSelecionada.inicio) / duracao) * 100}%`;
                const encerrada = empresaSelecionadaObj.isFinalizado || empresaSelecionadaObj.isCancelled;
                return (
                  <section className="jornada-faixa" aria-labelledby="jornada-faixa-titulo">
                    <div className="jornada-faixa-header">
                      <h5 id="jornada-faixa-titulo" className="jornada-bloco-titulo">Classificação ao longo da jornada</h5>
                      <ul className="jornada-legenda">
                        <li><span className="jornada-legenda-cor fast" aria-hidden="true" />Fast (score ≥ 6)</li>
                        <li><span className="jornada-legenda-cor safety" aria-hidden="true" />Safety (score &lt; 6)</li>
                        <li><span className="jornada-legenda-cor sem-score" aria-hidden="true" />Sem score</li>
                        <li><span className="jornada-legenda-marcador" aria-hidden="true" />Mudança — clique para ver o motivo</li>
                      </ul>
                    </div>
                    <div className="jornada-faixa-barra">
                      {linhaSelecionada.trechos.map((trecho) => {
                        const largura = ((trecho.fim - trecho.inicio) / duracao) * 100;
                        return (
                          <div
                            key={trecho.inicio}
                            className={`jornada-faixa-trecho ${classeTipo(trecho.tipo)} ${trecho.estimado ? "estimado" : ""}`}
                            style={{ left: posicao(trecho.inicio), width: `${largura}%` }}
                            title={`${rotuloTipo(trecho.tipo)}: ${new Date(trecho.inicio).toLocaleDateString("pt-BR")} a ${new Date(trecho.fim).toLocaleDateString("pt-BR")}${trecho.estimado ? " (estimado)" : ""}`}
                          >
                            {largura >= 9 && <b className="jornada-faixa-rotulo">{rotuloTipo(trecho.tipo)}</b>}
                          </div>
                        );
                      })}
                      {linhaSelecionada.mudancas.map((mudanca, indice) => (
                        <button
                          key={mudanca.data}
                          type="button"
                          className={`jornada-mudanca-marcador ${classeTipo(mudanca.para)} ${
                            mudancaSelecionada === mudanca ? "ativo" : ""
                          }`}
                          style={{ left: posicao(mudanca.data) }}
                          aria-label={`${tituloMudanca(mudanca)} em ${new Date(mudanca.data).toLocaleDateString("pt-BR")}. Ver o motivo.`}
                          title={`${tituloMudanca(mudanca)} em ${new Date(mudanca.data).toLocaleDateString("pt-BR")}`}
                          onClick={() => setSelecao({ tipo: "mudanca", indice })}
                        />
                      ))}
                    </div>
                    <div className="jornada-faixa-eixo">
                      <span>{new Date(linhaSelecionada.inicio).toLocaleDateString("pt-BR")}</span>
                      <span>{encerrada ? new Date(linhaSelecionada.fim).toLocaleDateString("pt-BR") : "Hoje"}</span>
                    </div>
                    {linhaSelecionada.mudancas.length === 0 && (
                      <p className="jornada-faixa-nota">
                        {linhaSelecionada.trechos.every((t) => t.tipo === null)
                          ? "Nenhum cálculo de score registrado para este cliente."
                          : "A classificação não mudou ao longo da jornada."}
                      </p>
                    )}
                    {linhaSelecionada.temEstimativa && (
                      <p className="jornada-faixa-nota">
                        Trechos hachurados são estimativas com base no score atual ou em reduções antigas deduzidas
                        das ocorrências. O histórico disponível pode não registrar ajustes removidos ou alterados.
                      </p>
                    )}
                    {linhaSelecionada.mudancas.length > 0 && (
                      <details className="jornada-lista-mudancas" open>
                        <summary>Mudanças de classificação ({linhaSelecionada.mudancas.length})</summary>
                        <ol>
                          {linhaSelecionada.mudancas.map((mudanca, indice) => (
                            <li key={mudanca.data}>
                              <button type="button" aria-pressed={selecao?.tipo === "mudanca" && selecao.indice === indice}
                                onClick={() => setSelecao({ tipo: "mudanca", indice })}>
                                <span className={`jornada-mudanca-icone ${classeTipo(mudanca.para)}`} aria-hidden="true" />
                                <span><strong>{tituloMudanca(mudanca)}</strong>
                                  <small>{new Date(mudanca.data).toLocaleDateString("pt-BR")} · {formatarScore(mudanca.scoreAntes)} → {formatarScore(mudanca.scoreDepois)}{mudanca.estimado ? " · Estimado" : ""}</small>
                                  <small>{mudanca.causas.map((c) => c.texto).join("; ")}</small>
                                </span>
                                <span className="jornada-ver-motivo">Ver motivo</span>
                              </button>
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </section>
                );
              })()}

              {/* ========================================================
                 STEPPER HORIZONTAL INTERATIVO
                 ======================================================== */}
              <div className="jornada-stepper-container">
                <h5 className="jornada-bloco-titulo">Etapas da jornada</h5>
                <p className="jornada-stepper-ajuda">
                  A cor de cada linha mostra a classificação do cliente durante a etapa: verde Fast, vermelho Safety e
                  cinza sem score. Os quadrados marcam quando ele mudou de classificação.
                </p>
                <div className={`jornada-stepper-track ${trackWidth >= 680 ? "use-grid" : ""}`} ref={trackRef}>
                  {conectores.length > 0 && (
                    <svg
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: "100%",
                        pointerEvents: "none",
                        zIndex: 1,
                        overflow: "visible",
                      }}
                    >
                      {conectores.map((conector, i) => (
                        <g key={i}>
                          <path d={conector.d} fill="none" className="jornada-stepper-line" strokeWidth={4} strokeLinecap="round" />
                          {conector.fatias.map((fatia, j) => (
                            <path
                              key={j}
                              d={conector.d}
                              fill="none"
                              pathLength={100}
                              stroke={COR_TIPO[fatia.tipo ?? "nulo"]}
                              strokeWidth={4}
                              strokeLinecap="butt"
                              strokeDasharray={`0 ${fatia.inicio * 100} ${(fatia.fim - fatia.inicio) * 100} 100`}
                            />
                          ))}
                        </g>
                      ))}
                    </svg>
                  )}
                  {conectores.flatMap((conector) => conector.marcadores).map((marcador) => (
                    <button
                      key={marcador.indice}
                      type="button"
                      className={`jornada-mudanca-marcador na-regua ${classeTipo(marcador.mudanca.para)} ${
                        mudancaSelecionada === marcador.mudanca ? "ativo" : ""
                      }`}
                      style={{ left: marcador.x, top: marcador.y }}
                      aria-label={`${tituloMudanca(marcador.mudanca)} em ${new Date(marcador.mudanca.data).toLocaleDateString("pt-BR")}. Ver o motivo.`}
                      title={`${tituloMudanca(marcador.mudanca)} em ${new Date(marcador.mudanca.data).toLocaleDateString("pt-BR")}`}
                      onClick={() => setSelecao({ tipo: "mudanca", indice: marcador.indice })}
                    />
                  ))}
                  {jornadaSelecionada.map((item, idx) => {
                    const isSlaBreached = item.stage === "Sem próximo passo definido" && item.slaBreached;
                    const isSelected = selectedStageIndex === idx;
                    const statusTreinamento = obterStatusTreinamento(item);
                    const statusClass = statusTreinamento === "cancelado" ? "cancelado" : statusTreinamento === "ausente" ? "ausente" : "";

                    const isUseGrid = trackWidth >= 680;
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
                        aria-pressed={isSelected}
                        onClick={() => setSelecao({ tipo: "etapa", indice: idx })}
                      >
                        <div className="jornada-step-circle">
                          {renderStageIcon(item.stage, 16, statusTreinamento)}
                          {item.active && !empresaSelecionadaObj.isFinalizado && (
                            <div className="jornada-step-active-pulse" />
                          )}
                          {item.problemasDuvidas && item.problemasDuvidas.length > 0 && (() => {
                            const qtdProblemas = item.problemasDuvidas!.filter((o) => o.tipo === "Problema").length;
                            const qtdDuvidas = item.problemasDuvidas!.filter((o) => o.tipo === "Dúvida").length;
                            return (
                              <>
                                {qtdProblemas > 0 && (
                                  <div
                                    className="jornada-step-issue-badge problema"
                                    title={`${qtdProblemas} problema(s) registrado(s) neste período. Clique para ver os detalhes.`}
                                  >
                                    {qtdProblemas}
                                  </div>
                                )}
                                {qtdDuvidas > 0 && (
                                  <div
                                    className="jornada-step-issue-badge duvida"
                                    title={`${qtdDuvidas} dúvida(s) registrada(s) neste período. Clique para ver os detalhes.`}
                                  >
                                    {qtdDuvidas}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                        <span className="jornada-step-name">
                          {item.stage === "Finalizado"
                            ? "Finalizado"
                            : item.stage === "Cliente Cancelado"
                            ? "Cliente Cancelado"
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
                  {mostrarMarcoAtual && (() => {
                    const indice = jornadaSelecionada.length;
                    const linha = Math.floor(indice / 5);
                    return <div className="jornada-step-node jornada-step-hoje"
                      style={trackWidth >= 680 ? { gridRow: linha + 1, gridColumn: (linha % 2 ? 4 - indice % 5 : indice % 5) + 1 } : undefined}>
                      <div className="jornada-step-circle"><Clock size={16} aria-hidden="true" /></div>
                      <span className="jornada-step-name">Hoje</span>
                      <span className={`jornada-tipo-pill ${classeTipo(empresaSelecionadaObj.tipoAtual)}`}>
                        {rotuloTipo(empresaSelecionadaObj.tipoAtual)}
                      </span>
                    </div>;
                  })()}
                </div>
              </div>

              {/* ========================================================
                 DETALHE DE UMA MUDANÇA DE CLASSIFICAÇÃO
                 ======================================================== */}
              {mudancaSelecionada && (
                <div ref={detalheMudancaRef} tabIndex={-1} role="region" aria-label="Detalhes da mudança de classificação"
                  className={`jornada-focus-card jornada-mudanca-card ${classeTipo(mudancaSelecionada.para)}`}>
                  <div className="jornada-focus-header">
                    <div className="jornada-focus-title-group">
                      <h4 className="jornada-focus-title">
                        {mudancaSelecionada.para === "Safety" ? (
                          <TrendingDown size={20} aria-hidden="true" />
                        ) : (
                          <TrendingUp size={20} aria-hidden="true" />
                        )}{" "}
                        {tituloMudanca(mudancaSelecionada)}
                      </h4>
                      <div className="jornada-focus-badges">
                        <span className="jornada-stage-badge em-andamento">
                          <Calendar size={12} aria-hidden="true" />
                          {new Date(mudancaSelecionada.data).toLocaleDateString("pt-BR")}
                        </span>
                        {mudancaSelecionada.estimado && (
                          <span className="jornada-stage-badge estimado" title="Inclui reduções antigas deduzidas das ocorrências">
                            Estimado
                          </span>
                        )}
                      </div>
                    </div>
                    <button type="button" className="jornada-link-btn" onClick={() => setSelecao(null)}>
                      <ArrowLeft size={14} aria-hidden="true" /> Voltar para a etapa atual
                    </button>
                  </div>

                  <div className="jornada-mudanca-score">
                    <div>
                      <span>Antes</span>
                      <strong className={classeTipo(mudancaSelecionada.de)}>
                        {rotuloTipo(mudancaSelecionada.de)} · {formatarScore(mudancaSelecionada.scoreAntes)}
                      </strong>
                    </div>
                    <span className="jornada-mudanca-seta" aria-hidden="true">→</span>
                    <div>
                      <span>Depois</span>
                      <strong className={classeTipo(mudancaSelecionada.para)}>
                        {rotuloTipo(mudancaSelecionada.para)} · {formatarScore(mudancaSelecionada.scoreDepois)}
                      </strong>
                    </div>
                    <p>Score efetivo = último cálculo de score − reduções temporárias ativas. Fast a partir de 6 pontos.</p>
                  </div>

                  <div>
                    <h5 className="jornada-focus-oc-header">Por que mudou</h5>
                    <ul className="jornada-causas">
                      {mudancaSelecionada.causas.map((causa: CausaMudanca, i) => (
                        <li key={i} className={`jornada-causa ${causa.natureza}`}>
                          <div className="jornada-causa-linha">
                            <span>{causa.texto}</span>
                            {causa.pontos !== undefined && causa.pontos !== 0 && (
                              <b className={causa.pontos < 0 ? "negativo" : "positivo"}>
                                {causa.pontos > 0 ? "+" : "−"}
                                {formatarScore(Math.abs(causa.pontos))} pt
                              </b>
                            )}
                          </div>
                          {causa.detalhes && (
                            <ul className="jornada-causa-detalhes">
                              {causa.detalhes.map((detalhe) => <li key={detalhe}>{detalhe}</li>)}
                            </ul>
                          )}
                          {causa.ocorrencia?.descricao && causa.natureza !== "calculo" && (
                            <p className="jornada-causa-descricao">“{causa.ocorrencia.descricao.slice(0, 180)}”</p>
                          )}
                          {causa.ocorrencia?.id && (
                            <Link
                              className="jornada-causa-link"
                              to={`/historico?empresa=${encodeURIComponent(empresaSelecionadaObj.nomeEmpresa)}&ocorrencia=${causa.ocorrencia.id}`}
                            >
                              Ver ocorrência {causa.ocorrencia.idSeqFormatted ?? ""} no Histórico
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {mudancaSelecionada.reducoesAtivas.length > 0 && (
                    <div>
                      <h5 className="jornada-focus-oc-header">Reduções valendo a partir desta data</h5>
                      <ul className="jornada-causa-detalhes">
                        {mudancaSelecionada.reducoesAtivas.map((r) => (
                          <li key={`${r.motivo}-${r.inicio}`}>
                            {r.motivo} — até {new Date(r.fim).toLocaleDateString("pt-BR")} (−{formatarScore(r.valor)} pt)
                            {r.estimado ? " · estimada" : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

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
                          : etapaSelecionada.stage === "Cliente Cancelado"
                          ? "🚫 Cliente Cancelado"
                          : etapaSelecionada.stage === "Em treinamento" && focusStatus === "cancelado"
                          ? "❌ Treinamento Cancelado"
                          : etapaSelecionada.stage === "Em treinamento" && focusStatus === "ausente"
                          ? "⚠️ Treinamento Ausente"
                          : etapaSelecionada.stage === "Suspenso"
                          ? "⏸️ Suspenso"
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
                          <span className="jornada-stage-badge cancelado" style={{ background: "rgba(239,68,68,0.15)", color: "var(--lt-texto-f87171, #f87171)", borderColor: "rgba(239,68,68,0.3)" }}>
                            <AlertCircle size={12} style={{ marginRight: 5 }} />
                            Cancelado
                          </span>
                        )}
                        {etapaSelecionada.stage === "Em treinamento" && focusStatus === "ausente" && (
                          <span className="jornada-stage-badge ausente" style={{ background: "rgba(245,158,11,0.15)", color: "var(--lt-texto-fbbf24, #fbbf24)", borderColor: "rgba(245,158,11,0.3)" }}>
                            <AlertCircle size={12} style={{ marginRight: 5 }} />
                            Ausente
                          </span>
                        )}
                        {!etapaSelecionada.active && etapaSelecionada.stage !== "Finalizado" &&
                         etapaSelecionada.stage !== "Cliente Cancelado" &&
                         etapaSelecionada.stage !== "Suspenso" &&
                         !(etapaSelecionada.stage === "Em treinamento" && (focusStatus === "cancelado" || focusStatus === "ausente")) && (
                          <span className="jornada-stage-badge concluido">
                            <CheckCircle size={12} style={{ marginRight: 5 }} />
                            Concluída
                          </span>
                        )}
                        {etapaSelecionada.stage === "Suspenso" && !etapaSelecionada.active && (
                          <span className="jornada-stage-badge concluido" style={{ background: "rgba(245,158,11,0.12)", color: "var(--lt-texto-fbbf24, #fbbf24)", borderColor: "rgba(245,158,11,0.3)" }}>
                            <CheckCircle size={12} style={{ marginRight: 5 }} />
                            Reativado
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

                    {etapaSelecionada.stage !== "Finalizado" && etapaSelecionada.stage !== "Cliente Cancelado" && (
                      <>
                        <div className="jornada-focus-item">
                          <span>
                            <Calendar size={12} />
                            Data de Fim
                          </span>
                          <strong>
                            {(etapaSelecionada.active && !empresaSelecionadaObj.isFinalizado && etapaSelecionada.stage === "Sem próximo passo definido")
                              || (etapaSelecionada.active && etapaSelecionada.stage === "Suspenso")
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
                        {etapaSelecionada.days} dias úteis sem um próximo passo de agendamento definido.
                        O prazo limite recomendado para esta etapa é de no máximo <strong>4 dias úteis</strong>.
                      </div>
                    </div>
                  )}

                  {/* Dúvidas/Problemas registrados durante o período desta etapa */}
                  {etapaSelecionada.problemasDuvidas && etapaSelecionada.problemasDuvidas.length > 0 && (
                    <div className="jornada-focus-ocorrencia-section" style={{ borderTop: "1px solid var(--lt-borda-ffffff0d, rgba(255, 255, 255, 0.05))", paddingTop: "1.25rem" }}>
                      <h5 className="jornada-focus-oc-header">
                        <AlertCircle size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                        Dúvidas / Problemas no Período ({etapaSelecionada.problemasDuvidas.length})
                      </h5>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                        {etapaSelecionada.problemasDuvidas.map((oc, i) => {
                          const isProblema = oc.tipo === "Problema";
                          const corTipo = isProblema ? "#f87171" : "#22d3ee";
                          return (
                            <div
                              key={oc.id || i}
                              className="jornada-focus-desc"
                              style={{ borderLeft: `3px solid ${corTipo}` }}
                            >
                              <h5 style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "6px" }}>
                                <span style={{ color: corTipo, display: "inline-flex", alignItems: "center", gap: 4 }}>
                                  {isProblema ? <AlertCircle size={13} /> : <HelpCircle size={13} />}
                                  {obterInfoTipoOcorrencia(oc).label} ·{" "}
                                  {new Date(oc.createdAt ?? oc.dataOcorrencia ?? 0).toLocaleDateString("pt-BR")}
                                </span>
                                <span style={{ textTransform: "none", fontWeight: 600, color: "var(--lt-texto-94a3b8, #94a3b8)" }}>
                                  {formatarNome(oc.responsavel)}
                                </span>
                              </h5>
                              <p>{oc.descricao}</p>
                              {oc.temaOcorrencia && oc.temaOcorrencia.length > 0 && (
                                <div className="temas-selecionados" style={{ marginTop: "0.75rem" }}>
                                  {oc.temaOcorrencia.map((tema) => (
                                    <span key={tema} className="tema-tag">
                                      {tema}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
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
                        <div className="jornada-focus-item" style={{ background: "var(--lt-fundo-0f172a26, rgba(15,23,42,0.15))" }}>
                          <span>Tipo de Registro</span>
                          <strong>{obterInfoTipoOcorrencia(etapaSelecionada.ocorrencia).label}</strong>
                        </div>
                        <div className="jornada-focus-item" style={{ background: "var(--lt-fundo-0f172a26, rgba(15,23,42,0.15))" }}>
                          <span>Responsável pelo Registro</span>
                          <strong>{formatarNome(etapaSelecionada.ocorrencia.responsavel)}</strong>
                        </div>
                        {etapaSelecionada.ocorrencia.idSeqFormatted && (
                          <div className="jornada-focus-item" style={{ background: "var(--lt-fundo-0f172a26, rgba(15,23,42,0.15))" }}>
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
                            <h5>{etapaSelecionada.stage === "Agendamento realizado" ? "Temas Agendados" : "Temas Abordados"}</h5>
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
                        etapaSelecionada.ocorrencia.treinamentoResultados &&
                        etapaSelecionada.ocorrencia.treinamentoResultados.length > 0 && (
                          <div className="jornada-focus-csat">
                            <h5>Resultado do CSAT</h5>
                            <div className="csat-notas-container">
                              {etapaSelecionada.ocorrencia.treinamentoResultados.map((resultado, nIdx) => (
                                <span
                                  key={nIdx}
                                  className={`csat-nota-badge ${
                                    resultado === "Bom" ? "csat-nota-badge--bom" : "csat-nota-badge--ruim"
                                  }`}
                                >
                                  {resultado}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      {etapaSelecionada.ocorrencia.tipo === "Treinamento" &&
                        etapaSelecionada.ocorrencia.treinamentoNotas &&
                        etapaSelecionada.ocorrencia.treinamentoNotas.length > 0 && (
                          <div className="jornada-focus-csat">
                            <h5>Notas de Satisfação (CSAT, modelo antigo)</h5>
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
                                    {new Date(at.updatedAt || 0).toLocaleDateString("pt-BR")}{" "}
                                    {new Date(at.updatedAt || 0).toLocaleTimeString("pt-BR", {
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
                    <div className="jornada-focus-ocorrencia-section" style={{ borderTop: "1px solid var(--lt-borda-ffffff0d, rgba(255, 255, 255, 0.05))", paddingTop: "1.25rem", marginTop: "1.25rem" }}>
                      <h5 className="jornada-focus-oc-header">
                        <FileText size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                        Ocorrência de Conclusão / Finalização
                      </h5>
                      <p style={{ fontSize: "0.85rem", color: "var(--lt-texto-94a3b8, #94a3b8)", marginBottom: "0.75rem", marginTop: "-0.25rem" }}>
                        Esta etapa foi encerrada/concluída pela seguinte ocorrência:
                      </p>

                      <div className="jornada-focus-grid" style={{ background: "none", padding: 0, border: "none" }}>
                        <div className="jornada-focus-item" style={{ background: "var(--lt-fundo-0f172a26, rgba(15,23,42,0.15))" }}>
                          <span>Tipo de Registro</span>
                          <strong>{obterInfoTipoOcorrencia(etapaSelecionada.ocorrenciaFinalizadora).label}</strong>
                        </div>
                        <div className="jornada-focus-item" style={{ background: "var(--lt-fundo-0f172a26, rgba(15,23,42,0.15))" }}>
                          <span>Responsável pelo Registro</span>
                          <strong>{formatarNome(etapaSelecionada.ocorrenciaFinalizadora.responsavel)}</strong>
                        </div>
                        {etapaSelecionada.ocorrenciaFinalizadora.idSeqFormatted && (
                          <div className="jornada-focus-item" style={{ background: "var(--lt-fundo-0f172a26, rgba(15,23,42,0.15))" }}>
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
                                    {new Date(at.updatedAt || 0).toLocaleDateString("pt-BR")}{" "}
                                    {new Date(at.updatedAt || 0).toLocaleTimeString("pt-BR", {
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
