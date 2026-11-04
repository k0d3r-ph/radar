import React, { useEffect, useMemo, useState } from "react";
import { Flag, PauseCircle, Hourglass, Headphones, Star, Activity } from "lucide-react";
import {
  calcularValorKpiTreinamento,
  gerarPeriodosIndicadoresEntreDatas,
  formatarValorKpiTreinamento,
  KPI_POR_CHAVE,
  type EventosIndicadoresTreinamento,
  type PeriodoIndicador,
} from "../../utils/indicadoresTreinamento";
import { calcularGolNoPrazo } from "../../utils/golTreinamento";
import type { Empresa, Ocorrencia } from "../../types";
import "./BolsaIndicadoresTreinamento.css";

type Granularidade = "dia" | "semana" | "mes";

const ORDEM_GRANULARIDADES: Granularidade[] = ["dia", "semana", "mes"];
const ROTULO_GRANULARIDADE: Record<Granularidade, string> = {
  dia: "Dia a dia",
  semana: "Semana a semana",
  mes: "Mês a mês",
};
const INTERVALO_ROTACAO_MS = 5000;

type ChaveBolsa =
  | "golNoPrazo"
  | "clientesSuspensos"
  | "tempoPrimeiroTreinamento"
  | "contatosSuporteTreinamento"
  | "csatTreinamento";

interface ConfigBolsa {
  chave: ChaveBolsa;
  titulo: string;
  icone: React.ReactNode;
  menorEhMelhor: boolean;
}

const INDICADORES_BOLSA: ConfigBolsa[] = [
  {
    chave: "golNoPrazo",
    titulo: "Gol atingido no prazo",
    icone: <Flag size={20} />,
    menorEhMelhor: false,
  },
  {
    chave: "clientesSuspensos",
    titulo: "Clientes suspensos",
    icone: <PauseCircle size={20} />,
    menorEhMelhor: true,
  },
  {
    chave: "tempoPrimeiroTreinamento",
    titulo: "Tempo até o 1º treinamento",
    icone: <Hourglass size={20} />,
    menorEhMelhor: true,
  },
  {
    chave: "contatosSuporteTreinamento",
    titulo: "Contatos com Suporte atribuíveis a treinamento",
    icone: <Headphones size={20} />,
    menorEhMelhor: true,
  },
  {
    chave: "csatTreinamento",
    titulo: "CSAT do treinamento",
    icone: <Star size={20} />,
    menorEhMelhor: false,
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

function calcularValorIndicadorBolsa(
  chave: ChaveBolsa,
  eventos: EventosIndicadoresTreinamento,
  empresas: Empresa[],
  ocorrencias: Ocorrencia[],
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
  return calcularValorKpiTreinamento(chave, eventos, inicio, fim, treinador);
}

function formatarValorBolsa(chave: ChaveBolsa, valor: number | null): string {
  if (chave === "golNoPrazo") {
    return valor === null ? "—" : `${Math.round(valor)}%`;
  }
  return formatarValorKpiTreinamento(chave, valor);
}

interface Ponto {
  categoria: string;
  valor: number | null;
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

/**
 * Gráfico de linha em SVG puro, estilo ticker (TradingView): curva suavizada, área
 * preenchida em degradê, brilho na linha e grade pontilhada de fundo.
 */
function Sparkline({ pontos, cor }: { pontos: Ponto[]; cor: string }) {
  const largura = 320;
  const altura = 200;
  const margem = 10;
  const valores = pontos.map((p) => p.valor ?? 0);
  const min = Math.min(...valores, 0);
  const max = Math.max(...valores, 1);
  const amplitude = max - min || 1;
  const passo = pontos.length > 1 ? largura / (pontos.length - 1) : 0;

  const coords = valores.map((v, i) => {
    const x = i * passo;
    const y = altura - margem - ((v - min) / amplitude) * (altura - margem * 2);
    return { x, y };
  });

  const linha = caminhoSuave(coords);
  const area = `${linha} L ${largura},${altura} L 0,${altura} Z`;
  const idGradiente = `bolsa-grad-${cor.replace("#", "")}`;
  const idGlow = `bolsa-glow-${cor.replace("#", "")}`;
  const linhasGradeY = [0.25, 0.5, 0.75].map((f) => margem + (altura - margem * 2) * f);

  return (
    <svg
      className="bolsa-sparkline"
      viewBox={`0 0 ${largura} ${altura}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={idGradiente} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={cor} stopOpacity="0.4" />
          <stop offset="100%" stopColor={cor} stopOpacity="0" />
        </linearGradient>
        <filter id={idGlow} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {linhasGradeY.map((y) => (
        <line
          key={y}
          x1="0"
          y1={y}
          x2={largura}
          y2={y}
          stroke="rgba(255,255,255,0.07)"
          strokeWidth="1"
          strokeDasharray="4 6"
        />
      ))}
      <path d={area} fill={`url(#${idGradiente})`} stroke="none" />
      <path
        d={linha}
        fill="none"
        stroke={cor}
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
        filter={`url(#${idGlow})`}
      />
      {coords.length > 0 && (
        <circle
          cx={coords[coords.length - 1].x}
          cy={coords[coords.length - 1].y}
          r="5"
          fill={cor}
          stroke="#0b1120"
          strokeWidth="2"
        />
      )}
    </svg>
  );
}

function CardIndicador({
  config,
  serie,
  granularidade,
}: {
  config: ConfigBolsa;
  serie: Ponto[];
  granularidade: Granularidade;
}) {
  const ultimo = serie[serie.length - 1]?.valor ?? null;
  const penultimo = serie[serie.length - 2]?.valor ?? null;
  const temComparacao = ultimo !== null && penultimo !== null;
  const deltaPasso = temComparacao ? ultimo! - penultimo! : null;
  const deltaPercentual =
    temComparacao && penultimo !== 0 ? (deltaPasso! / Math.abs(penultimo!)) * 100 : null;
  // Favorabilidade do selo: sempre em cima do mesmo número que ele exibe (o último passo),
  // nunca da tendência do período inteiro — senão a seta/cor podem contradizer o valor.
  const favoravelPasso =
    deltaPasso === null || deltaPasso === 0
      ? null
      : config.menorEhMelhor
        ? deltaPasso < 0
        : deltaPasso > 0;

  // A cor do ícone/gráfico reflete a tendência do período inteiro exibido (primeiro vs.
  // último ponto com dado) — igual a um ticker de bolsa mostrando a variação do dia/período,
  // não só o último passo, que costuma ficar neutro quando os dados são esparsos.
  const valoresValidos = serie.map((p) => p.valor).filter((v): v is number => v !== null);
  const deltaTendencia =
    valoresValidos.length >= 2
      ? valoresValidos[valoresValidos.length - 1] - valoresValidos[0]
      : null;
  const favoravel =
    deltaTendencia === null || deltaTendencia === 0
      ? null
      : config.menorEhMelhor
        ? deltaTendencia < 0
        : deltaTendencia > 0;
  const cor = favoravel === null ? "#64748b" : favoravel ? "#22c55e" : "#ef4444";

  return (
    <div className="bolsa-card">
      <div className="bolsa-card-topo">
        <span className="bolsa-card-icone" style={{ color: cor }}>
          {config.icone}
        </span>
        <span className="bolsa-card-titulo">{config.titulo}</span>
      </div>

      <div className="bolsa-card-valor-bloco" key={`${config.chave}-${granularidade}`}>
        <span className="bolsa-card-valor">{formatarValorBolsa(config.chave, ultimo)}</span>
        {favoravelPasso !== null && deltaPercentual !== null && (
          <span
            className={`bolsa-card-badge ${favoravelPasso ? "bolsa-card-badge--up" : "bolsa-card-badge--down"}`}
          >
            {deltaPasso! > 0 ? "▲" : "▼"} {Math.abs(deltaPercentual).toFixed(1).replace(".", ",")}%
          </span>
        )}
      </div>

      <Sparkline pontos={serie} cor={cor} />

      <span className="bolsa-card-meta-label">
        {config.chave === "golNoPrazo"
          ? "Maior é melhor"
          : KPI_POR_CHAVE[config.chave].menorEhMelhor
            ? "Menor é melhor"
            : "Maior é melhor"}
      </span>
    </div>
  );
}

interface Props {
  eventos: EventosIndicadoresTreinamento;
  empresas: Empresa[];
  ocorrencias: Ocorrencia[];
  treinador: string | null;
}

/**
 * Cinco cards independentes, estilo "bolsa de valores" (ticker), alternando automaticamente
 * entre dia/semana/mês. Todo o cálculo roda em cima de `eventos`/`empresas`/`ocorrencias` já
 * carregados pela página-mãe — não dispara nenhuma leitura adicional no Firestore.
 */
export const BolsaIndicadoresTreinamento: React.FC<Props> = ({
  eventos,
  empresas,
  ocorrencias,
  treinador,
}) => {
  const [granularidade, setGranularidade] = useState<Granularidade>("dia");
  const [pausado, setPausado] = useState(false);

  useEffect(() => {
    if (pausado) return;
    const id = window.setInterval(() => {
      setGranularidade((atual) => {
        const idx = ORDEM_GRANULARIDADES.indexOf(atual);
        return ORDEM_GRANULARIDADES[(idx + 1) % ORDEM_GRANULARIDADES.length];
      });
    }, INTERVALO_ROTACAO_MS);
    return () => window.clearInterval(id);
  }, [pausado]);

  const periodosPorGranularidade = useMemo(() => {
    const agora = new Date();
    const inicioJanelaDia = new Date(agora);
    inicioJanelaDia.setDate(inicioJanelaDia.getDate() - 20);
    const inicioJanelaSemana = new Date(agora);
    inicioJanelaSemana.setDate(inicioJanelaSemana.getDate() - 70);

    return {
      dia: gerarPeriodosIndicadoresEntreDatas(inicioJanelaDia, agora, "dia").slice(-10),
      semana: gerarPeriodosIndicadoresEntreDatas(inicioJanelaSemana, agora, "semana").slice(-8),
      mes: gerarUltimosMeses(6),
    } satisfies Record<Granularidade, PeriodoIndicador[]>;
  }, []);

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
            p.inicio,
            p.fim,
            treinador,
          ),
        }));
      });
    });
    return resultado;
  }, [eventos, empresas, ocorrencias, treinador, periodosPorGranularidade]);

  return (
    <div className="bolsa-indicadores-wrapper">
      <div className="bolsa-indicadores-header">
        <div className="bolsa-indicadores-titulo">
          <Activity size={18} />
          <h2>Painel ao vivo</h2>
          <span className="bolsa-ao-vivo-dot" aria-hidden="true" />
        </div>
        <button
          type="button"
          className="bolsa-granularidade-toggle"
          onClick={() => setPausado((p) => !p)}
          aria-pressed={pausado}
          title={pausado ? "Retomar rotação automática" : "Pausar rotação automática"}
        >
          <span key={granularidade} className="bolsa-granularidade-label">
            {ROTULO_GRANULARIDADE[granularidade]}
          </span>
          {pausado ? " · pausado" : ""}
        </button>
      </div>

      <div className="bolsa-indicadores-grid-cards">
        {INDICADORES_BOLSA.map((config) => (
          <CardIndicador
            key={config.chave}
            config={config}
            serie={seriesPorIndicador[config.chave][granularidade]}
            granularidade={granularidade}
          />
        ))}
      </div>
    </div>
  );
};
