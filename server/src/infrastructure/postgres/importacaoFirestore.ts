/**
 * Carga dos dados do Firestore no PostgreSQL (usada por scripts/migrarFirestoreParaPostgres.ts).
 * Separada do script para ser testada sem acessar o Firestore.
 */
import { DocumentReference, GeoPoint, Timestamp } from 'firebase-admin/firestore';
import { isDeepStrictEqual } from 'node:util';
import type pg from 'pg';
import { TABELAS_SUBCOLECAO, todasAsTabelas } from './colecoes.js';
import { migrarEsquema } from './migrador.js';

export interface LinhaImportacao {
  tabela: string;
  paiId?: string;
  id: string;
  dados: Record<string, unknown>;
  criadoEm: string;
  atualizadoEm: string;
}

/** Converte tipos do Firestore que o JSON não representa; cada conversão é contada para o relatório. */
export function converterValorFirestore(valor: unknown, caminho: string, contar: (tipo: string) => void): unknown {
  if (valor === null || typeof valor === 'string' || typeof valor === 'boolean') return valor;
  if (typeof valor === 'number') {
    if (Number.isFinite(valor)) return valor;
    contar(`número não finito → null (${caminho})`);
    return null;
  }
  if (valor instanceof Timestamp) { contar('Timestamp → milissegundos'); return valor.toMillis(); }
  if (valor instanceof Date) { contar('Date → milissegundos'); return valor.getTime(); }
  if (valor instanceof DocumentReference) { contar('Referência → caminho (texto)'); return valor.path; }
  if (valor instanceof GeoPoint) { contar('GeoPoint → {latitude, longitude}'); return { latitude: valor.latitude, longitude: valor.longitude }; }
  if (valor instanceof Uint8Array) { contar('Bytes → base64'); return Buffer.from(valor).toString('base64'); }
  if (Array.isArray(valor)) return valor.map((item, i) => converterValorFirestore(item, `${caminho}[${i}]`, contar));
  if (typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor as Record<string, unknown>)
      .map(([k, v]) => [k, converterValorFirestore(v, `${caminho}.${k}`, contar)]));
  }
  throw new Error(`Valor não suportado em ${caminho}: ${typeof valor}`);
}

const ehSubcolecao = (tabela: string) => (Object.values(TABELAS_SUBCOLECAO) as string[]).includes(tabela);
const chave = (l: { paiId?: string; id: string }) => (l.paiId !== undefined ? `${l.paiId}/${l.id}` : l.id);

/**
 * Substitui todo o conteúdo das tabelas do Radar pelas linhas informadas, em uma transação
 * (esvazia e recarrega, preservando as datas originais). Depois relê o banco e retorna as
 * divergências encontradas em relação às linhas — lista vazia significa cópia idêntica.
 */
export async function substituirDados(pool: pg.Pool, linhas: LinhaImportacao[]): Promise<string[]> {
  await migrarEsquema(pool);
  const tabelas = todasAsTabelas();
  const desconhecida = linhas.find(l => !tabelas.includes(l.tabela));
  if (desconhecida) throw new Error(`Tabela desconhecida: ${desconhecida.tabela}`);
  const porTabela = new Map<string, LinhaImportacao[]>(tabelas.map(t => [t, []]));
  for (const l of linhas) {
    if (ehSubcolecao(l.tabela) !== (l.paiId !== undefined)) throw new Error(`Documento ${l.tabela}/${chave(l)} sem o pai esperado.`);
    porTabela.get(l.tabela)!.push(l);
  }

  const cliente = await pool.connect();
  try {
    await cliente.query('begin');
    await cliente.query("set local radar.importacao = 'on'");
    // Nenhuma gravação da aplicação se mistura à carga.
    await cliente.query(`lock table ${tabelas.join(', ')} in access exclusive mode`);
    await cliente.query(`truncate ${tabelas.join(', ')}`);
    for (const [tabela, itens] of porTabela) {
      for (let i = 0; i < itens.length; i += 500) {
        const lote = itens.slice(i, i + 500);
        const comuns = [lote.map(l => l.id), lote.map(l => JSON.stringify(l.dados)), lote.map(l => l.criadoEm), lote.map(l => l.atualizadoEm)];
        if (ehSubcolecao(tabela)) {
          await cliente.query(
            `insert into ${tabela} (pai_id, id, dados, criado_em, atualizado_em)
             select * from unnest($1::text[], $2::text[], $3::jsonb[], $4::timestamptz[], $5::timestamptz[])`,
            [lote.map(l => l.paiId), ...comuns],
          );
        } else {
          await cliente.query(
            `insert into ${tabela} (id, dados, criado_em, atualizado_em)
             select * from unnest($1::text[], $2::jsonb[], $3::timestamptz[], $4::timestamptz[])`,
            comuns,
          );
        }
      }
    }
    await cliente.query('commit');
  } catch (erro) {
    await cliente.query('rollback').catch(() => undefined);
    throw erro;
  } finally {
    cliente.release();
  }

  const divergencias: string[] = [];
  for (const [tabela, itens] of porTabela) {
    const esperadas = new Map(itens.map(l => [chave(l), l.dados]));
    const { rows } = await pool.query<{ chave: string; dados: unknown }>(
      `select ${ehSubcolecao(tabela) ? "pai_id || '/' || id" : 'id'} as chave, dados from ${tabela}`);
    if (rows.length !== esperadas.size) divergencias.push(`${tabela}: ${rows.length} no banco, ${esperadas.size} esperados`);
    for (const { chave: id, dados } of rows) {
      if (!isDeepStrictEqual(dados, esperadas.get(id))) divergencias.push(`${tabela}/${id} diverge`);
    }
  }
  return divergencias;
}
