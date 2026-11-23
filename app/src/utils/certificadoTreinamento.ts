import { normalizarEmpresaOcorrencia } from "./registroTreinamento";
import { instanteRealizacaoTreinamento, isTreinamentoRealizado } from "./temasTreinamento";

/** Aproveitamento mínimo para emitir certificado (mesmo corte da aprovação). */
export const APROVEITAMENTO_MINIMO_CERTIFICADO = 80;

export type TipoCertificado = "roubo_furto" | "gestao_frotas";

export const TIPOS_CERTIFICADO: { valor: TipoCertificado; rotulo: string }[] = [
  { valor: "roubo_furto", rotulo: "Roubo e Furto" },
  { valor: "gestao_frotas", rotulo: "Gestão de Frotas" },
];

/** Arredondamento da carga horária exibida no certificado. */
export const PASSO_ARREDONDAMENTO_MINUTOS = 10;

type OcorrenciaCarga = {
  id?: string;
  empresa?: string;
  tipo: string;
  temaOcorrencia?: string[];
  treinamentoTempoAgenda?: string;
  createdAt?: number;
  dataOcorrencia?: number;
};

type TentativaCertificado = {
  empresa: string;
  concluidaEm?: number;
  percentual?: number;
  ocorrenciaId?: string;
  treinamentoTempoAgenda?: string;
};

/** "HH:MM" (duração da agenda) em minutos; valores inválidos contam como zero. */
export function minutosDaAgenda(tempo?: string): number {
  const m = /^\s*(\d{1,3}):([0-5]\d)\s*$/.exec(tempo ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

export function arredondarMinutos(minutos: number, passo = PASSO_ARREDONDAMENTO_MINUTOS): number {
  if (minutos <= 0) return 0;
  return Math.max(passo, Math.round(minutos / passo) * passo);
}

/** 460 → "7h40min"; 480 → "8h"; 40 → "40min". */
export function formatarCargaHoraria(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas === 0) return `${resto}min`;
  if (resto === 0) return `${horas}h`;
  return `${horas}h${String(resto).padStart(2, "0")}min`;
}

/** Data no padrão DD/MM/AAAA, no horário de Brasília. */
export function formatarDataCertificado(instante: number): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(instante));
}

/** 89,6 → "90%" (o certificado mostra o aproveitamento em inteiro). */
export function formatarAproveitamento(percentual: number): string {
  return `${Math.round(percentual)}%`;
}

export type DadosAutomaticosCertificado = {
  /** Soma exata das agendas, em minutos. */
  minutosExatos: number;
  /** Quantidade de agendas (treinamentos realizados) consideradas na soma. */
  agendas: number;
  cargaHoraria: string;
  inicio: string;
  fim: string;
  aproveitamento: string;
  dataGeracao: string;
};

/**
 * Carga horária e período do certificado a partir dos treinamentos realizados do
 * cliente (inclui revisões e a própria validação; ignora Ausente/Cancelado) até a
 * conclusão da validação. O período vai do primeiro treinamento à validação.
 */
export function calcularDadosCertificado(
  tentativa: TentativaCertificado,
  ocorrencias: OcorrenciaCarga[],
  agora = Date.now(),
): DadosAutomaticosCertificado {
  const empresa = normalizarEmpresaOcorrencia(tentativa.empresa);
  const fim = tentativa.concluidaEm || agora;
  const treinamentos = ocorrencias.filter((o) => {
    if (normalizarEmpresaOcorrencia(o.empresa || "") !== empresa || !isTreinamentoRealizado(o)) return false;
    const instante = instanteRealizacaoTreinamento(o);
    // Tolerância para a ocorrência da validação, gravada logo após a conclusão.
    return instante > 0 && instante <= fim + 60 * 60 * 1000;
  });

  let minutosExatos = treinamentos.reduce((acc, o) => acc + minutosDaAgenda(o.treinamentoTempoAgenda), 0);
  let agendas = treinamentos.length;
  // A ocorrência da validação pode ainda não ter chegado ao cache local.
  if (!tentativa.ocorrenciaId || !treinamentos.some((o) => o.id === tentativa.ocorrenciaId)) {
    minutosExatos += minutosDaAgenda(tentativa.treinamentoTempoAgenda);
    agendas += 1;
  }

  const inicio = treinamentos.reduce(
    (menor, o) => Math.min(menor, instanteRealizacaoTreinamento(o)),
    fim,
  );

  return {
    minutosExatos,
    agendas,
    cargaHoraria: formatarCargaHoraria(arredondarMinutos(minutosExatos)),
    inicio: formatarDataCertificado(inicio),
    fim: formatarDataCertificado(fim),
    aproveitamento: formatarAproveitamento(tentativa.percentual ?? 0),
    dataGeracao: formatarDataCertificado(agora),
  };
}

export type ConteudoCertificado = {
  participante: string;
  tipo: TipoCertificado;
  cargaHoraria: string;
  inicio: string;
  fim: string;
  aproveitamento: string;
  dataGeracao: string;
};

export function rotuloTipoCertificado(tipo: TipoCertificado): string {
  return TIPOS_CERTIFICADO.find((t) => t.valor === tipo)?.rotulo ?? "";
}

export function montarTextoCertificado(c: Omit<ConteudoCertificado, "participante" | "dataGeracao">): string {
  return `Concluiu o treinamento da plataforma SSX, com ênfase em ${rotuloTipoCertificado(c.tipo)} com carga horária de ${c.cargaHoraria.trim()}, no período de ${c.inicio.trim()} a ${c.fim.trim()}. Obteve ${c.aproveitamento.trim()} de aproveitamento.`;
}

/** Valida DD/MM/AAAA de verdade (sem 31/02). */
export function dataCertificadoValida(valor: string): boolean {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor.trim());
  if (!m) return false;
  const [d, mes, ano] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const data = new Date(ano, mes - 1, d);
  return data.getFullYear() === ano && data.getMonth() === mes - 1 && data.getDate() === d;
}

/** Máscara de digitação DD/MM/AAAA. */
export function mascararDataCertificado(valor: string): string {
  const dig = valor.replace(/\D/g, "").slice(0, 8);
  if (dig.length <= 2) return dig;
  if (dig.length <= 4) return `${dig.slice(0, 2)}/${dig.slice(2)}`;
  return `${dig.slice(0, 2)}/${dig.slice(2, 4)}/${dig.slice(4)}`;
}

/** Nomes sugeridos: quem respondeu o CSAT da validação, sem repetições. */
export function participantesSugeridos(respostas?: { nome: string }[]): string[] {
  const vistos = new Set<string>();
  return (respostas ?? []).flatMap(({ nome }) => {
    const limpo = nome.replace(/\s+/g, " ").trim();
    const chave = limpo.toLocaleLowerCase("pt-BR");
    if (!limpo || vistos.has(chave)) return [];
    vistos.add(chave);
    return [limpo];
  });
}

/** "certificado-robson-ramos-08-04-2024.jpg" — sem acentos e com data brasileira. */
export function nomeArquivoCertificado(participante: string, dataGeracao: string): string {
  const slug = participante
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "participante";
  return `certificado-${slug}-${dataGeracao.replace(/\//g, "-")}.jpg`;
}
