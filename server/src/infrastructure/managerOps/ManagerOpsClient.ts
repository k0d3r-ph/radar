/** Cliente fino da API de combinados da Manager Ops (Daily) — ver server/MANAGER_OPS.md. */

export type ManagerOpsStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export type ManagerOpsPriority = 'LOW' | 'NORMAL' | 'HIGH';

export interface ManagerOpsAgreement {
  id: string;
  title: string;
  description: string | null;
  status: ManagerOpsStatus;
  priority: ManagerOpsPriority;
  origin: string;
  member: { id: string; name: string; email: string };
  central: { id: string; name: string } | null;
  dueDate: string | null;
  originalDueDate: string | null;
  completedAt: string | null;
  outcome: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ListarCombinadosResposta {
  data: ManagerOpsAgreement[];
  nextCursor: string | null;
}

const BASE_URL = 'https://managerops-omega.vercel.app/api/v1';

function cabecalhos(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
}

async function tratarResposta<T>(response: Response, contexto: string): Promise<T> {
  if (!response.ok) {
    // Nunca registrar o corpo bruto da resposta nem a chave — pode conter dados do time.
    throw new Error(`Manager Ops (${contexto}) respondeu HTTP ${response.status}.`);
  }
  const corpo = await response.json().catch(() => {
    throw new Error(`Manager Ops (${contexto}) devolveu uma resposta que não é JSON.`);
  });
  return corpo as T;
}

/** Uma página de combinados alterados desde `updatedSince` (ISO 8601), ou todos se omitido. */
export async function listarCombinados(
  apiKey: string,
  opcoes: { updatedSince?: string; cursor?: string; fetchApi?: typeof fetch } = {},
): Promise<ListarCombinadosResposta> {
  const fetchApi = opcoes.fetchApi ?? fetch;
  const url = new URL(`${BASE_URL}/agreements`);
  url.searchParams.set('limit', '200');
  if (opcoes.updatedSince) url.searchParams.set('updatedSince', opcoes.updatedSince);
  if (opcoes.cursor) url.searchParams.set('cursor', opcoes.cursor);
  const response = await fetchApi(url, {
    headers: cabecalhos(apiKey),
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  });
  return tratarResposta<ListarCombinadosResposta>(response, 'listar combinados');
}

/** Busca todas as páginas de combinados alterados desde `updatedSince`. */
export async function listarTodosCombinados(
  apiKey: string,
  updatedSince: string | undefined,
  fetchApi: typeof fetch = fetch,
): Promise<ManagerOpsAgreement[]> {
  const combinados: ManagerOpsAgreement[] = [];
  let cursor: string | undefined;
  for (let pagina = 0; pagina < 200; pagina++) {
    const resposta = await listarCombinados(apiKey, { updatedSince, cursor, fetchApi });
    combinados.push(...resposta.data);
    if (!resposta.nextCursor) return combinados;
    cursor = resposta.nextCursor;
  }
  throw new Error('Manager Ops: paginação de combinados não terminou dentro do limite esperado.');
}

export interface CriarCombinadoDados {
  memberEmail: string;
  title: string;
  description?: string;
  dueDate?: string;
  priority?: ManagerOpsPriority;
}

export async function criarCombinado(
  apiKey: string,
  dados: CriarCombinadoDados,
  fetchApi: typeof fetch = fetch,
): Promise<ManagerOpsAgreement> {
  const response = await fetchApi(`${BASE_URL}/agreements`, {
    method: 'POST',
    headers: { ...cabecalhos(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify(dados),
    signal: AbortSignal.timeout(20_000),
    redirect: 'error',
  });
  return tratarResposta<ManagerOpsAgreement>(response, 'criar combinado');
}

export interface AtualizarCombinadoDados {
  title?: string;
  description?: string;
  priority?: ManagerOpsPriority;
  status?: 'DONE' | 'CANCELLED';
  outcome?: string;
  reason?: string;
}

export async function atualizarCombinado(
  apiKey: string,
  id: string,
  dados: AtualizarCombinadoDados,
  fetchApi: typeof fetch = fetch,
): Promise<ManagerOpsAgreement> {
  const response = await fetchApi(`${BASE_URL}/agreements/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...cabecalhos(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify(dados),
    signal: AbortSignal.timeout(20_000),
    redirect: 'error',
  });
  return tratarResposta<ManagerOpsAgreement>(response, 'atualizar combinado');
}

/** Exclusão lógica — o combinado some das telas e listas da Daily, mas fica guardado lá. */
export async function excluirCombinado(
  apiKey: string,
  id: string,
  fetchApi: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchApi(`${BASE_URL}/agreements/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: cabecalhos(apiKey),
    signal: AbortSignal.timeout(20_000),
    redirect: 'error',
  });
  // 404 aqui só significa que o combinado já não existe mais do lado da Daily — não é
  // um erro de sincronização, o resultado desejado (ele não existir) já está garantido.
  if (response.status === 404) return;
  await tratarResposta<{ id: string; deleted: boolean }>(response, 'excluir combinado');
}
