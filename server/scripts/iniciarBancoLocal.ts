/**
 * Sobe um PostgreSQL 18 local para desenvolvimento, sem instalação (binários do pacote
 * embedded-postgres). Os dados ficam em server/.postgres-local/ e persistem entre execuções.
 *
 * Uso (a partir de server/): npm run db:local — Ctrl+C encerra.
 * No server/.env de desenvolvimento: DATABASE_URL=postgres://postgres:radar-local@127.0.0.1:54329/radar
 */
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTA_BANCO_LOCAL, SENHA_BANCO_LOCAL, URL_BANCO_LOCAL } from './bancoLocal.js';

const pasta = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.postgres-local');
const servidor = new EmbeddedPostgres({
  databaseDir: pasta,
  user: 'postgres',
  password: SENHA_BANCO_LOCAL,
  port: PORTA_BANCO_LOCAL,
  persistent: true,
  onLog: () => undefined,
});

if (!fs.existsSync(path.join(pasta, 'PG_VERSION'))) {
  console.log(`Criando o banco local em ${pasta}...`);
  await servidor.initialise();
}
await servidor.start();
const cliente = servidor.getPgClient();
await cliente.connect();
const existe = await cliente.query("select 1 from pg_database where datname = 'radar'");
if (!existe.rowCount) await cliente.query("create database radar encoding 'UTF8' template template0");
await cliente.query("alter database radar set timezone to 'America/Sao_Paulo'");
await cliente.end();

console.log(`PostgreSQL local pronto: ${URL_BANCO_LOCAL}`);
console.log('Ctrl+C para encerrar.');

let encerrando = false;
const encerrar = async () => {
  if (encerrando) return;
  encerrando = true;
  await servidor.stop();
  process.exit(0);
};
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
