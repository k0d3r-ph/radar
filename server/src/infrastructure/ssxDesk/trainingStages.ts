/** Cliente fino da API de etapas de treinamento ("training stages") do SSX Desk —
 * ver server/SSX_DESK_TRAINING_STAGES.md. Escopo `training-stages:write`, chave
 * própria (SSX_DESK_TRAINING_STAGES_API_KEY), nunca a de leitura de conversas. */

export type StatusEtapaDesk = 'Em andamento' | 'Concluído' | 'Não concluído';

export interface EtapaTreinamentoDesk {
  id: string;
  companyId: string;
  name: string;
  status: StatusEtapaDesk;
  sortOrder: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyDesk {
  id: string;
  name: string;
  idCentral: string | null;
}

const BASE_URL = 'https://ssxdesk.ssatx.com.br/api/integrations/v1';

function cabecalhos(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
}

async function tratarResposta<T>(response: Response, contexto: string): Promise<T> {
  if (!response.ok) {
    // Nunca registrar o corpo bruto da resposta nem a chave — pode conter dados do cliente.
    throw new Error(`SSX Desk (${contexto}) respondeu HTTP ${response.status}. Confira a chave, o escopo e o limite de consultas.`);
  }
  const corpo = await response.json().catch(() => {
    throw new Error(`SSX Desk (${contexto}) devolveu uma resposta que não é JSON.`);
  });
  return corpo as T;
}

function validarCompany(value: unknown): value is CompanyDesk {
  const c = value as CompanyDesk | null;
  return !!c && typeof c.id === 'string' && !!c.id && typeof c.name === 'string'
    && (c.idCentral === null || typeof c.idCentral === 'string');
}

/**
 * Todas as empresas cadastradas no Desk, paginado como `listarConversas`. Usada só para
 * resolver `companyId` a partir do `idCentral` do Radar — cacheie o resultado (ver
 * TrainingStagesSyncService) em vez de chamar a cada ciclo.
 */
export async function listarEmpresasDesk(
  apiKey: string, fetchApi: typeof fetch = fetch,
  esperar: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<CompanyDesk[]> {
  const empresas = new Map<string, CompanyDesk>();
  let offset = 0;
  for (let pagina = 0; pagina < 1000; pagina++) {
    const url = new URL(`${BASE_URL}/companies`);
    url.searchParams.set('limit', '500');
    url.searchParams.set('offset', String(offset));
    const response = await fetchApi(url, {
      headers: cabecalhos(apiKey),
      signal: AbortSignal.timeout(30_000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`SSX Desk (listar empresas) respondeu HTTP ${response.status}. Confira a chave, o escopo e o limite de consultas.`);
    const body = await response.json() as { data: unknown[]; meta: { hasMore: boolean; offset: number; total: number } };
    if (!body || !Array.isArray(body.data) || !body.data.every(validarCompany)
      || !body.meta || typeof body.meta.hasMore !== 'boolean' || body.meta.offset !== offset
      || !Number.isInteger(body.meta.total) || body.meta.total < 0) {
      throw new Error('Resposta do SSX Desk (listar empresas) fora do formato esperado.');
    }
    for (const c of body.data as CompanyDesk[]) empresas.set(c.id, c);
    if (!body.meta.hasMore) return [...empresas.values()];
    if (!body.data.length) throw new Error('Paginação do SSX Desk (listar empresas) não avançou.');
    offset += body.data.length;
    await esperar(600); // Até 100 páginas/minuto, abaixo das 120 req/min permitidas.
  }
  throw new Error('Paginação do SSX Desk (listar empresas) excedeu o limite de segurança.');
}

export interface CriarEtapaTreinamentoDados {
  companyId: string;
  name: string;
  status?: StatusEtapaDesk;
  sortOrder?: number;
  notes?: string;
}

export async function criarEtapaTreinamento(
  apiKey: string, dados: CriarEtapaTreinamentoDados, fetchApi: typeof fetch = fetch,
): Promise<EtapaTreinamentoDesk> {
  const response = await fetchApi(`${BASE_URL}/training-stages`, {
    method: 'POST',
    headers: { ...cabecalhos(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify(dados),
    signal: AbortSignal.timeout(20_000), redirect: 'error',
  });
  const corpo = await tratarResposta<{ data: EtapaTreinamentoDesk }>(response, 'criar etapa');
  return corpo.data;
}

export interface AtualizarEtapaTreinamentoDados {
  name?: string;
  status?: StatusEtapaDesk;
  sortOrder?: number;
  notes?: string;
}

export async function atualizarEtapaTreinamento(
  apiKey: string, id: string, dados: AtualizarEtapaTreinamentoDados, fetchApi: typeof fetch = fetch,
): Promise<EtapaTreinamentoDesk> {
  const response = await fetchApi(`${BASE_URL}/training-stages/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { ...cabecalhos(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify(dados),
    signal: AbortSignal.timeout(20_000), redirect: 'error',
  });
  const corpo = await tratarResposta<{ data: EtapaTreinamentoDesk }>(response, 'atualizar etapa');
  return corpo.data;
}

/** Exclusão — 404 aqui só significa que a etapa já não existe mais do lado do Desk, não é
 * um erro de sincronização (o resultado desejado, ela não existir, já está garantido). */
export async function excluirEtapaTreinamento(
  apiKey: string, id: string, fetchApi: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchApi(`${BASE_URL}/training-stages/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: cabecalhos(apiKey),
    signal: AbortSignal.timeout(20_000), redirect: 'error',
  });
  if (response.status === 404) return;
  await tratarResposta<{ id: string; deleted: boolean }>(response, 'excluir etapa');
}
