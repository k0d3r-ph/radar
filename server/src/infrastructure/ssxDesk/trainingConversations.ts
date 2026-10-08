import { createHash } from 'node:crypto';

export interface TrainingConversation {
  id: string;
  sessionId: string;
  date: string;
  startedAt: string;
  finishedAt: string;
  company: { id: string; name: string; isInTraining: boolean; idCentral: string | null };
  customerName: string;
  summary: string | null;
  summaryGeneratedAt: string | null;
  tags: { id: string; label: string }[];
  conversationIds?: string[];
}

export interface RadarEmpresa {
  id: string;
  nomeEmpresa: string;
  idCentral?: string;
  dataEntrada: string;
  dataFinalizacao?: string;
  isOngoing?: boolean;
  isCancelled?: boolean;
  isSuspended?: boolean;
  /** Primeiro nome do treinador responsável (ver Gamificacao.tsx), usado na dedução de pontos por contato de Suporte. */
  responsavel?: string;
  scoreAjustesTemporarios?: {
    motivo: string;
    valor: number;
    criadoEm: number;
    expiraEm: number;
    ocorrenciaId?: string;
  }[];
  gamificacaoDeducaoSuporte?: {
    ativo: boolean;
    duvida?: { dentroExpediente?: number; foraExpediente?: number };
    problema?: { dentroExpediente?: number; foraExpediente?: number };
    solicitacao?: { dentroExpediente?: number; foraExpediente?: number };
  };
}

export const RESUMO_PENDENTE = 'Atendimento encerrado no SSX Desk. Resumo aguardando processamento.';

export function normalizarNome(nome: string): string {
  return nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function empresaEmTreinamento(empresa: RadarEmpresa): boolean {
  return !!empresa.nomeEmpresa && normalizarNome(empresa.nomeEmpresa) !== 'systemsat'
    && !empresa.isOngoing && !empresa.isCancelled;
}

export function conversaElegivel(conversa: TrainingConversation, empresa: RadarEmpresa): boolean {
  const inicio = Date.parse(conversa.startedAt);
  const fim = Date.parse(conversa.finishedAt);
  return conversa.company.isInTraining === true && empresaEmTreinamento(empresa)
    && /^\d{4}-\d{2}-\d{2}$/.test(empresa.dataEntrada)
    && Number.isFinite(inicio) && Number.isFinite(fim) && fim >= inicio
    && conversa.date >= empresa.dataEntrada;
}

/** O idCentral não é único no Desk. Nunca escolher a primeira correspondência ambígua. */
export function resolverEmpresa(
  company: TrainingConversation['company'], empresas: RadarEmpresa[], companies: TrainingConversation['company'][],
): RadarEmpresa | undefined {
  const central = company.idCentral?.trim();
  const porCentral = central ? empresas.filter(e => e.idCentral?.trim() === central) : [];
  const nomesIguais = (e: RadarEmpresa) => normalizarNome(e.nomeEmpresa) === normalizarNome(company.name);
  if (porCentral.length) {
    const idsDesk = new Set(companies.filter(c => c.idCentral?.trim() === central).map(c => c.id));
    if (porCentral.length === 1 && idsDesk.size === 1) return porCentral[0];
    const porNome = porCentral.filter(nomesIguais);
    const idsMesmoNome = new Set(companies.filter(c => c.idCentral?.trim() === central
      && normalizarNome(c.name) === normalizarNome(company.name)).map(c => c.id));
    return porNome.length === 1 && idsMesmoNome.size === 1 ? porNome[0] : undefined;
  }
  // Sem ID vinculado, só aceitar nome exato e sem conflito com um ID já cadastrado.
  const porNome = empresas.filter(nomesIguais);
  const idsMesmoNome = new Set(companies.filter(c => normalizarNome(c.name) === normalizarNome(company.name)).map(c => c.id));
  if (porNome.length !== 1 || idsMesmoNome.size !== 1) return undefined;
  const empresa = porNome[0];
  if (central && empresa.idCentral?.trim() && empresa.idCentral.trim() !== central) return undefined;
  return empresa;
}

export function idOcorrencia(conversaId: string): string {
  return `ssxdesk_${createHash('sha256').update(conversaId).digest('hex')}`;
}

export function tipoDaConversa(conversa: TrainingConversation): string {
  const tipos = new Map([['duvida', 'Dúvida'], ['solicitacao', 'Solicitação'], ['problema', 'Problema']]);
  const encontrados = new Set(conversa.tags.map(t => tipos.get(normalizarNome(t.label))).filter(Boolean));
  // Não escolher arbitrariamente quando o Desk informa tipos conflitantes.
  return encontrados.size === 1 ? [...encontrados][0]! : '';
}

export function chaveSessao(c: TrainingConversation): string {
  return JSON.stringify([c.company.id, c.sessionId]);
}

export function agruparConversas(conversas: TrainingConversation[], anteriores: Map<string, string> = new Map()) {
  const grupos = new Map<string, TrainingConversation[]>();
  for (const c of conversas) {
    const chave = chaveSessao(c);
    grupos.set(chave, [...(grupos.get(chave) || []), c]);
  }
  return [...grupos.entries()].map(([chave, grupo]) => {
    const ordenadas = [...grupo].sort((a, b) => a.id.localeCompare(b.id));
    const principal = ordenadas.find(c => c.id === anteriores.get(chave)) || ordenadas[0];
    const resumo = [...ordenadas].filter(c => c.summary?.trim()).sort((a, b) =>
      (Date.parse(b.summaryGeneratedAt || '') || 0) - (Date.parse(a.summaryGeneratedAt || '') || 0))[0];
    return {
      ...principal,
      id: anteriores.get(chave) || principal.id,
      startedAt: [...grupo].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))[0].startedAt,
      finishedAt: [...grupo].sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))[0].finishedAt,
      summary: resumo?.summary || null,
      summaryGeneratedAt: resumo?.summaryGeneratedAt || null,
      tags: [...new Map(grupo.flatMap(c => c.tags).map(t => [normalizarNome(t.label), t])).values()],
      conversationIds: ordenadas.map(c => c.id),
    };
  });
}

export function criarOcorrencia(conversa: TrainingConversation, empresa: RadarEmpresa, agora: number) {
  return {
    empresa: empresa.nomeEmpresa,
    tipo: tipoDaConversa(conversa),
    departamento: 'Suporte',
    responsavel: 'SSX Desk',
    descricao: conversa.summary?.trim() || RESUMO_PENDENTE,
    dataOcorrencia: Date.parse(conversa.startedAt),
    createdAt: agora,
    updatedAt: agora,
    temaOcorrencia: [],
    atualizacoes: [],
    origem: 'ssx-desk',
    ssxDesk: {
      conversationId: conversa.id,
      conversationIds: conversa.conversationIds || [conversa.id],
      sessionId: conversa.sessionId,
      companyId: conversa.company.id,
      empresaId: empresa.id,
      customerName: conversa.customerName,
      startedAt: conversa.startedAt,
      finishedAt: conversa.finishedAt,
      summaryGeneratedAt: conversa.summaryGeneratedAt,
      tags: conversa.tags.map(t => t.label),
      importedAt: agora,
    },
  };
}

function validarConversa(value: unknown): value is TrainingConversation {
  const c = value as TrainingConversation | null;
  return !!c && typeof c.id === 'string' && !!c.id && typeof c.sessionId === 'string'
    && typeof c.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.date)
    && typeof c.startedAt === 'string' && Number.isFinite(Date.parse(c.startedAt))
    && typeof c.finishedAt === 'string' && Number.isFinite(Date.parse(c.finishedAt))
    && !!c.company && typeof c.company.id === 'string' && !!c.company.id
    && typeof c.company.name === 'string' && typeof c.company.isInTraining === 'boolean'
    && (c.company.idCentral === null || typeof c.company.idCentral === 'string')
    && typeof c.customerName === 'string'
    && (c.summary === null || typeof c.summary === 'string')
    && (c.summaryGeneratedAt === null || typeof c.summaryGeneratedAt === 'string')
    && Array.isArray(c.tags) && c.tags.every(t => !!t && typeof t.id === 'string' && typeof t.label === 'string');
}

export async function listarConversas(
  apiKey: string, fetchApi: typeof fetch = fetch,
  esperar: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<TrainingConversation[]> {
  const conversas = new Map<string, TrainingConversation>();
  let offset = 0;
  // Sem filtro de início: uma conversa antiga pode encerrar hoje ou receber o resumo depois.
  for (let pagina = 0; pagina < 1000; pagina++) {
    const url = new URL('https://ssxdesk.ssat.dev/api/integrations/v1/training-conversations');
    url.searchParams.set('limit', '500');
    url.searchParams.set('offset', String(offset));
    const response = await fetchApi(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`SSX Desk respondeu HTTP ${response.status}. Confira a chave, o escopo e o limite de consultas.`);
    const body = await response.json() as { data: unknown[]; meta: { hasMore: boolean; offset: number; total: number } };
    if (!body || !Array.isArray(body.data) || !body.data.every(validarConversa)
      || !body.meta || typeof body.meta.hasMore !== 'boolean' || body.meta.offset !== offset
      || !Number.isInteger(body.meta.total) || body.meta.total < 0) {
      throw new Error('Resposta do SSX Desk fora do formato esperado; nenhuma importação iniciada.');
    }
    for (const c of body.data as TrainingConversation[]) conversas.set(c.id, c);
    if (!body.meta.hasMore) return [...conversas.values()];
    if (!body.data.length) throw new Error('Paginação do SSX Desk não avançou.');
    offset += body.data.length;
    await esperar(600); // Até 100 páginas/minuto, abaixo das 120 req/min permitidas.
  }
  throw new Error('Paginação do SSX Desk excedeu o limite de segurança.');
}
