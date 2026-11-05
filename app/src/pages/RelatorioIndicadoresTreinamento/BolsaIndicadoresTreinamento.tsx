import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  calcularValorKpiTreinamento,
  gerarPeriodosIndicadoresEntreDatas,
  formatarValorKpiTreinamento,
  gerarReferenciasSnapshotSuspensos,
  KPI_POR_CHAVE,
  type EventosIndicadoresTreinamento,
  type PeriodoIndicador,
} from "../../utils/indicadoresTreinamento";
import { calcularGolNoPrazo } from "../../utils/golTreinamento";
import {
  calcularValidacaoPorCliente,
  type ResultadoValidacaoCliente,
} from "../../utils/validacaoConhecimentoIndicadores";
import type { Empresa, Ocorrencia } from "../../types";
import type { TentativaValidacao } from "../../../../server/src/domain/validacaoConhecimento";
import "./BolsaIndicadoresTreinamento.css";

type Granularidade = "dia" | "semana" | "mes";

const ORDEM_GRANULARIDADES: Granularidade[] = ["dia", "semana", "mes"];
const ROTULO_COMPARACAO: Record<Granularidade, string> = {
  dia: "vs. dia anterior",
  semana: "vs. semana anterior",
  mes: "vs. mês anterior",
};

type ChaveBolsa =
  | "golNoPrazo"
  | "clientesSuspensos"
  | "validacaoConhecimento"
  | "contatosSuporteTreinamento"
  | "csatTreinamento";

interface ConfigBolsa {
  chave: ChaveBolsa;
  /** Curto de propósito — o card é lido de longe; a explicação completa vai em `descricao`. */
  titulo: string;
  descricao: string;
  menorEhMelhor: boolean;
  /** Só definido quando existe um alvo oficial do negócio (ex.: CSAT ≥ 4,8). Sem isso, o
   * card mostra "maior/menor é melhor" e a pílula segue a tendência, não uma meta fixa. */
  meta?: number;
  /** Granularidade do valor em destaque no card. Padrão: "dia" (valor de hoje). */
  granularidadePrincipal?: Granularidade;
  /** Quais comparações (dia/semana/mês) aparecem embaixo do card. Padrão: as três. */
  granularidadesComparacao?: Granularidade[];
}

const INDICADORES_BOLSA: ConfigBolsa[] = [
  {
    chave: "golNoPrazo",
    titulo: "Gol no Prazo",
    descricao: "Percentual de clientes que bateram a meta combinada (Gol) dentro do prazo, no mês.",
    menorEhMelhor: false,
    meta: 100,
    // Só compara mês inteiro (até agora) contra o mês anterior — dia/semana isolados não
    // fazem sentido pra essa taxa, que é acumulada ao longo do mês inteiro.
    granularidadePrincipal: "mes",
    granularidadesComparacao: ["mes"],
  },
  {
    chave: "clientesSuspensos",
    titulo: "Suspensos",
    descricao: "Clientes em treinamento que estavam suspensos ao fim de cada período.",
    menorEhMelhor: true,
    meta: 0,
  },
  {
    chave: "validacaoConhecimento",
    titulo: "Validação do Conhecimento",
    descricao:
      "Percentual de clientes aprovados na validação do conhecimento no mês, considerando só a tentativa mais recente de cada um.",
    menorEhMelhor: false,
    meta: 80,
    granularidadePrincipal: "mes",
    granularidadesComparacao: ["mes"],
  },
  {
    chave: "contatosSuporteTreinamento",
    titulo: "Contatos Suporte",
    descricao: "Dúvidas de Suporte do SSX Desk, recebidas dentro do expediente, de clientes em treinamento.",
    menorEhMelhor: true,
    // Tolerância de 2: até 1 contato no dia fica dentro da meta; 2 ou mais, fora.
    meta: 1,
  },
  {
    chave: "csatTreinamento",
    titulo: "CSAT",
    descricao: "Nota média (1 a 5) dada pelos clientes para o atendimento de treinamento.",
    menorEhMelhor: false,
    meta: 4.8,
  },
];

function gerarUltimosMeses(quantidade: number): PeriodoIndicador[] {
  const agora = new Date();
  const periodos: PeriodoIndicador[] = [];
  for (let i = quantidade - 1; i >= 0; i--) {
    const ref = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    const inicio = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const fimDoMes = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999);
    const fim = fimDoMes.getTime() > agora.getTime() ? agora : fimDoMes;
    periodos.push({
      inicio,
      fim,
      categoria: inicio
        .toLocaleDateString("pt-BR", { month: "short" })
        .replace(".", "")
        .toUpperCase(),
    });
  }
  return periodos;
}

/** Linhas de {@link calcularValidacaoPorCliente} dentro de um período, usada tanto para o
 * percentual quanto para a fração "aprovados/total" mostrada embaixo do card. */
function filtrarValidacaoNoPeriodo(
  validacaoPorCliente: ResultadoValidacaoCliente[],
  inicio: Date,
  fim: Date,
): ResultadoValidacaoCliente[] {
  return validacaoPorCliente.filter(
    (r) => r.concluidaEm >= inicio.getTime() && r.concluidaEm <= fim.getTime(),
  );
}

function calcularValorIndicadorBolsa(
  chave: ChaveBolsa,
  eventos: EventosIndicadoresTreinamento,
  empresas: Empresa[],
  ocorrencias: Ocorrencia[],
  validacaoPorCliente: ResultadoValidacaoCliente[],
  inicio: Date,
  fim: Date,
  treinador: string | null,
): number | null {
  if (chave === "golNoPrazo") {
    const resultados = calcularGolNoPrazo(empresas, ocorrencias).filter(
      (r) =>
        r.dataReferencia.getTime() >= inicio.getTime() &&
        r.dataReferencia.getTime() <= fim.getTime(),
    );
    if (resultados.length === 0) return null;
    return (resultados.filter((r) => r.noPrazo).length / resultados.length) * 100;
  }
  if (chave === "validacaoConhecimento") {
    const resultados = filtrarValidacaoNoPeriodo(validacaoPorCliente, inicio, fim);
    if (resultados.length === 0) return null;
    return (resultados.filter((r) => r.aprovada).length / resultados.length) * 100;
  }
  return calcularValorKpiTreinamento(chave, eventos, inicio, fim, treinador);
}

function formatarValorBolsa(chave: ChaveBolsa, valor: number | null): string {
  if (chave === "golNoPrazo" || chave === "validacaoConhecimento") {
    return valor === null ? "—" : `${Math.round(valor)}%`;
  }
  return formatarValorKpiTreinamento(chave, valor);
}

/** Separa o valor em número + unidade (ex.: "82,4" + "%"), para o número grande do card
 * ficar maior que a unidade ao lado — igual ao painel de referência. */
function dividirValorBolsa(chave: ChaveBolsa, valor: number | null): { main: string; unit: string } {
  if (valor === null) return { main: "—", unit: "" };
  if (chave === "golNoPrazo" || chave === "validacaoConhecimento")
    return { main: `${Math.round(valor)}`, unit: "%" };
  const formato = KPI_POR_CHAVE[chave].formato;
  if (formato === "percentual") return { main: valor.toFixed(1).replace(".", ","), unit: "%" };
  if (formato === "nota") return { main: valor.toFixed(1).replace(".", ","), unit: "/ 5" };
  return { main: `${Math.round(valor)}`, unit: "" };
}

interface Ponto {
  categoria: string;
  valor: number | null;
  inicio: Date;
  fim: Date;
}

/** Indicadores de contagem (não taxa/nota) — comparar o total de uma semana ou mês inteiro
 * contra o valor de hoje seria injusto (uma soma de 7 ou 30 dias é sempre maior que 1 dia),
 * então essas comparações usam a média diária do período anterior. Gol no Prazo e CSAT já
 * são taxas/notas — comparáveis entre períodos de tamanhos diferentes sem esse ajuste. */
const CHAVES_CONTAGEM_BOLSA = new Set<ChaveBolsa>([
  "contatosSuporteTreinamento",
]);

function diasNoPeriodo(p: Ponto): number {
  return Math.round((p.fim.getTime() - p.inicio.getTime()) / 86_400_000) + 1;
}

function formatarMediaDiariaBolsa(valor: number | null): string {
  if (valor === null) return "—";
  return `${valor.toFixed(1).replace(".", ",")}/dia`;
}

/** Caminho SVG suavizado (curva), não serrilhado — mesmo truque de relatórios financeiros:
 * uma quadrática por segmento, terminando no ponto médio entre os dois pontos vizinhos. */
function caminhoSuave(coords: { x: number; y: number }[]): string {
  if (coords.length === 0) return "";
  if (coords.length === 1) return `M ${coords[0].x} ${coords[0].y}`;
  let d = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 1; i < coords.length - 1; i++) {
    const xc = (coords[i].x + coords[i + 1].x) / 2;
    const yc = (coords[i].y + coords[i + 1].y) / 2;
    d += ` Q ${coords[i].x} ${coords[i].y} ${xc} ${yc}`;
  }
  const ultimo = coords[coords.length - 1];
  d += ` L ${ultimo.x} ${ultimo.y}`;
  return d;
}

function construirCoordenadas(pontos: Ponto[], largura: number, altura: number, margem: number) {
  const valores = pontos.map((p) => p.valor ?? 0);
  const min = Math.min(...valores, 0);
  const max = Math.max(...valores, 1);
  const amplitude = max - min || 1;
  const passo = pontos.length > 1 ? largura / (pontos.length - 1) : 0;
  return valores.map((v, i) => ({
    x: i * passo,
    y: altura - margem - ((v - min) / amplitude) * (altura - margem * 2),
  }));
}

/** Sparkline compacto usado dentro de cada linha de comparação (estilo o
 * "spark" do painel de bolsa: só a linha e a área, sem grade nem brilho). */
function MiniSparkline({ pontos, cor }: { pontos: Ponto[]; cor: string }) {
  const largura = 96;
  const altura = 30;
  const margem = 3;
  const coords = construirCoordenadas(pontos, largura, altura, margem);
  const linha = caminhoSuave(coords);
  const area = `${linha} L ${largura},${altura} L 0,${altura} Z`;
  const idGradiente = `bolsa-mini-grad-${cor.replace("#", "")}`;

  return (
    <svg
      className="bolsa-mini-sparkline"
      viewBox={`0 0 ${largura} ${altura}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={idGradiente} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={cor} stopOpacity="0.35" />
          <stop offset="100%" stopColor={cor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${idGradiente})`} stroke="none" />
      <path
        d={linha}
        fill="none"
        stroke={cor}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {coords.length > 0 && (
        <circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y} r="2.6" fill={cor} />
      )}
    </svg>
  );
}

/**
 * Efeito "flip clock": cada caractere é um slot independente que só reanima quando o
 * valor naquela posição muda (geração incrementada) — dígitos que continuam iguais entre
 * duas atualizações ficam parados, igual num painel de aeroporto mecânico de verdade.
 */
function FlipDigits({ texto, className }: { texto: string; className?: string }) {
  const caracteres = texto.split("");
  const [prevTexto, setPrevTexto] = useState(texto);
  const [geracoes, setGeracoes] = useState<number[]>(() => caracteres.map(() => 0));

  if (prevTexto !== texto) {
    const prevCaracteres = prevTexto.split("");
    const novasGeracoes = caracteres.map((c, i) =>
      prevCaracteres[i] === c ? geracoes[i] ?? 0 : (geracoes[i] ?? 0) + 1,
    );
    setPrevTexto(texto);
    setGeracoes(novasGeracoes);
  }

  return (
    <span className={`bolsa-flip ${className || ""}`}>
      {caracteres.map((c, i) => (
        <span className="bolsa-flip-slot" key={i}>
          <span className="bolsa-flip-digito" key={geracoes[i] ?? 0}>
            {c}
          </span>
        </span>
      ))}
    </span>
  );
}

const COR_NEUTRA = "#64748b";
const COR_FAVORAVEL = "#22c55e";
const COR_DESFAVORAVEL = "#ef4444";

function corPorFavorabilidade(favoravel: boolean | null): string {
  return favoravel === null ? COR_NEUTRA : favoravel ? COR_FAVORAVEL : COR_DESFAVORAVEL;
}

interface LinhaComparacao {
  granularidade: Granularidade;
  label: string;
  prevStr: string;
  deltaStr: string;
  arrow: string;
  word: string;
  cor: string;
  serie: Ponto[];
}

interface ComparacaoSnapshot {
  atual: number | null;
  anterior: number | null;
  label: string;
}

function construirComparacao(
  config: ConfigBolsa,
  granularidade: Granularidade,
  serie: Ponto[],
  valorHoje: number | null,
  snapshot?: ComparacaoSnapshot,
): LinhaComparacao {
  // Para contagens, "semana"/"mês" comparam hoje contra a MÉDIA DIÁRIA do período anterior
  // completo (total ÷ dias do período) — não o total acumulado, que inflaria o "antes" e
  // faria o dia parecer sempre pior. Taxas/notas (Gol, CSAT) continuam comparando total do
  // período atual vs. total do período anterior, já que são comparáveis entre si.
  const usarMediaDiaria = !snapshot && granularidade !== "dia" && CHAVES_CONTAGEM_BOLSA.has(config.chave);

  let atual: number | null;
  let anterior: number | null;
  let prevStr: string;
  let formatarDelta: (absoluto: number) => string;

  if (snapshot) {
    atual = snapshot.atual;
    anterior = snapshot.anterior;
    prevStr = anterior === null ? "—" : formatarValorBolsa(config.chave, anterior);
    formatarDelta = (absoluto) => formatarValorBolsa(config.chave, absoluto);
  } else if (usarMediaDiaria) {
    const periodoAnterior = serie[serie.length - 2] ?? null;
    const dias = periodoAnterior ? diasNoPeriodo(periodoAnterior) : 0;
    atual = valorHoje;
    anterior =
      periodoAnterior && periodoAnterior.valor !== null && dias > 0
        ? periodoAnterior.valor / dias
        : null;
    prevStr = formatarMediaDiariaBolsa(anterior);
    formatarDelta = (absoluto) => absoluto.toFixed(1).replace(".", ",");
  } else {
    atual = serie[serie.length - 1]?.valor ?? null;
    anterior = serie[serie.length - 2]?.valor ?? null;
    prevStr = anterior === null ? "—" : formatarValorBolsa(config.chave, anterior);
    formatarDelta = (absoluto) => formatarValorBolsa(config.chave, absoluto);
  }

  const temComparacao = atual !== null && anterior !== null;
  const delta = temComparacao ? atual! - anterior! : null;
  const favoravel =
    delta === null || delta === 0 ? null : config.menorEhMelhor ? delta < 0 : delta > 0;
  const cor = corPorFavorabilidade(favoravel);
  return {
    granularidade,
    label: snapshot?.label ?? (usarMediaDiaria
      ? granularidade === "semana"
        ? "vs. média da semana anterior"
        : "vs. média do mês anterior"
      : ROTULO_COMPARACAO[granularidade]),
    prevStr,
    deltaStr: delta === null ? "—" : formatarDelta(Math.abs(delta)),
    arrow: delta === null || delta === 0 ? "■" : delta > 0 ? "▲" : "▼",
    word: favoravel === null ? "estável" : favoravel ? "melhor" : "pior",
    cor,
    serie,
  };
}

function CardIndicador({
  config,
  series,
  snapshotsSuspensos,
  fracaoExtra,
}: {
  config: ConfigBolsa;
  series: Record<Granularidade, Ponto[]>;
  snapshotsSuspensos?: Record<Granularidade, ComparacaoSnapshot>;
  /** Número absoluto por trás do percentual (ex.: aprovados/total), mostrado junto da
   * meta — hoje só a Validação do Conhecimento usa isso. */
  fracaoExtra?: { parte: number; total: number } | null;
}) {
  const granularidadePrincipal = config.granularidadePrincipal ?? "dia";
  const granularidadesComparacao = config.granularidadesComparacao ?? ORDEM_GRANULARIDADES;
  const ultimo =
    snapshotsSuspensos?.[granularidadePrincipal].atual ??
    series[granularidadePrincipal][series[granularidadePrincipal].length - 1]?.valor ??
    null;
  const comparacoes = granularidadesComparacao.map((g) =>
    construirComparacao(config, g, series[g], ultimo, snapshotsSuspensos?.[g]),
  );
  // Primeira comparação da lista configurada (normalmente "dia"; só "mês" para o Gol no Prazo).
  const comparacaoPrincipal = comparacoes[0];

  // Com meta oficial do negócio: a pílula reflete se o valor atual bate a meta. Sem
  // meta: segue a tendência diária (hoje vs. ontem) — o mesmo número em destaque,
  // para nunca contradizer o que se vê.
  let statusTexto: string;
  let statusClasse: "ok" | "bad" | "neutro";
  let corPrincipal: string;
  if (config.meta !== undefined) {
    if (ultimo === null) {
      statusTexto = "Sem dados";
      statusClasse = "neutro";
      corPrincipal = COR_NEUTRA;
    } else {
      const atingiuMeta = config.menorEhMelhor ? ultimo <= config.meta : ultimo >= config.meta;
      statusTexto = atingiuMeta ? "Dentro da meta" : "Fora da meta";
      statusClasse = atingiuMeta ? "ok" : "bad";
      corPrincipal = atingiuMeta ? COR_FAVORAVEL : COR_DESFAVORAVEL;
    }
  } else {
    const favoravel =
      comparacaoPrincipal.arrow === "■"
        ? null
        : comparacaoPrincipal.arrow === "▲"
          ? !config.menorEhMelhor
          : config.menorEhMelhor;
    statusTexto = favoravel === null ? "Estável" : favoravel ? "Favorável" : "Desfavorável";
    statusClasse = favoravel === null ? "neutro" : favoravel ? "ok" : "bad";
    corPrincipal = corPorFavorabilidade(favoravel);
  }

  const valorSplit = dividirValorBolsa(config.chave, ultimo);
  const metaSplit = config.meta !== undefined ? dividirValorBolsa(config.chave, config.meta) : null;
  const metaLabel = metaSplit
    ? `Meta ${config.menorEhMelhor ? "≤" : "≥"} ${metaSplit.main}${metaSplit.unit}`
    : config.menorEhMelhor
      ? "Menor é melhor"
      : "Maior é melhor";

  return (
    <article className={`bolsa-card ${statusClasse === "bad" ? "bolsa-card--alerta" : ""}`}>
      <div className="bolsa-card-cabecalho">
        <span className={`bolsa-card-pill bolsa-card-pill--${statusClasse}`}>
          <span aria-hidden="true">●</span> {statusTexto}
        </span>
        <h3 className="bolsa-card-titulo">{config.titulo}</h3>
      </div>

      <p className="bolsa-card-descricao">{config.descricao}</p>

      <div className="bolsa-card-valor-bloco">
        <div className="bolsa-card-valor-linha" style={{ color: corPrincipal }}>
          <FlipDigits texto={valorSplit.main} className="bolsa-card-valor" />
          {valorSplit.unit && <span className="bolsa-card-unidade">{valorSplit.unit}</span>}
        </div>
        <span className="bolsa-card-meta-label">{metaLabel}</span>
        {fracaoExtra && fracaoExtra.total > 0 && (
          <span className="bolsa-card-fracao-label">
            {fracaoExtra.parte}/{fracaoExtra.total}
          </span>
        )}
      </div>

      <div className="bolsa-card-comparacoes">
        {comparacoes.map((c) => (
          <div className="bolsa-card-comparacao" key={c.granularidade}>
            <div className="bolsa-card-comparacao-texto">
              <span className="bolsa-card-comparacao-label">{c.label}</span>
              <span className="bolsa-card-comparacao-antes">Antes: {c.prevStr}</span>
            </div>
            <MiniSparkline pontos={c.serie} cor={c.cor} />
            <div className="bolsa-card-comparacao-delta" style={{ color: c.cor }}>
              <span className="bolsa-card-comparacao-seta">
                {c.arrow} {c.deltaStr}
              </span>
              <span className="bolsa-card-comparacao-palavra">{c.word}</span>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

interface Props {
  eventos: EventosIndicadoresTreinamento;
  empresas: Empresa[];
  ocorrencias: Ocorrencia[];
  /** Vazio para quem não é master/treinador (ver server/SINCRONIZACAO.md) — o card de
   * Validação do Conhecimento fica "sem dados" nesse caso, sem travar o resto do painel. */
  tentativasValidacao: TentativaValidacao[];
  treinador: string | null;
  atualizadoEm: number;
  /** Tela dedicada de TV/monitor (/indicadores-treinamento-tv): sempre preenche a
   * tela inteira, como o modo foco, mas sem depender da Fullscreen API (a própria
   * aba, maximizada, já cumpre esse papel — ver App.tsx). */
  modoTv?: boolean;
}

/**
 * Painel "ao vivo" estilo bolsa de valores: cada card mostra o valor do dia, a meta (quando
 * existe uma oficial) e as três comparações (dia/semana/mês anterior) com mini-gráfico de
 * tendência. Todo o cálculo roda em cima de `eventos`/`empresas`/`ocorrencias` já carregados
 * pela página-mãe — não dispara nenhuma leitura adicional no Firestore.
 */
export const BolsaIndicadoresTreinamento: React.FC<Props> = ({
  eventos,
  empresas,
  ocorrencias,
  tentativasValidacao,
  treinador,
  atualizadoEm,
  modoTv = false,
}) => {
  const validacaoPorCliente = useMemo(
    () => calcularValidacaoPorCliente(tentativasValidacao),
    [tentativasValidacao],
  );
  const [agora, setAgora] = useState(() => new Date());
  const [modoFoco, setModoFoco] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = window.setInterval(() => setAgora(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    function aoSairDoFullscreen() {
      if (!document.fullscreenElement) setModoFoco(false);
    }
    document.addEventListener("fullscreenchange", aoSairDoFullscreen);
    return () => document.removeEventListener("fullscreenchange", aoSairDoFullscreen);
  }, []);

  async function alternarModoFoco() {
    const elemento = wrapperRef.current;
    if (!elemento) return;
    if (!document.fullscreenElement) {
      if (!elemento.requestFullscreen) {
        toast.error("O modo foco não está disponível neste navegador.");
        return;
      }
      try {
        await elemento.requestFullscreen();
        setModoFoco(true);
      } catch (error) {
        console.error("Não foi possível ativar o modo foco do painel:", error);
        toast.error("Não foi possível ativar o modo foco. Tente novamente.");
      }
    } else {
      try {
        await document.exitFullscreen();
        setModoFoco(false);
      } catch (error) {
        console.error("Não foi possível sair do modo foco do painel:", error);
        toast.error("Não foi possível sair do modo foco. Tente novamente.");
      }
    }
  }

  // Recalculado a cada minuto junto do relógio, para a janela "últimos N dias" avançar
  // sozinha sem precisar recarregar a página.
  const minutoAtual = Math.floor(agora.getTime() / 60000);
  const periodosPorGranularidade = useMemo(() => {
    const referencia = new Date(minutoAtual * 60000);
    const inicioJanelaDia = new Date(referencia);
    inicioJanelaDia.setDate(inicioJanelaDia.getDate() - 20);
    const inicioJanelaSemana = new Date(referencia);
    inicioJanelaSemana.setDate(inicioJanelaSemana.getDate() - 70);

    return {
      dia: gerarPeriodosIndicadoresEntreDatas(inicioJanelaDia, referencia, "dia").slice(-10),
      semana: gerarPeriodosIndicadoresEntreDatas(inicioJanelaSemana, referencia, "semana").slice(-8),
      mes: gerarUltimosMeses(6),
    } satisfies Record<Granularidade, PeriodoIndicador[]>;
  }, [minutoAtual]);

  const seriesPorIndicador = useMemo(() => {
    const resultado = {} as Record<ChaveBolsa, Record<Granularidade, Ponto[]>>;
    INDICADORES_BOLSA.forEach(({ chave }) => {
      resultado[chave] = { dia: [], semana: [], mes: [] };
      ORDEM_GRANULARIDADES.forEach((g) => {
        resultado[chave][g] = periodosPorGranularidade[g].map((p) => ({
          categoria: p.categoria,
          valor: calcularValorIndicadorBolsa(
            chave,
            eventos,
            empresas,
            ocorrencias,
            validacaoPorCliente,
            p.inicio,
            p.fim,
            treinador,
          ),
          inicio: p.inicio,
          fim: p.fim,
        }));
      });
    });
    return resultado;
  }, [eventos, empresas, ocorrencias, validacaoPorCliente, treinador, periodosPorGranularidade]);

  // Fração "aprovados/total" do mês corrente, mostrada embaixo do percentual do card de
  // Validação do Conhecimento — mesma amostra usada por calcularValorIndicadorBolsa para
  // essa chave, só que sem converter para percentual.
  const fracaoValidacaoConhecimentoMes = useMemo(() => {
    const fim = new Date(minutoAtual * 60000);
    const inicio = new Date(fim.getFullYear(), fim.getMonth(), 1);
    const resultados = filtrarValidacaoNoPeriodo(validacaoPorCliente, inicio, fim);
    return { parte: resultados.filter((r) => r.aprovada).length, total: resultados.length };
  }, [validacaoPorCliente, minutoAtual]);

  const snapshotsSuspensos = useMemo(() => {
    const referencias = gerarReferenciasSnapshotSuspensos(new Date(minutoAtual * 60000 + 59_999));
    const contarNoMomento = (fim: Date) =>
      calcularValorKpiTreinamento(
        "clientesSuspensos",
        eventos,
        new Date(0),
        fim,
        treinador,
      );
    const atual = contarNoMomento(referencias.atual);
    return {
      dia: { atual, anterior: contarNoMomento(referencias.ontem), label: "vs. ontem" },
      semana: { atual, anterior: contarNoMomento(referencias.semanaPassada), label: "vs. semana passada" },
      mes: { atual, anterior: contarNoMomento(referencias.mesPassado), label: "vs. mês passado" },
    } satisfies Record<Granularidade, ComparacaoSnapshot>;
  }, [eventos, treinador, minutoAtual]);

  const ticker = useMemo(
    () =>
      INDICADORES_BOLSA.map((config) => {
        const granularidadePrincipal = config.granularidadePrincipal ?? "dia";
        const serie = seriesPorIndicador[config.chave][granularidadePrincipal];
        const snapshot = config.chave === "clientesSuspensos" ? snapshotsSuspensos[granularidadePrincipal] : undefined;
        const valor = snapshot?.atual ?? serie[serie.length - 1]?.valor ?? null;
        const comparacao = construirComparacao(config, granularidadePrincipal, serie, valor, snapshot);
        return {
          chave: config.chave,
          titulo: config.titulo,
          valor: formatarValorBolsa(config.chave, valor),
          arrow: comparacao.arrow,
          deltaStr: comparacao.deltaStr,
          cor: comparacao.cor,
          rotulo: comparacao.label,
        };
      }),
    [seriesPorIndicador, snapshotsSuspensos],
  );
  const tickerDuplicado = [...ticker, ...ticker, ...ticker];

  const sinceUpdate = Math.max(0, Math.round((agora.getTime() - atualizadoEm) / 1000));
  const diaSemana = agora.toLocaleDateString("pt-BR", { weekday: "long" });
  const diaSemanaCapitalizado = diaSemana.charAt(0).toUpperCase() + diaSemana.slice(1);
  const dataCurta = agora.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

  return (
    <div
      className={`bolsa-indicadores-wrapper ${modoFoco || modoTv ? "bolsa-indicadores-wrapper--foco" : ""}`}
      ref={wrapperRef}
    >
      <div className="bolsa-indicadores-header">
        <div className="bolsa-indicadores-coluna-titulo">
          <div className="bolsa-indicadores-eyebrow">
            <span className="bolsa-ao-vivo-dot" aria-hidden="true" />
            <span>Ao vivo · Treinamento</span>
          </div>
          <h1 className="bolsa-indicadores-titulo-pagina">Indicadores de Treinamento</h1>
          <p className="bolsa-indicadores-subtitulo">
            Painel ao vivo — atualiza sozinho, sem consumir leituras do Firebase.
          </p>
        </div>
        <div className="bolsa-indicadores-header-direita">
          {!modoTv && (
            <button
              type="button"
              className="bolsa-modo-foco-btn"
              onClick={alternarModoFoco}
              aria-pressed={modoFoco}
              title={modoFoco ? "Sair do modo foco" : "Modo foco (tela cheia)"}
            >
              {modoFoco ? "Sair do modo foco" : "Modo foco"}
            </button>
          )}
          <div className="bolsa-indicadores-relogio">
            <span className="bolsa-indicadores-hora">
              {agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <span className="bolsa-indicadores-data">
              {diaSemanaCapitalizado}, {dataCurta}
            </span>
            <span className="bolsa-indicadores-atualizado">Atualizado há {sinceUpdate}s</span>
          </div>
        </div>
      </div>

      <div className="bolsa-indicadores-grid-cards">
        {INDICADORES_BOLSA.map((config) => (
          <CardIndicador
            key={config.chave}
            config={config}
            series={seriesPorIndicador[config.chave]}
            snapshotsSuspensos={config.chave === "clientesSuspensos" ? snapshotsSuspensos : undefined}
            fracaoExtra={config.chave === "validacaoConhecimento" ? fracaoValidacaoConhecimentoMes : undefined}
          />
        ))}
      </div>

      <div className="bolsa-legenda">
        <span>
          <strong className="bolsa-legenda-verde">▲▼ Verde</strong> melhor que o período anterior
        </span>
        <span>
          <strong className="bolsa-legenda-vermelho">▲▼ Vermelho</strong> pior que o período anterior
        </span>
        <span>A seta indica se o número subiu ou caiu</span>
      </div>

      <div className="bolsa-ticker" role="presentation">
        <div className="bolsa-ticker-trilha">
          {tickerDuplicado.map((item, idx) => (
            <span className="bolsa-ticker-item" key={`${item.chave}-${idx}`}>
              <span className="bolsa-ticker-titulo">{item.titulo}</span>
              <FlipDigits texto={item.valor} className="bolsa-ticker-valor" />
              <span className="bolsa-ticker-delta" style={{ color: item.cor }}>
                {item.arrow} {item.deltaStr}
              </span>
              <span className="bolsa-ticker-rotulo">{item.rotulo}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
