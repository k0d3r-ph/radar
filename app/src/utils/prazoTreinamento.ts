import type { Empresa, Ocorrencia } from "../types";
import { calcularTotalFases } from "./monitoramento";
import { isDiaUtilComFeriados } from "./feriados";

/** Mesmo critério de "realizado" usado em utils/indicadoresTreinamento.ts: exclui ausências e cancelamentos. */
function treinamentoFoiRealizado(o: Ocorrencia): boolean {
  if (o.tipo !== "Treinamento") return false;
  const temas = (o.temaOcorrencia || []).map((t) => t.trim().toLowerCase());
  return !temas.includes("ausente") && !temas.includes("cancelado");
}

function timestampOcorrencia(o: Ocorrencia): number {
  return o.dataOcorrencia || o.createdAt || 0;
}

function ocorrenciasDaEmpresa(ocorrencias: Ocorrencia[], nomeEmpresa: string): Ocorrencia[] {
  const nome = nomeEmpresa.trim().toLowerCase();
  return ocorrencias.filter((o) => o.empresa.trim().toLowerCase() === nome);
}

/** Datas "yyyy-mm-dd" são lidas no fuso local, como no resto do app. */
function parseDataLocalISO(iso?: string): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const data = new Date(y, m - 1, d);
  return isNaN(data.getTime()) ? null : data;
}

/** Primeiro treinamento realizado da empresa (data mais antiga), ou `null` se nenhum ainda. */
export function obterPrimeiroTreinamentoRealizado(ocorrencias: Ocorrencia[], nomeEmpresa: string): Date | null {
  const realizados = ocorrenciasDaEmpresa(ocorrencias, nomeEmpresa)
    .filter(treinamentoFoiRealizado)
    .sort((a, b) => timestampOcorrencia(a) - timestampOcorrencia(b));
  const t = realizados[0] ? timestampOcorrencia(realizados[0]) : 0;
  return t > 0 ? new Date(t) : null;
}

/** Avança `dias` dias úteis (seg-sex, sem feriados nacionais) a partir de `data`. */
export function avancarDiasUteisComFeriados(data: Date, dias: number): Date {
  const resultado = new Date(data);
  let restantes = dias;
  while (restantes > 0) {
    resultado.setDate(resultado.getDate() + 1);
    if (isDiaUtilComFeriados(resultado)) restantes--;
  }
  return resultado;
}

/**
 * Data estimada do último treinamento da esteira, a partir da data do primeiro treinamento
 * realizado, da cadência (dias úteis entre um treinamento e o próximo, validada com o
 * cliente) e do total de temas cadastrados. Com 1 tema só, a estimativa é o próprio primeiro
 * treinamento. Retorna `null` quando faltam dados para estimar (sem primeiro treinamento ou
 * sem cadência informada).
 */
export function calcularDataEstimadaUltimoTreinamento(
  dataPrimeiroTreinamento: Date | null,
  cadenciaDiasUteis: number | undefined,
  totalTemas: number,
): Date | null {
  if (!dataPrimeiroTreinamento || !cadenciaDiasUteis || cadenciaDiasUteis <= 0) return null;
  const etapasRestantes = Math.max(0, totalTemas - 1);
  if (etapasRestantes === 0) return dataPrimeiroTreinamento;
  return avancarDiasUteisComFeriados(dataPrimeiroTreinamento, cadenciaDiasUteis * etapasRestantes);
}

export interface ResultadoPrazoTreinamento {
  empresa: string;
  dataPrimeiroTreinamento: Date;
  dataEstimada: Date;
  dataRealUltimoTreinamento: Date;
  noPrazo: boolean;
}

/**
 * Para as empresas com cadência informada e esteira concluída (`dataFinalizacao`
 * preenchida), compara a data de conclusão com a estimativa feita a partir do primeiro
 * treinamento + cadência. Usa `dataFinalizacao` como data real do último treinamento — e
 * não a contagem de ocorrências de Treinamento — porque um bloco (temas unidos no mesmo
 * dia) gera uma única ocorrência para vários temas, então o número de ocorrências
 * realizadas nunca bate com o total de temas. Empresas sem cadência cadastrada, sem
 * esteira concluída ou sem nenhum treinamento realizado ficam fora do cálculo.
 */
export function calcularTreinamentosNoPrazo(
  empresas: Empresa[],
  ocorrencias: Ocorrencia[],
): ResultadoPrazoTreinamento[] {
  const resultados: ResultadoPrazoTreinamento[] = [];

  empresas.forEach((empresa) => {
    if (!empresa.cadenciaDiasTreinamento || empresa.cadenciaDiasTreinamento <= 0) return;
    const dataRealUltimoTreinamento = parseDataLocalISO(empresa.dataFinalizacao);
    if (!dataRealUltimoTreinamento) return;

    const totalTemas = calcularTotalFases(empresa.temaText);
    if (totalTemas === 0) return;

    const dataPrimeiroTreinamento = obterPrimeiroTreinamentoRealizado(ocorrencias, empresa.nomeEmpresa);
    const dataEstimada = calcularDataEstimadaUltimoTreinamento(
      dataPrimeiroTreinamento,
      empresa.cadenciaDiasTreinamento,
      totalTemas,
    );
    if (!dataPrimeiroTreinamento || !dataEstimada) return;

    resultados.push({
      empresa: empresa.nomeEmpresa,
      dataPrimeiroTreinamento,
      dataEstimada,
      dataRealUltimoTreinamento,
      noPrazo: dataRealUltimoTreinamento.getTime() <= dataEstimada.getTime(),
    });
  });

  return resultados;
}
