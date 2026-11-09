import type { Empresa, Ocorrencia } from "../types";

/** Mesmo prazo de 30 dias corridos usado pela meta de Gol, contados a partir da data de entrada. */
export const PRAZO_DIAS_GOL = 30;

/**
 * Mesmo corte usado no Relatório de Aging (RelatorioAging.tsx): antes dessa data o Gol não
 * era cobrado como meta, então clientes antigos sem Gol nunca contam como "não realizado
 * fora do prazo" — só aplica a quem entrou na esteira a partir daqui.
 */
const DATA_CORTE_GOL = "2026-09-10";

function normalizarNomeEmpresa(nome: string): string {
  return nome.trim().toLowerCase();
}

/**
 * Só entram no indicador de Gol os clientes nas esteiras "Em andamento", "Suspenso" ou
 * "Concluído" — mesmos buckets exibidos na Home (ver `dadosAtivos`/`dadosSuspensos`/
 * `dadosConcluidos` em Home.tsx). Fora do indicador: Cancelados, Acompanhamento (Ongoing)
 * e conclusão unilateral da capacitação, que não representam a esteira de treinamento normal.
 */
function pertenceEsteirasElegiveisGol(empresa: Empresa): boolean {
  return (
    empresa.conclusaoUnilateralCapacitacao !== true &&
    !empresa.isOngoing &&
    !empresa.isCancelled
  );
}

function parseDataLocalISO(iso?: string): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const data = new Date(y, m - 1, d);
  return isNaN(data.getTime()) ? null : data;
}

/** Primeira ocorrência marcada como Gol para o cliente, a mais antiga. Mesmo critério do RelatorioAging. */
function encontrarOcorrenciaGol(ocorrencias: Ocorrencia[], nomeEmpresa: string): Ocorrencia | undefined {
  return ocorrencias
    .filter(
      (o) =>
        o.tipo === "Gol" &&
        o.dataOcorrencia > 0 &&
        normalizarNomeEmpresa(o.empresa) === normalizarNomeEmpresa(nomeEmpresa),
    )
    .sort((a, b) => a.dataOcorrencia - b.dataOcorrencia)[0];
}

export interface ResultadoGolTreinamento {
  empresa: string;
  atingiuGol: boolean;
  noPrazo: boolean;
  /** Fim do prazo de 30 dias desde a entrada — o mês de apuração é sempre o mês em que o
   * cliente completa 30 dias de contrato, seja o Gol batido dentro, fora do prazo ou não batido. */
  dataReferencia: Date;
}

/**
 * Empresas elegíveis para o indicador de Gol: já bateram o Gol (dentro ou fora do prazo) ou
 * já passaram os {@link PRAZO_DIAS_GOL} dias corridos desde a entrada sem bater — nesse caso
 * contam como fora do prazo. Clientes ainda dentro da janela de 30 dias e sem Gol registrado
 * ficam fora do cálculo, pois ainda não é possível saber se vão cumprir o prazo.
 */
export function calcularGolNoPrazo(empresas: Empresa[], ocorrencias: Ocorrencia[]): ResultadoGolTreinamento[] {
  const agora = Date.now();
  const resultados: ResultadoGolTreinamento[] = [];

  empresas.forEach((empresa) => {
    if (!pertenceEsteirasElegiveisGol(empresa)) return;

    const dataEntrada = parseDataLocalISO(empresa.dataEntrada);
    if (!dataEntrada) return;

    const ocorrenciaGol = encontrarOcorrenciaGol(ocorrencias, empresa.nomeEmpresa);
    const prazoMs = dataEntrada.getTime() + PRAZO_DIAS_GOL * 24 * 60 * 60 * 1000;

    if (ocorrenciaGol) {
      const noPrazo = ocorrenciaGol.dataOcorrencia <= prazoMs;
      resultados.push({
        empresa: empresa.nomeEmpresa,
        atingiuGol: true,
        noPrazo,
        // Regra de negócio validada (ver conversa com o supervisor): o mês de apuração é
        // sempre o mês em que o cliente completa os 30 dias de contrato (fim do prazo),
        // nunca o mês em que o Gol foi efetivamente batido — mesmo quando o Gol aconteceu
        // antes disso. Ex.: cliente entra 07/10, bate o Gol 28/10, completa 30 dias em
        // 07/11 — conta em novembro, já a partir de 01/11 (apuração é por mês inteiro, não
        // pelo dia exato do vencimento), não em outubro.
        dataReferencia: new Date(prazoMs),
      });
      return;
    }

    if (agora > prazoMs) {
      resultados.push({
        empresa: empresa.nomeEmpresa,
        atingiuGol: false,
        noPrazo: false,
        dataReferencia: new Date(prazoMs),
      });
    }
  });

  return resultados;
}

export interface ResultadoNaoRealizadoGolTreinamento {
  empresa: string;
  /** Fim da janela de 30 dias contada a partir da entrada — mesmo mês de apuração usado por
   * {@link calcularGolNoPrazo} para quem já expirou sem bater o Gol. */
  dataReferencia: Date;
}

/**
 * Clientes sem Gol cujo prazo de {@link PRAZO_DIAS_GOL} dias corridos desde a entrada já venceu.
 * Clientes ainda dentro do prazo não entram como "não realizados" no resumo do card.
 */
export function calcularNaoRealizadosGolTreinamento(
  empresas: Empresa[],
  ocorrencias: Ocorrencia[],
): ResultadoNaoRealizadoGolTreinamento[] {
  const resultados: ResultadoNaoRealizadoGolTreinamento[] = [];
  const agora = Date.now();

  empresas.forEach((empresa) => {
    if (!pertenceEsteirasElegiveisGol(empresa)) return;

    const dataEntrada = parseDataLocalISO(empresa.dataEntrada);
    if (!dataEntrada) return;

    if (encontrarOcorrenciaGol(ocorrencias, empresa.nomeEmpresa)) return;

    const prazoMs = dataEntrada.getTime() + PRAZO_DIAS_GOL * 24 * 60 * 60 * 1000;
    if (agora <= prazoMs) return;
    resultados.push({ empresa: empresa.nomeEmpresa, dataReferencia: new Date(prazoMs) });
  });

  return resultados;
}

export type ClassificacaoGolCliente =
  | "noPrazoRealizado"
  | "foraPrazoRealizado"
  | "noPrazoNaoRealizado"
  | "foraPrazoNaoRealizado";

/**
 * Classifica um único cliente nas 4 combinações possíveis de realizado/não realizado x
 * dentro/fora do prazo de {@link PRAZO_DIAS_GOL} dias corridos desde a entrada — usado pelo
 * filtro de Gol da Home. Diferente de {@link calcularGolNoPrazo} (que deixa de fora quem
 * ainda está dentro do prazo sem Gol, pois não dá pra julgar se vai bater a meta), aqui o
 * objetivo é outro: permitir filtrar também quem ainda está dentro do prazo sem ter batido.
 * Retorna `null` quando a empresa não tem `dataEntrada` válida (não dá pra calcular o prazo).
 */
export function classificarGolCliente(
  empresa: Empresa,
  ocorrencias: Ocorrencia[],
  agora: number = Date.now(),
): ClassificacaoGolCliente | null {
  const dataEntrada = parseDataLocalISO(empresa.dataEntrada);
  if (!dataEntrada) return null;

  const ocorrenciaGol = encontrarOcorrenciaGol(ocorrencias, empresa.nomeEmpresa);
  const prazoMs = dataEntrada.getTime() + PRAZO_DIAS_GOL * 24 * 60 * 60 * 1000;

  if (ocorrenciaGol) {
    return ocorrenciaGol.dataOcorrencia <= prazoMs ? "noPrazoRealizado" : "foraPrazoRealizado";
  }
  if (agora <= prazoMs) return "noPrazoNaoRealizado";

  // "Fora do prazo (não realizado)" só vale para quem entrou a partir do corte do Gol —
  // antes disso, não bater o Gol não era uma falha, já que a meta ainda não existia.
  if (empresa.dataEntrada < DATA_CORTE_GOL) return null;
  return "foraPrazoNaoRealizado";
}
