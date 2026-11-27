/**
 * Carrega no banco LOCAL uma exportação dos dados de produção, para testar telas com dados
 * reais sem tocar na VPS (ver server/WHATSAPP_CHAT.md, "Teste local com dados reais").
 *
 * Na VPS (gera só dados, em INSERTs, sem o esquema):
 *   sudo -u postgres pg_dump --data-only --column-inserts radar > /tmp/radar-dados.sql
 *
 * Aqui, com `npm run db:local` aberto em outro terminal:
 *   npm run db:local:importar -- caminho/radar-dados.sql
 *
 * Apaga os dados do banco local antes de importar. Grava sempre em 127.0.0.1:54329
 * (scripts/bancoLocal.ts), ignorando o .env, então não alcança produção.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { URL_BANCO_LOCAL } from './bancoLocal.js';
import { migrarEsquema } from '../src/infrastructure/postgres/migrador.js';
import { todasAsTabelas } from '../src/infrastructure/postgres/colecoes.js';

/** Linhas do arquivo que não são executadas: comandos do psql e o controle de migrações. */
function filtrarDump(conteudo: string): string {
  return conteudo
    .split(/\r?\n/)
    .filter((linha) => !linha.startsWith('\\'))
    // O banco local já registra as próprias migrações (inclusive as que produção ainda não tem).
    .filter((linha) => !/^INSERT INTO (public\.)?radar_migracoes\b/i.test(linha))
    .join('\n');
}

async function main() {
  const arquivo = process.argv[2];
  if (!arquivo) {
    console.error('Informe o arquivo exportado: npm run db:local:importar -- caminho/radar-dados.sql');
    process.exit(1);
  }
  const caminho = path.resolve(arquivo);
  if (!fs.existsSync(caminho)) {
    console.error(`Arquivo não encontrado: ${caminho}`);
    process.exit(1);
  }
  const sql = filtrarDump(fs.readFileSync(caminho, 'utf8'));
  if (!/INSERT INTO/i.test(sql)) {
    console.error('O arquivo não tem INSERTs. Gere com: pg_dump --data-only --column-inserts radar');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: URL_BANCO_LOCAL, max: 2 });
  try {
    await migrarEsquema(pool).catch((erro) => {
      throw new Error(`Banco local não respondeu. Rode "npm run db:local" em outro terminal. (${(erro as Error).message})`);
    });
    const tabelas = [...todasAsTabelas(), 'radar_exclusoes', 'whatsapp_mensagens', 'whatsapp_conversas'];
    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      // Sem gatilhos: mantém versões e datas exatamente como em produção.
      await cliente.query('set local session_replication_role = replica');
      await cliente.query(`truncate ${tabelas.join(', ')}`);
      await cliente.query(sql);
      await cliente.query('commit');
    } catch (erro) {
      await cliente.query('rollback').catch(() => undefined);
      throw erro;
    } finally {
      // O arquivo do pg_dump muda o search_path da sessão: restaura antes de devolver a conexão.
      await cliente.query('reset all').catch(() => undefined);
      cliente.release();
    }

    console.log(`Dados importados de ${path.basename(caminho)} para o banco local:`);
    for (const tabela of todasAsTabelas()) {
      const { rows } = await pool.query<{ n: number }>(`select count(*)::int as n from public.${tabela}`);
      if (rows[0].n > 0) console.log(`  ${tabela}: ${rows[0].n}`);
    }
    console.log('\nLembre de apagar o arquivo exportado: ele contém dados reais de clientes.');
  } finally {
    await pool.end();
  }
}

main().catch((erro) => {
  console.error('Falha na importação:', erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
