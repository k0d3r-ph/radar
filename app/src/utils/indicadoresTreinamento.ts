import type { Empresa, LancamentoPonto, Ocorrencia } from "../types";
import { obterCategoriaContatoSuporte } from "./contatosSuporte";

const DIACRITICOS = new RegExp("[\\u0300-\\u036f]", "g");

const normalizarNome = (s?: string) =>
  (s || "").trim().toLowerCase().normalize("NFD").replace(DIACRITICOS, "");

const primeiroNome = (s?: string) => normalizarNome((s || "").trim().split(/\s+/)[0] || "");

/** Fim de semana nunca entra nos indicadores de treinamento: não há expediente nesses dias. */
export function isDiaUtil(data: Date): boolean {
  const dia = data.getDay();
  return dia !== 0 && dia !== 6;
}

/** Datas "yyyy-mm-dd" são lidas no fuso local, como no resto do app (sem deslocar ao converter de/para UTC). */
function parseDataLocalISO(iso?: string): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const data = new Date(y, m - 1, d);
  return isNaN(data.getTime()) ? null : data;
}

function inicioDoDia(data: Date): Date {
  const d = new Date(data);
  d.setHours(0, 0, 0, 0);
  return d;
}

export interface EventoIndicador {
  data: Date;
  /** Nome completo do treinador responsável pelo evento (já resolvido quando possível). */
  treinador: string;
}

export interface EventoEspera extends EventoIndicador {
  dias: number;
}

export interface EventosIndicadoresTreinamento {
  treinamentosRealizados: EventoIndicador[];
  treinamentosAusentes: EventoIndicador[];
  treinamentosCancelados: EventoIndicador[];
  /** Subconjunto de `treinamentosRealizados` que recebeu alguma marcação de CSAT (Bom ou Ruim). */
  treinamentosComResultado: EventoIndicador[];
  treinamentosBons: EventoIndicador[];
  treinamentosRuins: EventoIndicador[];
  esperas: EventoEspera[];
  contatosSuporte: EventoIndicador[];
  atendimentosWhatsApp: EventoIndicador[];
  clientesSuspensos: EventoIndicador[];
  clientesCancelados: EventoIndicador[];
}

export type KpiTreinamentoChave =
  | "treinamentosRealizados"
  | "treinamentosAusentes"
  | "treinamentosCancelados"
  | "taxaCsat"
  | "treinamentosBons"
  | "treinamentosRuins"
  | "tempoMedioEspera"
  | "contatosSuporte"
  | "atendimentosWhatsApp"
  | "clientesSuspensos"
  | "clientesCancelados";

export interface ConfigKpiTreinamento {
  chave: KpiTreinamentoChave;
  titulo: string;
  descricao: string;
  formato: "contagem" | "percentual" | "dias";
  /** Quando true, um valor menor é o resultado desejado (inverte a cor do indicador de variação). */
  menorEhMelhor: boolean;
}

export const KPIS_TREINAMENTO: ConfigKpiTreinamento[] = [
  {
    chave: "treinamentosRealizados",
    titulo: "Treinamentos realizados",
    descricao: "Treinamentos concluídos com sucesso no período (exclui ausências e cancelamentos).",
    formato: "contagem",
    menorEhMelhor: false,
  },
  {
    chave: "treinamentosAusentes",
    titulo: "Treinamentos ausentes",
    descricao: "Treinamentos agendados em que o cliente não compareceu.",
    formato: "contagem",
    menorEhMelhor: true,
  },
  {
    chave: "treinamentosCancelados",
    titulo: "Treinamentos cancelados",
    descricao: "Treinamentos agendados e cancelados antes da realização.",
    formato: "contagem",
    menorEhMelhor: true,
  },
  {
    chave: "taxaCsat",
    titulo: "Taxa CSAT",
    descricao: "Treinamentos realizados que receberam alguma avaliação (Bom ou Ruim), sobre o total de realizados.",
    formato: "percentual",
    menorEhMelhor: false,
  },
  {
    chave: "treinamentosBons",
    titulo: "Treinamento BOM",
    descricao: "Avaliações de CSAT marcadas como Bom.",
    formato: "contagem",
    menorEhMelhor: false,
  },
  {
    chave: "treinamentosRuins",
    titulo: "Treinamento RUIM",
    descricao: "Avaliações de CSAT marcadas como Ruim.",
    formato: "contagem",
    menorEhMelhor: true,
  },
  {
    chave: "tempoMedioEspera",
    titulo: "Tempo médio de espera",
    descricao: "Média de dias entre a solicitação e a realização do treinamento (clientes ativos na esteira).",
    formato: "dias",
    menorEhMelhor: true,
  },
  {
    chave: "contatosSuporte",
    titulo: "Contato com Suporte",
    descricao: "Ocorrências do departamento Suporte atribuídas ao treinador dono do cliente.",
    formato: "contagem",
    menorEhMelhor: true,
  },
  {
    chave: "atendimentosWhatsApp",
    titulo: "Atendimentos WhatsApp",
    descricao: "Ocorrências de dúvida, problema ou solicitação do departamento de Treinamento.",
    formato: "contagem",
    menorEhMelhor: false,
  },
  {
    chave: "clientesSuspensos",
    titulo: "Clientes Suspensos",
    descricao: "Clientes suspensos temporariamente, pela data de suspensão registrada.",
    formato: "contagem",
    menorEhMelhor: true,
  },
  {
    chave: "clientesCancelados",
    titulo: "Clientes cancelados",
    descricao: "Clientes cancelados. Sem um campo de data de cancelamento, usa a data de envio do aviso de WhatsApp como aproximação; cancelamentos sem esse envio não aparecem na linha do tempo.",
    formato: "contagem",
    menorEhMelhor: true,
  },
];

export const KPI_POR_CHAVE: Record<KpiTreinamentoChave, ConfigKpiTreinamento> = KPIS_TREINAMENTO.reduce(
  (acc, kpi) => {
    acc[kpi.chave] = kpi;
    return acc;
  },
  {} as Record<KpiTreinamentoChave, ConfigKpiTreinamento>,
);

const temasDoLancamento = (l: LancamentoPonto) =>
  (l.treinamentoTema || "").split(",").map((t) => t.trim().toLowerCase());

/**
 * Constrói os eventos datados de todos os indicadores de treinamento a partir das
 * três fontes já usadas no modal de Indicadores da Gamificação (lançamentos de
 * pontos, ocorrências e carteira de clientes), para manter os números consistentes
 * entre as duas telas.
 */
export function construirEventosIndicadoresTreinamento(
  empresas: Empresa[],
  ocorrencias: Ocorrencia[],
  lancamentos: LancamentoPonto[],
  treinadores: { nome: string }[],
): EventosIndicadoresTreinamento {
  const nomePorPrimeiroNome = new Map<string, string>();
  treinadores.forEach((t) => {
    const chave = primeiroNome(t.nome);
    if (chave && !nomePorPrimeiroNome.has(chave)) nomePorPrimeiroNome.set(chave, t.nome.trim());
  });

  // A empresa guarda o responsável pelo primeiro nome (às vezes com sobrenome), então
  // resolve sempre pelo primeiro nome para cair no mesmo treinador independente do formato salvo.
  const resolverTreinador = (responsavel?: string): string | null => {
    const chave = primeiroNome(responsavel);
    if (!chave) return null;
    return nomePorPrimeiroNome.get(chave) || responsavel?.trim() || null;
  };

  const responsavelPorEmpresa = new Map<string, string>();
  empresas.forEach((e) => {
    const chaveEmpresa = normalizarNome(e.nomeEmpresa);
    if (!chaveEmpresa) return;
    const dono = resolverTreinador(e.responsavel);
    if (dono) responsavelPorEmpresa.set(chaveEmpresa, dono);
  });

  const empresasAtivasNaEsteira = new Set<string>();
  empresas.forEach((e) => {
    if (e.isCancelled || e.isSuspended || e.isOngoing) return;
    const chave = normalizarNome(e.nomeEmpresa);
    if (chave) empresasAtivasNaEsteira.add(chave);
  });

  const treinamentosRealizados: EventoIndicador[] = [];
  const treinamentosAusentes: EventoIndicador[] = [];
  const treinamentosCancelados: EventoIndicador[] = [];
  const treinamentosComResultado: EventoIndicador[] = [];
  const treinamentosBons: EventoIndicador[] = [];
  const treinamentosRuins: EventoIndicador[] = [];
  const esperas: EventoEspera[] = [];

  lancamentos
    .filter((l) => l.tipoAcao === "treinamento" && l.treinamentoTema)
    .forEach((l) => {
      const treinador = l.treinadorNome?.trim();
      if (!treinador) return;

      const data =
        parseDataLocalISO(l.treinamentoDataRealizacao) || inicioDoDia(new Date(l.dataLancamento));
      const evento: EventoIndicador = { data, treinador };
      const temas = temasDoLancamento(l);

      if (temas.includes("ausente")) {
        treinamentosAusentes.push(evento);
        return;
      }
      if (temas.includes("cancelado")) {
        treinamentosCancelados.push(evento);
        return;
      }

      treinamentosRealizados.push(evento);

      const resultados = l.treinamentoResultados || [];
      if (resultados.length > 0) {
        treinamentosComResultado.push(evento);
        resultados.forEach((r) => {
          if (r === "Bom") treinamentosBons.push(evento);
          else if (r === "Ruim") treinamentosRuins.push(evento);
        });
      }

      if (empresasAtivasNaEsteira.has(normalizarNome(l.treinamentoEmpresa))) {
        const inicio = parseDataLocalISO(l.treinamentoDataSolicitacao);
        const fim = parseDataLocalISO(l.treinamentoDataRealizacao);
        if (inicio && fim) {
          const dias = Math.round((fim.getTime() - inicio.getTime()) / 86_400_000);
          if (dias >= 0) esperas.push({ ...evento, dias });
        }
      }
    });

  const contatosSuporte: EventoIndicador[] = [];
  const atendimentosWhatsApp: EventoIndicador[] = [];

  ocorrencias.forEach((o) => {
    const timestamp = o.dataOcorrencia || o.createdAt;
    if (!timestamp) return;
    const data = inicioDoDia(new Date(timestamp));

    if (o.departamento === "Suporte") {
      // Contato de Suporte mede a carga do cliente, então conta para o treinador dono
      // do cliente, não para quem eventualmente registrou a ocorrência.
      const dono = responsavelPorEmpresa.get(normalizarNome(o.empresa));
      if (dono) contatosSuporte.push({ data, treinador: dono });
      return;
    }

    if (o.departamento === "Treinamento") {
      const categoria = obterCategoriaContatoSuporte(o);
      if (categoria === "duvidas" || categoria === "problemas" || categoria === "solicitacoes") {
        const treinador = resolverTreinador(o.responsavel);
        if (treinador) atendimentosWhatsApp.push({ data, treinador });
      }
    }
  });

  const clientesSuspensos: EventoIndicador[] = [];
  const clientesCancelados: EventoIndicador[] = [];

  empresas.forEach((e) => {
    const treinador = resolverTreinador(e.responsavel);
    if (!treinador) return;

    if (e.isSuspended) {
      const data = parseDataLocalISO(e.dataSuspensao);
      if (data) clientesSuspensos.push({ data, treinador });
    }

    if (e.isCancelled && e.whatsappEnviadoEmCancelamento) {
      const data = inicioDoDia(new Date(e.whatsappEnviadoEmCancelamento));
      clientesCancelados.push({ data, treinador });
    }
  });

  return {
    treinamentosRealizados,
    treinamentosAusentes,
    treinamentosCancelados,
    treinamentosComResultado,
    treinamentosBons,
    treinamentosRuins,
    esperas,
    contatosSuporte,
    atendimentosWhatsApp,
    clientesSuspensos,
    clientesCancelados,
  };
}

function dentroDoPeriodo(evento: EventoIndicador, inicio: Date, fim: Date): boolean {
  if (!isDiaUtil(evento.data)) return false;
  const t = evento.data.getTime();
  return t >= inicio.getTime() && t <= fim.getTime();
}

function filtrarPorTreinador<T extends EventoIndicador>(lista: T[], treinador: string | null): T[] {
  if (!treinador) return lista;
  const chave = normalizarNome(treinador);
  return lista.filter((e) => normalizarNome(e.treinador) === chave);
}

/**
 * Valor de um KPI de treinamento num período e, opcionalmente, para um único
 * treinador. Retorna `null` quando não há amostra suficiente (taxa CSAT e tempo
 * médio de espera não têm "zero" — significam ausência de dado, não desempenho nulo).
 */
export function calcularValorKpiTreinamento(
  chave: KpiTreinamentoChave,
  eventos: EventosIndicadoresTreinamento,
  inicio: Date,
  fim: Date,
  treinador: string | null,
): number | null {
  const filtra = <T extends EventoIndicador>(lista: T[]) =>
    filtrarPorTreinador(lista, treinador).filter((e) => dentroDoPeriodo(e, inicio, fim));

  switch (chave) {
    case "treinamentosRealizados":
      return filtra(eventos.treinamentosRealizados).length;
    case "treinamentosAusentes":
      return filtra(eventos.treinamentosAusentes).length;
    case "treinamentosCancelados":
      return filtra(eventos.treinamentosCancelados).length;
    case "treinamentosBons":
      return filtra(eventos.treinamentosBons).length;
    case "treinamentosRuins":
      return filtra(eventos.treinamentosRuins).length;
    case "contatosSuporte":
      return filtra(eventos.contatosSuporte).length;
    case "atendimentosWhatsApp":
      return filtra(eventos.atendimentosWhatsApp).length;
    case "clientesSuspensos":
      return filtra(eventos.clientesSuspensos).length;
    case "clientesCancelados":
      return filtra(eventos.clientesCancelados).length;
    case "taxaCsat": {
      const realizados = filtra(eventos.treinamentosRealizados).length;
      if (realizados === 0) return null;
      const comResultado = filtra(eventos.treinamentosComResultado).length;
      return (comResultado / realizados) * 100;
    }
    case "tempoMedioEspera": {
      const amostra = filtra(eventos.esperas);
      if (amostra.length === 0) return null;
      return amostra.reduce((acc, e) => acc + e.dias, 0) / amostra.length;
    }
    default:
      return null;
  }
}

export interface PeriodoIndicador {
  inicio: Date;
  fim: Date;
  categoria: string;
}

/** Teto de colunas geradas por {@link gerarPeriodosIndicadoresEntreDatas}, para um período
 * personalizado muito largo (ex.: vários anos em granularidade "dia") não travar a tela
 * nem virar uma tabela impraticável; mantém sempre os períodos mais recentes do intervalo. */
const LIMITE_PERIODOS = 180;

/**
 * Períodos (dias úteis ou semanas) entre duas datas, inclusive, para montar o eixo X do
 * gráfico e as colunas do painel analítico. Dias de fim de semana nunca entram como
 * categoria própria. Em "semana", os limites de cada período são sempre segunda a domingo
 * (a primeira e a última semana podem extrapolar o intervalo pedido).
 */
export function gerarPeriodosIndicadoresEntreDatas(
  dataInicio: Date,
  dataFim: Date,
  granularidade: "dia" | "semana",
): PeriodoIndicador[] {
  const periodos: PeriodoIndicador[] = [];
  const inicio = inicioDoDia(dataInicio);
  const fim = inicioDoDia(dataFim);
  if (inicio.getTime() > fim.getTime()) return periodos;

  if (granularidade === "dia") {
    const cursor = new Date(inicio);
    while (cursor.getTime() <= fim.getTime()) {
      if (isDiaUtil(cursor)) {
        const diaInicio = new Date(cursor);
        const diaFim = new Date(cursor);
        diaFim.setHours(23, 59, 59, 999);
        periodos.push({
          inicio: diaInicio,
          fim: diaFim,
          categoria: diaInicio.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return periodos.length > LIMITE_PERIODOS ? periodos.slice(-LIMITE_PERIODOS) : periodos;
  }

  // Semana: segunda a domingo, começando na semana de `inicio` até a semana de `fim`.
  const diaDaSemanaInicio = inicio.getDay();
  const deslocamentoAteSegunda = diaDaSemanaInicio === 0 ? 6 : diaDaSemanaInicio - 1;
  const cursor = new Date(inicio);
  cursor.setDate(cursor.getDate() - deslocamentoAteSegunda);

  while (cursor.getTime() <= fim.getTime()) {
    const semanaInicio = new Date(cursor);
    const semanaFim = new Date(cursor);
    semanaFim.setDate(semanaFim.getDate() + 6);
    semanaFim.setHours(23, 59, 59, 999);
    periodos.push({
      inicio: semanaInicio,
      fim: semanaFim,
      categoria: semanaInicio.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    });
    cursor.setDate(cursor.getDate() + 7);
  }
  return periodos.length > LIMITE_PERIODOS ? periodos.slice(-LIMITE_PERIODOS) : periodos;
}

/** Nomes distintos de treinadores com algum evento registrado, para o filtro da tela. */
export function listarTreinadoresComEventos(eventos: EventosIndicadoresTreinamento): string[] {
  const nomes = new Set<string>();
  (Object.keys(eventos) as (keyof EventosIndicadoresTreinamento)[]).forEach((chave) => {
    eventos[chave].forEach((e) => nomes.add(e.treinador));
  });
  return Array.from(nomes).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function formatarValorKpiTreinamento(chave: KpiTreinamentoChave, valor: number | null): string {
  if (valor === null) return "—";
  const cfg = KPI_POR_CHAVE[chave];
  if (cfg.formato === "percentual") return `${valor.toFixed(1).replace(".", ",")}%`;
  if (cfg.formato === "dias") return `${valor.toFixed(1).replace(".", ",")} dias`;
  return `${Math.round(valor)}`;
}
