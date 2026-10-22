import assert from 'node:assert/strict';
import test from 'node:test';
import { SetOcorrenciaFavorita, podeFavoritar } from '../dist/application/use-cases/SetOcorrenciaFavorita.js';
import { OcorrenciasController } from '../dist/adapters/controllers/OcorrenciasController.js';

function database() {
  const data = new Map([
    ['empresas/e1', { nomeEmpresa: 'Cliente A' }], ['empresas/e2', { nomeEmpresa: 'Cliente B' }],
    ...['a', 'b', 'c', 'd', 'e'].map(id => [`ocorrencias/${id}`, { empresa: 'Cliente A' }]),
    ['ocorrencias/z', { empresa: 'Cliente B' }], ['usuarios/u1', { role: 'treinador' }],
  ]);
  const snapshot = ref => ({ ref, id: ref.id, exists: data.has(ref.path), data: () => structuredClone(data.get(ref.path)) });
  const doc = path => ({ path, id: path.split('/').at(-1), get: async () => snapshot(doc(path)) });
  const getQuery = (name, campo, valor) => {
    const refs = [...data.keys()].filter(path => path.startsWith(`${name}/`) && (!campo || data.get(path)[campo] === valor)).map(doc);
    return { empty: !refs.length, docs: refs.map(snapshot) };
  };
  let queue = Promise.resolve();
  return {
    data,
    collection: name => ({ doc: id => doc(`${name}/${id}`), get: async () => getQuery(name),
      where: (campo, operador, valor) => ({ get: async () => getQuery(name, campo, valor) }) }),
    runTransaction(callback) {
      const job = queue.then(async () => {
        const writes = [];
        const value = await callback({
          get: async ref => snapshot(ref), getAll: async (...refs) => refs.map(snapshot),
          set: (ref, payload) => writes.push(() => data.set(ref.path, structuredClone(payload))),
          update: (ref, payload) => writes.push(() => data.set(ref.path, { ...data.get(ref.path), ...payload })),
        });
        writes.forEach(write => write());
        return value;
      });
      queue = job.catch(() => {});
      return job;
    },
  };
}

test('somente treinadores e masters podem marcar e desmarcar estrelas', async () => {
  for (const role of ['suporte', 'cs', 'hardware', 'financeiro', 'comercial', 'painel', '']) {
    assert.equal(podeFavoritar(role), false);
    const db = database();
    const before = structuredClone([...db.data]);
    await assert.rejects(new SetOcorrenciaFavorita(db).execute('a', true, 'u1', role), error => error.status === 403);
    assert.deepEqual([...db.data], before);
  }
  for (const role of ['master', 'treinador']) assert.equal(podeFavoritar(role), true);
});

test('limite de três é compartilhado entre usuários e separado por cliente', async () => {
  const db = database(), usecase = new SetOcorrenciaFavorita(db);
  await usecase.execute('a', true, 'treinador-1', 'treinador');
  await usecase.execute('b', true, 'master-1', 'master');
  await usecase.execute('c', true, 'treinador-2', 'treinador');
  await assert.rejects(usecase.execute('d', true, 'u1', 'master'), error => error.status === 409);
  await usecase.execute('z', true, 'u1', 'master');
  assert.deepEqual(db.data.get('favoritosOcorrencias/e1').ocorrenciaIds, ['a', 'b', 'c']);
  assert.deepEqual(db.data.get('favoritosOcorrencias/e2').ocorrenciaIds, ['z']);
});

test('duas marcações concorrentes disputando a última vaga não ultrapassam três', async () => {
  const db = database(), usecase = new SetOcorrenciaFavorita(db);
  await usecase.execute('a', true, 'u1', 'master');
  await usecase.execute('b', true, 'u1', 'master');
  const resultados = await Promise.allSettled([usecase.execute('c', true, 'u1', 'treinador'), usecase.execute('d', true, 'u2', 'master')]);
  assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(db.data.get('favoritosOcorrencias/e1').ocorrenciaIds.length, 3);
});

test('desmarcar libera vaga e repetição da marcação não duplica o contador', async () => {
  const db = database(), usecase = new SetOcorrenciaFavorita(db);
  for (const id of ['a', 'b', 'c']) await usecase.execute(id, true, 'u1', 'master');
  await usecase.execute('a', true, 'u1', 'master');
  assert.equal(db.data.get('favoritosOcorrencias/e1').ocorrenciaIds.length, 3);
  await usecase.execute('a', false, 'u2', 'treinador');
  assert.equal(db.data.get('ocorrencias/a').favorita, false);
  assert.equal(db.data.get('ocorrencias/a').favoritadaEm, null);
  await usecase.execute('d', true, 'u1', 'master');
  assert.equal(db.data.get('ocorrencias/d').favoritadaPor, 'u1');
});

test('excluir uma ocorrência com estrela libera sua vaga na próxima marcação', async () => {
  const db = database(), usecase = new SetOcorrenciaFavorita(db);
  for (const id of ['a', 'b', 'c']) await usecase.execute(id, true, 'u1', 'master');
  db.data.delete('ocorrencias/a');
  await usecase.execute('d', true, 'u1', 'master');
  assert.deepEqual(db.data.get('favoritosOcorrencias/e1').ocorrenciaIds, ['b', 'c', 'd']);
});

test('ocorrência ausente ou sem cliente único não gera marcação', async () => {
  const db = database(), usecase = new SetOcorrenciaFavorita(db);
  await assert.rejects(usecase.execute('nao-existe', true, 'u1', 'master'), error => error.status === 404);
  db.data.set('empresas/e3', { nomeEmpresa: 'Cliente A' });
  await assert.rejects(usecase.execute('a', true, 'u1', 'master'), error => error.status === 409);
});

function response() { return { code: 0, body: undefined, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }

function usuariosRepoFrom(db) {
  return { buscarPorUid: async uid => (await db.collection('usuarios').doc(uid).get()).data() };
}

test('endpoint exige autenticação e lê perfil do cadastro, ignorando papel enviado pelo navegador', async () => {
  const db = database();
  const controller = new OcorrenciasController(db, { verifyIdToken: async () => ({ uid: 'u1' }) }, usuariosRepoFrom(db));
  const req = { headers: {}, params: { id: 'a' }, body: { favorita: true, role: 'master' } };
  const res = response();
  await controller.definirFavorita(req, res);
  assert.equal(res.code, 401);
  db.data.get('usuarios/u1').role = 'suporte';
  await controller.definirFavorita({ ...req, headers: { authorization: 'Bearer token' } }, res);
  assert.equal(res.code, 403);
  db.data.get('usuarios/u1').role = 'treinador';
  await controller.definirFavorita({ ...req, headers: { authorization: 'Bearer token' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.favorita, true);
});

test('token inválido, entrada inválida e backend sem credenciais retornam erro', async () => {
  const db = database(), req = { headers: { authorization: 'Bearer token' }, params: { id: 'a' }, body: { favorita: 'true' } };
  const res = response();
  await new OcorrenciasController(db, { verifyIdToken: async () => { throw Error('Invalid'); } }, usuariosRepoFrom(db)).definirFavorita(req, res);
  assert.equal(res.code, 401);
  await new OcorrenciasController(db, { verifyIdToken: async () => ({ uid: 'u1' }) }, usuariosRepoFrom(db)).definirFavorita(req, res);
  assert.equal(res.code, 400);
  await new OcorrenciasController(null, null, null).definirFavorita(req, res);
  assert.equal(res.code, 503);
});
