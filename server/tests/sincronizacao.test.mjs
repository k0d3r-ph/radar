import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { IndiceSincronizacao } from '../dist/infrastructure/postgres/IndiceSincronizacao.js';
import { SincronizacaoController } from '../dist/adapters/controllers/SincronizacaoController.js';
import { iniciarPostgresTeste } from './helpers/postgresTeste.mjs';

let pg, banco;
before(async () => { pg = await iniciarPostgresTeste(); banco = pg.banco; });
after(async () => { await pg?.encerrar(); });
beforeEach(async () => { await pg.limpar(); });

const novoIndice = () => new IndiceSincronizacao(pg.pool, { intervaloMinimoMs: 0, esperaAposErroMs: 50 });

// ---------------------------------------------------------------- índice

test('primeira leitura carrega a coleção; as seguintes trazem só mudanças, inclusive exclusões', async () => {
  await pg.semear([['ocorrencias/a', { titulo: 'A' }], ['ocorrencias/b', { titulo: 'B' }]]);
  const indice = novoIndice();
  const inicial = await indice.listar('ocorrencias');
  assert.deepEqual(inicial.map(d => d.id), ['a', 'b']);

  await banco.doc('ocorrencias/b').update({ titulo: 'B2' });
  await banco.doc('ocorrencias/a').delete();
  await banco.doc('ocorrencias/c').set({ titulo: 'C' });
  const depois = await indice.listar('ocorrencias');
  assert.deepEqual(depois.map(d => d.id), ['b', 'c']);
  assert.notEqual(depois[0].versao, inicial[1].versao);
  assert.deepEqual(await indice.dados('ocorrencias'), [{ titulo: 'B2', id: 'b' }, { titulo: 'C', id: 'c' }]);

  // Documento excluído e recriado continua no índice com a nova versão.
  await banco.doc('ocorrencias/c').delete();
  await banco.doc('ocorrencias/c').set({ titulo: 'C2' });
  assert.deepEqual((await indice.dados('ocorrencias')).find(d => d.id === 'c'), { titulo: 'C2', id: 'c' });
});

test('gravação confirmada depois da leitura, mas iniciada antes, não é perdida', async () => {
  await pg.semear([['empresas/e1', { n: 0 }]]);
  const indice = novoIndice();
  await indice.listar('empresas');

  // Transação lenta: grava (recebe o xid) e só confirma depois de uma leitura do índice.
  const lenta = await pg.pool.connect();
  await lenta.query('begin');
  await lenta.query(`insert into empresas (id, dados) values ('lenta', '{"n":1}')`);
  await banco.doc('empresas/rapida').set({ n: 2 });
  assert.deepEqual((await indice.listar('empresas')).map(d => d.id), ['e1', 'rapida']);
  await lenta.query('commit');
  lenta.release();
  assert.deepEqual((await indice.listar('empresas')).map(d => d.id), ['e1', 'lenta', 'rapida']);
});

test('chamadas concorrentes compartilham a mesma consulta ao banco', async () => {
  await pg.semear([['checklist_tarefas/t1', {}]]);
  const indice = new IndiceSincronizacao(pg.pool, { intervaloMinimoMs: 60_000 });
  const [a, b] = await Promise.all([indice.listar('checklist_tarefas'), indice.listar('checklist_tarefas')]);
  assert.deepEqual(a, b);
  await banco.doc('checklist_tarefas/t2').set({});
  // Dentro do intervalo mínimo, reutiliza a memória.
  assert.equal((await indice.listar('checklist_tarefas')).length, 1);
});

test('falha no banco é informada, não serve índice desatualizado e permite nova tentativa', async () => {
  await pg.semear([['empresas/e1', {}]]);
  const indice = novoIndice();
  await indice.listar('empresas');
  await pg.pool.query('alter table empresas rename to empresas_tmp');
  try {
    await assert.rejects(indice.listar('empresas'), /empresas/);
    await assert.rejects(indice.listar('empresas'), /empresas/); // dentro da espera: mesmo erro, sem consultar
  } finally {
    await pg.pool.query('alter table empresas_tmp rename to empresas');
  }
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.deepEqual((await indice.listar('empresas')).map(d => d.id), ['e1']);
});

// ---------------------------------------------------------------- controller

function response() {
  return { code: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}
const req = (colecao, body) => ({ params: { colecao }, headers: { authorization: 'Bearer token' }, body });
const auth = { verifyIdToken: async () => ({ uid: 'u1' }) };
const repo = usuario => ({ buscarPorUid: async () => usuario });

test('API bloqueia tokens inválidos, usuários não cadastrados e coleções privadas', async () => {
  for (const [usuario, tokenAuth, request, status] of [
    [{ role: 'treinador' }, { verifyIdToken: async () => { throw new Error('token'); } }, req('ocorrencias'), 401],
    [{ role: 'treinador' }, auth, req('csatReservas'), 400],
    [undefined, auth, req('ocorrencias'), 403],
    [{ role: 'treinador', needsPasswordChange: true }, auth, req('ocorrencias'), 403],
    [{ role: 'desconhecido' }, auth, req('empresas'), 403],
    [{ role: 'cs' }, auth, req('gamificacao_pontos'), 403],
    [{ role: 'cs' }, auth, req('validacao_tentativas'), 403],
    [{ role: 'treinador' }, auth, { params: { colecao: 'ocorrencias' }, headers: {} }, 401],
  ]) {
    for (const metodo of ['listar', 'documentos']) {
      const res = response();
      await new SincronizacaoController(tokenAuth, repo(usuario), novoIndice())[metodo](request, res);
      assert.equal(res.code, status, `${metodo} ${request.params.colecao} ${JSON.stringify(usuario)}`);
    }
  }
});

test('sem banco configurado, a sincronização responde 503', async () => {
  const res = response();
  await new SincronizacaoController(auth, repo({ role: 'master' }), null).listar(req('ocorrencias'), res);
  assert.equal(res.code, 503);
});

test('listar retorna IDs e versões sem cache; documentos filtra por IDs e valida o formato', async () => {
  await pg.semear([['ocorrencias/a', { titulo: 'Dúvida' }], ['ocorrencias/b', { titulo: 'Problema' }]]);
  const controller = new SincronizacaoController(auth, repo({ role: 'treinador' }), novoIndice());

  const lista = response();
  await controller.listar(req('ocorrencias'), lista);
  assert.equal(lista.code, 200);
  assert.equal(lista.headers['Cache-Control'], 'no-store');
  assert.deepEqual(lista.body.documentos.map(d => d.id), ['a', 'b']);
  assert.ok(lista.body.documentos.every(d => /^\d+$/.test(d.versao)));

  const todos = response();
  await controller.documentos(req('ocorrencias', {}), todos);
  assert.deepEqual(todos.body, { documentos: [{ titulo: 'Dúvida', id: 'a' }, { titulo: 'Problema', id: 'b' }] });

  const filtrada = response();
  await controller.documentos(req('ocorrencias', { ids: ['a'] }), filtrada);
  assert.deepEqual(filtrada.body, { documentos: [{ titulo: 'Dúvida', id: 'a' }] });

  const invalida = response();
  await controller.documentos(req('ocorrencias', { ids: 'a' }), invalida);
  assert.equal(invalida.code, 400);
});

test('validacao_tentativas: liberada para master/treinador, bloqueada para os demais perfis', async () => {
  await pg.semear([['validacao_tentativas/t1', { empresaId: 'e1', aprovada: true }]]);
  const res = response();
  await new SincronizacaoController(auth, repo({ role: 'master' }), novoIndice()).documentos(req('validacao_tentativas', {}), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { documentos: [{ empresaId: 'e1', aprovada: true, id: 't1' }] });
  const bloqueada = response();
  await new SincronizacaoController(auth, repo({ role: 'suporte' }), novoIndice()).documentos(req('validacao_tentativas', {}), bloqueada);
  assert.equal(bloqueada.code, 403);
});
