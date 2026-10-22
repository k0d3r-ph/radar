import assert from 'node:assert/strict';
import test from 'node:test';
import { RemoverPontoTreinamentoExcedente } from '../dist/application/use-cases/RemoverPontoTreinamentoExcedente.js';
import { GamificacaoController } from '../dist/adapters/controllers/GamificacaoController.js';

function database() {
  const data = new Map([
    ['gamificacao_pontos/valido', { tipoAcao: 'treinamento', pontos: 1 }],
    ['gamificacao_pontos/excedente', { tipoAcao: 'treinamento', pontos: 1, ocorrenciaId: 'o1' }],
    ['gamificacao_pontos/manual', { tipoAcao: 'nova_doc', pontos: 3 }],
    ['ocorrencias/o1', { gamificacaoPontoId: 'valido', empresa: 'Alltech' }],
    ['csatReservas/r1', { gamificacaoPontoId: 'valido', status: 'concluida' }],
  ]);
  const collection = name => ({
    doc: id => ({ path: `${name}/${id}` }),
    where: (campo, op, valor) => ({ limit: () => ({ name, campo, valor }) }),
  });
  return { data, collection, runTransaction: async callback => {
    const writes = [];
    const result = await callback({
      get: async ref => ref.path
        ? { exists: data.has(ref.path), data: () => structuredClone(data.get(ref.path)) }
        : { empty: ![...data].some(([path, value]) => path.startsWith(`${ref.name}/`) && value[ref.campo] === ref.valor) },
      delete: ref => writes.push(() => data.delete(ref.path)),
    });
    writes.forEach(write => write());
    return result;
  } };
}

test('remove excedente mesmo com ocorrenciaId incorreto, preservando ocorrência, reserva e ponto oficial', async () => {
  const db = database();
  const before = structuredClone([...db.data].filter(([path]) => path !== 'gamificacao_pontos/excedente'));
  await new RemoverPontoTreinamentoExcedente(db).execute('excedente', 'master');
  assert.deepEqual([...db.data], before);
  await new RemoverPontoTreinamentoExcedente(db).execute('excedente', 'master');
  assert.deepEqual([...db.data], before);
});

test('bloqueia vínculo oficial em ocorrência ou reserva, inclusive reserva pendente', async () => {
  for (const origem of ['ocorrencias/o2', 'csatReservas/r2']) {
    const db = database();
    db.data.set(origem, { gamificacaoPontoId: 'excedente', status: 'reservada' });
    const before = structuredClone([...db.data]);
    await assert.rejects(new RemoverPontoTreinamentoExcedente(db).execute('excedente', 'master'), e => e.status === 409);
    assert.deepEqual([...db.data], before);
  }
});

test('somente master pode excluir e a rota não exclui lançamentos manuais', async () => {
  const db = database(), action = new RemoverPontoTreinamentoExcedente(db);
  for (const role of ['treinador', 'cs', 'suporte', 'painel', '']) {
    await assert.rejects(action.execute('excedente', role), e => e.status === 403);
  }
  await assert.rejects(action.execute('manual', 'master'), e => e.status === 400);
  await assert.rejects(action.execute('a/b', 'master'), e => e.status === 400);
  assert.equal(db.data.size, 5);
});

function response() { return { code: 0, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
test('endpoint exige token válido e usa perfil do cadastro, ignorando perfil do navegador', async () => {
  const db = database(), auth = { verifyIdToken: async () => ({ uid: 'u1' }) };
  const repo = { buscarPorUid: async () => ({ role: 'treinador' }) };
  const controller = new GamificacaoController(db, auth, repo);
  const req = { headers: {}, params: { id: 'excedente' }, body: { role: 'master' } }, res = response();
  await controller.removerPontoExcedente(req, res);
  assert.equal(res.code, 401);
  req.headers.authorization = 'Bearer token';
  await controller.removerPontoExcedente(req, res);
  assert.equal(res.code, 403);
  await new GamificacaoController(db, { verifyIdToken: async () => { throw Error(); } }, repo).removerPontoExcedente(req, res);
  assert.equal(res.code, 401);
  await new GamificacaoController(null, null, null).removerPontoExcedente(req, res);
  assert.equal(res.code, 503);
  await new GamificacaoController(db, auth, { buscarPorUid: async () => ({ role: 'master' }) }).removerPontoExcedente(req, res);
  assert.equal(res.code, 200);
  assert.equal(db.data.has('gamificacao_pontos/excedente'), false);
});
