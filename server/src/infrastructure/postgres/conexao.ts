import pg from 'pg';

export interface ConfiguracaoPostgres {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: { rejectUnauthorized: boolean };
  max: number;
  application_name: string;
}

/**
 * Lê a conexão do ambiente: DATABASE_URL ou POSTGRES_HOST/PORT/DB/USER/PASSWORD.
 * Retorna null quando nada foi configurado (o processo sobe, mas as rotas de dados respondem 503).
 */
export function lerConfiguracaoPostgres(env: NodeJS.ProcessEnv, processo: string): ConfiguracaoPostgres | null {
  const url = env.DATABASE_URL?.trim();
  const host = env.POSTGRES_HOST?.trim();
  if (!url && !host) return null;
  const ssl = env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined;
  const max = Math.max(1, Number(env.POSTGRES_POOL_MAX) || 10);
  const application_name = `radar-${processo}`;
  if (url) return { connectionString: url, ssl, max, application_name };
  return {
    host,
    port: Number(env.POSTGRES_PORT) || 5432,
    database: env.POSTGRES_DB || 'radar',
    user: env.POSTGRES_USER || 'radar',
    password: env.POSTGRES_PASSWORD,
    ssl, max, application_name,
  };
}

export function criarPoolPostgres(configuracao: ConfiguracaoPostgres): pg.Pool {
  const pool = new pg.Pool({ ...configuracao, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  // Sem este listener, a queda de uma conexão ociosa derrubaria o processo.
  pool.on('error', erro => console.error('[PostgreSQL] Conexão ociosa encerrada com erro:', erro.message));
  return pool;
}
