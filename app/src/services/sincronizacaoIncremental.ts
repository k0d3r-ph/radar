/** Sincroniza apenas documentos alterados; exclusões são reconciliadas por ID. */
import {
  collection, documentId, getDocsFromCache, getDocsFromServer,
  query, where, type QuerySnapshot,
} from 'firebase/firestore';
import { auth, db } from './firebase';

type RegistroSincronizavel = { id?: string };
type DocumentoIndice = { id: string; versao: string };
const emAndamento = new Map<string, Promise<RegistroSincronizavel[]>>();

function chaveMarcador(nomeColecao: string): string {
  return `radar:sync:v2:${auth.currentUser?.uid}:${nomeColecao}`;
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
  try { localStorage.removeItem(chaveMarcador(nomeColecao)); }
  catch { /* localStorage indisponível. */ }
}

function mapearDocumentos<T>(snapshot: QuerySnapshot): T[] {
  return snapshot.docs.map(documento => ({ ...documento.data(), id: documento.id })) as T[];
}

async function consultarIndice(nomeColecao: string): Promise<DocumentoIndice[]> {
  if (!auth.currentUser) throw new Error('Entre novamente no Radar.');
  const token = await auth.currentUser.getIdToken();
  const apiUrl = (import.meta.env.VITE_WHATSAPP_API_URL || 'http://localhost:5000').replace(/\/+$/, '');
  const response = await fetch(`${apiUrl}/api/sincronizacao/${encodeURIComponent(nomeColecao)}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  const dados = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(dados.error || 'Não foi possível sincronizar os dados.');
  if (!Array.isArray(dados.documentos) || !dados.documentos.every((d: DocumentoIndice) =>
    d && typeof d.id === 'string' && d.id.length > 0 && !d.id.includes('/') && typeof d.versao === 'string')) {
    throw new Error('Índice de sincronização inválido.');
  }
  return dados.documentos;
}

async function sincronizar<T extends RegistroSincronizavel>(nomeColecao: string, chave: string): Promise<T[]> {
  const documentos = await consultarIndice(nomeColecao);
  const referencia = collection(db, nomeColecao);
  const versoes = lerVersoes(chave);
  let base: T[] = [];
  if (versoes) {
    try { base = mapearDocumentos<T>(await getDocsFromCache(referencia)); }
    catch { /* Cache vazio ou indisponível: faz uma carga inicial. */ }
  }

  const porId = new Map(base.map(registro => [registro.id, registro]));
  const alterados = documentos.filter(d => !porId.has(d.id) || versoes?.get(d.id) !== d.versao);
  if (alterados.length > 0) {
    if (!versoes || base.length === 0) {
      // Uma consulta na primeira carga; não multiplica chamadas por lote.
      porId.clear();
      mapearDocumentos<T>(await getDocsFromServer(referencia)).forEach(registro => porId.set(registro.id, registro));
    } else {
      // `in` aceita até 30 IDs. Busca criações/edições e documentos que o SDK
      // tenha removido do cache, inclusive registros sem updatedAt.
      for (let inicio = 0; inicio < alterados.length; inicio += 30) {
        const ids = alterados.slice(inicio, inicio + 30).map(d => d.id);
        const snapshot = await getDocsFromServer(query(referencia, where(documentId(), 'in', ids)));
        mapearDocumentos<T>(snapshot).forEach(registro => porId.set(registro.id, registro));
        // Pode haver uma exclusão entre a consulta do índice e a dos documentos.
        const encontrados = new Set(snapshot.docs.map(d => d.id));
        ids.filter(id => !encontrados.has(id)).forEach(id => porId.delete(id));
      }
    }
  }

  // Filtra exclusões mesmo com delta vazio: o cache do SDK pode conservar
  // documentos apagados por outra pessoa em outro computador.
  const registros = documentos.flatMap(d => {
    const registro = porId.get(d.id);
    return registro ? [registro] : [];
  });
  if (chave !== chaveMarcador(nomeColecao)) throw new Error('A sessão mudou durante a sincronização. Entre novamente.');
  gravarVersoes(chave, documentos);
  return registros;
}

/**
 * Atualiza a lista pelo índice compartilhado. forceRefresh ignora o cache em
 * memória dos serviços, sem reler a coleção. Cargas completas só ocorrem na
 * primeira consulta ou quando a base local foi perdida.
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
