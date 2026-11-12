/** Cliente fino da API de etapas de treinamento ("training stages") do SSX Desk —
 * ver server/SSX_DESK_TRAINING_STAGES.md. Escopo `training-stages:write`, chave
 * própria (SSX_DESK_TRAINING_STAGES_API_KEY), nunca a de leitura de conversas. */

export type StatusEtapaDesk = "Em andamento" | "Concluído" | "Não concluído";

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

/** Campo embutido em cada empresa de `GET /companies` — já traz as etapas atuais. Não
 * usado para ler o estado (o serviço de sincronização mantém o id de cada etapa em
 * `Empresa.ssxDeskTrainingStageIds`), só documentado aqui pelo formato real da resposta. */
export interface TrainingStagesEmbutido {
  hasStages: boolean;
  items: EtapaTreinamentoDesk[];
}

export interface CompanyDesk {
  id: string;
  name: string;
  idCentral: string | null;
  /** Confirmado pela resposta real do Desk; não validamos nem usamos os campos abaixo
   * além de id/name/idCentral, para não quebrar se o formato ganhar novos campos. */
  trainingStages?: TrainingStagesEmbutido;
}

const BASE_URL = "https://desk.systemsat.com.br/api/integrations/v1";

function cabecalhos(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
}

/** Erro HTTP do Desk com o status preservado — permite ao chamador reagir a um código
 * específico (ex.: recriar uma etapa que sumiu, em vez de só logar um 404 genérico). */
export class SsxDeskHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "SsxDeskHttpError";
  }
}

async function tratarResposta<T>(
  response: Response,
  contexto: string,
): Promise<T> {
  if (!response.ok) {
    // Nunca registrar o corpo bruto da resposta nem a chave — pode conter dados do cliente.
    throw new SsxDeskHttpError(
      `SSX Desk (${contexto}) respondeu HTTP ${response.status}. Confira a chave, o escopo e o limite de consultas.`,
      response.status,
    );
  }
  const corpo = await response.json().catch(() => {
    throw new Error(
      `SSX Desk (${contexto}) devolveu uma resposta que não é JSON.`,
    );
  });
  return corpo as T;
}

/** Só valida os campos que o serviço realmente usa (id/name/idCentral) — a resposta real
 * traz bem mais campos (industry, phone, isInTraining, trainingStages, evaluation...)
 * que não nos interessam e não devem quebrar a validação se mudarem. */
function validarCompany(value: unknown): value is CompanyDesk {
  const c = value as CompanyDesk | null;
  return (
    !!c &&
    typeof c.id === "string" &&
    !!c.id &&
    typeof c.name === "string" &&
    (c.idCentral === null ||
      c.idCentral === undefined ||
      typeof c.idCentral === "string")
  );
}

/**
 * Todas as empresas cadastradas no Desk. Usada só para resolver `companyId` a partir do
 * `idCentral` do Radar — cacheie o resultado (ver TrainingStagesSyncService) em vez de
 * chamar a cada ciclo.
 *
 * A resposta real confirmada traz `{ data: [...], meta: { total } }`, sem `hasMore`
 * nem `offset` — diferente da paginação de `training-conversations`. Por ora, uma única
 * chamada sem parâmetros de página: se `data.length` vier menor que `meta.total`, a lista
 * está incompleta e não há como pedir o restante com o contrato atualmente confirmado —
 * erra de forma explícita em vez de seguir com uma lista parcial (ver limitação em
 * server/SSX_DESK_TRAINING_STAGES.md).
 */
export async function listarEmpresasDesk(
  apiKey: string,
  fetchApi: typeof fetch = fetch,
): Promise<CompanyDesk[]> {
  const response = await fetchApi(`${BASE_URL}/companies`, {
    headers: cabecalhos(apiKey),
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(
      `SSX Desk (listar empresas) respondeu HTTP ${response.status}. Confira a chave, o escopo e o limite de consultas.`,
    );
  const body = (await response.json()) as {
    data: unknown[];
    meta: { total: number };
  };
  if (
    !body ||
    !Array.isArray(body.data) ||
    !body.data.every(validarCompany) ||
    !body.meta ||
    !Number.isInteger(body.meta.total) ||
    body.meta.total < 0
  ) {
    throw new Error(
      "Resposta do SSX Desk (listar empresas) fora do formato esperado.",
    );
  }
  if (body.data.length < body.meta.total) {
    throw new Error(
      `SSX Desk (listar empresas) retornou ${body.data.length} de ${body.meta.total} empresas — ` +
        "a API não documentou paginação para /companies; confirme com o SSX Desk como pedir o restante.",
    );
  }
  return body.data as CompanyDesk[];
}

export interface CriarEtapaTreinamentoDados {
  companyId: string;
  name: string;
  status?: StatusEtapaDesk;
  sortOrder?: number;
  notes?: string;
}

export async function criarEtapaTreinamento(
  apiKey: string,
  dados: CriarEtapaTreinamentoDados,
  fetchApi: typeof fetch = fetch,
): Promise<EtapaTreinamentoDesk> {
  const response = await fetchApi(`${BASE_URL}/training-stages`, {
    method: "POST",
    headers: { ...cabecalhos(apiKey), "Content-Type": "application/json" },
    body: JSON.stringify(dados),
    signal: AbortSignal.timeout(20_000),
    redirect: "error",
  });
  const corpo = await tratarResposta<{ data: EtapaTreinamentoDesk }>(
    response,
    "criar etapa",
  );
  return corpo.data;
}

export interface AtualizarEtapaTreinamentoDados {
  name?: string;
  status?: StatusEtapaDesk;
  sortOrder?: number;
  notes?: string;
}

/** O `id` vai na query string (`?id=`), não no caminho — conforme o guia da API do Desk.
 * `/training-stages/{id}` não existe e responde 404 sempre (era a causa das etapas
 * duplicadas: todo PUT falhava e o 404 era tratado como "etapa excluída, recriar"). */
function urlEtapaTreinamento(id: string): string {
  return `${BASE_URL}/training-stages?id=${encodeURIComponent(id)}`;
}

export async function atualizarEtapaTreinamento(
  apiKey: string,
  id: string,
  dados: AtualizarEtapaTreinamentoDados,
  fetchApi: typeof fetch = fetch,
): Promise<EtapaTreinamentoDesk> {
  const response = await fetchApi(urlEtapaTreinamento(id), {
    method: "PUT",
    headers: { ...cabecalhos(apiKey), "Content-Type": "application/json" },
    body: JSON.stringify(dados),
    signal: AbortSignal.timeout(20_000),
    redirect: "error",
  });
  const corpo = await tratarResposta<{ data: EtapaTreinamentoDesk }>(
    response,
    "atualizar etapa",
  );
  return corpo.data;
}

/** Exclusão — 404 aqui só significa que a etapa já não existe mais do lado do Desk, não é
 * um erro de sincronização (o resultado desejado, ela não existir, já está garantido). */
export async function excluirEtapaTreinamento(
  apiKey: string,
  id: string,
  fetchApi: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchApi(urlEtapaTreinamento(id), {
    method: "DELETE",
    headers: cabecalhos(apiKey),
    signal: AbortSignal.timeout(20_000),
    redirect: "error",
  });
  if (response.status === 404) return;
  await tratarResposta<{ id: string; deleted: boolean }>(
    response,
    "excluir etapa",
  );
}
