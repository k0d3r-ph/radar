import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  GraduationCap,
  UserX,
  Ban,
  Smile,
  ThumbsUp,
  ThumbsDown,
  Timer,
  Wrench,
  MessageCircle,
  PauseCircle,
  XCircle,
  Calendar,
  Target,
  ClipboardCheck,
  Award,
  Flag,
  Hourglass,
  Headphones,
  Star,
} from "lucide-react";
import { LineChart } from "../../components/LineChart";
import { SelectCustomizado } from "../../components/SelectCustomizado";
import { ColumnSelector } from "../../components/ColumnSelector";
import { ComparativoTreinamento } from "./ComparativoTreinamento";
import { DetalhamentoEsperaTreinamento } from "./DetalhamentoEsperaTreinamento";
import { DetalhamentoClientesSuspensos } from "./DetalhamentoClientesSuspensos";
import {
  intervaloAnteriorTreinamento,
  lerDataComparacao,
  type IntervaloComparacaoTreinamento,
} from "../../utils/comparativoTreinamento";
import { construirGraficoIndicadoresTreinamento } from "../../utils/graficoIndicadoresTreinamento";
import { listarEmpresas, isEmpresaInterna } from "../../services/empresas";
import { listarOcorrencias } from "../../services/ocorrencias";
import { listarLancamentosPontos } from "../../services/gamificacao";
import { listarUsuarios } from "../../services/auth";
import { indicadoresConhecimento } from "../../services/validacaoConhecimento";
import { atuaComoTreinador } from "../../utils/perfis";
import { formatarNome } from "../../utils/formatarNome";
import { usePreferenciaPaineis } from "../../hooks/usePreferenciaPaineis";
import { calcularTreinamentosNoPrazo } from "../../utils/prazoTreinamento";
import { calcularGolNoPrazo } from "../../utils/golTreinamento";
import type { Empresa, Ocorrencia, LancamentoPonto } from "../../types";
import {
  KPIS_TREINAMENTO,
  KPI_POR_CHAVE,
  construirEventosIndicadoresTreinamento,
  listarTreinadoresIndicadoresTreinamento,
  calcularValorKpiTreinamento,
  calcularResumoCardsTreinamento,
  gerarPeriodosIndicadoresEntreDatas,
  recortarPeriodosIndicadores,
  formatarValorKpiTreinamento,
  listarAvaliacoesCsatNoPeriodo,
  listarTemposPrimeiroTreinamentoNoPeriodo,
  type KpiTreinamentoChave,
} from "../../utils/indicadoresTreinamento";
import "../Relatorios/Relatorios.css";
import "./RelatorioIndicadoresTreinamento.css";

const ICONE_KPI: Record<KpiTreinamentoChave, React.ReactNode> = {
  treinamentosRealizados: <GraduationCap size={22} />,
  treinamentosAusentes: <UserX size={22} color="#f59e0b" />,
  treinamentosCancelados: <Ban size={22} color="#ef4444" />,
  taxaCsat: <Smile size={22} color="#10b981" />,
  treinamentosBons: <ThumbsUp size={22} color="#10b981" />,
  treinamentosRuins: <ThumbsDown size={22} color="#ef4444" />,
  tempoMedioEspera: <Timer size={22} />,
  contatosSuporte: <Wrench size={22} color="#f59e0b" />,
  atendimentosWhatsApp: <MessageCircle size={22} />,
  clientesSuspensos: <PauseCircle size={22} color="#f59e0b" />,
  clientesCancelados: <XCircle size={22} color="#ef4444" />,
  tempoPrimeiroTreinamento: <Hourglass size={22} />,
  contatosSuporteTreinamento: <Headphones size={22} color="#f59e0b" />,
  csatTreinamento: <Star size={22} color="#f59e0b" />,
};

function formatarDataISOLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

type ModoPeriodo = "semana" | "mes" | "personalizado";

export const RelatorioIndicadoresTreinamento: React.FC = () => {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([]);
  const [lancamentos, setLancamentos] = useState<LancamentoPonto[]>([]);
  const [treinadoresEquipe, setTreinadoresEquipe] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [kpiSelecionado, setKpiSelecionado] = useState<KpiTreinamentoChave>(
    "treinamentosRealizados",
  );
  const [treinadorFiltro, setTreinadorFiltro] = useState<string>("");
  const [granularidade, setGranularidade] = useState<"dia" | "semana">("dia");
  const [modoPeriodo, setModoPeriodo] = useState<ModoPeriodo>("semana");
  const [comparacao, setComparacao] = useState<{
    chave: string;
    ativo: boolean;
    selecionados: IntervaloComparacaoTreinamento[];
  } | null>(null);
  const [dataInicioPersonalizada, setDataInicioPersonalizada] =
    useState<string>(() => {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      return formatarDataISOLocal(d);
    });
  const [dataFimPersonalizada, setDataFimPersonalizada] = useState<string>(() =>
    formatarDataISOLocal(new Date()),
  );

  function alterarModoPeriodo(modo: ModoPeriodo) {
    if (modo !== modoPeriodo) setComparacao(null);
    setModoPeriodo(modo);
  }

  useEffect(() => {
    Promise.all([
      listarEmpresas(),
      listarOcorrencias(),
      listarLancamentosPontos(),
      listarUsuarios(),
    ])
      .then(
        ([
          empresasLista,
          ocorrenciasLista,
          lancamentosLista,
          usuariosLista,
        ]) => {
          setEmpresas(empresasLista.filter((e) => !isEmpresaInterna(e)));
          setOcorrencias(ocorrenciasLista);
          setLancamentos(lancamentosLista);
          setTreinadoresEquipe(
            listarTreinadoresIndicadoresTreinamento(
              usuariosLista
                .filter(
                  (u) =>
                    atuaComoTreinador(u.role) &&
                    !u.inativo &&
                    u.nome?.trim() &&
                    u.nome.trim().toLowerCase() !== "painel" &&
                    !u.email?.toLowerCase().includes("painel"),
                )
                .map((u) => u.nome.trim()),
              lancamentosLista,
              ocorrenciasLista,
            ).sort((a, b) =>
              formatarNome(a).localeCompare(formatarNome(b), "pt-BR"),
            ),
          );
        },
      )
      .catch((error) => {
        console.error(
          "Erro ao carregar dados dos indicadores de treinamento:",
          error,
        );
        toast.error("Erro ao carregar os indicadores de treinamento.");
      })
      .finally(() => setLoading(false));
  }, []);

  const eventos = useMemo(
    () =>
      construirEventosIndicadoresTreinamento(
        empresas,
        ocorrencias,
        lancamentos,
        treinadoresEquipe.map((nome) => ({ nome })),
      ),
    [empresas, ocorrencias, lancamentos, treinadoresEquipe],
  );

  // Intervalo [início, fim] de acordo com o filtro de período escolhido. Para os atalhos
  // "Semana atual"/"Mês atual", nunca avança além de hoje (evita dias futuros zerados no
  // meio da semana/mês corrente); para "Personalizado", o usuário controla os dois limites.
  const rangeAtivo = useMemo((): { inicio: Date; fim: Date } | null => {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const fimHojeInclusive = new Date();
    fimHojeInclusive.setHours(23, 59, 59, 999);

    if (modoPeriodo === "semana") {
      const diaDaSemana = hoje.getDay();
      const deslocamento = diaDaSemana === 0 ? 6 : diaDaSemana - 1;
      const inicio = new Date(hoje);
      inicio.setDate(inicio.getDate() - deslocamento);
      const fimSemana = new Date(inicio);
      fimSemana.setDate(inicio.getDate() + 6);
      fimSemana.setHours(23, 59, 59, 999);
      return {
        inicio,
        fim:
          fimSemana.getTime() > fimHojeInclusive.getTime()
            ? fimHojeInclusive
            : fimSemana,
      };
    }

    if (modoPeriodo === "mes") {
      const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
      fimMes.setHours(23, 59, 59, 999);
      return {
        inicio,
        fim:
          fimMes.getTime() > fimHojeInclusive.getTime()
            ? fimHojeInclusive
            : fimMes,
      };
    }

    const inicio = lerDataComparacao(dataInicioPersonalizada);
    const fim = lerDataComparacao(dataFimPersonalizada);
    if (!inicio || !fim) return null;
    fim.setHours(23, 59, 59, 999);
    if (inicio.getTime() > fim.getTime()) return null;
    return { inicio, fim };
  }, [modoPeriodo, dataInicioPersonalizada, dataFimPersonalizada]);

  const periodos = useMemo(
    () =>
      rangeAtivo
        ? recortarPeriodosIndicadores(
            gerarPeriodosIndicadoresEntreDatas(
              rangeAtivo.inicio,
              rangeAtivo.fim,
              granularidade,
            ),
            rangeAtivo,
          )
        : [],
    [rangeAtivo, granularidade],
  );

  const periodoTotal = rangeAtivo;

  const treinadorAtivo = treinadorFiltro || null;
  const chaveComparacao = `${modoPeriodo}-${dataInicioPersonalizada}-${dataFimPersonalizada}`;
  const comparacaoAtual = useMemo(
    () =>
      comparacao?.chave === chaveComparacao
        ? comparacao
        : {
            chave: chaveComparacao,
            ativo: false,
            selecionados: rangeAtivo
              ? [intervaloAnteriorTreinamento(modoPeriodo, rangeAtivo)]
              : [],
          },
    [comparacao, chaveComparacao, rangeAtivo, modoPeriodo],
  );

  const kpiConfigSelecionado = KPIS_TREINAMENTO.find(
    (k) => k.chave === kpiSelecionado,
  )!;

  const corKpi = kpiConfigSelecionado.menorEhMelhor ? "#ef4444" : "#3b82f6";
  const grafico = useMemo(
    () =>
      rangeAtivo
        ? construirGraficoIndicadoresTreinamento({
            atual: rangeAtivo,
            comparacoes: comparacaoAtual.ativo
              ? comparacaoAtual.selecionados
              : [],
            granularidade,
            eventos,
            kpi: kpiSelecionado,
            treinador: treinadorAtivo,
            cor: corKpi,
          })
        : { categorias: [], series: [] },
    [
      rangeAtivo,
      comparacaoAtual,
      granularidade,
      eventos,
      kpiSelecionado,
      treinadorAtivo,
      corKpi,
    ],
  );

  const valoresCards = useMemo(() => {
    if (!periodoTotal) return {} as Record<KpiTreinamentoChave, number | null>;
    const resultado = {} as Record<KpiTreinamentoChave, number | null>;
    KPIS_TREINAMENTO.forEach((kpi) => {
      resultado[kpi.chave] = calcularValorKpiTreinamento(
        kpi.chave,
        eventos,
        periodoTotal.inicio,
        periodoTotal.fim,
        treinadorAtivo,
      );
    });
    return resultado;
  }, [eventos, periodoTotal, treinadorAtivo]);

  const resumoCards = useMemo(
    () =>
      periodoTotal
        ? calcularResumoCardsTreinamento(
            valoresCards,
            periodoTotal.inicio,
            periodoTotal.fim,
          )
        : null,
    [valoresCards, periodoTotal],
  );

  // Resumo padrão (metas da gestão): satisfação e treinamentos no prazo usam o mesmo
  // período selecionado acima; Gol usa a janela própria de 30 dias da data de entrada,
  // então só filtra pelo período quando o resultado (Gol batido ou prazo vencido) caiu
  // dentro dele. Validação prática vem da API de validação de conhecimento (RelatorioValidacaoConhecimento).
  const resumoMetas = useMemo(() => {
    if (!periodoTotal) return null;
    const bons =
      calcularValorKpiTreinamento(
        "treinamentosBons",
        eventos,
        periodoTotal.inicio,
        periodoTotal.fim,
        treinadorAtivo,
      ) ?? 0;
    const ruins =
      calcularValorKpiTreinamento(
        "treinamentosRuins",
        eventos,
        periodoTotal.inicio,
        periodoTotal.fim,
        treinadorAtivo,
      ) ?? 0;
    const satisfacao = bons + ruins > 0 ? (bons / (bons + ruins)) * 100 : null;

    const prazoResultados = calcularTreinamentosNoPrazo(
      empresas,
      ocorrencias,
    ).filter(
      (r) =>
        r.dataRealUltimoTreinamento.getTime() >=
          periodoTotal.inicio.getTime() &&
        r.dataRealUltimoTreinamento.getTime() <= periodoTotal.fim.getTime(),
    );
    const treinamentosNoPrazo =
      prazoResultados.length > 0
        ? (prazoResultados.filter((r) => r.noPrazo).length /
            prazoResultados.length) *
          100
        : null;

    const golResultados = calcularGolNoPrazo(empresas, ocorrencias).filter(
      (r) =>
        r.dataReferencia.getTime() >= periodoTotal.inicio.getTime() &&
        r.dataReferencia.getTime() <= periodoTotal.fim.getTime(),
    );
    const golNoPrazo =
      golResultados.length > 0
        ? (golResultados.filter((r) => r.noPrazo).length /
            golResultados.length) *
          100
        : null;

    const csatTreinamento = calcularValorKpiTreinamento(
      "csatTreinamento",
      eventos,
      periodoTotal.inicio,
      periodoTotal.fim,
      treinadorAtivo,
    );
    const csatTreinamentoAmostra = listarAvaliacoesCsatNoPeriodo(
      eventos,
      periodoTotal.inicio,
      periodoTotal.fim,
      treinadorAtivo,
    ).length;

    return {
      satisfacao,
      satisfacaoAmostra: bons + ruins,
      treinamentosNoPrazo,
      treinamentosNoPrazoAmostra: prazoResultados.length,
      golNoPrazo,
      golNoPrazoAmostra: golResultados.length,
      csatTreinamento,
      csatTreinamentoAmostra,
    };
  }, [eventos, periodoTotal, treinadorAtivo, empresas, ocorrencias]);

  // Validação prática de aprendizado: reaproveita a API/indicadores já usados em
  // RelatorioValidacaoConhecimento (taxaAprovacao = tentativas que atingiram 80% ou mais).
  const chaveValidacao = periodoTotal
    ? `${formatarDataISOLocal(periodoTotal.inicio)}:${formatarDataISOLocal(periodoTotal.fim)}`
    : "";
  const [respostaValidacao, setRespostaValidacao] = useState<{
    chave: string;
    taxaAprovacao: number | null;
    amostra: number;
  } | null>(null);
  const carregandoValidacao =
    !!chaveValidacao && respostaValidacao?.chave !== chaveValidacao;
  const validacaoAprendizado =
    respostaValidacao?.chave === chaveValidacao ? respostaValidacao : null;

  useEffect(() => {
    if (!periodoTotal) return;
    let cancelado = false;
    indicadoresConhecimento(
      formatarDataISOLocal(periodoTotal.inicio),
      formatarDataISOLocal(periodoTotal.fim),
    )
      .then((dados) => {
        if (!cancelado)
          setRespostaValidacao({
            chave: chaveValidacao,
            taxaAprovacao: dados.taxaAprovacao,
            amostra: dados.tentativasConcluidas,
          });
      })
      .catch((error) => {
        console.error(
          "Erro ao carregar indicadores de validação do conhecimento:",
          error,
        );
        if (!cancelado)
          setRespostaValidacao({
            chave: chaveValidacao,
            taxaAprovacao: null,
            amostra: 0,
          });
      });
    return () => {
      cancelado = true;
    };
  }, [periodoTotal, chaveValidacao]);

  const linhasTabela = useMemo(() => {
    if (!periodoTotal) return [];
    const nomes = treinadorFiltro ? [treinadorFiltro] : treinadoresEquipe;
    return nomes.map((nome) => ({
      nome,
      porPeriodo: periodos.map(
        (p) =>
          calcularValorKpiTreinamento(
            kpiSelecionado,
            eventos,
            p.inicio,
            p.fim,
            nome,
          ) ?? 0,
      ),
      total: calcularValorKpiTreinamento(
        kpiSelecionado,
        eventos,
        periodoTotal.inicio,
        periodoTotal.fim,
        nome,
      ),
    }));
  }, [
    periodos,
    periodoTotal,
    kpiSelecionado,
    eventos,
    treinadorFiltro,
    treinadoresEquipe,
  ]);

  const linhaEquipe = useMemo(() => {
    if (!periodoTotal) return null;
    return {
      porPeriodo: periodos.map(
        (p) =>
          calcularValorKpiTreinamento(
            kpiSelecionado,
            eventos,
            p.inicio,
            p.fim,
            null,
          ) ?? 0,
      ),
      total: calcularValorKpiTreinamento(
        kpiSelecionado,
        eventos,
        periodoTotal.inicio,
        periodoTotal.fim,
        null,
      ),
    };
  }, [periodos, periodoTotal, kpiSelecionado, eventos]);

  const categorias = periodos.map((p) => p.categoria);

  const tituloGrafico = `${granularidade === "dia" ? "Evolução diária" : "Evolução semanal"} — ${kpiConfigSelecionado.titulo}${
    treinadorFiltro ? ` — ${formatarNome(treinadorFiltro)}` : ""
  }`;

  const PAINEIS_INDICADORES = [
    { key: "cartoes", label: "Cartões de indicadores" },
    { key: "comparativo", label: "Comparativo entre períodos" },
    { key: "grafico", label: "Gráfico de evolução" },
    { key: "tabela", label: "Tabela por treinador" },
  ];
  const prefsPaineis = usePreferenciaPaineis(
    "radar:indicadores-treinamento:paineis:v2",
    PAINEIS_INDICADORES,
  );
  const painelVisivel = (chave: string) =>
    prefsPaineis.visiveis.includes(chave);

  // Cartões sem KPI próprio (não alimentam o gráfico/tabela abaixo) — antigo "Resumo de
  // metas" — reunidos com os cartões de KPIS_TREINAMENTO (antiga grade clicável "Visão
  // dos indicadores") num único seletor, para o usuário escolher o que acompanhar.
  const CHAVES_CARTOES_ESTATICOS = [
    "treinamentosNoPrazo",
    "validacaoAprendizado",
    "satisfacaoTreinamento",
    "golNoPrazo",
  ] as const;
  type ChaveCartaoEstatico = (typeof CHAVES_CARTOES_ESTATICOS)[number];
  const CHAVES_CARTOES_ESTATICOS_SET = new Set<string>(
    CHAVES_CARTOES_ESTATICOS,
  );
  const TITULOS_CARTOES_ESTATICOS: Record<ChaveCartaoEstatico, string> = {
    treinamentosNoPrazo: "Treinamentos no prazo",
    validacaoAprendizado: "Validação prática de aprendizado",
    satisfacaoTreinamento: "Satisfação com o treinamento",
    golNoPrazo: "GOL atingido no prazo",
  };

  // Padrão (sem preferência salva): só os cinco indicadores mais acompanhados ficam
  // visíveis; os demais começam ocultos até o usuário escolher exibi-los.
  const CARTOES_VISIVEIS_PADRAO = new Set<string>([
    "golNoPrazo",
    "tempoPrimeiroTreinamento",
    "clientesSuspensos",
    "contatosSuporteTreinamento",
    "csatTreinamento",
  ]);
  const ITENS_CARTOES_INDICADORES = [
    ...CHAVES_CARTOES_ESTATICOS.map((chave) => ({
      key: chave,
      label: TITULOS_CARTOES_ESTATICOS[chave],
      hiddenByDefault: !CARTOES_VISIVEIS_PADRAO.has(chave),
    })),
    ...KPIS_TREINAMENTO.map((kpi) => ({
      key: kpi.chave,
      label: kpi.titulo,
      hiddenByDefault: !CARTOES_VISIVEIS_PADRAO.has(kpi.chave),
    })),
  ];
  const prefsCartoes = usePreferenciaPaineis(
    "radar:indicadores-treinamento:cartoes:v1",
    ITENS_CARTOES_INDICADORES,
  );
  const cartoesVisiveis = prefsCartoes.visiveis;

  // Se o KPI selecionado (usado no gráfico e na tabela abaixo) foi ocultado, volta para
  // o primeiro cartão de KPI ainda visível (os cartões estáticos não alimentam o gráfico).
  const kpisVisiveis = cartoesVisiveis.filter(
    (chave) => !CHAVES_CARTOES_ESTATICOS_SET.has(chave),
  ) as KpiTreinamentoChave[];
  useEffect(() => {
    if (kpisVisiveis.length > 0 && !kpisVisiveis.includes(kpiSelecionado)) {
      setKpiSelecionado(kpisVisiveis[0]);
    }
  }, [kpisVisiveis, kpiSelecionado]);

  // Dados dos quatro cartões estáticos (sem KPI próprio): mesmas fontes do antigo
  // "Resumo de metas" (resumoMetas, validação de conhecimento).
  const cartoesEstaticosDados: Record<
    ChaveCartaoEstatico,
    {
      titulo: string;
      icone: React.ReactNode;
      valor: number | null;
      amostra: number;
      meta: number | null;
      descricaoAmostra: (n: number) => string;
      descricaoSemAmostra: string;
    }
  > = {
    treinamentosNoPrazo: {
      titulo: "Treinamentos no prazo",
      icone: <Target size={22} color="#3b82f6" />,
      valor: resumoMetas?.treinamentosNoPrazo ?? null,
      amostra: resumoMetas?.treinamentosNoPrazoAmostra ?? 0,
      meta: 95,
      descricaoAmostra: (n) =>
        `${n} ${n === 1 ? "esteira concluída" : "esteiras concluídas"} no período, com cadência cadastrada.`,
      descricaoSemAmostra:
        "Nenhuma esteira com cadência de treinamento cadastrada concluiu o último treinamento neste período.",
    },
    validacaoAprendizado: {
      titulo: "Validação prática de aprendizado",
      icone: <ClipboardCheck size={22} color="#10b981" />,
      valor: carregandoValidacao
        ? null
        : (validacaoAprendizado?.taxaAprovacao ?? null),
      amostra: validacaoAprendizado?.amostra ?? 0,
      meta: 80,
      descricaoAmostra: (n) =>
        `${n} ${n === 1 ? "tentativa concluída" : "tentativas concluídas"} no período.`,
      descricaoSemAmostra: carregandoValidacao
        ? "Carregando…"
        : "Nenhuma tentativa de validação concluída neste período.",
    },
    satisfacaoTreinamento: {
      titulo: "Satisfação com o treinamento",
      icone: <Award size={22} color="#f59e0b" />,
      valor: resumoMetas?.satisfacao ?? null,
      amostra: resumoMetas?.satisfacaoAmostra ?? 0,
      meta: 90,
      descricaoAmostra: (n) =>
        `${n} ${n === 1 ? "avaliação recebida" : "avaliações recebidas"} (Bom ou Ruim) no período.`,
      descricaoSemAmostra:
        "Nenhuma avaliação de CSAT recebida neste período.",
    },
    golNoPrazo: {
      titulo: "GOL atingido no prazo",
      icone: <Flag size={22} color="#ef4444" />,
      valor: resumoMetas?.golNoPrazo ?? null,
      amostra: resumoMetas?.golNoPrazoAmostra ?? 0,
      meta: null,
      descricaoAmostra: (n) =>
        `${n} ${n === 1 ? "cliente avaliado" : "clientes avaliados"} no período (Gol batido ou prazo de 30 dias vencido).`,
      descricaoSemAmostra:
        "Nenhum cliente com resultado de Gol apurado neste período.",
    },
  };

  function renderCartaoEstatico(chave: ChaveCartaoEstatico) {
    const item = cartoesEstaticosDados[chave];
    const atingiuMeta =
      item.valor !== null && item.meta !== null
        ? item.valor >= item.meta
        : null;
    const valorFormatado =
      item.valor === null ? "—" : `${Math.round(item.valor)}%`;
    const metaFormatada = item.meta === null ? null : `≥${item.meta}%`;
    return (
      <div
        key={chave}
        className="relatorio-kpi-card indicadores-cartao-estatico"
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span className="kpi-label">{item.titulo}</span>
          <span style={{ opacity: 0.8 }}>{item.icone}</span>
        </div>
        <div className="kpi-value-row">
          <span className="kpi-value">{valorFormatado}</span>
          {metaFormatada && (
            <span className="kpi-desc indicadores-kpi-complemento">
              Meta: {metaFormatada}
            </span>
          )}
        </div>
        {atingiuMeta !== null && (
          <span
            className={`indicadores-meta-badge ${atingiuMeta ? "indicadores-meta-badge--ok" : "indicadores-meta-badge--abaixo"}`}
          >
            {atingiuMeta ? "✓ Dentro da meta" : "✗ Abaixo da meta"}
          </span>
        )}
      </div>
    );
  }

  // Complementos (meta e amostra) dos três KPIs que antes só apareciam no Resumo de
  // metas — preservados aqui para não perder informação ao fundir os dois painéis.
  const metasExtraKpi: Partial<
    Record<
      KpiTreinamentoChave,
      {
        meta: number | null;
        formatoMeta: "percentual" | "nota";
        amostra: number;
        descricaoAmostra: (n: number) => string;
        descricaoSemAmostra: string;
      }
    >
  > = periodoTotal
    ? {
        tempoPrimeiroTreinamento: {
          meta: null,
          formatoMeta: "percentual",
          amostra: listarTemposPrimeiroTreinamentoNoPeriodo(
            eventos,
            periodoTotal.inicio,
            periodoTotal.fim,
            treinadorAtivo,
          ).length,
          descricaoAmostra: (n) =>
            `${n} ${n === 1 ? "cliente apurado" : "clientes apurados"} no período. Sem meta fixa (linha de base).`,
          descricaoSemAmostra:
            "Nenhum cliente com primeiro treinamento realizado neste período.",
        },
        contatosSuporteTreinamento: {
          meta: null,
          formatoMeta: "percentual",
          amostra: valoresCards.contatosSuporteTreinamento ?? 0,
          descricaoAmostra: () =>
            "Ocorrências de Suporte importadas do SSX Desk de clientes em treinamento no período. Sem meta fixa (linha de base).",
          descricaoSemAmostra:
            "Nenhum contato de Suporte do SSX Desk atribuível a treinamento neste período.",
        },
        csatTreinamento: {
          meta: 4.8,
          formatoMeta: "nota",
          amostra: listarAvaliacoesCsatNoPeriodo(
            eventos,
            periodoTotal.inicio,
            periodoTotal.fim,
            treinadorAtivo,
          ).length,
          descricaoAmostra: (n) =>
            `${n} ${n === 1 ? "avaliação" : "avaliações"} de 1 a 5 estrelas no período. Respostas antigas (Bom/Ruim) não entram aqui.`,
          descricaoSemAmostra:
            "Nenhuma avaliação em estrelas recebida neste período.",
        },
      }
    : {};

  function renderCartaoKpi(chave: KpiTreinamentoChave) {
    const kpi = KPI_POR_CHAVE[chave];
    const extra = metasExtraKpi[chave];
    const valor = valoresCards[chave] ?? null;
    const atingiuMeta =
      extra && valor !== null && extra.meta !== null
        ? valor >= extra.meta
        : null;
    const metaFormatada =
      extra?.meta == null
        ? null
        : extra.formatoMeta === "nota"
          ? `≥${String(extra.meta).replace(".", ",")} / 5`
          : `≥${extra.meta}%`;
    return (
      <div
        key={chave}
        className={`relatorio-kpi-card ${kpiSelecionado === chave ? "active" : ""}`}
        onClick={() => setKpiSelecionado(chave)}
        role="button"
        aria-pressed={kpiSelecionado === chave}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setKpiSelecionado(chave);
          }
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span className="kpi-label">{kpi.titulo}</span>
          <span style={{ opacity: 0.8 }}>{ICONE_KPI[chave]}</span>
        </div>
        <div className="kpi-value-row">
          <span className="kpi-value">
            {formatarValorKpiTreinamento(chave, valor)}
          </span>
          {metaFormatada && (
            <span className="kpi-desc indicadores-kpi-complemento">
              Meta: {metaFormatada}
            </span>
          )}
          {!metaFormatada &&
            resumoCards &&
            chave in resumoCards.percentuais && (
              <span className="kpi-desc indicadores-kpi-complemento">
                {formatarValorKpiTreinamento(
                  "taxaCsat",
                  resumoCards.percentuais[chave] ?? null,
                )}{" "}
                do total
              </span>
            )}
        </div>
        {atingiuMeta !== null && (
          <span
            className={`indicadores-meta-badge ${atingiuMeta ? "indicadores-meta-badge--ok" : "indicadores-meta-badge--abaixo"}`}
          >
            {atingiuMeta ? "✓ Dentro da meta" : "✗ Abaixo da meta"}
          </span>
        )}
        {resumoCards && chave in resumoCards.percentuais && (
          <span className="kpi-desc">
            Base: {resumoCards.totalTreinamentos} treinamentos (realizados,
            ausentes e cancelados).
          </span>
        )}
        {resumoCards && chave === "contatosSuporte" && (
          <span className="kpi-desc indicadores-kpi-complemento">
            Média:{" "}
            {resumoCards.mediaSuporte === null
              ? "—"
              : resumoCards.mediaSuporte.toFixed(1).replace(".", ",")}{" "}
            por dia útil
            {` · ${resumoCards.diasUteis} ${resumoCards.diasUteis === 1 ? "dia útil" : "dias úteis"} no período`}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="indicadores-treinamento-container">
      <div className="relatorios-filtros indicadores-filtros">
        <div className="indicadores-periodo-filtro">
          <div
            className="indicadores-periodo-toggle"
            role="group"
            aria-label="Período do relatório"
          >
            <button
              type="button"
              className={`indicadores-periodo-btn ${modoPeriodo === "semana" ? "active" : ""}`}
              onClick={() => alterarModoPeriodo("semana")}
            >
              Semana atual
            </button>
            <button
              type="button"
              className={`indicadores-periodo-btn ${modoPeriodo === "mes" ? "active" : ""}`}
              onClick={() => alterarModoPeriodo("mes")}
            >
              Mês atual
            </button>
            <button
              type="button"
              className={`indicadores-periodo-btn ${modoPeriodo === "personalizado" ? "active" : ""}`}
              onClick={() => alterarModoPeriodo("personalizado")}
            >
              Personalizado
            </button>
          </div>

          {modoPeriodo === "personalizado" && (
            <div className="indicadores-periodo-personalizado">
              <label htmlFor="indicadores-data-inicio">De:</label>
              <input
                id="indicadores-data-inicio"
                type="date"
                value={dataInicioPersonalizada}
                max={dataFimPersonalizada}
                onChange={(e) => {
                  setDataInicioPersonalizada(e.target.value);
                  setComparacao(null);
                }}
              />
              <label htmlFor="indicadores-data-fim">Até:</label>
              <input
                id="indicadores-data-fim"
                type="date"
                value={dataFimPersonalizada}
                min={dataInicioPersonalizada}
                max={formatarDataISOLocal(new Date())}
                onChange={(e) => {
                  setDataFimPersonalizada(e.target.value);
                  setComparacao(null);
                }}
              />
            </div>
          )}

          {rangeAtivo && (
            <span className="semana-info-badge">
              <Calendar
                size={14}
                style={{ marginRight: "6px", verticalAlign: "middle" }}
              />
              Período: {rangeAtivo.inicio.toLocaleDateString("pt-BR")} até{" "}
              {rangeAtivo.fim.toLocaleDateString("pt-BR")}
            </span>
          )}
        </div>

        <div className="indicadores-treinador-filtro">
          <label id="indicadores-treinador-label">Treinador:</label>
          <SelectCustomizado
            className="w-auto"
            value={treinadorFiltro}
            onChange={setTreinadorFiltro}
            opcoes={[
              { value: "", label: "Todos os treinadores" },
              ...treinadoresEquipe.map((nome) => ({
                value: nome,
                label: formatarNome(nome),
              })),
            ]}
            searchPlaceholder="Pesquisar treinador..."
            ariaLabel="Filtrar por treinador"
          />
        </div>

        <ColumnSelector
          columns={PAINEIS_INDICADORES}
          order={prefsPaineis.order}
          hidden={prefsPaineis.hidden}
          onChangeOrder={prefsPaineis.setOrder}
          onChangeHidden={prefsPaineis.setHidden}
          onRestaurarPadrao={prefsPaineis.restaurarPadrao}
          label="⚙️ Painéis"
          triggerTitulo="Escolher e reorganizar os painéis deste relatório"
          painelTitulo="Painéis deste relatório"
          painelDica="Escolha quais painéis ficam visíveis e em que ordem. Arraste para reordenar."
          ariaLabel="Escolher painéis visíveis dos indicadores de treinamento"
        />
      </div>

      {loading ? (
        <div className="relatorio-loader">
          <div className="spinner"></div>
          <p>Carregando indicadores de treinamento...</p>
        </div>
      ) : !rangeAtivo ? (
        <div className="relatorio-empty">
          <span className="relatorio-empty-icon">
            <Calendar size={28} />
          </span>
          <p>
            Informe datas válidas, com a data inicial anterior ou igual à final.
          </p>
        </div>
      ) : (
        <>
          {/* Cartões de indicadores — reúne as metas da gestão (antigo "Resumo de metas")
              e os KPIs clicáveis que alimentam o gráfico/tabela abaixo (antiga "Visão
              dos indicadores") num único seletor de cartões visíveis. */}
          {painelVisivel("cartoes") && (
            <>
              <div className="indicadores-secao-header indicadores-secao-header-com-acao">
                <div>
                  <h2>Indicadores</h2>
                  <p>
                    Escolha os indicadores acompanhados para o período
                    selecionado acima. Clique num cartão de KPI para explorar
                    a evolução e comparar períodos.
                  </p>
                </div>
                <ColumnSelector
                  columns={ITENS_CARTOES_INDICADORES}
                  order={prefsCartoes.order}
                  hidden={prefsCartoes.hidden}
                  onChangeOrder={prefsCartoes.setOrder}
                  onChangeHidden={prefsCartoes.setHidden}
                  onRestaurarPadrao={prefsCartoes.restaurarPadrao}
                  label="⚙️ Indicadores"
                  triggerTitulo="Escolher e reorganizar os cartões exibidos"
                  painelTitulo="Cartões deste relatório"
                  painelDica="Escolha quais indicadores aparecem aqui e em que ordem. Arraste para reordenar."
                  ariaLabel="Escolher indicadores visíveis no relatório"
                />
              </div>
              <div className="relatorios-grid">
                {cartoesVisiveis.map((chave) =>
                  CHAVES_CARTOES_ESTATICOS_SET.has(chave)
                    ? renderCartaoEstatico(chave as ChaveCartaoEstatico)
                    : renderCartaoKpi(chave as KpiTreinamentoChave),
                )}
              </div>
            </>
          )}

          {painelVisivel("comparativo") && (
            <ComparativoTreinamento
              key={chaveComparacao}
              modo={modoPeriodo}
              atual={rangeAtivo}
              eventos={eventos}
              kpi={kpiSelecionado}
              treinador={treinadorAtivo}
              treinadores={treinadoresEquipe}
              ativo={comparacaoAtual.ativo}
              selecionados={comparacaoAtual.selecionados}
              onAtivoChange={(ativo) =>
                setComparacao({ ...comparacaoAtual, ativo })
              }
              onSelecionadosChange={(selecionados) =>
                setComparacao({ ...comparacaoAtual, selecionados })
              }
            />
          )}

          {painelVisivel("grafico") && (
            <>
              {/* Filtros do gráfico */}
              <div className="line-chart-filtro-semanas">
                <label id="indicadores-granularidade-label">
                  Visualizar por:
                </label>
                <SelectCustomizado
                  className="w-auto"
                  value={granularidade}
                  onChange={(v) => setGranularidade(v as "dia" | "semana")}
                  opcoes={[
                    { value: "semana", label: "Semana" },
                    { value: "dia", label: "Dia" },
                  ]}
                  ariaLabel="Granularidade do gráfico"
                />
              </div>

              {/* Gráfico — parte superior */}
              {comparacaoAtual.ativo &&
                comparacaoAtual.selecionados.length > 0 && (
                  <p className="aging-legenda">
                    {kpiSelecionado === "taxaCsat" ? "As colunas" : "As linhas"}{" "}
                    são alinhadas pela posição de cada{" "}
                    {granularidade === "dia" ? "dia útil" : "semana"} no
                    período. Passe o mouse ou navegue pelos pontos com Tab para
                    consultar as datas e os indicadores.
                  </p>
                )}
              <LineChart
                title={tituloGrafico}
                categorias={grafico.categorias}
                series={grafico.series}
                exibirZerados={kpiSelecionado === "taxaCsat"}
                variante={kpiSelecionado === "taxaCsat" ? "colunas" : "linha"}
              />
              {(kpiSelecionado === "treinamentosRealizados" ||
                kpiSelecionado === "tempoMedioEspera") && (
                <DetalhamentoEsperaTreinamento
                  eventos={eventos}
                  inicio={rangeAtivo.inicio}
                  fim={rangeAtivo.fim}
                  treinador={treinadorAtivo}
                />
              )}
              {kpiSelecionado === "clientesSuspensos" && (
                <DetalhamentoClientesSuspensos
                  eventos={eventos}
                  inicio={rangeAtivo.inicio}
                  fim={rangeAtivo.fim}
                  treinador={treinadorAtivo}
                />
              )}
            </>
          )}

          {/* Painel analítico — parte inferior: o mesmo KPI, detalhado por treinador e período */}
          {painelVisivel("tabela") && (
            <div className="relatorio-detalhe-section indicadores-tabela-card">
              <div className="indicadores-tabela-header">
                <h3>{kpiConfigSelecionado.titulo} por treinador</h3>
                <p>{kpiConfigSelecionado.descricao}</p>
              </div>

              {linhasTabela.length === 0 ? (
                <div className="relatorio-empty">
                  <span className="relatorio-empty-icon">
                    <GraduationCap size={28} />
                  </span>
                  <p>
                    Nenhum treinador cadastrado ou com histórico de treinamento
                    para exibir o detalhamento.
                  </p>
                </div>
              ) : (
                <div
                  className="relatorios-table-wrapper"
                  role="region"
                  aria-label={`${kpiConfigSelecionado.titulo} por treinador, tabela rolável na horizontal`}
                  tabIndex={0}
                >
                  <table className="relatorios-table indicadores-tabela">
                    <thead>
                      <tr>
                        <th className="indicadores-col-treinador">Treinador</th>
                        {categorias.map((cat, idx) => (
                          <th key={`${cat}-${idx}`}>{cat}</th>
                        ))}
                        <th className="indicadores-col-total">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linhasTabela.map((linha) => (
                        <tr key={linha.nome}>
                          <td className="indicadores-col-treinador">
                            {formatarNome(linha.nome)}
                          </td>
                          {linha.porPeriodo.map((valor, idx) => (
                            <td key={idx}>
                              {formatarValorKpiTreinamento(
                                kpiSelecionado,
                                valor,
                              )}
                            </td>
                          ))}
                          <td className="indicadores-col-total">
                            {formatarValorKpiTreinamento(
                              kpiSelecionado,
                              linha.total,
                            )}
                          </td>
                        </tr>
                      ))}
                      {!treinadorFiltro && linhaEquipe && (
                        <tr className="indicadores-linha-equipe">
                          <td className="indicadores-col-treinador">
                            Equipe (total)
                          </td>
                          {linhaEquipe.porPeriodo.map((valor, idx) => (
                            <td key={idx}>
                              {formatarValorKpiTreinamento(
                                kpiSelecionado,
                                valor,
                              )}
                            </td>
                          ))}
                          <td className="indicadores-col-total">
                            {formatarValorKpiTreinamento(
                              kpiSelecionado,
                              linhaEquipe.total,
                            )}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
