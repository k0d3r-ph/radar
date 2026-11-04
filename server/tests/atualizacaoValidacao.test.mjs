import assert from 'node:assert/strict';
import test from 'node:test';
import { AdicionarAtualizacaoValidacao } from '../dist/application/use-cases/AdicionarAtualizacaoValidacao.js';
import { OcorrenciasController } from '../dist/adapters/controllers/OcorrenciasController.js';

function database() {
  const data = new Map([
    ['ocorrencias/validacao-1', {
      tipo: 'Treinamento',
      validacaoTentativaId: 'tentativa-1',
      atualizacoes: [{ descricao: 'Primeiro registro', updatedAt: 1 }],
    }],
    ['ocorrencias/comum-1', { tipo: 'Informativa' }],
    ['usuarios/treinador-1', { role: 'treinador', nome: 'Treinador Radar' }],
  ]);
  const doc = path => ({ path, id: path.split('/').at(-1), get: async () => snapshot(doc(path)) });
  const snapshot = ref => ({
    ref,
    exists: data.has(ref.path),
    data: () => structuredClone(data.get(ref.path)),
  });
  return {
    data,
    collection: name => ({ doc: id => doc(`${name}/${id}`) }),
    runTransaction: callback => callback({
      get: async ref => snapshot(ref),
      update: (ref, payload) => data.set(ref.path, { ...data.get(ref.path), ...structuredClone(payload) }),
    }),
  };
}

function response() {
  return {
    code: 0,
    body: undefined,
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function usuariosRepoFrom(db) {
  return { buscarPorUid: async uid => db.data.get(`usuarios/${uid}`) };
}

test('adiciona atualização mantendo o histórico e confirma que o destino é uma ocorrência de validação', async () => {
  const db = database();
  const resultado = await new AdicionarAtualizacaoValidacao(db).execute(
    'validacao-1',
    'Reforçar os pontos da avaliação.',
    'Treinador Radar',
  );
  assert.equal(resultado.atualizacoes.length, 2);
  assert.equal(resultado.atualizacoes[0].descricao, 'Primeiro registro');
  assert.equal(resultado.atualizacoes[1].descricao, 'Reforçar os pontos da avaliação.');
  assert.equal(resultado.atualizacoes[1].responsavel, 'Treinador Radar');
  assert.equal(db.data.get('ocorrencias/validacao-1').updatedAt, resultado.updatedAt);
});

test('endpoint exige login, papel permitido, descrição válida e usuário ativo', async () => {
  const db = database();
  const controller = new OcorrenciasController(
    db,
    { verifyIdToken: async token => {
      if (token === 'inválido') throw new Error('invalid token');
      return { uid: token === 'master-token' ? 'master-1' : 'treinador-1' };
    } },
    usuariosRepoFrom(db),
  );
  const base = { params: { id: 'validacao-1' }, body: { descricao: 'Atualização' } };
  let res = response();
  await controller.adicionarAtualizacaoValidacao({ ...base, headers: {} }, res);
  assert.equal(res.code, 401);

  res = response();
  await controller.adicionarAtualizacaoValidacao({ ...base, headers: { authorization: 'Bearer inválido' } }, res);
  assert.equal(res.code, 401);

  res = response();
  await controller.adicionarAtualizacaoValidacao({ ...base, headers: { authorization: 'Bearer treinador-token' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.atualizacoes.at(-1).responsavel, 'Treinador Radar');

  db.data.set('usuarios/treinador-1', { role: 'cs', nome: 'Usuário CS' });
  res = response();
  await controller.adicionarAtualizacaoValidacao({ ...base, headers: { authorization: 'Bearer treinador-token' } }, res);
  assert.equal(res.code, 403);

  db.data.set('usuarios/treinador-1', { role: 'treinador', nome: 'Treinador Radar', inativo: true });
  res = response();
  await controller.adicionarAtualizacaoValidacao({ ...base, headers: { authorization: 'Bearer treinador-token' } }, res);
  assert.equal(res.code, 403);

  db.data.set('usuarios/master-1', { role: 'master', nome: 'Master Radar' });
  res = response();
  await controller.adicionarAtualizacaoValidacao({ ...base, headers: { authorization: 'Bearer master-token' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.atualizacoes.at(-1).responsavel, 'Master Radar');

  res = response();
  await controller.adicionarAtualizacaoValidacao({
    ...base,
    params: { id: 'validacao-1' },
    body: { descricao: ' ' },
    headers: { authorization: 'Bearer master-token' },
  }, res);
  assert.equal(res.code, 400);
});

test('endpoint não altera ocorrências comuns nem aceita ausência de serviço', async () => {
  const db = database();
  const controller = new OcorrenciasController(
    db,
    { verifyIdToken: async () => ({ uid: 'treinador-1' }) },
    usuariosRepoFrom(db),
  );
  const res = response();
  await controller.adicionarAtualizacaoValidacao({
    params: { id: 'comum-1' },
    body: { descricao: 'Atualização' },
    headers: { authorization: 'Bearer treinador-token' },
  }, res);
  assert.equal(res.code, 409);

  const unavailable = response();
  await new OcorrenciasController(null, null, null).adicionarAtualizacaoValidacao({}, unavailable);
  assert.equal(unavailable.code, 503);
});
