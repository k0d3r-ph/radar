/**
 * Cópia local das coleções sincronizadas (IndexedDB), separada por usuário e coleção.
 * Substitui o cache persistente do SDK do Firestore: ao recarregar a página, só os documentos
 * alterados são buscados de novo. Qualquer falha devolve null e a sincronização faz uma carga completa.
 */
const BANCO = 'radar-cache';
const VERSAO = 1;
const LOJA = 'colecoes';

let conexao: Promise<IDBDatabase | null> | null = null;

function abrir(): Promise<IDBDatabase | null> {
  if (!conexao) {
    conexao = new Promise(resolve => {
      try {
        if (!globalThis.indexedDB) { resolve(null); return; }
        const pedido = indexedDB.open(BANCO, VERSAO);
        pedido.onupgradeneeded = () => { if (!pedido.result.objectStoreNames.contains(LOJA)) pedido.result.createObjectStore(LOJA); };
        pedido.onsuccess = () => resolve(pedido.result);
        pedido.onerror = () => resolve(null);
        pedido.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return conexao;
}

export async function lerCache<T>(chave: string): Promise<T[] | null> {
  const banco = await abrir();
  if (!banco) return null;
  return new Promise(resolve => {
    try {
      const pedido = banco.transaction(LOJA, 'readonly').objectStore(LOJA).get(chave);
      pedido.onsuccess = () => resolve(Array.isArray(pedido.result) ? pedido.result as T[] : null);
      pedido.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function gravarCache<T>(chave: string, registros: T[]): Promise<void> {
  const banco = await abrir();
  if (!banco) return;
  await new Promise<void>(resolve => {
    try {
      const transacao = banco.transaction(LOJA, 'readwrite');
      transacao.objectStore(LOJA).put(registros, chave);
      transacao.oncomplete = () => resolve();
      transacao.onerror = () => resolve();
      transacao.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function apagarCache(chave: string): Promise<void> {
  const banco = await abrir();
  if (!banco) return;
  await new Promise<void>(resolve => {
    try {
      const transacao = banco.transaction(LOJA, 'readwrite');
      transacao.objectStore(LOJA).delete(chave);
      transacao.oncomplete = () => resolve();
      transacao.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
