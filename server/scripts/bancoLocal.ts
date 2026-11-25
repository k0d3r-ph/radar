/**
 * Banco PostgreSQL local de desenvolvimento (ver server/EMULADOR.md).
 *
 * Os scripts de exemplo (seed*) usam sempre este endereço, ignorando o .env: assim nunca gravam
 * no banco de produção, mesmo que o server/.env aponte para ele.
 */
import type { BancoDocumentosPostgres } from '../src/infrastructure/postgres/BancoDocumentosPostgres.js';

export const PORTA_BANCO_LOCAL = 54329;
export const SENHA_BANCO_LOCAL = 'radar-local';
export const URL_BANCO_LOCAL = `postgres://postgres:${SENHA_BANCO_LOCAL}@127.0.0.1:${PORTA_BANCO_LOCAL}/radar`;

export async function abrirBancoLocal(): Promise<BancoDocumentosPostgres> {
  // Antes de importar bancoDados: o dotenv não sobrescreve variáveis já definidas.
  process.env.DATABASE_URL = URL_BANCO_LOCAL;
  delete process.env.POSTGRES_SSL;
  const { banco, prepararBanco } = await import('../src/infrastructure/postgres/bancoDados.js');
  if (!banco) throw new Error('Banco local indisponível.');
  try {
    await prepararBanco();
  } catch (erro) {
    throw new Error(`Banco local não respondeu em 127.0.0.1:${PORTA_BANCO_LOCAL}. Rode "npm run db:local" em outro terminal. (${(erro as Error).message})`);
  }
  return banco;
}
