import type { Empresa, Ocorrencia } from "../types";
import {
  DIAS_REDUCAO_SCORE_GAP_AGENDA,
  DIAS_REDUCAO_SCORE_SUPORTE,
  DIAS_REDUCAO_SCORE_TREINAMENTO,
  LIMITE_DIAS_GAP_AGENDA,
  MOTIVO_REDUCAO_SCORE_GAP_AGENDA,
  MOTIVO_REDUCAO_SCORE_SUPORTE,
  MOTIVO_REDUCAO_SCORE_TREINAMENTO,
  VALOR_REDUCAO_SCORE_GAP_AGENDA,
  VALOR_REDUCAO_SCORE_SUPORTE,
  VALOR_REDUCAO_SCORE_TREINAMENTO,
  encontrarOcorrenciaDoAjuste,
  type ScoreFormAnswers,
} from "./score";

/**
 * Reconstrói, a partir das ocorrências já gravadas, como o cliente esteve classificado
 * (Fast/Safety) ao longo da jornada. O score em cada instante é o último cálculo de score
 * registrado menos as reduções temporárias ativas naquele instante — a mesma regra de
 * `calcularScoreEfetivo`, aplicada ao passado.
 *
 * O cadastro guarda só as reduções ainda ativas, então as já vencidas são deduzidas das
 * próprias ocorrências (dúvidas com Suporte/Treinamento e intervalos longos entre agendas)
 * e marcadas como `estimado`.
 */

export type TipoScore = "Fast" | "Safety";

const DIA_MS = 24 * 60 * 60 * 1000;
const LIMIAR_FAST = 6;
/** Distância máxima para tratar uma "Mudança de score" como o mesmo cálculo de uma ocorrência com `scoreCalculado`. */
const JANELA_MESMO_CALCULO_MS = 10 * 60 * 1000;

export const PERGUNTAS_SCORE: {
  chave: keyof ScoreFormAnswers;
  rotulo: string;
  desfavoravel: "Sim" | "Não";
}[] = [
  { chave: "entraComputador", rotulo: "Entra pelo computador", desfavoravel: "Não" },
  { chave: "compartilhaTela", rotulo: "Compartilha a tela", desfavoravel: "Não" },
  { chave: "fazPerguntas", rotulo: "Faz perguntas", desfavoravel: "Não" },
  { chave: "recordaTemas", rotulo: "Recorda temas anteriores", desfavoravel: "Não" },
  { chave: "faltouDoisDias", rotulo: "Faltou 2 dias seguidos", desfavoravel: "Sim" },
  { chave: "estruturaNecessaria", rotulo: "Possui estrutura necessária", desfavoravel: "Não" },
  { chave: "clienteReclamante", rotulo: "Reclama do sistema", desfavoravel: "Sim" },
  { chave: "clienteSumido", rotulo: "Cliente sumiu", desfavoravel: "Sim" },
];

const ROTULO_REDUCAO: Record<string, string> = {
  [MOTIVO_REDUCAO_SCORE_SUPORTE]: "Dúvida registrada com o Suporte",
  [MOTIVO_REDUCAO_SCORE_TREINAMENTO]: "Dúvida registrada com o Treinamento",
  [MOTIVO_REDUCAO_SCORE_GAP_AGENDA]: "Intervalo maior que 5 dias entre agendas",
};

interface PontoBase {
  data: number;
  score: number | null;
  respostas?: Partial<ScoreFormAnswers> | null;
  ocorrencia?: Ocorrencia;
  estimado: boolean;
}

export interface ReducaoScore {
  inicio: number;
  fim: number;
  valor: number;
  motivo: string;
  ocorrencia?: Ocorrencia;
  estimado: boolean;
}

export interface CausaMudanca {
  natureza: "calculo" | "neutro" | "reducao" | "expiracao";
  texto: string;
  detalhes?: string[];
  /** Impacto no score efetivo (negativo derruba). */
  pontos?: number;
  ocorrencia?: Ocorrencia;
}

export interface TrechoTipoScore {
  inicio: number;
  fim: number;
  tipo: TipoScore | null;
  estimado: boolean;
}

export interface MudancaTipoScore {
  data: number;
  de: TipoScore | null;
  para: TipoScore | null;
  scoreAntes: number | null;
  scoreDepois: number | null;
  causas: CausaMudanca[];
  reducoesAtivas: ReducaoScore[];
  estimado: boolean;
}

export interface LinhaTempoScore {
  inicio: number;
  fim: number;
  trechos: TrechoTipoScore[];
  mudancas: MudancaTipoScore[];
  temEstimativa: boolean;
}

interface EstadoScore {
  base?: PontoBase;
  ativas: ReducaoScore[];
  efetivo: number | null;
  tipo: TipoScore | null;
  estimado: boolean;
}

const normalizar = (nome?: string) => (nome || "").trim().toLowerCase();
const instanteOcorrencia = (o: Ocorrencia) => o.createdAt ?? o.dataOcorrencia ?? 0;
const dataCurta = (t: number) => new Date(t).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export function formatarScore(valor: number | null): string {
  if (valor === null) return "sem score";
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

export function classificarScore(valor: number | null): TipoScore | null {
  if (valor === null) return null;
  return valor >= LIMIAR_FAST ? "Fast" : "Safety";
}

/** "Score atual: 4,5" das ocorrências de cálculo; `undefined` quando o texto não traz um cálculo. */
function lerScoreDaDescricao(descricao: string): number | null | undefined {
  if (!/^(Cálculo inicial de score|Mudança de score de)/.test(descricao.trim())) return undefined;
  const correspondencia = descricao.match(/Score atual:\s*(Neutro|-?\d+(?:[.,]\d+)?)/);
  if (!correspondencia) return undefined;
  if (correspondencia[1] === "Neutro") return null;
  return Number(correspondencia[1].replace(",", "."));
}

function coletarBases(empresa: Empresa, ocorrencias: Ocorrencia[]): PontoBase[] {
  const pontos: PontoBase[] = [];
  ocorrencias.forEach((o) => {
    const data = instanteOcorrencia(o);
    if (data <= 0 || (typeof o.scoreCalculado !== "number" && o.scoreCalculado !== null)) return;
    pontos.push({ data, score: o.scoreCalculado, respostas: o.scoreAnswers ?? null, ocorrencia: o, estimado: false });
  });

  ocorrencias.forEach((o) => {
    if (o.tipo !== "Mudança de score") return;
    const data = instanteOcorrencia(o);
    const score = lerScoreDaDescricao(o.descricao || "");
    if (data <= 0 || score === undefined) return;
    if (pontos.some((p) => p.score === score && Math.abs(p.data - data) <= JANELA_MESMO_CALCULO_MS)) return;
    pontos.push({ data, score, ocorrencia: o, estimado: false });
  });

  pontos.sort((a, b) => a.data - b.data);

  // Score calculado sem ocorrência (ex.: pelo cadastro na Home): só se conhece o valor atual.
  if (pontos.length === 0 && typeof empresa.score === "number") {
    pontos.push({ data: -Infinity, score: empresa.score, respostas: empresa.scoreAnswers ?? null, estimado: true });
  }
  return pontos;
}

/**
 * As reduções que ainda estariam ativas hoje já constam do cadastro; as deduzidas das
 * ocorrências só valem para o passado. Isso também respeita reduções removidas à mão.
 */
function coletarReducoes(empresa: Empresa, ocorrencias: Ocorrencia[], agora: number): ReducaoScore[] {
  const reducoes: ReducaoScore[] = (empresa.scoreAjustesTemporarios || []).map((ajuste) => ({
    inicio: ajuste.criadoEm,
    fim: ajuste.expiraEm,
    valor: ajuste.valor,
    motivo: ajuste.motivo,
    ocorrencia: encontrarOcorrenciaDoAjuste(ajuste, ocorrencias),
    estimado: false,
  }));
  const cobertas = new Set(reducoes.map((r) => r.ocorrencia?.id).filter(Boolean));

  const regraDuvida: Record<string, { motivo: string; valor: number; dias: number }> = {
    Suporte: { motivo: MOTIVO_REDUCAO_SCORE_SUPORTE, valor: VALOR_REDUCAO_SCORE_SUPORTE, dias: DIAS_REDUCAO_SCORE_SUPORTE },
    Treinamento: { motivo: MOTIVO_REDUCAO_SCORE_TREINAMENTO, valor: VALOR_REDUCAO_SCORE_TREINAMENTO, dias: DIAS_REDUCAO_SCORE_TREINAMENTO },
  };
  ocorrencias.forEach((o) => {
    const regra = o.tipo === "Dúvida" ? regraDuvida[o.departamento] : undefined;
    const inicio = o.ssxDesk ? o.dataOcorrencia : instanteOcorrencia(o);
    if (!regra || inicio <= 0 || (o.id && cobertas.has(o.id))) return;
    if (inicio + regra.dias * DIA_MS > agora) return;
    reducoes.push({ inicio, fim: inicio + regra.dias * DIA_MS, valor: regra.valor, motivo: regra.motivo, ocorrencia: o, estimado: true });
  });

  // Mesma regra do Histórico: nova agenda mais de 5 dias depois da agenda mais recente já existente.
  const agendas = ocorrencias
    .filter((o) => ["Treinamento", "Informativa", "Checkpoint"].includes(o.tipo) && o.dataOcorrencia > 0 && instanteOcorrencia(o) > 0)
    .sort((a, b) => instanteOcorrencia(a) - instanteOcorrencia(b));
  let ultimaAgenda = -Infinity;
  agendas.forEach((agenda) => {
    const diferencaDias = (agenda.dataOcorrencia - ultimaAgenda) / DIA_MS;
    const inicio = instanteOcorrencia(agenda);
    if (
      Number.isFinite(diferencaDias) && diferencaDias > LIMITE_DIAS_GAP_AGENDA &&
      !(agenda.id && cobertas.has(agenda.id)) && inicio + DIAS_REDUCAO_SCORE_GAP_AGENDA * DIA_MS <= agora
    ) {
      reducoes.push({
        inicio,
        fim: inicio + DIAS_REDUCAO_SCORE_GAP_AGENDA * DIA_MS,
        valor: VALOR_REDUCAO_SCORE_GAP_AGENDA,
        motivo: MOTIVO_REDUCAO_SCORE_GAP_AGENDA,
        ocorrencia: agenda,
        estimado: true,
      });
    }
    ultimaAgenda = Math.max(ultimaAgenda, agenda.dataOcorrencia);
  });

  return reducoes.sort((a, b) => a.inicio - b.inicio);
}

function estadoNoInstante(t: number, bases: PontoBase[], reducoes: ReducaoScore[]): EstadoScore {
  let base: PontoBase | undefined;
  for (const ponto of bases) {
    if (ponto.data > t) break;
    base = ponto;
  }
  const ativas = reducoes.filter((r) => r.inicio <= t && t < r.fim);
  const baseScore = base?.score ?? null;
  const efetivo = baseScore === null ? null : baseScore - ativas.reduce((soma, r) => soma + r.valor, 0);
  return {
    base,
    ativas,
    efetivo,
    tipo: classificarScore(efetivo),
    estimado: !!base?.estimado || ativas.some((r) => r.estimado),
  };
}

export function descreverReducao(reducao: ReducaoScore): string {
  const rotulo = ROTULO_REDUCAO[reducao.motivo] || reducao.motivo;
  const dias = Math.round((reducao.fim - reducao.inicio) / DIA_MS);
  return `${rotulo} em ${dataCurta(reducao.inicio)} (−${formatarScore(reducao.valor)} pt por ${dias} dias)`;
}

const respostaTexto = (valor?: string) => (valor === "Sim" || valor === "Não" ? valor : "—");

function causaDoCalculo(anterior: EstadoScore, atual: EstadoScore): CausaMudanca {
  const novo = atual.base!;
  if (novo.score === null) {
    return { natureza: "neutro", texto: "Score marcado como Neutro (sem classificação)", ocorrencia: novo.ocorrencia };
  }
  const antigo = anterior.base;
  if (!antigo || antigo.score === null) {
    const desfavoraveis = PERGUNTAS_SCORE
      .filter((p) => novo.respostas?.[p.chave] === p.desfavoravel)
      .map((p) => `${p.rotulo}: ${p.desfavoravel}`);
    return {
      natureza: "calculo",
      texto: `Primeiro cálculo de score: ${formatarScore(novo.score)}`,
      detalhes: desfavoraveis.length > 0 ? desfavoraveis : undefined,
      ocorrencia: novo.ocorrencia,
    };
  }
  const alteradas = PERGUNTAS_SCORE
    .filter((p) => antigo.respostas && novo.respostas && antigo.respostas[p.chave] !== novo.respostas[p.chave])
    .map((p) => `${p.rotulo}: ${respostaTexto(antigo.respostas?.[p.chave])} → ${respostaTexto(novo.respostas?.[p.chave])}`);
  return {
    natureza: "calculo",
    texto: `Novo cálculo de score: ${formatarScore(antigo.score)} → ${formatarScore(novo.score)}`,
    detalhes: alteradas.length > 0 ? alteradas : undefined,
    pontos: novo.score - antigo.score,
    ocorrencia: novo.ocorrencia,
  };
}

function causasDaMudanca(anterior: EstadoScore, atual: EstadoScore): CausaMudanca[] {
  const causas: CausaMudanca[] = [];
  if (anterior.base !== atual.base && atual.base) causas.push(causaDoCalculo(anterior, atual));
  atual.ativas
    .filter((r) => !anterior.ativas.includes(r))
    .forEach((r) => causas.push({ natureza: "reducao", texto: descreverReducao(r), pontos: -r.valor, ocorrencia: r.ocorrencia }));
  anterior.ativas
    .filter((r) => !atual.ativas.includes(r))
    .forEach((r) => causas.push({
      natureza: "expiracao",
      texto: `Venceu a redução: ${descreverReducao(r)}`,
      pontos: r.valor,
      ocorrencia: r.ocorrencia,
    }));
  return causas;
}

/**
 * Classificação do cliente entre `inicio` e `fim` (ex.: entrada na esteira até hoje ou
 * até a finalização). Trechos consecutivos com o mesmo tipo são unidos; cada troca de
 * tipo vira uma {@link MudancaTipoScore} com as causas identificadas.
 */
export function construirLinhaTempoScore(
  empresa: Empresa,
  ocorrencias: Ocorrencia[],
  inicio: number,
  fim: number,
  agora: number = Date.now(),
): LinhaTempoScore {
  const nome = normalizar(empresa.nomeEmpresa);
  const doCliente = ocorrencias.filter((o) => normalizar(o.empresa) === nome);
  const bases = coletarBases(empresa, doCliente);
  const reducoes = coletarReducoes(empresa, doCliente, agora);
  const limiteFinal = Math.max(inicio, fim);

  const marcos = new Set<number>([inicio, limiteFinal]);
  bases.forEach((b) => { if (b.data > inicio && b.data < limiteFinal) marcos.add(b.data); });
  reducoes.forEach((r) => [r.inicio, r.fim].forEach((t) => { if (t > inicio && t < limiteFinal) marcos.add(t); }));
  const ordenados = [...marcos].sort((a, b) => a - b);

  const intervalos: (EstadoScore & { inicio: number; fim: number })[] = ordenados.length === 1
    ? [{ ...estadoNoInstante(inicio, bases, reducoes), inicio, fim: limiteFinal }]
    : ordenados.slice(0, -1).map((t, i) => ({ ...estadoNoInstante(t, bases, reducoes), inicio: t, fim: ordenados[i + 1] }));
  // Inclui mudanças exatamente no limite final, sem estender o período analisado.
  if (ordenados.length > 1) intervalos.push({ ...estadoNoInstante(limiteFinal, bases, reducoes), inicio: limiteFinal, fim: limiteFinal });

  const trechos: TrechoTipoScore[] = [];
  const mudancas: MudancaTipoScore[] = [];
  intervalos.forEach((atual, indice) => {
    const ultimo = trechos[trechos.length - 1];
    if (ultimo && ultimo.tipo === atual.tipo) {
      ultimo.fim = atual.fim;
      ultimo.estimado = ultimo.estimado || atual.estimado;
    } else {
      trechos.push({ inicio: atual.inicio, fim: atual.fim, tipo: atual.tipo, estimado: atual.estimado });
    }
    const anterior = intervalos[indice - 1];
    if (anterior && anterior.tipo !== atual.tipo) {
      mudancas.push({
        data: atual.inicio,
        de: anterior.tipo,
        para: atual.tipo,
        scoreAntes: anterior.efetivo,
        scoreDepois: atual.efetivo,
        causas: causasDaMudanca(anterior, atual),
        reducoesAtivas: atual.ativas,
        estimado: anterior.estimado || atual.estimado,
      });
    }
  });

  return { inicio, fim: limiteFinal, trechos, mudancas, temEstimativa: trechos.some((t) => t.estimado) };
}

/** Tipo no instante `t`; depois do fim da linha, mantém o último tipo conhecido. */
export function tipoNoInstante(linha: LinhaTempoScore, t: number): TipoScore | null {
  if (linha.trechos.length === 0) return null;
  if (t <= linha.inicio) return linha.trechos[0].tipo;
  const trecho = linha.trechos.find((tr) => t >= tr.inicio && t < tr.fim);
  return (trecho ?? linha.trechos[linha.trechos.length - 1]).tipo;
}

/**
 * Partes de um intervalo [de, ate] com seu tipo, em frações de 0 a 1 — usado para pintar
 * cada linha da régua de etapas com as cores dos períodos que ela atravessa.
 */
export function fatiarIntervaloPorTipo(
  linha: LinhaTempoScore,
  de: number,
  ate: number,
): { inicio: number; fim: number; tipo: TipoScore | null }[] {
  if (ate <= de) return [{ inicio: 0, fim: 1, tipo: tipoNoInstante(linha, de) }];
  const cortes = [de, ...linha.mudancas.map((m) => m.data).filter((t) => t > de && t < ate), ate];
  return cortes.slice(0, -1).map((t, i) => ({
    inicio: (t - de) / (ate - de),
    fim: (cortes[i + 1] - de) / (ate - de),
    tipo: tipoNoInstante(linha, t),
  }));
}
