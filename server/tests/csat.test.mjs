import test from 'node:test';
import assert from 'node:assert/strict';
import { registrarCsat, validarResposta } from '../dist/infrastructure/web/csat.js';

function setup() {
  const data = new Map([
    ['usuarios/u1', { role: 'treinador', nome: 'Pedro' }],
    ['usuarios/u2', { role: 'treinador', nome: 'Jean' }],
    ['usuarios/u3', { role: 'suporte' }],
    ['empresas/e1', { nomeEmpresa: 'Cliente' }],
  ]);
  let seq = 0;
  const snapshot = ref => ({ exists: data.has(ref.path), id: ref.id, data: () => data.get(ref.path) });
  const ref = path => ({ path, id: path.split('/').at(-1), get: async () => snapshot(ref(path)), collection: name => collection(`${path}/${name}`) });
  const collection = path => ({
    doc: id => ref(`${path}/${id || `id${++seq}`}`),
    where: (field, op, value) => ({ get: async () => ({ docs: [...data.entries()]
      .filter(([key, item]) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1 && item[field] === value)
      .map(([key]) => snapshot(ref(key))) }) }),
  });
  const db = { collection, doc: ref, runTransaction: async fn => fn({
    get: async r => r.path ? snapshot(r) : r.get(),
    set: (r, value, options) => data.set(r.path, options?.merge ? { ...data.get(r.path), ...value } : value),
    update: (r, value) => { assert.ok(data.has(r.path)); data.set(r.path, { ...data.get(r.path), ...value }); },
  }) };
  const routes = new Map();
  registrarCsat({ get: (p, fn) => routes.set(`GET ${p}`, fn), post: (p, fn) => routes.set(`POST ${p}`, fn) }, db,
    { verifyIdToken: async token => { if (!data.has(`usuarios/${token}`)) throw Error(); return { uid: token }; } });
  const call = async (route, body, params = {}, uid = 'u1') => {
    let status = 200, result;
    const res = { set() {}, status(code) { status = code; return this; }, json(value) { result = value; } };
    await routes.get(route)({ body, params, headers: { authorization: `Bearer ${uid}` } }, res);
    return { status, result };
  };
  return { data, call };
}

test('valida campos obrigatórios e limite da opinião no servidor', () => {
  const body = { nome: 'Ana', experiencia: 'Bom', opiniao: '', responseId: '12345678-12345678' };
  assert.equal(validarResposta(body).nome, 'Ana');
  for (const override of [{ nome: ' ' }, { experiencia: 'Ótimo' }, { opiniao: 'x'.repeat(101) }, { responseId: '../invalid' }]) {
    assert.throws(() => validarResposta({ ...body, ...override }));
  }
});
test('reserva ID único, restringe criação e lista apenas reservas do criador', async () => {
  const { call, data } = setup();
  assert.equal((await call('POST /api/csat/reservas', { empresaId: 'e1' }, {}, 'u3')).status, 403);
  const a = (await call('POST /api/csat/reservas', { empresaId: 'e1' })).result;
  const b = (await call('POST /api/csat/reservas', { empresaId: 'e1' }, {}, 'u2')).result;
  assert.notEqual(a.idSeqFormatted, b.idSeqFormatted);
  assert.deepEqual((await call('GET /api/csat/reservas')).result.map(r => r.id), [a.id]);
  assert.equal(data.has(`ocorrencias/${a.id}`), false);
  assert.equal((await call('POST /api/csat/reservas/:id/concluir', {}, { id: a.id }, 'u2')).status, 404);
  assert.equal((await call('POST /api/csat/reservas/:id/concluir', { empresa: 'Outro', tipo: 'Treinamento', departamento: 'Treinamento', descricao: 'Realizado', dataOcorrencia: Date.now() }, { id: a.id })).status, 400);
  assert.equal((await call('GET /api/csat/reservas', undefined, {}, '')).status, 401);
});
test('vincula respostas antes e depois da conclusão, sem duplicar reenvio', async () => {
  const { call, data } = setup();
  const reserva = (await call('POST /api/csat/reservas', { empresaId: 'e1' })).result;
  const body = { nome: 'Ana', experiencia: 'Bom', opiniao: 'Excelente', responseId: '12345678-12345678' };
  const params = { token: reserva.token };
  assert.deepEqual((await call('GET /api/csat/publico/:token', undefined, params, '')).result, { disponivel: true });
  assert.equal((await call('POST /api/csat/publico/:token', body, params, '')).status, 200);
  await call('POST /api/csat/publico/:token', body, params, '');
  const completed = await call('POST /api/csat/reservas/:id/concluir', { empresa: 'Cliente', tipo: 'Treinamento', departamento: 'Treinamento', descricao: 'Realizado', dataOcorrencia: Date.now() }, { id: reserva.id });
  assert.equal(completed.status, 200);
  assert.deepEqual(data.get(`ocorrencias/${reserva.id}`).treinamentoResultados, ['Bom']);
  await call('POST /api/csat/publico/:token', { ...body, nome: 'Carlos', experiencia: 'Ruim', responseId: '87654321-87654321' }, params, '');
  assert.deepEqual(data.get(`ocorrencias/${reserva.id}`).treinamentoResultados, ['Bom', 'Ruim']);
  assert.equal(data.get(`ocorrencias/${reserva.id}`).csatRespostas[0].opiniao, 'Excelente');
  await call('POST /api/csat/reservas/:id/concluir', { descricao: 'Reenvio' }, { id: reserva.id });
  assert.equal(data.get(`ocorrencias/${reserva.id}`).descricao, 'Realizado');
  assert.deepEqual((await call('GET /api/csat/reservas')).result, []);
  data.delete(`ocorrencias/${reserva.id}`);
  assert.equal((await call('POST /api/csat/publico/:token', { ...body, responseId: '11111111-11111111' }, params, '')).status, 410);
});
test('link inválido não permite ler ou escrever avaliações', async () => {
  const { call } = setup();
  assert.equal((await call('GET /api/csat/publico/:token', undefined, { token: 'x'.repeat(64) }, '')).status, 404);
});
test('bloqueia novos links por treinador até concluir a reserva, inclusive para outro cliente', async () => {
  const { call, data } = setup();
  data.set('empresas/e2', { nomeEmpresa: 'Outro cliente' });
  const reserva = (await call('POST /api/csat/reservas', { empresaId: 'e1' })).result;
  assert.equal((await call('POST /api/csat/reservas', { empresaId: 'e1' })).status, 409);
  assert.equal((await call('POST /api/csat/reservas', { empresaId: 'e2' })).status, 409);
  assert.equal(data.get('csatControle/sequencia').ultimo, 1);
  assert.equal((await call('POST /api/csat/reservas', { empresaId: 'e1' }, {}, 'u2')).status, 200);
  await call('POST /api/csat/reservas/:id/concluir', { empresa: 'Cliente', tipo: 'Treinamento', departamento: 'Treinamento', descricao: 'Realizado', dataOcorrencia: Date.now() }, { id: reserva.id });
  assert.equal((await call('POST /api/csat/reservas', { empresaId: 'e2' })).status, 200);
});
