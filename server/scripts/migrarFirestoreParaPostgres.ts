/**
 * Copia todos os dados do Firestore para o PostgreSQL do Radar (ver server/MIGRACAO_POSTGRES.md).
 *
 * O Firestore é só lido. Sem --aplicar, apenas simula: lê, converte, mostra o relatório e salva
 * o backup local. Com --aplicar, substitui o conteúdo das tabelas do Radar em UMA transação
 * (esvazia e recarrega), então pode ser repetido até a virada sem duplicar nada; ao final, relê
 * o banco e compara documento por documento com o Firestore.
 *
 * Uso (a partir de server/):
 *   npm run migrar-firestore -- --contar  # só conta os documentos (quase sem custo de leitura)
 *   npm run migrar-firestore              # simulação
 *   npm run migrar-firestore -- --aplicar # grava no PostgreSQL configurado no .env
 *
 * Origem: FIREBASE_SERVICE_ACCOUNT_PATH (padrão ./serviceAccountKey.json na raiz do projeto).
 * Destino: DATABASE_URL ou POSTGRES_HOST/PORT/DB/USER/PASSWORD.
 */
import '../src/infrastructure/config/env.js';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TABELAS_RAIZ, TABELAS_SUBCOLECAO } from '../src/infrastructure/postgres/colecoes.js';
import { criarPoolPostgres, lerConfiguracaoPostgres } from '../src/infrastructure/postgres/conexao.js';
import { converterValorFirestore, substituirDados, type LinhaImportacao } from '../src/infrastructure/postgres/importacaoFirestore.js';

const aplicar = process.argv.includes('--aplicar');
const raizServer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const conversoes = new Map<string, number>();
const contar = (tipo: string) => conversoes.set(tipo, (conversoes.get(tipo) ?? 0) + 1);

function linha(tabela: string, documento: DocumentSnapshot, paiId?: string): LinhaImportacao {
  return {
    tabela, paiId, id: documento.id,
    dados: converterValorFirestore(documento.data() ?? {}, documento.ref.path, contar) as Record<string, unknown>,
    criadoEm: documento.createTime!.toDate().toISOString(),
    atualizadoEm: documento.updateTime!.toDate().toISOString(),
  };
}

function abrirFirestore(): Firestore {
  const caminho = path.resolve(raizServer, '..', process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './serviceAccountKey.json');
  if (!fs.existsSync(caminho)) throw new Error(`Credencial do Firebase não encontrada em ${caminho}.`);
  const credencial = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  if (credencial.project_id !== 'automatiza-esteira') throw new Error(`Projeto Firebase inesperado: ${credencial.project_id}.`);
  return getFirestore(initializeApp({ credential: cert(credencial) }, 'migracao'));
}

async function lerFirestore(db: Firestore) {
  const linhas: LinhaImportacao[] = [];
  const porColecao: Record<string, number> = {};
  const ignoradas: string[] = [];
  for (const colecao of await db.listCollections()) {
    const tabela = (TABELAS_RAIZ as Record<string, string>)[colecao.id];
    if (!tabela) { ignoradas.push(colecao.id); continue; }
    const documentos = (await colecao.get()).docs;
    porColecao[colecao.id] = documentos.length;
    for (const documento of documentos) linhas.push(linha(tabela, documento));
    console.log(`  ${colecao.id}: ${documentos.length}`);
  }
  for (const [caminho, tabela] of Object.entries(TABELAS_SUBCOLECAO)) {
    const [pai, sub] = caminho.split('/');
    const documentos = (await db.collectionGroup(sub).get()).docs.filter(d => d.ref.parent.parent?.parent.id === pai);
    porColecao[caminho] = documentos.length;
    for (const documento of documentos) linhas.push(linha(tabela, documento, documento.ref.parent.parent!.id));
    console.log(`  ${caminho}: ${documentos.length}`);
  }
  return { linhas, porColecao, ignoradas };
}

/** Só conta os documentos (consulta de agregação: ~1 leitura a cada 1.000 documentos). */
async function contarFirestore(db: Firestore) {
  const porColecao: Record<string, number> = {};
  for (const colecao of await db.listCollections()) {
    porColecao[colecao.id] = (await colecao.count().get()).data().count;
  }
  for (const caminho of Object.keys(TABELAS_SUBCOLECAO)) {
    const sub = caminho.split('/')[1];
    porColecao[`${caminho} (grupo)`] = (await db.collectionGroup(sub).count().get()).data().count;
  }
  const total = Object.values(porColecao).reduce((a, b) => a + b, 0);
  const semTabela = Object.keys(porColecao).filter(c => !c.includes('/') && !(c in TABELAS_RAIZ));
  console.log(JSON.stringify({ porColecao, total, semTabela }, null, 2));
}

if (process.argv.includes('--contar')) {
  try {
    await contarFirestore(abrirFirestore());
    process.exit(0);
  } catch (erro) {
    console.error('Contagem interrompida:', erro instanceof Error ? erro.message : erro);
    process.exit(1);
  }
}

try {
  console.log(aplicar ? 'Modo: APLICAR (substitui os dados do PostgreSQL).' : 'Modo: simulação (nada é gravado no PostgreSQL).');
  console.log('Lendo o Firestore...');
  const { linhas, porColecao, ignoradas } = await lerFirestore(abrirFirestore());

  const pasta = path.join(raizServer, '.private-backups');
  fs.mkdirSync(pasta, { recursive: true });
  const backup = path.join(pasta, `firestore-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backup, JSON.stringify(linhas), { flag: 'wx', mode: 0o600 });
  console.log(`\nTotal: ${linhas.length} documentos. Backup local (contém dados de clientes): ${backup}`);
  if (ignoradas.length) console.warn(`ATENÇÃO — coleções sem tabela correspondente, NÃO migradas: ${ignoradas.join(', ')}`);
  console.log(conversoes.size ? `Conversões: ${JSON.stringify(Object.fromEntries(conversoes), null, 2)}` : 'Nenhuma conversão de tipo foi necessária.');

  if (aplicar) {
    const configuracao = lerConfiguracaoPostgres(process.env, 'migracao');
    if (!configuracao) throw new Error('Configure DATABASE_URL ou POSTGRES_HOST para gravar.');
    const pool = criarPoolPostgres(configuracao);
    try {
      const divergencias = await substituirDados(pool, linhas);
      if (divergencias.length) {
        divergencias.slice(0, 50).forEach(d => console.error(`  ✗ ${d}`));
        throw new Error(`${divergencias.length} divergência(s) na conferência. Não faça a virada.`);
      }
      console.log(`Conferência ok: ${linhas.length} documentos idênticos ao Firestore.`);
    } finally {
      await pool.end();
    }
  }
  console.log(JSON.stringify({ porColecao }, null, 2));
  process.exit(0);
} catch (erro) {
  console.error('Migração interrompida:', erro instanceof Error ? erro.message : erro);
  process.exit(1);
}
