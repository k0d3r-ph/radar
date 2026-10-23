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
} from "lucide-react";
import { LineChart } from "../../components/LineChart";
import { SelectCustomizado } from "../../components/SelectCustomizado";
import { ComparativoTreinamento } from "./ComparativoTreinamento";
import { DetalhamentoEsperaTreinamento } from "./DetalhamentoEsperaTreinamento";
import { intervaloAnteriorTreinamento, lerDataComparacao, type IntervaloComparacaoTreinamento } from "../../utils/comparativoTreinamento";
import { construirGraficoIndicadoresTreinamento } from "../../utils/graficoIndicadoresTreinamento";
import { listarEmpresas, isEmpresaInterna } from "../../services/empresas";
import { listarOcorrencias } from "../../services/ocorrencias";
import { listarLancamentosPontos } from "../../services/gamificacao";
import { listarUsuarios } from "../../services/auth";
import { atuaComoTreinador } from "../../utils/perfis";
import { formatarNome } from "../../utils/formatarNome";
import type { Empresa, Ocorrencia, LancamentoPonto } from "../../types";
import {
  KPIS_TREINAMENTO,
  construirEventosIndicadoresTreinamento,
  listarTreinadoresIndicadoresTreinamento,
  calcularValorKpiTreinamento,
  calcularResumoCardsTreinamento,
  gerarPeriodosIndicadoresEntreDatas,
  recortarPeriodosIndicadores,
  formatarValorKpiTreinamento,
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

  const [kpiSelecionado, setKpiSelecionado] = useState<KpiTreinamentoChave>("treinamentosRealizados");
  const [treinadorFiltro, setTreinadorFiltro] = useState<string>("");
  const [granularidade, setGranularidade] = useState<"dia" | "semana">("dia");
  const [modoPeriodo, setModoPeriodo] = useState<ModoPeriodo>("semana");
  const [comparacao, setComparacao] = useState<{
    chave: string;
    ativo: boolean;
    selecionados: IntervaloComparacaoTreinamento[];
  } | null>(null);
  const [dataInicioPersonalizada, setDataInicioPersonalizada] = useState<string>(() => {
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
      .then(([empresasLista, ocorrenciasLista, lancamentosLista, usuariosLista]) => {
        setEmpresas(empresasLista.filter((e) => !isEmpresaInterna(e)));
        setOcorrencias(ocorrenciasLista);
        setLancamentos(lancamentosLista);
        setTreinadoresEquipe(
          listarTreinadoresIndicadoresTreinamento(
            usuariosLista.filter(
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
          )
            .sort((a, b) => formatarNome(a).localeCompare(formatarNome(b), "pt-BR")),
        );
      })
      .catch((error) => {
        console.error("Erro ao carregar dados dos indicadores de treinamento:", error);
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
      return { inicio, fim: fimSemana.getTime() > fimHojeInclusive.getTime() ? fimHojeInclusive : fimSemana };
    }

    if (modoPeriodo === "mes") {
      const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
      fimMes.setHours(23, 59, 59, 999);
      return { inicio, fim: fimMes.getTime() > fimHojeInclusive.getTime() ? fimHojeInclusive : fimMes };
    }

    const inicio = lerDataComparacao(dataInicioPersonalizada);
    const fim = lerDataComparacao(dataFimPersonalizada);
    if (!inicio || !fim) return null;
    fim.setHours(23, 59, 59, 999);
    if (inicio.getTime() > fim.getTime()) return null;
    return { inicio, fim };
  }, [modoPeriodo, dataInicioPersonalizada, dataFimPersonalizada]);

  const periodos = useMemo(
    () => (rangeAtivo ? recortarPeriodosIndicadores(
      gerarPeriodosIndicadoresEntreDatas(rangeAtivo.inicio, rangeAtivo.fim, granularidade),
      rangeAtivo,
    ) : []),
    [rangeAtivo, granularidade],
  );

  const periodoTotal = rangeAtivo;

  const treinadorAtivo = treinadorFiltro || null;
  const chaveComparacao = `${modoPeriodo}-${dataInicioPersonalizada}-${dataFimPersonalizada}`;
  const comparacaoAtual = useMemo(() => comparacao?.chave === chaveComparacao ? comparacao : {
    chave: chaveComparacao,
    ativo: false,
    selecionados: rangeAtivo ? [intervaloAnteriorTreinamento(modoPeriodo, rangeAtivo)] : [],
  }, [comparacao, chaveComparacao, rangeAtivo, modoPeriodo]);

  const kpiConfigSelecionado = KPIS_TREINAMENTO.find((k) => k.chave === kpiSelecionado)!;

  const corKpi = kpiConfigSelecionado.menorEhMelhor ? "#ef4444" : "#3b82f6";
  const grafico = useMemo(() => rangeAtivo ? construirGraficoIndicadoresTreinamento({
    atual: rangeAtivo,
    comparacoes: comparacaoAtual.ativo ? comparacaoAtual.selecionados : [],
    granularidade,
    eventos,
    kpi: kpiSelecionado,
    treinador: treinadorAtivo,
    cor: corKpi,
  }) : { categorias: [], series: [] }, [rangeAtivo, comparacaoAtual, granularidade,
    eventos, kpiSelecionado, treinadorAtivo, corKpi]);

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

  const resumoCards = useMemo(() => periodoTotal
    ? calcularResumoCardsTreinamento(valoresCards, periodoTotal.inicio, periodoTotal.fim)
    : null, [valoresCards, periodoTotal]);

  const linhasTabela = useMemo(() => {
    if (!periodoTotal) return [];
    const nomes = treinadorFiltro ? [treinadorFiltro] : treinadoresEquipe;
    return nomes.map((nome) => ({
      nome,
      porPeriodo: periodos.map(
        (p) => calcularValorKpiTreinamento(kpiSelecionado, eventos, p.inicio, p.fim, nome) ?? 0,
      ),
      total: calcularValorKpiTreinamento(kpiSelecionado, eventos, periodoTotal.inicio, periodoTotal.fim, nome),
    }));
  }, [periodos, periodoTotal, kpiSelecionado, eventos, treinadorFiltro, treinadoresEquipe]);

  const linhaEquipe = useMemo(() => {
    if (!periodoTotal) return null;
    return {
      porPeriodo: periodos.map(
        (p) => calcularValorKpiTreinamento(kpiSelecionado, eventos, p.inicio, p.fim, null) ?? 0,
      ),
      total: calcularValorKpiTreinamento(kpiSelecionado, eventos, periodoTotal.inicio, periodoTotal.fim, null),
    };
  }, [periodos, periodoTotal, kpiSelecionado, eventos]);

  const categorias = periodos.map((p) => p.categoria);

  const tituloGrafico = `${granularidade === "dia" ? "Evolução diária" : "Evolução semanal"} — ${kpiConfigSelecionado.titulo}${
    treinadorFiltro ? ` — ${formatarNome(treinadorFiltro)}` : ""
  }`;

  return (
    <div className="indicadores-treinamento-container">
      <div className="relatorios-filtros indicadores-filtros">
        <div className="indicadores-periodo-filtro">
          <div className="indicadores-periodo-toggle" role="group" aria-label="Período do relatório">
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
                onChange={(e) => { setDataInicioPersonalizada(e.target.value); setComparacao(null); }}
              />
              <label htmlFor="indicadores-data-fim">Até:</label>
              <input
                id="indicadores-data-fim"
                type="date"
                value={dataFimPersonalizada}
                min={dataInicioPersonalizada}
                max={formatarDataISOLocal(new Date())}
                onChange={(e) => { setDataFimPersonalizada(e.target.value); setComparacao(null); }}
              />
            </div>
          )}

          {rangeAtivo && (
            <span className="semana-info-badge">
              <Calendar size={14} style={{ marginRight: "6px", verticalAlign: "middle" }} />
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
              ...treinadoresEquipe.map((nome) => ({ value: nome, label: formatarNome(nome) })),
            ]}
            searchPlaceholder="Pesquisar treinador..."
            ariaLabel="Filtrar por treinador"
          />
        </div>
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
          <p>Informe datas válidas, com a data inicial anterior ou igual à final.</p>
        </div>
      ) : (
        <>
          {/* Grid de KPIs — clicar num card seleciona o KPI exibido no gráfico e no painel abaixo */}
          <div className="indicadores-secao-header">
            <h2>Visão dos indicadores</h2>
            <p>Selecione um indicador para explorar a evolução e comparar períodos.</p>
          </div>
          <div className="relatorios-grid">
            {KPIS_TREINAMENTO.map((kpi) => (
              <div
                key={kpi.chave}
                className={`relatorio-kpi-card ${kpiSelecionado === kpi.chave ? "active" : ""}`}
                onClick={() => setKpiSelecionado(kpi.chave)}
                role="button"
                aria-pressed={kpiSelecionado === kpi.chave}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setKpiSelecionado(kpi.chave);
                  }
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="kpi-label">{kpi.titulo}</span>
                  <span style={{ opacity: 0.8 }}>{ICONE_KPI[kpi.chave]}</span>
                </div>
                <div className="kpi-value-row">
                  <span className="kpi-value">
                    {formatarValorKpiTreinamento(kpi.chave, valoresCards[kpi.chave] ?? null)}
                  </span>
                  {resumoCards && kpi.chave in resumoCards.percentuais && (
                    <span className="kpi-desc indicadores-kpi-complemento">
                      {formatarValorKpiTreinamento("taxaCsat", resumoCards.percentuais[kpi.chave] ?? null)} do total
                    </span>
                  )}
                </div>
                {resumoCards && kpi.chave in resumoCards.percentuais && (
                  <span className="kpi-desc">Base: {resumoCards.totalTreinamentos} treinamentos (realizados, ausentes e cancelados).</span>
                )}
                {resumoCards && kpi.chave === "contatosSuporte" && (
                  <span className="kpi-desc indicadores-kpi-complemento">
                    Média: {resumoCards.mediaSuporte === null ? "—" : resumoCards.mediaSuporte.toFixed(1).replace(".", ",")} por dia útil
                    {` · ${resumoCards.diasUteis} ${resumoCards.diasUteis === 1 ? "dia útil" : "dias úteis"} no período`}
                  </span>
                )}
                <span className="kpi-desc">{kpi.descricao}</span>
              </div>
            ))}
          </div>

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
            onAtivoChange={(ativo) => setComparacao({ ...comparacaoAtual, ativo })}
            onSelecionadosChange={(selecionados) => setComparacao({ ...comparacaoAtual, selecionados })}
          />

          {/* Filtros do gráfico */}
          <div className="line-chart-filtro-semanas">
            <label id="indicadores-granularidade-label">Visualizar por:</label>
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
          {comparacaoAtual.ativo && comparacaoAtual.selecionados.length > 0 && (
            <p className="aging-legenda">
              {kpiSelecionado === "taxaCsat" ? "As colunas" : "As linhas"} são alinhadas pela posição de cada{" "}
              {granularidade === "dia" ? "dia útil" : "semana"} no período.
              Passe o mouse ou navegue pelos pontos com Tab para consultar as datas e os indicadores.
            </p>
          )}
          <LineChart
            title={tituloGrafico}
            categorias={grafico.categorias}
            series={grafico.series}
            exibirZerados={kpiSelecionado === "taxaCsat"}
            variante={kpiSelecionado === "taxaCsat" ? "colunas" : "linha"}
          />
          {(kpiSelecionado === "treinamentosRealizados" || kpiSelecionado === "tempoMedioEspera") && (
            <DetalhamentoEsperaTreinamento eventos={eventos} inicio={rangeAtivo.inicio} fim={rangeAtivo.fim} treinador={treinadorAtivo} />
          )}

          {/* Painel analítico — parte inferior: o mesmo KPI, detalhado por treinador e período */}
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
                <p>Nenhum treinador cadastrado ou com histórico de treinamento para exibir o detalhamento.</p>
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
                      <td className="indicadores-col-treinador">{formatarNome(linha.nome)}</td>
                      {linha.porPeriodo.map((valor, idx) => (
                        <td key={idx}>{formatarValorKpiTreinamento(kpiSelecionado, valor)}</td>
                      ))}
                      <td className="indicadores-col-total">
                        {formatarValorKpiTreinamento(kpiSelecionado, linha.total)}
                      </td>
                    </tr>
                  ))}
                  {!treinadorFiltro && linhaEquipe && (
                    <tr className="indicadores-linha-equipe">
                      <td className="indicadores-col-treinador">Equipe (total)</td>
                      {linhaEquipe.porPeriodo.map((valor, idx) => (
                        <td key={idx}>{formatarValorKpiTreinamento(kpiSelecionado, valor)}</td>
                      ))}
                      <td className="indicadores-col-total">
                        {formatarValorKpiTreinamento(kpiSelecionado, linhaEquipe.total)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            )}
          </div>

          <p className="aging-legenda">
            Os treinamentos incluem clientes de todos os status, inclusive ongoing, suspensos e
            cancelados. Treinadores com histórico permanecem disponíveis mesmo após mudança de perfil.
            A contagem usa as ocorrências e a mesma data do Histórico, inclusive registros sem tema.
            Lançamentos da gamificação complementam dados sem gerar contagens extras. Todos os
            indicadores consideram somente dias úteis (segunda a sexta): registros feitos em sábado
            ou domingo não entram nos cartões, no gráfico, nas comparações nem na tabela.
            "Clientes Suspensos" usa a data de suspensão registrada e
            "Clientes cancelados" usa a data de envio do aviso de cancelamento por WhatsApp, por
            serem as únicas datas disponíveis para essas duas situações; clientes suspensos ou
            cancelados sem essa data registrada não entram em nenhuma das duas métricas neste
            painel, mesmo que apareçam como suspensos/cancelados em outras telas do sistema.
          </p>
        </>
      )}
    </div>
  );
};
