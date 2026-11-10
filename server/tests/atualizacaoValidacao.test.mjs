import assert from 'node:assert/strict';
import test from 'node:test';
import { AdicionarAtualizacaoValidacao } from '../dist/application/use-cases/AdicionarAtualizacaoValidacao.js';
import { OcorrenciasController } from '../dist/adapters/controllers/OcorrenciasController.js';
import { EditarOcorrenciaValidacao, lerPedidoEdicaoOcorrenciaValidacao } from '../dist/application/use-cases/EditarOcorrenciaValidacao.js';

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

const instante = Date.parse('2026-11-05T14:00:00-03:00');
const edicao = (extra = {}) => ({
  descricao: 'Validação do conhecimento — tentativa 1 (corrigida)',
  departamento: 'Treinamento',
  responsavel: 'Treinador Radar',
  dataOcorrencia: instante,
  createdAt: instante,
  treinamentoDataSolicitacao: '2026-11-03',
  treinamentoTempoAgenda: '00:57',
  treinamentoSolicitante: 'Cliente',
  treinamentoMotivoEspera: null,
  treinamentoResultados: ['Bom'],
  ...extra,
});

function databaseValidacao() {
  const db = database();
  db.data.set('ocorrencias/validacao-1', {
    ...db.data.get('ocorrencias/validacao-1'),
    empresa: 'Cliente', tipo: 'Treinamento', temaOcorrencia: ['Validação do conhecimento'],
    validacaoAprovada: true, validacaoNota: 9,
    descricao: 'Validação do conhecimento — tentativa 1', departamento: 'Treinamento', responsavel: 'Treinador Radar',
    dataOcorrencia: instante, createdAt: instante, updatedAt: 10,
    treinamentoDataSolicitacao: '2026-11-03', treinamentoTempoAgenda: '01:10', treinamentoSolicitante: 'CS',
    treinamentoResultados: [], gamificacaoPontoId: 'tentativa-1',
  });
  db.data.set('validacao_tentativas/tentativa-1', { treinamentoTempoAgenda: '01:10', treinamentoSolicitante: 'CS', questoes: ['preservada'] });
  db.data.set('gamificacao_pontos/tentativa-1', {
    treinamentoTempoAgenda: '01:10', treinamentoSolicitante: 'CS', pontos: 1, treinadorId: 'treinador-1',
    descricao: 'Validação do conhecimento — tentativa 1',
  });
  db.data.set('usuarios/treinador-2', { role: 'treinador', nome: 'Outra Treinadora' });
  db.data.set('usuarios/cs-1', { role: 'cs', nome: 'Pessoa CS' });
  return db;
}

test('edição pelo Master grava os campos, replica para tentativa e ponto e registra o que mudou', async () => {
  const db = databaseValidacao();
  const pedido = lerPedidoEdicaoOcorrenciaValidacao({ ...edicao(), treinadorId: 'treinador-2', updatedAtEsperado: 10 });
  const resultado = await new EditarOcorrenciaValidacao(db).execute('validacao-1', pedido, 'Master Radar');

  const ocorrencia = db.data.get('ocorrencias/validacao-1');
  assert.equal(ocorrencia.treinamentoTempoAgenda, '00:57');
  assert.equal(ocorrencia.descricao, 'Validação do conhecimento — tentativa 1 (corrigida)');
  assert.deepEqual(ocorrencia.treinamentoResultados, ['Bom']);
  // Identidade da validação preservada.
  assert.equal(ocorrencia.validacaoTentativaId, 'tentativa-1');
  assert.equal(ocorrencia.validacaoNota, 9);
  assert.equal(ocorrencia.empresa, 'Cliente');
  assert.deepEqual(ocorrencia.temaOcorrencia, ['Validação do conhecimento']);

  const tentativa = db.data.get('validacao_tentativas/tentativa-1');
  assert.equal(tentativa.treinamentoTempoAgenda, '00:57');
  assert.equal(tentativa.treinamentoSolicitante, 'Cliente');
  assert.deepEqual(tentativa.questoes, ['preservada']);

  const ponto = db.data.get('gamificacao_pontos/tentativa-1');
  assert.equal(ponto.treinamentoTempoAgenda, '00:57');
  assert.equal(ponto.treinadorId, 'treinador-2');
  assert.equal(ponto.treinadorNome, 'Outra Treinadora');
  assert.equal(ponto.descricao, 'Validação do conhecimento — tentativa 1 (corrigida)');
  assert.equal(ponto.treinamentoDataRealizacao, '2026-11-05');
  assert.equal(ponto.pontos, 1);

  const registro = resultado.atualizacoes.at(-1);
  assert.equal(registro.responsavel, 'Master Radar');
  assert.match(registro.descricao, /tempo de agenda \(01:10 → 00:57\)/);
  assert.match(registro.descricao, /quem solicitou \(CS → Cliente\)/);
  assert.match(registro.descricao, /descrição/);

  // Sem alterações: não grava nem duplica o registro.
  const repetido = await new EditarOcorrenciaValidacao(db).execute('validacao-1', lerPedidoEdicaoOcorrenciaValidacao(edicao()), 'Master Radar');
  assert.equal(repetido.atualizacoes.length, resultado.atualizacoes.length);
});

test('edição recusa dados inválidos, conflito, responsável sem perfil e ocorrência comum', async () => {
  for (const invalido of [
    { treinamentoTempoAgenda: '57' },
    { treinamentoTempoAgenda: '00:00' },
    { treinamentoSolicitante: 'Outro' },
    { descricao: ' ' },
    { treinamentoResultados: ['Ótimo'] },
    { treinamentoDataSolicitacao: '2026-11-06' },
    { treinamentoMotivoEspera: 'outro' },
  ]) {
    assert.throws(() => lerPedidoEdicaoOcorrenciaValidacao(edicao(invalido)), { status: 400 }, JSON.stringify(invalido));
  }
  const db = databaseValidacao();
  const editar = (extra, id = 'validacao-1') =>
    new EditarOcorrenciaValidacao(db).execute(id, lerPedidoEdicaoOcorrenciaValidacao({ ...edicao(), ...extra }), 'Master Radar');
  await assert.rejects(editar({ updatedAtEsperado: 9 }), { status: 409 });
  await assert.rejects(editar({ treinadorId: 'cs-1' }), { status: 400 });
  await assert.rejects(editar({}, 'comum-1'), { status: 409 });
  await assert.rejects(editar({}, 'inexistente'), { status: 404 });
  assert.equal(db.data.get('ocorrencias/validacao-1').treinamentoTempoAgenda, '01:10');
});

test('endpoint de edição aceita somente Master ativo', async () => {
  const db = databaseValidacao();
  db.data.set('usuarios/master-1', { role: 'master', nome: 'Master Radar' });
  const controller = new OcorrenciasController(
    db,
    { verifyIdToken: async token => ({ uid: token === 'master-token' ? 'master-1' : 'treinador-1' }) },
    usuariosRepoFrom(db),
  );
  const base = { params: { id: 'validacao-1' }, body: edicao() };
  let res = response();
  await controller.editarOcorrenciaValidacao({ ...base, headers: {} }, res);
  assert.equal(res.code, 401);

  res = response();
  await controller.editarOcorrenciaValidacao({ ...base, headers: { authorization: 'Bearer treinador-token' } }, res);
  assert.equal(res.code, 403);

  db.data.set('usuarios/master-1', { role: 'master', nome: 'Master Radar', inativo: true });
  res = response();
  await controller.editarOcorrenciaValidacao({ ...base, headers: { authorization: 'Bearer master-token' } }, res);
  assert.equal(res.code, 403);

  db.data.set('usuarios/master-1', { role: 'master', nome: 'Master Radar' });
  res = response();
  await controller.editarOcorrenciaValidacao({ ...base, body: edicao({ treinamentoTempoAgenda: '5' }), headers: { authorization: 'Bearer master-token' } }, res);
  assert.equal(res.code, 400);

  res = response();
  await controller.editarOcorrenciaValidacao({ ...base, headers: { authorization: 'Bearer master-token' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.treinamentoTempoAgenda, '00:57');
});
