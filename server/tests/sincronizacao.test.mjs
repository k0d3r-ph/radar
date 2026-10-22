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
      listeners.get(nome).callback({ docs: documentos.map(({ id, versao = 1 }) => ({
        id, updateTime: { seconds: versao, nanoseconds: 123 },
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
const req = colecao => ({ params: { colecao }, headers: { authorization: 'Bearer token' } });
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
