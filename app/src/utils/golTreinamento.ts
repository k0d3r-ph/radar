import type { Empresa, Ocorrencia } from "../types";

/** Mesmo prazo de 30 dias corridos usado pela meta de Gol, contados a partir da data de entrada. */
export const PRAZO_DIAS_GOL = 30;

function normalizarNomeEmpresa(nome: string): string {
  return nome.trim().toLowerCase();
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
  /** Data em que o resultado passou a valer: a do Gol, ou o fim do prazo de 30 dias quando não bateu. */
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
    const dataEntrada = parseDataLocalISO(empresa.dataEntrada);
    if (!dataEntrada) return;

    const ocorrenciaGol = encontrarOcorrenciaGol(ocorrencias, empresa.nomeEmpresa);
    const prazoMs = dataEntrada.getTime() + PRAZO_DIAS_GOL * 24 * 60 * 60 * 1000;

    if (ocorrenciaGol) {
      resultados.push({
        empresa: empresa.nomeEmpresa,
        atingiuGol: true,
        noPrazo: ocorrenciaGol.dataOcorrencia <= prazoMs,
        // Mês de apuração é sempre o do fim da janela de 30 dias (data limite), nunca o
        // mês em que o Gol foi batido — um Gol fora do prazo conta no mês em que o prazo
        // se esgotou, não no mês (possivelmente bem posterior) em que o cliente o atingiu.
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
 * Clientes que ainda não bateram o Gol, estejam dentro ou fora dos {@link PRAZO_DIAS_GOL} dias
 * corridos desde a entrada. Diferente de {@link calcularGolNoPrazo}, não exclui quem ainda está
 * dentro do prazo — usado só na quebra "Não realizado" do resumo do card, não no percentual
 * principal de Gol no Prazo (que precisa aguardar o prazo se esgotar para julgar o cliente).
 */
export function calcularNaoRealizadosGolTreinamento(
  empresas: Empresa[],
  ocorrencias: Ocorrencia[],
): ResultadoNaoRealizadoGolTreinamento[] {
  const resultados: ResultadoNaoRealizadoGolTreinamento[] = [];

  empresas.forEach((empresa) => {
    const dataEntrada = parseDataLocalISO(empresa.dataEntrada);
    if (!dataEntrada) return;

    if (encontrarOcorrenciaGol(ocorrencias, empresa.nomeEmpresa)) return;

    const prazoMs = dataEntrada.getTime() + PRAZO_DIAS_GOL * 24 * 60 * 60 * 1000;
    resultados.push({ empresa: empresa.nomeEmpresa, dataReferencia: new Date(prazoMs) });
  });

  return resultados;
}
