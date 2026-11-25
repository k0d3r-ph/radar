// Ponta a ponta sem navegador: o cliente real do app (app/src/services/dados.ts), com fetch e HTTP
// de verdade, contra o DadosController e o PostgreSQL. Só a validação do token do Firebase é simulada
// (o token é o próprio uid). Rodar com --experimental-vm-modules (script test:postgres).
import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import express from 'express';
import ts from 'typescript';
import { iniciarPostgresTeste } from './helpers/postgresTeste.mjs';
import { DadosController } from '../dist/adapters/controllers/DadosController.js';

let pg, servidor, url;
before(async () => {
  pg = await iniciarPostgresTeste();
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  const controller = new DadosController(pg.banco, { verifyIdToken: async token => ({ uid: token, email: `${token}@radar.test` }) });
  app.post('/api/dados/gravar', (req, res) => controller.gravar(req, res));
  app.post('/api/dados/:colecao/consultar', (req, res) => controller.consultar(req, res));
  app.get('/api/dados/:colecao/:id', (req, res) => controller.ler(req, res));
  await new Promise(resolve => { servidor = app.listen(0, '127.0.0.1', resolve); });
  url = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => { servidor?.close(); await pg?.encerrar(); });
beforeEach(async () => {
  await pg.limpar();
  await pg.semear([
    ['usuarios/master1', { role: 'master', nome: 'Master', email: 'master1@radar.test' }],
    ['usuarios/suporte1', { role: 'suporte', nome: 'Suporte', email: 'suporte1@radar.test' }],
    ['empresas/e1', { nomeEmpresa: 'Cliente', contador: 0, aplicacaoTemasDias: { '01-10': 2 } }],
    ['empresas/cancelada', { nomeEmpresa: 'Cancelada', isCancelled: true }],
    ['ocorrencias/o1', { empresa: 'Cliente', createdAt: 1 }],
    ['ocorrencias/o2', { empresa: 'Cliente', createdAt: 2 }],
    ['ocorrencias/o3', { empresa: 'Outro', createdAt: 3 }],
  ]);
});

const codigoCliente = ts.transpileModule(readFileSync(new URL('../../app/src/services/dados.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

/** Uma "aba do navegador" logada como `uid`. */
async function navegador(uid) {
  const context = createContext({ console, AbortSignal, JSON, Promise, Error, TypeError, structuredClone, crypto, setTimeout, fetch, Object, Array });
  const firebase = new SyntheticModule(['auth'], function () {
    this.setExport('auth', { currentUser: { uid, getIdToken: async () => uid } });
  }, { context });
  const config = new SyntheticModule(['RADAR_API_URL'], function () { this.setExport('RADAR_API_URL', url); }, { context });
  const modulo = new SourceTextModule(codigoCliente, { context });
  await modulo.link(nome => ({ './firebase': firebase, './apiConfig.ts': config })[nome]);
  await modulo.evaluate();
  return { d: modulo.namespace, db: { tipo: 'radar' } };
}
const banco = caminho => pg.banco.doc(caminho).get().then(s => s.data());

test('leitura, consulta, merge, update com caminho e deleteField pela API', async () => {
  const { d, db } = await navegador('suporte1');
  const empresa = await d.getDoc(d.doc(db, 'empresas', 'e1'));
  assert.equal(empresa.exists(), true);
  assert.equal(empresa.data().nomeEmpresa, 'Cliente');
  await d.setDoc(d.doc(db, 'empresas', 'e1'), { contato: { nome: 'Ana' } }, { merge: true });
  await d.updateDoc(d.doc(db, 'empresas', 'e1'), { 'aplicacaoTemasDias.01-10': d.deleteField(), 'contato.fone': '1' });
  assert.deepEqual(await banco('empresas/e1'), { nomeEmpresa: 'Cliente', contador: 0, aplicacaoTemasDias: {}, contato: { nome: 'Ana', fone: '1' } });

  const lista = await d.getDocs(d.query(d.collection(db, 'ocorrencias'), d.where('empresa', '==', 'Cliente'), d.orderBy('createdAt', 'desc'), d.limit(1)));
  assert.deepEqual(lista.docs.map(x => x.id), ['o2']);
  const nova = await d.addDoc(d.collection(db, 'ocorrencias'), { empresa: 'Cliente', descricao: 'Nova' });
  assert.equal((await banco(nova.path)).descricao, 'Nova');
});

test('transações de abas diferentes ao mesmo tempo não perdem atualizações', async () => {
  const abas = await Promise.all(['suporte1', 'suporte1', 'master1', 'master1'].map(navegador));
  let execucoes = 0;
  await Promise.all(abas.map(({ d, db }) => d.runTransaction(db, async tx => {
    execucoes++;
    const atual = await tx.get(d.doc(db, 'empresas', 'e1'));
    tx.update(d.doc(db, 'empresas', 'e1'), { contador: atual.data().contador + 1 });
  })));
  assert.equal((await banco('empresas/e1')).contador, 4);
  assert.ok(execucoes >= 4);
});

test('regras valem pela API: permissão negada chega ao app com o código do Firestore', async () => {
  const { d, db } = await navegador('suporte1');
  await assert.rejects(d.deleteDoc(d.doc(db, 'ocorrencias', 'o1')), e => e.code === 'permission-denied');
  await assert.rejects(d.setDoc(d.doc(db, 'empresas', 'cancelada'), { isCancelled: false }, { merge: true }), e => e.code === 'permission-denied');
  await assert.rejects(d.getDocs(d.collection(db, 'usuarios')), e => e.code === 'permission-denied');
  await assert.rejects(d.getDoc(d.doc(db, 'csatReservas', 'x')), e => e.code === 'permission-denied');
  // Lote com uma escrita negada não grava nada.
  const lote = d.writeBatch(db);
  lote.update(d.doc(db, 'empresas', 'e1'), { contador: 99 });
  lote.delete(d.doc(db, 'ocorrencias', 'o1'));
  await assert.rejects(lote.commit(), e => e.code === 'permission-denied');
  assert.equal((await banco('empresas/e1')).contador, 0);
  // Sem cadastro: nada é lido.
  const intruso = await navegador('intruso');
  await assert.rejects(intruso.d.getDoc(intruso.d.doc(intruso.db, 'empresas', 'e1')), e => e.code === 'permission-denied');
  const master = await navegador('master1');
  await master.d.deleteDoc(master.d.doc(master.db, 'ocorrencias', 'o1'));
  assert.equal(await banco('ocorrencias/o1'), undefined);
});

test('inativar o usuário corta o acesso na requisição seguinte', async () => {
  const { d, db } = await navegador('suporte1');
  await d.getDoc(d.doc(db, 'empresas', 'e1'));
  await pg.banco.doc('usuarios/suporte1').update({ inativo: true });
  await assert.rejects(d.getDoc(d.doc(db, 'empresas', 'e1')), e => e.code === 'permission-denied');
  // O próprio cadastro continua legível (o login avisa que a conta foi desativada).
  assert.equal((await d.getDoc(d.doc(db, 'usuarios', 'suporte1'))).data().inativo, true);
});

test('updateDoc com FieldPath do app grava nome de tema com ponto como uma chave só', async () => {
  const { d, db } = await navegador('suporte1');
  await d.updateDoc(d.doc(db, 'empresas', 'e1'),
    new d.FieldPath('updatedAt'), 5,
    new d.FieldPath('aplicacaoTemasDias', 'Cadastro v2.0'), 3,
    new d.FieldPath('aplicacaoTemasDias', '01-10'), d.deleteField());
  assert.deepEqual((await banco('empresas/e1')).aplicacaoTemasDias, { 'Cadastro v2.0': 3 });
  assert.equal((await banco('empresas/e1')).updatedAt, 5);
  // Forma em texto continua separando por ponto, como no Firestore.
  await d.updateDoc(d.doc(db, 'empresas', 'e1'), 'contato.nome', 'Ana');
  assert.deepEqual((await banco('empresas/e1')).contato, { nome: 'Ana' });
});
