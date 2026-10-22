import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import ts from 'typescript';

async function criarServico() {
  const documentos = new Map();
  const clientes = new Map([['cliente', { nomeEmpresa: 'Cliente' }]]);
  const obter = ref => ({ exists: () => (ref.colecao === 'empresas' ? clientes : documentos).has(ref.id), data: () => (ref.colecao === 'empresas' ? clientes : documentos).get(ref.id), ref });
  const firestore = new SyntheticModule(['collection', 'doc', 'addDoc', 'runTransaction', 'deleteDoc', 'getDocsFromServer', 'getDocFromServer', 'query', 'where', 'orderBy', 'limit'], function () {
    this.setExport('collection', (_db, colecao) => ({ colecao }));
    this.setExport('doc', (dbOuColecao, colecao, id) => ({ id: id ?? 'nova', colecao: colecao ?? dbOuColecao.colecao }));
    this.setExport('addDoc', async (_colecao, dados) => { documentos.set('nova', dados); return { id: 'nova' }; });
    this.setExport('getDocFromServer', async ref => obter(ref));
    this.setExport('query', (colecao, ...filtros) => ({ ...colecao, filtros }));
    this.setExport('where', (campo, _operador, valor) => ({ campo, valor }));
    this.setExport('limit', quantidade => ({ quantidade }));
    this.setExport('getDocsFromServer', async consulta => ({ docs: [...clientes].filter(([, dados]) => consulta.filtros.every(f => !f.campo || dados[f.campo] === f.valor)).slice(0, 2).map(([id]) => obter({ id, colecao: 'empresas' })) }));
    this.setExport('runTransaction', async (_db, executar) => executar({
      get: async ref => obter(ref),
      update: (ref, dados) => documentos.set(ref.id, { ...documentos.get(ref.id), ...dados }),
      set: (ref, dados) => documentos.set(ref.id, dados),
    }));
    for (const nome of ['deleteDoc', 'orderBy']) this.setExport(nome, () => { throw Error(`Chamada inesperada: ${nome}`); });
  });
  const firebase = new SyntheticModule(['auth', 'db'], function () {
    this.setExport('auth', { currentUser: { uid: 'treinador' } }); this.setExport('db', {});
  });
  const sincronizacao = new SyntheticModule(['sincronizarColecao'], function () { this.setExport('sincronizarColecao', async () => []); });
  const config = new SyntheticModule(['RADAR_API_URL'], function () { this.setExport('RADAR_API_URL', ''); });
  const codigo = ts.transpileModule(readFileSync(new URL('../src/services/ocorrencias.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const modulo = new SourceTextModule(codigo);
  const regra = new SourceTextModule(ts.transpileModule(readFileSync(new URL('../src/utils/registroTreinamento.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText);
  await regra.link(() => { throw Error('Import inesperado na regra de suspensão'); });
  await modulo.link(nome => {
    const dependencias = { 'firebase/firestore': firestore, './firebase': firebase, './sincronizacaoIncremental': sincronizacao, './apiConfig.ts': config, '../utils/registroTreinamento': regra };
    if (!dependencias[nome]) throw Error(`Import inesperado: ${nome}`);
    return dependencias[nome];
  });
  await modulo.evaluate();
  return { documentos, clientes, servico: modulo.namespace };
}

test('ocorrência persiste o motivo e limpa classificação com null ao mudar as datas', async () => {
  const { documentos, servico } = await criarServico();
  const dados = { tipo: 'Treinamento', empresa: 'Cliente', descricao: 'Treinamento', treinamentoMotivoEspera: 'cliente' };
  const id = await servico.salvarOcorrencia(dados);
  assert.equal(documentos.get(id).treinamentoMotivoEspera, 'cliente');
  assert.ok(documentos.get(id).updatedAt > 0);
  await servico.salvarOcorrencia({ ...dados, id, treinamentoMotivoEspera: 'agenda_treinador' });
  assert.equal(documentos.get(id).treinamentoMotivoEspera, 'agenda_treinador');
  await servico.salvarOcorrencia({ ...dados, id, treinamentoMotivoEspera: null });
  assert.equal(documentos.get(id).treinamentoMotivoEspera, null);
});

test('atualizações de outros campos e preservação do CSAT não descartam motivo salvo', async () => {
  const { documentos, servico } = await criarServico();
  documentos.set('antiga', { tipo: 'Treinamento', empresa: 'Cliente', treinamentoMotivoEspera: 'cliente', csatReservaId: 'reserva', treinamentoResultados: ['Bom'] });
  await servico.salvarOcorrencia({ id: 'antiga', empresa: 'Cliente', descricao: 'Atualizada' });
  assert.equal(documentos.get('antiga').treinamentoMotivoEspera, 'cliente');
  assert.deepEqual(documentos.get('antiga').treinamentoResultados, ['Bom']);
});

test('bloqueia novo treinamento suspenso por ID e por nome, sem criar ocorrência', async () => {
  const { documentos, clientes, servico } = await criarServico();
  clientes.get('cliente').isSuspended = true;
  for (const opcoes of [undefined, { empresaId: 'cliente' }]) {
    await assert.rejects(servico.salvarOcorrencia({ empresa: 'Cliente', tipo: 'Treinamento' }, opcoes), /cliente suspenso/);
    assert.equal(documentos.size, 0);
  }
});

test('permite os outros tipos normalmente mesmo para cliente suspenso', async () => {
  const { documentos, clientes, servico } = await criarServico();
  clientes.get('cliente').isSuspended = true;
  for (const tipo of ['Informativa', 'Dúvida', 'Problema', 'Solicitação', 'Checkpoint', 'Mudança de score']) {
    const id = await servico.salvarOcorrencia({ empresa: 'Cliente', tipo });
    assert.equal(documentos.get(id).tipo, tipo);
  }
});

test('impede conversão e transferência para cliente suspenso, preservando o registro original', async () => {
  const { documentos, clientes, servico } = await criarServico();
  clientes.get('cliente').isSuspended = true;
  for (const anterior of [{ empresa: 'Cliente', tipo: 'Informativa' }, { empresa: 'Outro', tipo: 'Treinamento' }]) {
    documentos.set('antiga', anterior);
    await assert.rejects(servico.salvarOcorrencia({ id: 'antiga', empresa: 'Cliente', tipo: 'Treinamento' }, { empresaId: 'cliente' }), /cliente suspenso/);
    assert.deepEqual(documentos.get('antiga'), anterior);
  }
});

test('permite corrigir texto e incluir atualizações em treinamento antigo do cliente suspenso', async () => {
  const { documentos, clientes, servico } = await criarServico();
  clientes.get('cliente').isSuspended = true;
  documentos.set('antiga', { empresa: 'Cliente', tipo: 'Treinamento', createdAt: 123 });
  await servico.salvarOcorrencia({ id: 'antiga', empresa: 'Cliente', tipo: 'Treinamento', descricao: 'Correção' });
  await servico.salvarOcorrencia({ id: 'antiga', atualizacoes: [{ descricao: 'Comentário', updatedAt: 456 }] });
  assert.equal(documentos.get('antiga').descricao, 'Correção');
  assert.equal(documentos.get('antiga').createdAt, 123);
  assert.equal(documentos.get('antiga').atualizacoes.length, 1);
});

test('conferência final detecta suspensão posterior à validação inicial e libera após retorno', async () => {
  const { documentos, clientes, servico } = await criarServico();
  await servico.validarClienteParaNovoTreinamento('cliente', 'Cliente');
  clientes.get('cliente').isSuspended = true;
  await assert.rejects(servico.salvarOcorrencia({ empresa: 'Cliente', tipo: 'Treinamento' }, { empresaId: 'cliente' }), /cliente suspenso/);
  assert.equal(documentos.size, 0);
  clientes.get('cliente').isSuspended = false;
  const id = await servico.salvarOcorrencia({ empresa: 'Cliente', tipo: 'Treinamento' }, { empresaId: 'cliente' });
  assert.equal(documentos.get(id).tipo, 'Treinamento');
});

test('não permite informar outro cadastro ativo para contornar a suspensão do cliente', async () => {
  const { documentos, clientes, servico } = await criarServico();
  clientes.get('cliente').isSuspended = true;
  clientes.set('outro', { nomeEmpresa: 'Outro' });
  await assert.rejects(servico.salvarOcorrencia({ empresa: 'Cliente', tipo: 'Treinamento' }, { empresaId: 'outro' }), /cliente cadastrado válido/);
  assert.equal(documentos.size, 0);
});
