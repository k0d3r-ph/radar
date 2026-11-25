// Mesmos casos de app/tests/regrasFirestoreProducao.test.mjs (regras de produção do Firestore),
// agora contra a API de dados no PostgreSQL, mais os comportamentos próprios da API.
import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { iniciarPostgresTeste } from './helpers/postgresTeste.mjs';
import { AcessarDadosNavegador } from '../dist/application/use-cases/AcessarDadosNavegador.js';
import { DadosController } from '../dist/adapters/controllers/DadosController.js';

let pg, banco, api;
before(async () => { pg = await iniciarPostgresTeste(); banco = pg.banco; api = new AcessarDadosNavegador(banco); });
after(async () => { await pg?.encerrar(); });

beforeEach(async () => {
  await pg.limpar();
  await pg.semear([
    ['usuarios/master1', { role: 'master', nome: 'Master', email: 'master1@radar.test' }],
    ['usuarios/master2', { role: 'master', nome: 'Outro Master', email: 'master2@radar.test' }],
    ['usuarios/treinador1', { role: 'treinador', nome: 'Treinador', email: 'treinador1@radar.test' }],
    ['usuarios/suporte1', { role: 'suporte', nome: 'Suporte', email: 'suporte1@radar.test', cargo: 'analista' }],
    ['usuarios/painel1', { role: 'painel', nome: 'Painel', email: 'painel1@radar.test' }],
    ['usuarios/crc1', { role: 'crc', nome: 'CRC', email: 'crc1@radar.test' }],
    ['usuarios/inativo1', { role: 'suporte', nome: 'Inativo', email: 'inativo1@radar.test', inativo: true }],
    ['empresas/e1', { nomeEmpresa: 'Cliente' }],
    ['checklist_tarefas/t1', { descricao: 'Tarefa' }],
    ['ocorrencias/o1', { empresa: 'Cliente' }],
    ['ocorrencias/v1', { empresa: 'Cliente', validacaoTentativaId: 'tent1' }],
    ['gamificacao_pontos/p1', { pontos: 10, tipoAcao: 'treinamento' }],
    ['gamificacao_pontos/p2', { pontos: -5, tipoAcao: 'desconto_suporte' }],
    ['configuracoes/metas', { meta: 80 }],
    ['temasOcorrencia/tema1', { nome: 'Tema' }],
    ['csatReservas/r1', { status: 'pendente' }],
  ]);
});

/** Contexto como o controller monta: uid e e-mail do token + cadastro atual. */
async function como(uid) {
  if (!uid) return { uid: '', cadastro: undefined };
  return { uid, email: `${uid}@radar.test`, cadastro: (await banco.doc(`usuarios/${uid}`).get()).data() };
}
const ler = async (uid, caminho) => api.ler(await como(uid), caminho);
const gravar = async (uid, ...escritas) => api.gravar(await como(uid), { escritas });
const set = (caminho, dados, merge = false) => ({ tipo: 'set', caminho, dados, merge });
const update = (caminho, dados) => ({ tipo: 'update', caminho, dados });
const del = caminho => ({ tipo: 'delete', caminho });
const permitido = promessa => promessa;
const negado = promessa => assert.rejects(promessa, e => e.codigo === 'permission-denied');

// ------------------------------------------------- casos de regrasFirestoreProducao.test.mjs

test('falha 1: uma conta nova não cria o próprio cadastro nem vira master', async () => {
  await negado(gravar('intruso', set('usuarios/intruso', { role: 'master', nome: 'X', email: 'intruso@radar.test' })));
});

test('falha 1: usuário não altera o próprio perfil, inativo nem cargo', async () => {
  await negado(gravar('suporte1', update('usuarios/suporte1', { role: 'master' })));
  await negado(gravar('suporte1', update('usuarios/suporte1', { cargo: 'supervisor' })));
  await negado(gravar('suporte1', update('usuarios/suporte1', { email: 'outro@radar.test' })));
  await negado(gravar('inativo1', update('usuarios/inativo1', { inativo: false })));
});

test('fluxos atuais do próprio usuário continuam: definir senha, migrar crc → cs e ler o próprio cadastro inativo', async () => {
  await permitido(gravar('suporte1', set('usuarios/suporte1', {
    email: 'suporte1@radar.test', role: 'suporte', nome: 'Suporte Formatado', needsPasswordChange: false, updatedAt: 1,
  }, true)));
  await permitido(gravar('crc1', set('usuarios/crc1', { role: 'cs', updatedAt: 1 }, true)));
  await negado(gravar('crc1', set('usuarios/crc1', { role: 'treinador', updatedAt: 2 }, true)));
  assert.equal((await ler('inativo1', 'usuarios/inativo1')).dados.inativo, true);
});

test('falha 2: conta sem cadastro ou inativada não lê nem grava os dados do Radar', async () => {
  for (const uid of ['intruso', 'inativo1']) {
    await negado(ler(uid, 'empresas/e1'));
    await negado(gravar(uid, set('empresas/e1', { nomeEmpresa: 'Alterada' })));
    await negado(ler(uid, 'checklist_tarefas/t1'));
    await negado(ler(uid, 'ocorrencias/o1'));
    await negado(gravar(uid, set('ocorrencias/nova', { empresa: 'Cliente' })));
    await negado(como(uid).then(ctx => api.consultar(ctx, 'empresas', {})));
  }
});

test('falha 3: gamificação não é legível sem login; usuário do Radar continua lendo', async () => {
  await negado(ler(null, 'gamificacao_pontos/p1'));
  await negado(ler('intruso', 'gamificacao_pontos/p1'));
  await permitido(ler('suporte1', 'gamificacao_pontos/p1'));
});

test('falha 4: treinador gerencia usuários comuns, mas não promove, edita nem exclui Master', async () => {
  await permitido(ler('treinador1', 'usuarios/master1'));
  await permitido(gravar('treinador1', set('usuarios/suporte1', { telefone: '5586999999999', updatedAt: 1 }, true)));
  await permitido(gravar('treinador1', set('usuarios/suporte1', { role: 'cs', updatedAt: 2 }, true)));
  await permitido(gravar('treinador1', set('usuarios/suporte1', { inativo: true, updatedAt: 3 }, true)));
  await negado(gravar('treinador1', set('usuarios/suporte1', { role: 'master' }, true)));
  await negado(gravar('treinador1', set('usuarios/treinador1', { role: 'master' }, true)));
  await negado(gravar('treinador1', set('usuarios/master1', { telefone: '1' }, true)));
  await negado(gravar('treinador1', set('usuarios/master1', { inativo: true }, true)));
  await negado(gravar('treinador1', del('usuarios/master1')));
  await permitido(gravar('treinador1', del('usuarios/painel1')));
});

test('master continua gerenciando qualquer usuário; ninguém cria cadastro pelo navegador', async () => {
  await permitido(gravar('master1', set('usuarios/treinador1', { role: 'master' }, true)));
  await permitido(gravar('master1', set('usuarios/master2', { inativo: true }, true)));
  await permitido(gravar('master1', del('usuarios/master2')));
  await negado(gravar('master1', set('usuarios/novo', { role: 'suporte', nome: 'Novo' })));
});

test('demais perfis não leem a lista de usuários, como antes', async () => {
  await negado(ler('suporte1', 'usuarios/master1'));
  await negado(ler('painel1', 'usuarios/suporte1'));
  await negado(como('suporte1').then(ctx => api.consultar(ctx, 'usuarios', {})));
  const lista = await api.consultar(await como('treinador1'), 'usuarios', { ordens: [{ campo: 'email' }] });
  assert.equal(lista[0].id, 'crc1');
});

test('permissões de negócio preservadas: painel e demais perfis gravam empresas, checklist e ocorrências', async () => {
  for (const uid of ['painel1', 'suporte1']) {
    await permitido(gravar(uid, set('empresas/e1', { nomeEmpresa: `Cliente ${uid}` }, true)));
    await permitido(gravar(uid, set('checklist_tarefas/t1', { descricao: `Tarefa ${uid}` }, true)));
    await permitido(gravar(uid, set('ocorrencias/o1', { empresa: `Cliente ${uid}` }, true)));
    await negado(gravar(uid, del('ocorrencias/o1')));
    await negado(gravar(uid, set('ocorrencias/v1', { empresa: 'Alterada' }, true)));
    await negado(gravar(uid, set('ocorrencias/v2', { empresa: 'Cliente', validacaoTentativaId: 't2' })));
  }
  await permitido(gravar('master1', del('ocorrencias/o1')));
});

test('cliente cancelado não sai dos Cancelados, nem pelo Master', async () => {
  await pg.semear([['empresas/cancelado', { nomeEmpresa: 'Cancelado', isCancelled: true }]]);
  for (const uid of ['master1', 'treinador1']) {
    await negado(gravar(uid, set('empresas/cancelado', { isCancelled: false }, true)));
    await negado(gravar(uid, set('empresas/cancelado', { nomeEmpresa: 'Sem o campo' })));
    await permitido(gravar(uid, set('empresas/cancelado', { nomeEmpresa: `Cancelado ${uid}` }, true)));
  }
  await permitido(gravar('treinador1', set('empresas/e1', { isCancelled: true }, true)));
});

test('gamificação, configurações, temas e coleções da API mantêm as regras anteriores', async () => {
  await permitido(gravar('treinador1', set('gamificacao_pontos/p3', { pontos: 5, tipoAcao: 'treinamento' })));
  await negado(gravar('suporte1', set('gamificacao_pontos/p4', { pontos: 5, tipoAcao: 'treinamento' })));
  await permitido(gravar('treinador1', del('gamificacao_pontos/p1')));
  await negado(gravar('treinador1', del('gamificacao_pontos/p2')));
  await permitido(gravar('master1', del('gamificacao_pontos/p2')));
  await permitido(ler('suporte1', 'configuracoes/metas'));
  await negado(gravar('treinador1', set('configuracoes/metas', { meta: 90 })));
  await permitido(gravar('master1', set('configuracoes/metas', { meta: 90 })));
  await negado(gravar('treinador1', set('temasOcorrencia/tema2', { nome: 'Novo' })));
  await permitido(gravar('master1', set('temasOcorrencia/tema2', { nome: 'Novo' })));
  // Mudança deliberada: o Firestore proibia update de tema, mas a tela de perfis do tema precisa dele.
  await permitido(gravar('master1', update('temasOcorrencia/tema1', { perfisDisponiveis: ['suporte'] })));
  await negado(gravar('treinador1', update('temasOcorrencia/tema1', { nome: 'Alterado' })));
  await negado(ler('master1', 'csatReservas/r1'));
  await negado(gravar('master1', set('csatReservas/r1', { status: 'x' })));
  await negado(como('master1').then(ctx => api.consultar(ctx, 'validacao_tentativas', {})));
});

test('Gol: só o Master retira o cliente do indicador, na criação e na edição', async () => {
  await negado(gravar('treinador1', set('empresas/nova', { nomeEmpresa: 'N', excluidoIndicadorGol: true })));
  await permitido(gravar('treinador1', set('empresas/nova', { nomeEmpresa: 'N', excluidoIndicadorGol: false })));
  await negado(gravar('treinador1', update('empresas/nova', { excluidoIndicadorGol: true })));
  await permitido(gravar('master1', update('empresas/nova', { excluidoIndicadorGol: true })));
});

// ------------------------------------------------- comportamento da API

test('lote é atômico: uma escrita negada desfaz as demais', async () => {
  await negado(gravar('suporte1',
    set('checklist_tarefas/t1', { descricao: 'Alterada' }, true),
    set('gamificacao_pontos/p9', { pontos: 1 })));
  assert.equal((await banco.doc('checklist_tarefas/t1').get()).data().descricao, 'Tarefa');
  assert.equal((await banco.doc('gamificacao_pontos/p9').get()).exists, false);
});

test('transação do navegador: grava só se os documentos lidos não mudaram', async () => {
  const ctx = await como('suporte1');
  const lido = await api.ler(ctx, 'empresas/e1');
  assert.match(lido.versao, /^\d+$/);
  await banco.doc('empresas/e1').update({ nomeEmpresa: 'Mudou' });
  await assert.rejects(api.gravar(ctx, { leituras: [{ caminho: 'empresas/e1', versao: lido.versao }], escritas: [update('empresas/e1', { score: 1 })] }),
    e => e.codigo === 'aborted' && e.status === 409);
  const relido = await api.ler(ctx, 'empresas/e1');
  await api.gravar(ctx, { leituras: [{ caminho: 'empresas/e1', versao: relido.versao }, { caminho: 'ocorrencias/nova', versao: null }],
    escritas: [update('empresas/e1', { score: 1 }), set('ocorrencias/nova', { empresa: 'Mudou' })] });
  assert.deepEqual((await banco.doc('empresas/e1').get()).data(), { nomeEmpresa: 'Mudou', score: 1 });
  // Documento lido como inexistente e criado por outro antes do commit também conflita.
  await assert.rejects(api.gravar(ctx, { leituras: [{ caminho: 'ocorrencias/nova', versao: null }], escritas: [set('ocorrencias/nova', { a: 1 })] }),
    e => e.codigo === 'aborted');
});

test('deleteField, update com caminho "a.b" e update de documento inexistente', async () => {
  await gravar('suporte1', set('empresas/e1', { aplicacaoTemasDias: { '01-10': 2, '02-10': 3 }, sla: 5 }, true));
  await gravar('suporte1', update('empresas/e1', { 'aplicacaoTemasDias.01-10': { __radar__: 'deleteField' }, sla: { __radar__: 'deleteField' } }));
  assert.deepEqual((await banco.doc('empresas/e1').get()).data(), { nomeEmpresa: 'Cliente', aplicacaoTemasDias: { '02-10': 3 } });
  await assert.rejects(gravar('suporte1', update('empresas/nao-existe', { a: 1 })), e => e.codigo === 'not-found');
  await assert.rejects(gravar('suporte1', set('empresas/e1', { a: { __radar__: 'deleteField' } })), e => e.codigo === 'invalid-argument');
});

test('caminhos e consultas inválidos são recusados', async () => {
  for (const caminho of ['empresas', 'empresas/a/b', 'empresas/..', 'empresas/ ', 'nada/x', 42]) {
    await assert.rejects(gravar('master1', set(caminho, { a: 1 })), e => ['invalid-argument', 'permission-denied'].includes(e.codigo));
  }
  const ctx = await como('master1');
  await assert.rejects(api.consultar(ctx, 'empresas', { filtros: [{ campo: "x' or 1=1", operador: '==', valor: 1 }] }), e => e.codigo === 'invalid-argument');
  await assert.rejects(api.consultar(ctx, 'empresas', { filtros: [{ campo: 'x', operador: '!=', valor: 1 }] }), e => e.codigo === 'invalid-argument');
  await assert.rejects(api.consultar(ctx, 'empresas', { limite: -1 }), e => e.codigo === 'invalid-argument');
  assert.deepEqual((await api.consultar(ctx, 'empresas', { filtros: [{ campo: 'nomeEmpresa', operador: '==', valor: 'Cliente' }], limite: 2 })).map(d => d.id), ['e1']);
});

test('controller: token ausente/inválido → 401, sem banco → 503, erros com código do Firestore', async () => {
  const resposta = () => ({ code: 200, set() { return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
  const auth = uid => ({ verifyIdToken: async () => ({ uid, email: `${uid}@radar.test` }) });
  const req = (extra = {}) => ({ headers: { authorization: 'Bearer t' }, params: { colecao: 'empresas', id: 'e1' }, body: {}, ...extra });

  let res = resposta();
  await new DadosController(banco, auth('suporte1')).ler(req({ headers: {} }), res);
  assert.equal(res.code, 401);
  res = resposta();
  await new DadosController(banco, { verifyIdToken: async () => { throw new Error('expirado'); } }).ler(req(), res);
  assert.equal(res.code, 401);
  res = resposta();
  await new DadosController(null, auth('suporte1')).ler(req(), res);
  assert.equal(res.code, 503);
  res = resposta();
  await new DadosController(banco, auth('suporte1')).ler(req(), res);
  assert.deepEqual(res.body, { id: 'e1', existe: true, dados: { nomeEmpresa: 'Cliente' }, versao: res.body.versao });
  res = resposta();
  await new DadosController(banco, auth('suporte1')).gravar(req({ body: { escritas: [del('ocorrencias/o1')] } }), res);
  assert.equal(res.code, 403);
  assert.equal(res.body.code, 'permission-denied');
  res = resposta();
  await new DadosController(banco, auth('master1')).consultar(req({ params: { colecao: 'ocorrencias' }, body: { ordens: [{ campo: 'empresa', direcao: 'desc' }] } }), res);
  assert.deepEqual(res.body.documentos.map(d => d.id), ['v1', 'o1']); // empate desempatado pelo id na mesma direção
});

test('update por caminhos literais (FieldPath): parte com ponto vira uma chave só, deleteField e caminhos inválidos', async () => {
  await gravar('suporte1', set('empresas/e1', { aplicacaoTemasDias: { 'Tema 1.2': 1, Outro: 2 } }, true));
  await gravar('suporte1', { tipo: 'update', caminho: 'empresas/e1', campos: [
    { caminho: ['aplicacaoTemasDias', 'Cadastro v2.0'], valor: 3 },
    { caminho: ['aplicacaoTemasDias', 'Tema 1.2'], valor: { __radar__: 'deleteField' } },
    { caminho: ['updatedAt'], valor: 99 },
  ] });
  assert.deepEqual((await banco.doc('empresas/e1').get()).data(),
    { nomeEmpresa: 'Cliente', aplicacaoTemasDias: { Outro: 2, 'Cadastro v2.0': 3 }, updatedAt: 99 });
  for (const campos of [[], [{ caminho: [], valor: 1 }], [{ caminho: ['a', ''], valor: 1 }], [{ caminho: 'a.b', valor: 1 }], [{ caminho: ['a'], valor: undefined }]]) {
    await assert.rejects(gravar('suporte1', { tipo: 'update', caminho: 'empresas/e1', campos }), e => e.codigo === 'invalid-argument');
  }
  // As regras valem sobre o resultado: o update por caminho não escapa da proteção do Gol.
  await negado(gravar('treinador1', { tipo: 'update', caminho: 'empresas/e1', campos: [{ caminho: ['excluidoIndicadorGol'], valor: true }] }));
});
