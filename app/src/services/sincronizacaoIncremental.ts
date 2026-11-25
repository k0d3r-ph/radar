/** Sincroniza apenas documentos alterados; exclusões são reconciliadas por ID. */
import { auth } from './firebase';
import { RADAR_API_URL } from './apiConfig.ts';
import { apagarCache, gravarCache, lerCache } from './cacheDocumentos';

type RegistroSincronizavel = { id?: string };
type DocumentoIndice = { id: string; versao: string };
const emAndamento = new Map<string, Promise<RegistroSincronizavel[]>>();
/** Ids por requisição de documentos alterados. */
const TAMANHO_LOTE = 500;

function chaveMarcador(nomeColecao: string): string {
  // v3: versões do PostgreSQL (as do Firestore, v2, não valem mais).
  return `radar:sync:v3:${auth.currentUser?.uid}:${nomeColecao}`;
}

function lerVersoes(chave: string): Map<string, string> | null {
  try {
    const bruto = localStorage.getItem(chave);
    if (!bruto) return null;
    const dados: unknown = JSON.parse(bruto);
    if (!Array.isArray(dados) || !dados.every(item => Array.isArray(item)
      && item.length === 2 && item.every(valor => typeof valor === 'string'))) return null;
    return new Map(dados as [string, string][]);
  } catch { return null; }
}

function gravarVersoes(chave: string, documentos: DocumentoIndice[]): void {
  try {
    localStorage.setItem(chave, JSON.stringify(documentos.map(d => [d.id, d.versao])));
  } catch { /* Sem persistência, a próxima sincronização relê a base. */ }
}

/** Descarta as versões quando uma operação externa exige reler a base. */
export function invalidarSincronizacao(nomeColecao: string): void {
  const chave = chaveMarcador(nomeColecao);
  try { localStorage.removeItem(chave); }
  catch { /* localStorage indisponível. */ }
  void apagarCache(chave);
}

async function requisitar(caminho: string, corpo?: unknown): Promise<unknown> {
  if (!auth.currentUser) throw new Error('Entre novamente no Radar.');
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(`${RADAR_API_URL}/api/sincronizacao/${caminho}`, {
    method: corpo === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const dados = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(dados.error || 'Não foi possível sincronizar os dados.');
  return dados;
}

/** Documentos da coleção (todos, ou só os ids pedidos) a partir da memória do backend. */
async function buscarDocumentos<T>(nomeColecao: string, ids?: string[]): Promise<T[]> {
  const dados = await requisitar(`${encodeURIComponent(nomeColecao)}/documentos`, ids ? { ids } : {}) as { documentos?: unknown };
  if (!Array.isArray(dados.documentos)) throw new Error('Resposta de sincronização inválida.');
  return dados.documentos as T[];
}

/**
 * Lê a coleção inteira a partir do índice já mantido em memória pelo backend
 * (ver IndiceSincronizacao). Pensada para quem pede a coleção inteira com
 * frequência (ex.: painel ao vivo), sem cache local.
 */
export function obterColecaoCompleta<T>(nomeColecao: string): Promise<T[]> {
  return buscarDocumentos<T>(nomeColecao);
}

async function consultarIndice(nomeColecao: string): Promise<DocumentoIndice[]> {
  const dados = await requisitar(encodeURIComponent(nomeColecao)) as { documentos?: unknown };
  if (!Array.isArray(dados.documentos) || !dados.documentos.every((d: DocumentoIndice) =>
    d && typeof d.id === 'string' && d.id.length > 0 && !d.id.includes('/') && typeof d.versao === 'string')) {
    throw new Error('Índice de sincronização inválido.');
  }
  return dados.documentos as DocumentoIndice[];
}

async function sincronizar<T extends RegistroSincronizavel>(nomeColecao: string, chave: string): Promise<T[]> {
  const documentos = await consultarIndice(nomeColecao);
  const versoes = lerVersoes(chave);
  const base = versoes ? await lerCache<T>(chave) : null;

  const porId = new Map((base ?? []).map(registro => [registro.id, registro]));
  if (!versoes || !base) {
    // Primeira carga (ou cópia local perdida): uma única requisição com a coleção inteira.
    porId.clear();
    (await buscarDocumentos<T>(nomeColecao)).forEach(registro => porId.set(registro.id, registro));
  } else {
    const alterados = documentos.filter(d => !porId.has(d.id) || versoes.get(d.id) !== d.versao).map(d => d.id);
    for (let inicio = 0; inicio < alterados.length; inicio += TAMANHO_LOTE) {
      const ids = alterados.slice(inicio, inicio + TAMANHO_LOTE);
      const encontrados = await buscarDocumentos<T>(nomeColecao, ids);
      encontrados.forEach(registro => porId.set(registro.id, registro));
      // Pode haver uma exclusão entre a consulta do índice e a dos documentos.
      const recebidos = new Set(encontrados.map(registro => registro.id));
      ids.filter(id => !recebidos.has(id)).forEach(id => porId.delete(id));
    }
  }

  // Filtra exclusões mesmo sem alterações: a cópia local pode conservar
  // documentos apagados por outra pessoa em outro computador.
  const registros = documentos.flatMap(d => {
    const registro = porId.get(d.id);
    return registro ? [registro] : [];
  });
  if (chave !== chaveMarcador(nomeColecao)) throw new Error('A sessão mudou durante a sincronização. Entre novamente.');
  await gravarCache(chave, registros);
  gravarVersoes(chave, documentos.filter(d => porId.has(d.id)));
  return registros;
}

/**
 * Atualiza a lista pelo índice compartilhado. forceRefresh ignora o cache em
 * memória dos serviços, sem reler a coleção. Cargas completas só ocorrem na
 * primeira consulta ou quando a cópia local foi perdida.
 */
export async function sincronizarColecao<T extends RegistroSincronizavel>(
  nomeColecao: string,
  forceRefresh = false,
): Promise<T[]> {
  // A atualização forçada já foi aplicada ao cache em memória do serviço.
  // Aqui toda chamada consulta o índice atual, independentemente da opção.
  void forceRefresh;
  const chave = chaveMarcador(nomeColecao);
  let pendente = emAndamento.get(chave);
  if (!pendente) {
    pendente = sincronizar<T>(nomeColecao, chave);
    emAndamento.set(chave, pendente);
  }
  try { return await pendente as T[]; }
  finally { if (emAndamento.get(chave) === pendente) emAndamento.delete(chave); }
}
