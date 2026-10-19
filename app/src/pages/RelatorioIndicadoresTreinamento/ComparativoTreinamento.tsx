import { useMemo, useRef, useState } from "react";
import { ArrowLeftRight, CalendarDays, ChevronDown, Plus, X } from "lucide-react";
import {
  calcularValorKpiTreinamento,
  formatarValorKpiTreinamento,
  KPIS_TREINAMENTO,
  type EventosIndicadoresTreinamento,
  type KpiTreinamentoChave,
} from "../../utils/indicadoresTreinamento";
import {
  criarIntervaloComparacao,
  formatarVariacaoTreinamento,
  intervaloAnteriorTreinamento,
  lerDataComparacao,
  type IntervaloComparacaoTreinamento,
  type ModoPeriodoTreinamento,
} from "../../utils/comparativoTreinamento";
import { formatarNome } from "../../utils/formatarNome";

interface Props {
  modo: ModoPeriodoTreinamento;
  atual: IntervaloComparacaoTreinamento;
  eventos: EventosIndicadoresTreinamento;
  kpi: KpiTreinamentoChave;
  treinador: string | null;
  treinadores: string[];
}

function dataISO(data: Date): string {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

function rotulo(intervalo: IntervaloComparacaoTreinamento): string {
  return `${intervalo.inicio.toLocaleDateString("pt-BR")} a ${intervalo.fim.toLocaleDateString("pt-BR")}`;
}

function chave(intervalo: IntervaloComparacaoTreinamento): string {
  return `${dataISO(intervalo.inicio)}_${dataISO(intervalo.fim)}`;
}

function tituloPeriodo(modo: ModoPeriodoTreinamento, intervalo: IntervaloComparacaoTreinamento): string {
  if (modo === "mes") {
    const mes = intervalo.inicio.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    return mes.charAt(0).toUpperCase() + mes.slice(1);
  }
  return modo === "semana" ? `Semana de ${intervalo.inicio.toLocaleDateString("pt-BR")}` : rotulo(intervalo);
}

export function ComparativoTreinamento({ modo, atual, eventos, kpi, treinador, treinadores }: Props) {
  const [ativo, setAtivo] = useState(false);
  const [selecionados, setSelecionados] = useState<IntervaloComparacaoTreinamento[]>(() => [intervaloAnteriorTreinamento(modo, atual)]);
  const [referencia, setReferencia] = useState("");
  const [erro, setErro] = useState("");
  const referenciaRef = useRef<HTMLInputElement>(null);
  const config = KPIS_TREINAMENTO.find((item) => item.chave === kpi)!;

  const intervalos = useMemo(() => ativo ? [atual, ...selecionados] : [], [ativo, atual, selecionados]);
  const valores = useMemo(() => intervalos.map((intervalo) =>
    calcularValorKpiTreinamento(kpi, eventos, intervalo.inicio, intervalo.fim, treinador),
  ), [intervalos, kpi, eventos, treinador]);
  const linhas = useMemo(() => (treinador ? [treinador] : treinadores).map((nome) => ({
    nome,
    valores: intervalos.map((intervalo) => calcularValorKpiTreinamento(kpi, eventos, intervalo.inicio, intervalo.fim, nome)),
  })), [treinador, treinadores, intervalos, kpi, eventos]);

  const maximo = Math.max(1, ...valores.filter((valor): valor is number => valor !== null));
  const variacao = (base: number | null, anterior: number | null) =>
    formatarVariacaoTreinamento(base, anterior, config.formato === "percentual");

  function adicionar() {
    const data = lerDataComparacao(modo === "mes" ? `${referencia}-01` : referencia);
    if (!data) {
      setErro("Escolha uma data válida para comparar.");
      return;
    }
    const intervalo = criarIntervaloComparacao(modo, data, atual);
    if (intervalo.fim.getTime() >= atual.inicio.getTime()) {
      setErro("Escolha um período que termine antes do início do período principal.");
      return;
    }
    if (selecionados.some((item) => chave(item) === chave(intervalo))) {
      setErro("Esse período já está selecionado.");
      return;
    }
    setSelecionados((anteriores) => [...anteriores, intervalo].sort((a, b) => b.inicio.getTime() - a.inicio.getTime()));
    setReferencia("");
    setErro("");
    referenciaRef.current?.focus();
  }

  return (
    <section className="indicadores-comparativo" aria-label="Comparação de períodos">
      <header className="indicadores-comparativo-header">
        <div className="indicadores-comparativo-heading">
          <span className="indicadores-comparativo-icone"><ArrowLeftRight size={20} aria-hidden="true" /></span>
          <div><h3>Comparação de períodos</h3><p>Acompanhe o resultado em relação a outros períodos.</p></div>
        </div>
        <label className="indicadores-comparar-toggle">
          <input type="checkbox" checked={ativo} aria-controls="indicadores-comparativo-conteudo"
            onChange={(event) => setAtivo(event.target.checked)} />
          Comparar períodos
        </label>
      </header>
      {ativo && <div id="indicadores-comparativo-conteudo" className="indicadores-comparativo-conteudo">
        <div className="indicadores-comparativo-config">
          <div className="indicadores-comparativo-base">
            <span className="indicadores-comparativo-label">Período principal</span>
            <strong><CalendarDays size={16} aria-hidden="true" />{tituloPeriodo(modo, atual)}</strong>
            <span>{rotulo(atual)}</span>
          </div>
          <div className="indicadores-comparativo-destinos">
            <div className="indicadores-comparativo-selecao">
              <label htmlFor="comparacao-referencia">{modo === "mes" ? "Comparar com os meses" : modo === "semana" ? "Comparar com as semanas" : "Início do período de comparação"}</label>
              <div className="indicadores-comparativo-adicionar">
                <input ref={referenciaRef} id="comparacao-referencia" type={modo === "mes" ? "month" : "date"}
                  value={referencia} max={dataISO(atual.inicio).slice(0, modo === "mes" ? 7 : 10)}
                  aria-invalid={Boolean(erro)} aria-describedby={erro ? "comparacao-erro" : "comparacao-regra"}
                  onChange={(event) => { setReferencia(event.target.value); setErro(""); }} />
                <button type="button" onClick={adicionar} disabled={!referencia}><Plus size={16} aria-hidden="true" />Adicionar</button>
              </div>
            </div>
            {erro && <p id="comparacao-erro" role="alert" className="indicadores-comparativo-erro">{erro}</p>}
            <ul className="indicadores-comparativo-periodos" aria-label="Períodos selecionados">
              {selecionados.map((intervalo) => <li key={chave(intervalo)}>
                <span>{tituloPeriodo(modo, intervalo)}</span>
                <button type="button" aria-label={`Remover comparação: ${tituloPeriodo(modo, intervalo)}`}
                  onClick={() => {
                    setSelecionados((itens) => itens.filter((item) => chave(item) !== chave(intervalo)));
                    setErro("");
                    referenciaRef.current?.focus();
                  }}><X size={14} aria-hidden="true" /></button>
              </li>)}
            </ul>
          </div>
        </div>
        <p id="comparacao-regra" className="indicadores-comparativo-ajuda">
          {modo === "mes" ? "Meses anteriores completos. O mês atual considera até hoje."
            : modo === "semana" ? "Escolha qualquer dia da semana desejada. Semanas anteriores completas; a atual considera até hoje."
              : "Cada comparação terá a mesma quantidade de dias corridos do período principal."}
          {" "}Fins de semana não entram nos indicadores.
        </p>
        {selecionados.length === 0 ? <p role="status" className="indicadores-comparativo-vazio">Adicione um período acima para visualizar a comparação.</p> : <>
          <div className="indicadores-comparativo-resultado-header">
            <div><span className="indicadores-comparativo-label">Indicador selecionado</span><h4>{config.titulo}</h4></div>
            <span className="indicadores-comparativo-equipe">{treinador ? formatarNome(treinador) : "Todos os treinadores"}</span>
          </div>
          <div className="indicadores-comparativo-resultados">
            <div className="indicadores-comparativo-principal">
              <span className="indicadores-comparativo-label">Resultado principal</span>
              <strong className="indicadores-comparativo-valor">{formatarValorKpiTreinamento(kpi, valores[0])}</strong>
              <span>{rotulo(atual)}</span>
              <span className="indicadores-comparativo-base-badge">Base da comparação</span>
            </div>
            <div className="indicadores-comparativo-historico">
              <div className="indicadores-comparativo-colunas" aria-hidden="true"><span>Período comparado</span><span>Resultado</span><span>Variação do principal</span></div>
              {selecionados.map((intervalo, indice) => <div className="indicadores-comparativo-linha" key={chave(intervalo)}>
                <div className="indicadores-comparativo-periodo"><strong>{tituloPeriodo(modo, intervalo)}</strong><span>{rotulo(intervalo)}</span>
                  <div className="indicadores-comparativo-trilho" aria-hidden="true"><div style={{ width: `${(valores[indice + 1] ?? 0) / maximo * 100}%` }} /></div>
                </div>
                <strong className="indicadores-comparativo-numero">{formatarValorKpiTreinamento(kpi, valores[indice + 1])}</strong>
                <span className="indicadores-comparativo-delta"><span className="indicadores-comparativo-mobile-label">Variação do principal</span>{variacao(valores[0], valores[indice + 1])}</span>
              </div>)}
            </div>
          </div>
          <p className="indicadores-comparativo-ajuda indicadores-comparativo-nota">Variação do principal em relação a cada período comparado{config.formato === "percentual" ? ", em pontos percentuais" : ", em percentual"}. Selecione outro indicador nos cartões acima para atualizar.</p>
          <details className="indicadores-comparativo-detalhes">
            <summary>Detalhamento por treinador<ChevronDown size={18} aria-hidden="true" /></summary>
            <div className="relatorios-table-wrapper" role="region" aria-label="Comparativo por treinador, tabela rolável" tabIndex={0}>
            <table className="relatorios-table indicadores-tabela">
              <caption>{config.titulo} por treinador e período</caption>
              <thead><tr><th scope="col">Treinador</th>{intervalos.map((intervalo, indice) => <th scope="col" key={chave(intervalo)}>
                {indice === 0 ? "Principal" : "Comparação"}<br />{rotulo(intervalo)}
              </th>)}</tr></thead>
              <tbody>{linhas.map((linha) => <tr key={linha.nome}>
                <th scope="row">{formatarNome(linha.nome)}</th>
                {linha.valores.map((valor, indice) => <td key={chave(intervalos[indice])}>
                  {formatarValorKpiTreinamento(kpi, valor)}
                  {indice > 0 && <small className="indicadores-comparativo-variacao">{variacao(linha.valores[0], valor)}</small>}
                </td>)}
              </tr>)}
              {!treinador && <tr className="indicadores-linha-equipe"><th scope="row">Equipe (total)</th>{valores.map((valor, indice) => <td key={chave(intervalos[indice])}>
                {formatarValorKpiTreinamento(kpi, valor)}
                {indice > 0 && <small className="indicadores-comparativo-variacao">{variacao(valores[0], valor)}</small>}
              </td>)}</tr>}
              </tbody>
            </table>
            </div>
          </details>
        </>}
      </div>}
    </section>
  );
}
