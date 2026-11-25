import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import os from 'node:os';
import path from 'node:path';
import { BancoDocumentosPostgres } from '../../dist/infrastructure/postgres/BancoDocumentosPostgres.js';
import { migrarEsquema } from '../../dist/infrastructure/postgres/migrador.js';
import { todasAsTabelas } from '../../dist/infrastructure/postgres/colecoes.js';

/**
 * PostgreSQL 18 real e descartável (pacote embedded-postgres), um por arquivo de teste.
 * Os dados ficam numa pasta temporária apagada ao encerrar.
 */
export async function iniciarPostgresTeste() {
  const porta = 55_000 + (process.pid % 2_000);
  const servidor = new EmbeddedPostgres({
    databaseDir: path.join(os.tmpdir(), `radar-pg-teste-${process.pid}`),
    user: 'postgres', password: 'teste', port: porta, persistent: false, onLog: () => {},
  });
  await servidor.initialise();
  await servidor.start();
  const admin = servidor.getPgClient();
  await admin.connect();
  await admin.query("create database radar encoding 'UTF8' template template0");
  await admin.end();

  const pool = new pg.Pool({ host: '127.0.0.1', port: porta, user: 'postgres', password: 'teste', database: 'radar', max: 20 });
  await migrarEsquema(pool);
  const banco = new BancoDocumentosPostgres(pool);

  return {
    pool, banco,
    /** Grava documentos iniciais: [['colecao/id', dados], ...]. */
    async semear(documentos) {
      const lote = banco.batch();
      for (const [caminho, dados] of documentos) lote.set(banco.doc(caminho), dados);
      await lote.commit();
    },
    async limpar() {
      await pool.query(`truncate ${todasAsTabelas().join(', ')}, radar_exclusoes`);
    },
    async encerrar() {
      await pool.end();
      await servidor.stop();
    },
  };
}
