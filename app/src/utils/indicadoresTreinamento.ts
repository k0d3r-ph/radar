import type { Empresa, LancamentoPonto, Ocorrencia, MotivoEsperaTreinamento } from "../types";
import { filtrarEmpresasContatosSuporte, obterCategoriaContatoSuporte } from "./contatosSuporte";
import { calcularDiasEsperaTreinamento, LIMITE_ESPERA_LONGA_TREINAMENTO, motivoEsperaValido } from "./esperaTreinamento";
import { obterPrimeiroTreinamentoRealizado } from "./prazoTreinamento";

const DIACRITICOS = new RegExp("[\\u0300-\\u036f]", "g");

const normalizarNome = (s?: string) =>
  (s || "").trim().toLowerCase().normalize("NFD").replace(DIACRITICOS, "");

const primeiroNome = (s?: string) => normalizarNome((s || "").trim().split(/\s+/)[0] || "");

/** Variações históricas confirmadas da mesma pessoa; não agrupa homônimos por aproximação. */
const ALIASES_TREINADORES: Record<string, string> = {
  "jeff borges da costa": "Jeff Costa",
  "jeff costa": "Jeff Costa",
};

function padronizarNomeTreinador(nome?: string): string {
  return ALIASES_TREINADORES[normalizarNome(nome)] ?? nome?.trim() ?? "";
}

/** Todos os indicadores consideram somente dias úteis (segunda a sexta). */
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
  motivo?: MotivoEsperaTreinamento | null;
  empresa?: string;
  ocorrenciaId?: string;
}

export interface EventoClienteSuspenso extends EventoIndicador {
  empresa: string;
  /** Fim da suspensão; ausente enquanto o cliente continua suspenso. */
  dataFim?: Date;
  /** O cadastro está suspenso, mas não há data nem ocorrência para datar o início. */
  inicioDesconhecido?: boolean;
}

export interface EventoTempoPrimeiroTreinamento extends EventoIndicador {
  dias: number;
  empresa: string;
}

export interface EventoNotaCsat extends EventoIndicador {
  nota: number;
  empresa?: string;
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
  /** Ocorrências de Suporte importadas do SSX Desk de clientes em treinamento (não ongoing, não cancelados). */
  contatosSuporteTreinamento: EventoIndicador[];
  atendimentosWhatsApp: EventoIndicador[];
  clientesSuspensos: EventoClienteSuspenso[];
  clientesCancelados: EventoIndicador[];
  /** Dias corridos entre a entrada do cliente na esteira e o primeiro treinamento realizado. */
  temposPrimeiroTreinamento: EventoTempoPrimeiroTreinamento[];
  /** Avaliações de CSAT no modelo de estrelas (1 a 5), por participante. */
  avaliacoesCsatEstrelas: EventoNotaCsat[];
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
  | "contatosSuporteTreinamento"
  | "atendimentosWhatsApp"
  | "clientesSuspensos"
  | "clientesCancelados"
  | "tempoPrimeiroTreinamento"
  | "csatTreinamento";

/** Complementos dos cartões, sobre os mesmos totais já filtrados do relatório. */
export function calcularResumoCardsTreinamento(
  valores: Partial<Record<KpiTreinamentoChave, number | null>>,
  inicio: Date,
  fim: Date,
) {
  // Conta o calendário completo, sem o limite de 180 pontos usado pelo gráfico.
  const numeroDia = (data: Date) => Date.UTC(data.getFullYear(), data.getMonth(), data.getDate()) / 86_400_000;
  const quantidadeDias = numeroDia(fim) - numeroDia(inicio) + 1;
  let diasUteis = 0;
  if (Number.isFinite(quantidadeDias) && quantidadeDias > 0) {
    diasUteis = Math.floor(quantidadeDias / 7) * 5;
    const cursor = inicioDoDia(inicio);
    for (let i = 0; i < quantidadeDias % 7; i++) {
      if (isDiaUtil(cursor)) diasUteis++;
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  const chaves = ["treinamentosRealizados", "treinamentosAusentes", "treinamentosCancelados"] as const;
  const totalTreinamentos = chaves.reduce((total, chave) => total + (valores[chave] ?? 0), 0);
  const percentuais: Partial<Record<KpiTreinamentoChave, number | null>> = {};
  chaves.forEach((chave) => {
    percentuais[chave] = totalTreinamentos > 0 ? (valores[chave] ?? 0) / totalTreinamentos * 100 : null;
  });
  return {
    percentuais,
    totalTreinamentos,
    diasUteis,
    mediaSuporte: diasUteis > 0 && valores.contatosSuporte != null ? valores.contatosSuporte / diasUteis : null,
  };
}

export interface ConfigKpiTreinamento {
  chave: KpiTreinamentoChave;
  titulo: string;
  descricao: string;
  formato: "contagem" | "percentual" | "dias" | "diasCorridos" | "nota";
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
    descricao: "Média de dias úteis (segunda a sexta) entre a solicitação e a realização do treinamento, incluindo clientes ongoing, suspensos e cancelados.",
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
    descricao: "Clientes que estavam suspensos no fim do período selecionado.",
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
  {
    chave: "tempoPrimeiroTreinamento",
    titulo: "Tempo até o primeiro treinamento",
    descricao: "Dias corridos entre a entrada do cliente na esteira e a realização do primeiro treinamento.",
    formato: "diasCorridos",
    menorEhMelhor: true,
  },
  {
    chave: "contatosSuporteTreinamento",
    titulo: "Contatos com Suporte atribuíveis a treinamento",
    descricao: "Ocorrências de Suporte importadas do SSX Desk de clientes em treinamento (não ongoing, não cancelados).",
    formato: "contagem",
    menorEhMelhor: true,
  },
  {
    chave: "csatTreinamento",
    titulo: "CSAT do treinamento",
    descricao: "Média das notas de 1 a 5 estrelas recebidas no período. Avaliações antigas no modelo Bom/Ruim não entram nesta média.",
    formato: "nota",
    menorEhMelhor: false,
  },
];

export const KPI_POR_CHAVE: Record<KpiTreinamentoChave, ConfigKpiTreinamento> = KPIS_TREINAMENTO.reduce(
  (acc, kpi) => {
    acc[kpi.chave] = kpi;
    return acc;
  },
  {} as Record<KpiTreinamentoChave, ConfigKpiTreinamento>,
);

/** Preserva no relatório quem realizou treinamentos, mesmo após mudar de perfil ou sair da equipe. */
export function listarTreinadoresIndicadoresTreinamento(
  treinadoresAtuais: string[],
  lancamentos: LancamentoPonto[],
  ocorrencias: Ocorrencia[] = [],
): string[] {
  const nomes = new Map<string, string>();
  const adicionar = (nome?: string) => {
    const padronizado = padronizarNomeTreinador(nome);
    const chave = normalizarNome(padronizado);
    if (chave && !chave.includes("painel") && !nomes.has(chave)) {
      nomes.set(chave, padronizado);
    }
  };
  treinadoresAtuais.forEach(adicionar);
  lancamentos.forEach((l) => {
    if (l.tipoAcao === "treinamento") adicionar(l.treinadorNome);
  });
  const historicos = ocorrencias.filter((o) => o.tipo === "Treinamento")
    .map((o) => o.responsavel?.trim() || "Não informado");
  // Cadastra nomes completos antes dos primeiros nomes dos registros antigos.
  historicos.filter((nome) => nome.includes(" ")).forEach(adicionar);
  historicos.filter((nome) => !nome.includes(" ")).forEach((nome) => {
    const candidatos = [...nomes.values()].filter((n) => primeiroNome(n) === primeiroNome(nome));
    if (candidatos.length !== 1) adicionar(nome);
  });
  return Array.from(nomes.values()).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/**
 * Constrói os eventos datados de todos os indicadores de treinamento a partir das
 * ocorrências como fonte dos treinamentos. Lançamentos vinculados complementam
 * dados ausentes, mas não geram eventos extras nem alteram cliente/data da ocorrência.
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
    if (chave && !nomePorPrimeiroNome.has(chave)) nomePorPrimeiroNome.set(chave, padronizarNomeTreinador(t.nome));
  });

  // A empresa guarda o responsável pelo primeiro nome (às vezes com sobrenome), então
  // resolve sempre pelo primeiro nome para cair no mesmo treinador independente do formato salvo.
  const resolverTreinador = (responsavel?: string): string | null => {
    const chave = primeiroNome(responsavel);
    if (!chave) return null;
    return nomePorPrimeiroNome.get(chave) || padronizarNomeTreinador(responsavel) || null;
  };

  const responsavelPorEmpresa = new Map<string, string>();
  const historicoSuspensoesPorEmpresa = new Map<string, Ocorrencia[]>();
  empresas.forEach((e) => {
    const chaveEmpresa = normalizarNome(e.nomeEmpresa);
    if (!chaveEmpresa) return;
    const dono = resolverTreinador(e.responsavel);
    if (dono) responsavelPorEmpresa.set(chaveEmpresa, dono);
  });
  ocorrencias.forEach((ocorrencia) => {
    if (!ocorrencia.suspenderCliente && !ocorrencia.retornarEsteira) return;
    const chaveEmpresa = normalizarNome(ocorrencia.empresa);
    if (!chaveEmpresa) return;
    const historico = historicoSuspensoesPorEmpresa.get(chaveEmpresa) ?? [];
    historico.push(ocorrencia);
    historicoSuspensoesPorEmpresa.set(chaveEmpresa, historico);
  });

  // Clientes de todos os status, inclusive ongoing: o treinamento é dado da equipe
  // independentemente da situação do cliente. A espera exige cadastro atual.
  const empresasCadastradas = new Set<string>();
  empresas.forEach((e) => {
    const chave = normalizarNome(e.nomeEmpresa);
    if (chave) empresasCadastradas.add(chave);
  });

  const treinamentosRealizados: EventoIndicador[] = [];
  const treinamentosAusentes: EventoIndicador[] = [];
  const treinamentosCancelados: EventoIndicador[] = [];
  const treinamentosComResultado: EventoIndicador[] = [];
  const treinamentosBons: EventoIndicador[] = [];
  const treinamentosRuins: EventoIndicador[] = [];
  const esperas: EventoEspera[] = [];
  const avaliacoesCsatEstrelas: EventoNotaCsat[] = [];

  const lancamentosPorId = new Map(lancamentos.filter((l) => l.id).map((l) => [l.id, l]));
  const lancamentosPorOcorrencia = new Map<string, LancamentoPonto>();
  lancamentos.forEach((l) => {
    if (l.tipoAcao === "treinamento" && l.ocorrenciaId && !lancamentosPorOcorrencia.has(l.ocorrenciaId)) {
      lancamentosPorOcorrencia.set(l.ocorrenciaId, l);
    }
  });

  const nomesCanonicos = new Map(treinadores.map((t) => {
    const nome = padronizarNomeTreinador(t.nome);
    return [normalizarNome(nome), nome];
  }));
  const resolverAutorTreinamento = (nome?: string): string => {
    const padronizado = padronizarNomeTreinador(nome);
    const chave = normalizarNome(padronizado);
    if (!chave) return "Não informado";
    const exato = nomesCanonicos.get(chave);
    if (exato) return exato;
    if (!chave.includes(" ")) {
      const candidatos = [...nomesCanonicos.values()].filter((n) => primeiroNome(n) === chave);
      if (candidatos.length === 1) return candidatos[0];
    }
    return padronizado || "Não informado";
  };
  const ocorrenciasProcessadas = new Set<string>();
  ocorrencias.filter((o) => o.tipo === "Treinamento").forEach((o) => {
    if (o.id) {
      if (ocorrenciasProcessadas.has(o.id)) return;
      ocorrenciasProcessadas.add(o.id);
    }
    const empresa = normalizarNome(o.empresa);
    const timestamp = o.createdAt ?? o.dataOcorrencia;
    if (!timestamp || !Number.isFinite(timestamp)) return;
    const data = inicioDoDia(new Date(timestamp));
    if (Number.isNaN(data.getTime())) return;
    const vinculado = (o.gamificacaoPontoId ? lancamentosPorId.get(o.gamificacaoPontoId) : undefined)
      ?? (o.id ? lancamentosPorOcorrencia.get(o.id) : undefined);
    const l = vinculado?.tipoAcao === "treinamento" ? vinculado : undefined;
    const treinador = resolverAutorTreinamento(o.responsavel || l?.treinadorNome);
    const evento: EventoIndicador = { data, treinador };
    // Mesmo critério do filtro "Treinamento (Rea.)" do Histórico, inclusive tema vazio.
    const temas = (o.temaOcorrencia || []).map((t) => t.trim().toLowerCase());

    if (temas.includes("ausente")) {
      treinamentosAusentes.push(evento);
      return;
    }
    if (temas.includes("cancelado")) {
      treinamentosCancelados.push(evento);
      return;
    }

    treinamentosRealizados.push(evento);

    const resultados = o.treinamentoResultados
      ?? o.csatRespostas?.map((r) => r.experiencia)
      ?? l?.treinamentoResultados ?? [];
    if (resultados.length > 0) {
      treinamentosComResultado.push(evento);
      resultados.forEach((r) => {
        if (r === "Bom") treinamentosBons.push(evento);
        else if (r === "Ruim") treinamentosRuins.push(evento);
      });
    }
    (o.csatRespostas || []).forEach((r) => {
      if (Number.isInteger(r.nota) && r.nota! >= 1 && r.nota! <= 5) {
        avaliacoesCsatEstrelas.push({ ...evento, nota: r.nota!, empresa: o.empresa });
      }
    });

    if (empresasCadastradas.has(empresa)) {
      const realizacao = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
      const dias = calcularDiasEsperaTreinamento(o.treinamentoDataSolicitacao ?? l?.treinamentoDataSolicitacao, realizacao);
      if (dias !== null) esperas.push({
        ...evento, dias, empresa: o.empresa, ocorrenciaId: o.id,
        motivo: dias >= LIMITE_ESPERA_LONGA_TREINAMENTO && motivoEsperaValido(o.treinamentoMotivoEspera)
          ? o.treinamentoMotivoEspera : null,
      });
    }
  });

  const contatosSuporte: EventoIndicador[] = [];
  const contatosSuporteTreinamento: EventoIndicador[] = [];
  const atendimentosWhatsApp: EventoIndicador[] = [];
  // Cliente "em treinamento" para o indicador de contatos de Suporte vindos do SSX Desk:
  // mesmo filtro do relatório de Suporte (clientes na esteira e suspensos, sem concluídos),
  // para os dois relatórios ficarem comparáveis.
  const empresasEmTreinamentoPorNome = new Map<string, boolean>();
  const empresasElegiveisContatoSuporte = new Set(
    filtrarEmpresasContatosSuporte(empresas)
      .map((e) => normalizarNome(e.nomeEmpresa))
      .filter(Boolean),
  );
  empresas.forEach((e) => {
    const chave = normalizarNome(e.nomeEmpresa);
    if (chave) empresasEmTreinamentoPorNome.set(chave, empresasElegiveisContatoSuporte.has(chave));
  });

  ocorrencias.forEach((o) => {
    const timestamp = o.dataOcorrencia || o.createdAt;
    if (!timestamp) return;
    const data = inicioDoDia(new Date(timestamp));

    if (o.departamento === "Suporte") {
      // Contato de Suporte mede a carga do cliente, então conta para o treinador dono
      // do cliente, não para quem eventualmente registrou a ocorrência.
      const dono = responsavelPorEmpresa.get(normalizarNome(o.empresa));
      if (dono) contatosSuporte.push({ data, treinador: dono });
      if (o.origem === "ssx-desk" && dono && empresasEmTreinamentoPorNome.get(normalizarNome(o.empresa))) {
        contatosSuporteTreinamento.push({ data, treinador: dono });
      }
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

  const clientesSuspensos: EventoClienteSuspenso[] = [];
  const clientesCancelados: EventoIndicador[] = [];
  const temposPrimeiroTreinamento: EventoTempoPrimeiroTreinamento[] = [];

  empresas.forEach((e) => {
    const treinador = resolverTreinador(e.responsavel);
    if (!treinador) return;

    const transicoes = (historicoSuspensoesPorEmpresa.get(normalizarNome(e.nomeEmpresa)) ?? [])
      .map((ocorrencia) => ({
        ocorrencia,
        instante: ocorrencia.updatedAt || ocorrencia.createdAt || ocorrencia.dataOcorrencia || 0,
      }))
      .filter(({ instante }) => Number.isFinite(instante) && instante > 0)
      .sort((a, b) => a.instante - b.instante);
    let inicioSuspensao: Date | null = null;
    for (const { ocorrencia, instante } of transicoes) {
      if (ocorrencia.suspenderCliente) {
        if (!inicioSuspensao) inicioSuspensao = new Date(instante);
      } else if (ocorrencia.retornarEsteira && inicioSuspensao) {
        clientesSuspensos.push({
          data: inicioSuspensao,
          dataFim: new Date(instante),
          treinador,
          empresa: e.nomeEmpresa,
        });
        inicioSuspensao = null;
      }
    }

    if (e.isSuspended) {
      const inicioCadastrado = parseDataLocalISO(e.dataSuspensao);
      if (inicioSuspensao) {
        clientesSuspensos.push({
          data: inicioCadastrado ?? inicioSuspensao,
          treinador,
          empresa: e.nomeEmpresa,
        });
      } else {
        clientesSuspensos.push({
          data: inicioCadastrado ?? new Date(),
          treinador,
          empresa: e.nomeEmpresa,
          inicioDesconhecido: !inicioCadastrado,
        });
      }
    } else if (inicioSuspensao) {
      const fimCadastro = e.updatedAt && Number.isFinite(e.updatedAt)
        ? new Date(e.updatedAt)
        : null;
      if (fimCadastro && fimCadastro > inicioSuspensao) {
        clientesSuspensos.push({
          data: inicioSuspensao,
          dataFim: fimCadastro,
          treinador,
          empresa: e.nomeEmpresa,
        });
      }
    }

    const dataEntrada = parseDataLocalISO(e.dataEntrada);
    const primeiroTreinamento = obterPrimeiroTreinamentoRealizado(ocorrencias, e.nomeEmpresa);
    if (dataEntrada && primeiroTreinamento) {
      const dias = Math.round((inicioDoDia(primeiroTreinamento).getTime() - inicioDoDia(dataEntrada).getTime()) / 86_400_000);
      if (dias >= 0) temposPrimeiroTreinamento.push({ data: inicioDoDia(primeiroTreinamento), treinador, dias, empresa: e.nomeEmpresa });
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
    contatosSuporteTreinamento,
    atendimentosWhatsApp,
    temposPrimeiroTreinamento,
    avaliacoesCsatEstrelas,
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
  const chave = normalizarNome(padronizarNomeTreinador(treinador));
  return lista.filter((e) => normalizarNome(padronizarNomeTreinador(e.treinador)) === chave);
}

function estavaSuspensoNoFim(evento: EventoClienteSuspenso, fim: Date): boolean {
  return evento.data.getTime() <= fim.getTime()
    && (!evento.dataFim || evento.dataFim.getTime() > fim.getTime());
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
      return filtrarPorTreinador(eventos.clientesSuspensos, treinador)
        .filter((evento) => estavaSuspensoNoFim(evento, fim)).length;
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
    case "contatosSuporteTreinamento":
      return filtra(eventos.contatosSuporteTreinamento).length;
    case "tempoPrimeiroTreinamento": {
      const amostra = filtra(eventos.temposPrimeiroTreinamento);
      if (amostra.length === 0) return null;
      return amostra.reduce((acc, e) => acc + e.dias, 0) / amostra.length;
    }
    case "csatTreinamento": {
      const amostra = filtra(eventos.avaliacoesCsatEstrelas);
      if (amostra.length === 0) return null;
      return amostra.reduce((acc, e) => acc + e.nota, 0) / amostra.length;
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

export interface ReferenciasSnapshotSuspensos {
  atual: Date;
  ontem: Date;
  semanaPassada: Date;
  mesPassado: Date;
}

/** Marcos para comparar a contagem atual com snapshots de calendário em Brasília. */
export function gerarReferenciasSnapshotSuspensos(agora: Date): ReferenciasSnapshotSuspensos {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(agora);
  const obterParte = (tipo: Intl.DateTimeFormatPartTypes) =>
    Number(partes.find((parte) => parte.type === tipo)?.value);
  const ano = obterParte("year");
  const mes = obterParte("month");
  const dia = obterParte("day");
  const inicioHoje = Date.UTC(ano, mes - 1, dia, 3);
  const diaDaSemana = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
  const diasDesdeSegunda = diaDaSemana === 0 ? 6 : diaDaSemana - 1;
  const inicioSemanaAtual = inicioHoje - diasDesdeSegunda * 86_400_000;
  const inicioMesAtual = Date.UTC(ano, mes - 1, 1, 3);

  return {
    atual: new Date(agora),
    ontem: new Date(inicioHoje - 1),
    semanaPassada: new Date(inicioSemanaAtual - 1),
    mesPassado: new Date(inicioMesAtual - 1),
  };
}

export function listarEsperasLongasTreinamento(
  eventos: EventosIndicadoresTreinamento, inicio: Date, fim: Date, treinador: string | null,
): EventoEspera[] {
  return filtrarPorTreinador(eventos.esperas, treinador)
    .filter((evento) => evento.dias >= LIMITE_ESPERA_LONGA_TREINAMENTO && dentroDoPeriodo(evento, inicio, fim))
    .sort((a, b) => b.data.getTime() - a.data.getTime());
}

/** Clientes que estavam suspensos ao fim do período, para o detalhamento do indicador. */
export function listarClientesSuspensosNoPeriodo(
  eventos: EventosIndicadoresTreinamento, _inicio: Date, fim: Date, treinador: string | null,
): EventoClienteSuspenso[] {
  return filtrarPorTreinador(eventos.clientesSuspensos, treinador)
    .filter((evento) => evento.data.getTime() <= fim.getTime()
      && (!evento.dataFim || evento.dataFim.getTime() > fim.getTime()))
    .sort((a, b) => b.data.getTime() - a.data.getTime());
}

/** Avaliações de CSAT em estrelas dentro do período, mesma amostra usada por `csatTreinamento`. */
export function listarAvaliacoesCsatNoPeriodo(
  eventos: EventosIndicadoresTreinamento, inicio: Date, fim: Date, treinador: string | null,
): EventoNotaCsat[] {
  return filtrarPorTreinador(eventos.avaliacoesCsatEstrelas, treinador)
    .filter((evento) => dentroDoPeriodo(evento, inicio, fim));
}

/** Clientes com tempo até o primeiro treinamento apurado no período, mesma amostra usada por `tempoPrimeiroTreinamento`. */
export function listarTemposPrimeiroTreinamentoNoPeriodo(
  eventos: EventosIndicadoresTreinamento, inicio: Date, fim: Date, treinador: string | null,
): EventoTempoPrimeiroTreinamento[] {
  return filtrarPorTreinador(eventos.temposPrimeiroTreinamento, treinador)
    .filter((evento) => dentroDoPeriodo(evento, inicio, fim));
}

/** Teto de colunas geradas por {@link gerarPeriodosIndicadoresEntreDatas}, para um período
 * personalizado muito largo (ex.: vários anos em granularidade "dia") não travar a tela
 * nem virar uma tabela impraticável; mantém sempre os períodos mais recentes do intervalo. */
const LIMITE_PERIODOS = 180;

/**
 * Períodos (dias úteis ou semanas úteis) entre duas datas, inclusive, para montar o eixo X
 * do gráfico e as colunas do painel analítico. Sábado e domingo nunca entram. Em "semana",
 * os limites são segunda a sexta (a primeira e a última semana podem extrapolar o intervalo
 * pedido).
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

  // Semana: segunda a sexta, começando na semana de `inicio` até a semana de `fim`.
  const diaDaSemanaInicio = inicio.getDay();
  const deslocamentoAteSegunda = diaDaSemanaInicio === 0 ? 6 : diaDaSemanaInicio - 1;
  const cursor = new Date(inicio);
  cursor.setDate(cursor.getDate() - deslocamentoAteSegunda);

  while (cursor.getTime() <= fim.getTime()) {
    const semanaInicio = new Date(cursor);
    const semanaFim = new Date(cursor);
    semanaFim.setDate(semanaFim.getDate() + 4);
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

/**
 * Limita os períodos ao intervalo pedido. Semanas que, após o recorte, ficam só com
 * sábado/domingo (ex.: intervalo começando num sábado) são descartadas.
 */
export function recortarPeriodosIndicadores(
  periodos: PeriodoIndicador[],
  intervalo: { inicio: Date; fim: Date },
): PeriodoIndicador[] {
  return periodos
    .map((p) => ({
      ...p,
      inicio: new Date(Math.max(p.inicio.getTime(), intervalo.inicio.getTime())),
      fim: new Date(Math.min(p.fim.getTime(), intervalo.fim.getTime())),
    }))
    .filter((p) => p.inicio.getTime() <= p.fim.getTime());
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
  if (cfg.formato === "dias") return `${valor.toFixed(1).replace(".", ",")} dias úteis`;
  if (cfg.formato === "diasCorridos") return `${valor.toFixed(1).replace(".", ",")} dias`;
  if (cfg.formato === "nota") return `${valor.toFixed(1).replace(".", ",")} / 5`;
  return `${Math.round(valor)}`;
}
