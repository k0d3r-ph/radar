import type { Ocorrencia } from "../types";
import { normalizarEmpresaOcorrencia } from "./registroTreinamento";
import { isTreinamentoRealizado, lerTemasTreinamento } from "./temasTreinamento";
import { agruparLinhasEmBlocos, textosParaLinhasTema } from "./temasEsteira";

/** Colunas D-1 … D-30 da tabela de aplicação dos temas na base do cliente. */
export const TOTAL_DIAS_APLICACAO = 30;

/**
 * Uma linha da tabela "Aplicação dos temas": os temas ensinados num mesmo dia
 * (`realizado`) ou, enquanto ainda não houve treinamento, um bloco planejado da
 * esteira (somente leitura).
 */
export type LinhaAplicacaoTema = {
  /** Dia do treinamento (YYYY-MM-DD) nas linhas realizadas; `pendente-N` nas planejadas. */
  chave: string;
  temas: string[];
  /** DD/MM do treinamento realizado, ou a data planejada na esteira (pode ser vazia). */
  data: string;
  realizado: boolean;
  /** Dia D-N marcado pelo treinador, quando houver. */
  diaMarcado?: number;
  /** Dias corridos desde o treinamento até `hoje`; limita quais colunas podem ser marcadas. */
  diasDecorridos?: number;
};

const normalizarTema = (tema: string) => tema.trim().toLowerCase();

/**
 * Temas que não são aplicados pelo cliente no dia a dia (ex.: "Início", a abertura da
 * esteira) e por isso ficam fora da tabela e do gráfico de aplicação.
 */
const TEMAS_SEM_APLICACAO = new Set(["inicio"]);

function isTemaComAplicacao(tema: string): boolean {
  const semAcento = normalizarTema(tema).normalize("NFD").replace(/[̀-ͯ]/g, "");
  return !TEMAS_SEM_APLICACAO.has(semAcento);
}

function dataLocalISO(data: Date): string {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

function diasEntre(inicioISO: string, fim: Date): number {
  const [ano, mes, dia] = inicioISO.split("-").map(Number);
  const inicio = new Date(ano, mes - 1, dia);
  const fimDia = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate());
  return Math.round((fimDia.getTime() - inicio.getTime()) / 86_400_000);
}

/** Aceita só marcações D-1 … D-30 vindas do Firestore. */
export function isDiaAplicacaoValido(valor: unknown): valor is number {
  return Number.isInteger(valor) && (valor as number) >= 1 && (valor as number) <= TOTAL_DIAS_APLICACAO;
}

/**
 * Monta as linhas da tabela a partir das ocorrências de Treinamento realizadas do
 * cliente (ausências e cancelamentos ficam de fora). Cada tema entra apenas no
 * primeiro dia em que foi ensinado; revisões não abrem linha nova, porque o
 * aprendizado já foi contado no treinamento original. "Início" também fica de fora
 * (ver {@link TEMAS_SEM_APLICACAO}); um dia só com ele não gera linha. Temas da esteira ainda não
 * ensinados aparecem depois, agrupados pelo bloco planejado e sem permitir marcação.
 */
export function montarLinhasAplicacaoTemas(params: {
  nomeEmpresa: string;
  ocorrencias: Ocorrencia[];
  temaText?: string;
  dataText?: string;
  blocoText?: string;
  marcacoes?: Record<string, number>;
  hoje?: Date;
}): LinhaAplicacaoTema[] {
  const { nomeEmpresa, ocorrencias, temaText, dataText, blocoText, marcacoes = {}, hoje = new Date() } = params;
  const empresa = normalizarEmpresaOcorrencia(nomeEmpresa);

  const treinamentos = ocorrencias
    .filter((o) => normalizarEmpresaOcorrencia(o.empresa || "") === empresa && isTreinamentoRealizado(o))
    .map((o) => ({ o, instante: o.dataOcorrencia || o.createdAt || 0 }))
    // Treinamento com data futura é agendamento (mesmo critério de Relatórios), não realizado.
    .filter(({ instante }) => instante > 0 && instante <= hoje.getTime())
    .sort((a, b) => a.instante - b.instante);

  const ensinados = new Set<string>();
  const porDia = new Map<string, string[]>();

  for (const { o, instante } of treinamentos) {
    const { temas, temasRevisados } = lerTemasTreinamento(o.temaOcorrencia ?? [], o.isRevisao);
    const novos = temas.filter(
      (t) => isTemaComAplicacao(t) && !temasRevisados.includes(t) && !ensinados.has(normalizarTema(t)),
    );
    if (novos.length === 0) continue;
    const dia = dataLocalISO(new Date(instante));
    const lista = porDia.get(dia) ?? [];
    novos.forEach((t) => {
      ensinados.add(normalizarTema(t));
      lista.push(t);
    });
    porDia.set(dia, lista);
  }

  const realizadas: LinhaAplicacaoTema[] = [...porDia.entries()].map(([dia, temas]) => {
    const [, mes, d] = dia.split("-");
    const marcado = marcacoes[dia];
    return {
      chave: dia,
      temas,
      data: `${d}/${mes}`,
      realizado: true,
      diaMarcado: isDiaAplicacaoValido(marcado) ? marcado : undefined,
      diasDecorridos: diasEntre(dia, hoje),
    };
  });

  const linhasEsteira = textosParaLinhasTema(temaText, dataText, blocoText);
  const pendentes: LinhaAplicacaoTema[] = [];
  agruparLinhasEmBlocos(linhasEsteira).forEach((indices, i) => {
    const temas = indices
      .map((indice) => linhasEsteira[indice].tema.trim())
      .filter((t) => t && isTemaComAplicacao(t) && !ensinados.has(normalizarTema(t)));
    if (temas.length === 0) return;
    pendentes.push({
      chave: `pendente-${i}`,
      temas,
      data: linhasEsteira[indices[0]].data.trim(),
      realizado: false,
    });
  });

  return [...realizadas, ...pendentes];
}
