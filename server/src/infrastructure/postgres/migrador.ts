import type pg from 'pg';
import { MIGRACOES, type Migracao } from './migracoes.js';

// Chave arbitrária e fixa do advisory lock: API e bot podem iniciar ao mesmo tempo.
const CHAVE_BLOQUEIO = 7_461_002_301;

/** Aplica as migrações pendentes, cada uma em sua transação. Retorna as versões aplicadas. */
export async function migrarEsquema(pool: pg.Pool, migracoes: Migracao[] = MIGRACOES): Promise<number[]> {
  const cliente = await pool.connect();
  const aplicadas: number[] = [];
  try {
    await cliente.query('select pg_advisory_lock($1)', [CHAVE_BLOQUEIO]);
    await cliente.query(`create table if not exists radar_migracoes (
      versao integer primary key, nome text not null, aplicada_em timestamptz not null default now())`);
    const { rows } = await cliente.query<{ versao: number }>('select versao from radar_migracoes');
    const existentes = new Set(rows.map(r => Number(r.versao)));
    for (const migracao of [...migracoes].sort((a, b) => a.versao - b.versao)) {
      if (existentes.has(migracao.versao)) continue;
      await cliente.query('begin');
      try {
        await cliente.query(migracao.sql);
        await cliente.query('insert into radar_migracoes (versao, nome) values ($1, $2)', [migracao.versao, migracao.nome]);
        await cliente.query('commit');
        aplicadas.push(migracao.versao);
      } catch (erro) {
        await cliente.query('rollback');
        throw new Error(`Falha na migração ${migracao.versao} (${migracao.nome}): ${(erro as Error).message}`);
      }
    }
    return aplicadas;
  } finally {
    await cliente.query('select pg_advisory_unlock($1)', [CHAVE_BLOQUEIO]).catch(() => undefined);
    cliente.release();
  }
}
