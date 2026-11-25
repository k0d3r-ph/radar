import '../config/env.js';
import type pg from 'pg';
import { BancoDocumentosPostgres } from './BancoDocumentosPostgres.js';
import { criarPoolPostgres, lerConfiguracaoPostgres } from './conexao.js';
import { migrarEsquema } from './migrador.js';

/**
 * Banco de dados do Radar (PostgreSQL). A autenticação continua no Firebase (firebaseAdmin.ts).
 * O pool só abre conexões na primeira consulta; prepararBanco() aplica as migrações e deve ser
 * aguardado antes de o processo aceitar requisições.
 */
const processo = process.argv[1]?.includes('apiIndex') ? 'api' : process.argv[1]?.includes('index') ? 'bot' : 'script';
const configuracao = lerConfiguracaoPostgres(process.env, processo);

export const poolPostgres: pg.Pool | null = configuracao ? criarPoolPostgres(configuracao) : null;
export const banco: BancoDocumentosPostgres | null = poolPostgres ? new BancoDocumentosPostgres(poolPostgres) : null;

if (!configuracao) {
  console.warn('[PostgreSQL] Banco não configurado (POSTGRES_HOST ou DATABASE_URL). Rotas que usam dados ficarão indisponíveis.');
}

export async function prepararBanco(): Promise<void> {
  if (!poolPostgres) return;
  const aplicadas = await migrarEsquema(poolPostgres);
  console.log(aplicadas.length
    ? `[PostgreSQL] Migrações aplicadas: ${aplicadas.join(', ')}.`
    : '[PostgreSQL] Esquema atualizado.');
}
