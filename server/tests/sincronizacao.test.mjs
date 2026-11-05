import assert from 'node:assert/strict';
import test from 'node:test';
import { IndiceSincronizacao } from '../dist/infrastructure/firebase/IndiceSincronizacao.js';
import { SincronizacaoController } from '../dist/adapters/controllers/SincronizacaoController.js';

function database(usuario = { role: 'treinador' }) {
  const listeners = new Map();
  let inscricoes = 0;
  let cancelamentos = 0;
  return {
    listeners,
    inscricoes: () => inscricoes,
    cancelamentos: () => cancelamentos,
    collection: nome => ({
      doc: () => ({ get: async () => ({ data: () => usuario }) }),
      onSnapshot: (callback, erro) => {
        inscricoes++;
        listeners.set(nome, { callback, erro });
        return () => { cancelamentos++; listeners.delete(nome); };
      },
    }),
    emitir(nome, documentos) {
      listeners.get(nome).callback({ docs: documentos.map(({ id, versao = 1, dados = {} }) => ({
        id, updateTime: { seconds: versao, nanoseconds: 123 },
        data: () => dados,
      })) });
    },
  };
}

test('primeira resposta aguarda snapshot; chamadas concorrentes reutilizam listener', async () => {
  const db = database(), indice = new IndiceSincronizacao(db);
  const primeira = indice.listar('ocorrencias');
  const segunda = indice.listar('ocorrencias');
  assert.equal(db.inscricoes(), 1);
  db.emitir('ocorrencias', [{ id: 'a' }, { id: 'b' }]);
  assert.deepEqual(await primeira, await segunda);
  db.emitir('ocorrencias', [{ id: 'b', versao: 2 }, { id: 'c' }]);
  assert.deepEqual(await indice.listar('ocorrencias'), [{ id: 'b', versao: '2:123' }, { id: 'c', versao: '1:123' }]);
  assert.equal(db.inscricoes(), 1);
  assert.deepEqual(await indice.dados('ocorrencias'), [{ id: 'b' }, { id: 'c' }]);
  indice.encerrar();
  assert.equal(db.cancelamentos(), 1);
});

test('erro inicial bloqueia repetição imediata e não retorna índice vazio como sucesso', async () => {
  const db = database(), indice = new IndiceSincronizacao(db);
  const primeira = indice.listar('empresas');
  db.listeners.get('empresas').erro(new Error('quota'));
  await assert.rejects(primeira, /quota/);
  await assert.rejects(indice.listar('empresas'), /quota/);
  assert.equal(db.inscricoes(), 1);
});

test('erro depois do snapshot impede servir índice desatualizado', async () => {
  const db = database(), indice = new IndiceSincronizacao(db);
  const primeira = indice.listar('empresas');
  db.emitir('empresas', [{ id: 'e1' }]);
  await primeira;
  db.listeners.get('empresas').erro(new Error('offline'));
  await assert.rejects(indice.listar('empresas'), /offline/);
});

test('falha ao iniciar listener não deixa solicitações seguintes aguardando para sempre', async () => {
  const db = { collection: () => ({ onSnapshot() { throw new Error('inicialização'); } }) };
  const indice = new IndiceSincronizacao(db);
  await assert.rejects(indice.listar('empresas'), /inicialização/);
  await assert.rejects(indice.listar('empresas'), /inicialização/);
});

function response() {
  return { code: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}
const req = (colecao, body) => ({ params: { colecao }, headers: { authorization: 'Bearer token' }, body });
const auth = { verifyIdToken: async () => ({ uid: 'u1' }) };
const usuariosRepoFrom = db => ({ buscarPorUid: async uid => (await db.collection('usuarios').doc(uid).get()).data() });

test('API bloqueia tokens inválidos, usuários não cadastrados e coleções privadas', async () => {
  for (const [db, tokenAuth, request, status] of [
    [database(), { verifyIdToken: async () => { throw new Error('token'); } }, req('ocorrencias'), 401],
    [database(undefined), auth, req('csatReservas'), 400],
    [database(null), auth, req('ocorrencias'), 403],
    [database({ role: 'treinador', needsPasswordChange: true }), auth, req('ocorrencias'), 403],
    [database({ role: 'desconhecido' }), auth, req('empresas'), 403],
    [database({ role: 'cs' }), auth, req('gamificacao_pontos'), 403],
    [database({ role: 'cs' }), auth, req('validacao_tentativas'), 403],
    [database(), auth, { params: { colecao: 'ocorrencias' }, headers: {} }, 401],
  ]) {
    const res = response();
    await new SincronizacaoController(db, tokenAuth, usuariosRepoFrom(db)).listar(request, res);
    assert.equal(res.code, status);
    assert.equal(db.inscricoes(), 0);
  }
});

test('API retorna somente IDs e versões e desabilita cache HTTP', async () => {
  const db = database(), controller = new SincronizacaoController(db, auth, usuariosRepoFrom(db)), res = response();
  const chamada = controller.listar(req('ocorrencias'), res);
  await new Promise(resolve => setImmediate(resolve));
  db.emitir('ocorrencias', [{ id: 'a' }]);
  await chamada;
  assert.equal(res.code, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.deepEqual(res.body, { documentos: [{ id: 'a', versao: '1:123' }] });
});

test('rota de documentos também bloqueia tokens inválidos, usuários não cadastrados e coleções privadas', async () => {
  for (const [db, tokenAuth, request, status] of [
    [database(), { verifyIdToken: async () => { throw new Error('token'); } }, req('ocorrencias'), 401],
    [database(undefined), auth, req('csatReservas'), 400],
    [database(null), auth, req('ocorrencias'), 403],
    [database({ role: 'cs' }), auth, req('gamificacao_pontos'), 403],
    [database({ role: 'cs' }), auth, req('validacao_tentativas'), 403],
  ]) {
    const res = response();
    await new SincronizacaoController(db, tokenAuth, usuariosRepoFrom(db)).documentos(request, res);
    assert.equal(res.code, status);
  }
});

test('rota de documentos serve o conteúdo já em memória, filtra por IDs e valida o formato', async () => {
  const db = database(), controller = new SincronizacaoController(db, auth, usuariosRepoFrom(db));
  const res = response();
  const chamada = controller.documentos(req('ocorrencias', {}), res);
  await new Promise(resolve => setImmediate(resolve));
  db.emitir('ocorrencias', [{ id: 'a', dados: { titulo: 'Dúvida' } }, { id: 'b', dados: { titulo: 'Problema' } }]);
  await chamada;
  assert.equal(res.code, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.deepEqual(res.body, { documentos: [{ id: 'a', titulo: 'Dúvida' }, { id: 'b', titulo: 'Problema' }] });
  assert.equal(db.inscricoes(), 1); // Nenhuma nova inscrição: reaproveitou o listener já aberto.

  const resFiltrada = response();
  await controller.documentos(req('ocorrencias', { ids: ['a'] }), resFiltrada);
  assert.deepEqual(resFiltrada.body, { documentos: [{ id: 'a', titulo: 'Dúvida' }] });

  const resInvalida = response();
  await controller.documentos(req('ocorrencias', { ids: 'a' }), resInvalida);
  assert.equal(resInvalida.code, 400);
});

test('validacao_tentativas: liberada para master/treinador, bloqueada para os demais perfis', async () => {
  const db = database({ role: 'master' }), controller = new SincronizacaoController(db, auth, usuariosRepoFrom(db));
  const res = response();
  const chamada = controller.documentos(req('validacao_tentativas', {}), res);
  await new Promise(resolve => setImmediate(resolve));
  db.emitir('validacao_tentativas', [{ id: 't1', dados: { empresaId: 'e1', aprovada: true } }]);
  await chamada;
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { documentos: [{ id: 't1', empresaId: 'e1', aprovada: true }] });

  const dbSuporte = database({ role: 'suporte' });
  const resBloqueada = response();
  await new SincronizacaoController(dbSuporte, auth, usuariosRepoFrom(dbSuporte)).documentos(req('validacao_tentativas', {}), resBloqueada);
  assert.equal(resBloqueada.code, 403);
  assert.equal(dbSuporte.inscricoes(), 0);
});
