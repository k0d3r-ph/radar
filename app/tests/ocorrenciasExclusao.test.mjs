import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import ts from 'typescript';

function ambiente(registros) {
  return {
    servidor: new Map(registros.map(d => [d.id, { ...d }])),
    cache: new Map(), storage: new Map(), versoes: new Map(registros.map(d => [d.id, '1'])),
    consultas: [], documentos: new Map(), documentosLidos: 0, chamadasApi: 0,
    usuario: { uid: 'u1', getIdToken: async () => 'token' },
  };
}

async function criarPagina(estado) {
  const snapshot = registros => ({ docs: registros.map(({ id, ...dados }) => ({ id, data: () => dados })) });
  const context = createContext({
    Date: class extends Date { static now() { return estado.agora ?? Date.now(); } }, console, AbortSignal,
    localStorage: {
      getItem: chave => estado.storage.get(chave) ?? null,
      setItem: (chave, valor) => estado.storage.set(chave, valor),
      removeItem: chave => estado.storage.delete(chave),
    },
    fetch: async () => {
      estado.chamadasApi++;
      if (estado.erroApi) return { ok: false, json: async () => ({ error: estado.erroApi }) };
      return { ok: true, json: async () => ({ documentos: [...estado.servidor.keys()].map(id => ({ id, versao: estado.versoes.get(id) || '1' })) }) };
    },
  });
  const firestore = new SyntheticModule([
    'collection', 'addDoc', 'deleteDoc', 'runTransaction', 'doc',
    'getDocsFromServer', 'getDocFromServer', 'getDocsFromCache', 'documentId', 'query', 'where', 'orderBy', 'limit',
  ], function () {
    this.setExport('collection', (_db, nome) => ({ colecao: nome }));
    this.setExport('documentId', () => '__name__');
    this.setExport('doc', (...args) => {
      const segmentos = args.length === 1 && args[0]?.colecao
        ? [args[0].colecao, 'novo-documento']
        : args.slice(1);
      return { id: segmentos.at(-1), path: segmentos.join('/') };
    });
    this.setExport('where', (campo, operador, ids) => ({ campo, operador, ids }));
    this.setExport('query', (colecao, ...filtros) => ({ ...colecao, filtros }));
    for (const nome of ['orderBy', 'limit']) this.setExport(nome, (...args) => args);
    for (const nome of ['addDoc', 'deleteDoc']) this.setExport(nome, async () => {});
    this.setExport('runTransaction', async (_db, executar) => executar({
      get: async ref => {
        const dados = estado.documentos.get(ref.path);
        return { data: () => dados, exists: () => dados !== undefined };
      },
      update: (ref, dados) => {
        estado.documentos.set(ref.path, { ...estado.documentos.get(ref.path), ...dados });
      },
      delete: ref => estado.documentos.delete(ref.path),
      set: (ref, dados) => {
        estado.documentos.set(ref.path, dados);
      },
    }));
    this.setExport('getDocFromServer', () => { throw new Error('A sincronização não deve consultar o cadastro de treinamento.'); });
    this.setExport('getDocsFromCache', async () => snapshot([...estado.cache.values()]));
    this.setExport('getDocsFromServer', async consulta => {
      if (estado.erroFirestore) throw new Error(estado.erroFirestore);
      const ids = consulta.filtros?.find(f => f.campo === '__name__')?.ids;
      estado.consultas.push(ids ? Array.from(ids) : 'completa');
      const registros = [...estado.servidor.values()].filter(d => !ids || ids.includes(d.id));
      estado.documentosLidos += registros.length;
      for (const d of registros) estado.cache.set(d.id, { ...d });
      if (ids) ids.filter(id => !estado.servidor.has(id)).forEach(id => estado.cache.delete(id));
      return snapshot(registros);
    });
  }, { context });
  const firebase = new SyntheticModule(['auth', 'db'], function () {
    this.setExport('auth', { get currentUser() { return estado.usuario; } });
    this.setExport('db', {});
  }, { context });
  const gamificacao = new SyntheticModule(['invalidarCacheGamificacao'], function () {
    this.setExport('invalidarCacheGamificacao', () => {});
  }, { context });
  const empresas = new SyntheticModule(['invalidarCacheEmpresas'], function () {
    this.setExport('invalidarCacheEmpresas', () => {});
  }, { context });
  const modules = new Map();
  async function carregar(nome) {
    if (nome === 'firebase/firestore') return firestore;
    if (nome === './firebase') return firebase;
    if (nome === './gamificacao') return gamificacao;
    if (nome === './empresas') return empresas;
    if (!['./ocorrencias', './sincronizacaoIncremental', './apiConfig.ts', '../utils/registroTreinamento'].includes(nome)) throw new Error(`Import inesperado: ${nome}`);
    if (modules.has(nome)) return modules.get(nome);
    const caminho = nome === '../utils/registroTreinamento' ? '../src/utils/registroTreinamento.ts' : `../src/services/${nome.slice(2).replace(/\.ts$/, '')}.ts`;
    const source = readFileSync(new URL(caminho, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = new SourceTextModule(code, { context, initializeImportMeta: meta => { meta.env = {}; } });
    modules.set(nome, module);
    await module.link(carregar);
    return module;
  }
  const module = await carregar('./ocorrencias');
  await module.evaluate();
  return { servico: module.namespace, sync: modules.get('./sincronizacaoIncremental').namespace };
}

test('recarregar a página elimina exclusão de outro usuário sem reler documentos', async () => {
  const estado = ambiente([{ id: '2060', createdAt: 2 }, { id: '2059', createdAt: 1 }]);
  const primeiraPagina = await criarPagina(estado);
  assert.equal((await primeiraPagina.servico.listarOcorrencias()).length, 2);
  estado.servidor.delete('2060');
  assert.equal(estado.cache.has('2060'), true); // Fantasma permanece no SDK.
  const paginaRecarregada = await criarPagina(estado);
  assert.equal((await paginaRecarregada.servico.listarOcorrencias()).length, 1);
  assert.equal((await paginaRecarregada.servico.listarOcorrencias())[0].id, '2059');
  assert.equal(estado.documentosLidos, 2);
  assert.equal(estado.chamadasApi, 2); // Segunda chamada usou o cache em memória.
});

test('remove o desconto de suporte na transação da edição da ocorrência', async () => {
  const estado = ambiente([]);
  estado.documentos.set('ocorrencias/oc-1', {
    tipo: 'Dúvida',
    empresa: 'Empresa A',
    gamificacaoDescontoPontoId: 'ponto-1',
    updatedAt: 1,
  });
  estado.documentos.set('gamificacao_pontos/ponto-1', { pontos: -1 });
  const { servico } = await criarPagina(estado);

  await servico.salvarOcorrencia(
    { id: 'oc-1', tipo: 'Problema' },
    { updatedAtEsperado: 1, removerDescontoSuporteId: 'ponto-1' },
  );

  assert.equal(estado.documentos.has('gamificacao_pontos/ponto-1'), false);
  assert.equal(
    estado.documentos.get('ocorrencias/oc-1').gamificacaoDescontoPontoId,
    '',
  );
  assert.equal(estado.documentos.get('ocorrencias/oc-1').tipo, 'Problema');
});

test('não remove ponto se o vínculo mudou durante a edição', async () => {
  const estado = ambiente([]);
  estado.documentos.set('ocorrencias/oc-1', {
    tipo: 'Dúvida',
    empresa: 'Empresa A',
    gamificacaoDescontoPontoId: 'ponto-atual',
    updatedAt: 1,
  });
  estado.documentos.set('gamificacao_pontos/ponto-antigo', { pontos: -1 });
  const { servico } = await criarPagina(estado);

  await assert.rejects(
    servico.salvarOcorrencia(
      { id: 'oc-1', tipo: 'Problema' },
      { updatedAtEsperado: 1, removerDescontoSuporteId: 'ponto-antigo' },
    ),
    /desconto de gamificação desta ocorrência foi alterado/,
  );

  assert.equal(estado.documentos.has('gamificacao_pontos/ponto-antigo'), true);
  assert.equal(
    estado.documentos.get('ocorrencias/oc-1').gamificacaoDescontoPontoId,
    'ponto-atual',
  );
});

test('conclui unilateralmente a esteira na mesma transação da ocorrência informativa', async () => {
  const estado = ambiente([]);
  estado.documentos.set('empresas/empresa-1', {
    nomeEmpresa: 'Empresa A',
    temaText: 'Introdução\nCadastros\nRelatórios\nValidação',
    currentPhase: 1,
    dataFollowUpFinal: '2026-09-10',
  });
  const { servico } = await criarPagina(estado);

  const resultado = await servico.salvarOcorrencia(
    {
      empresa: 'Empresa A',
      tipo: 'Informativa',
      descricao: 'Conclusão unilateral da capacitação',
      departamento: 'CS',
      responsavel: 'CS',
      dataOcorrencia: 0,
      conclusaoUnilateralCapacitacao: true,
    },
    {
      concluirEsteiraUnilateralmente: {
        empresaId: 'empresa-1',
        dataFinalizacao: '2026-10-30',
      },
    },
  );

  const empresa = estado.documentos.get('empresas/empresa-1');
  const ocorrencia = estado.documentos.get('ocorrencias/novo-documento');
  assert.equal(empresa.currentPhase, 3);
  assert.equal(empresa.dataFinalizacao, '2026-10-30');
  assert.equal(empresa.dataFollowUpFinal, '2026-11-19');
  assert.equal(empresa.conclusaoUnilateralCapacitacao, true);
  assert.equal(empresa.conclusaoUnilateralOcorrenciaId, resultado.id);
  assert.deepEqual([...empresa.temasConcluidosUnilateralmente], [
    'Relatórios',
    'Validação',
  ]);
  assert.equal(ocorrencia.tipo, 'Informativa');
  assert.equal(ocorrencia.conclusaoUnilateralCapacitacao, true);

  await servico.removerOcorrencia(resultado.id);
  const empresaRestaurada = estado.documentos.get('empresas/empresa-1');
  assert.equal(empresaRestaurada.currentPhase, 1);
  assert.equal(empresaRestaurada.dataFinalizacao, '');
  assert.equal(empresaRestaurada.dataFollowUpFinal, '2026-09-10');
  assert.equal(empresaRestaurada.conclusaoUnilateralCapacitacao, false);
  assert.equal(empresaRestaurada.conclusaoUnilateralOcorrenciaId, '');
  assert.deepEqual(
    [...empresaRestaurada.temasConcluidosUnilateralmente],
    [],
  );
  assert.equal(estado.documentos.has('ocorrencias/novo-documento'), false);
});

test('atualização forçada com mil registros busca somente três documentos alterados', async () => {
  const estado = ambiente(Array.from({ length: 1000 }, (_, i) => ({ id: `oc${i}` })));
  const { servico } = await criarPagina(estado);
  await servico.listarOcorrencias();
  await servico.listarOcorrencias(true);
  assert.equal(estado.documentosLidos, 1000);
  for (const id of ['oc0', 'oc1', 'oc2']) {
    estado.servidor.set(id, { id, descricao: 'alterado sem updatedAt' });
    estado.versoes.set(id, '2');
  }
  const atual = await servico.listarOcorrencias(true);
  assert.equal(atual.filter(d => d.descricao).length, 3);
  assert.equal(estado.documentosLidos, 1003);
  assert.deepEqual(estado.consultas, ['completa', ['oc0', 'oc1', 'oc2']]);
});

test('reconcilia exclusão e criação simultâneas, mesmo com contagem igual', async () => {
  const estado = ambiente([{ id: 'a' }, { id: 'b' }]);
  const { servico } = await criarPagina(estado);
  await servico.listarOcorrencias();
  estado.servidor.delete('a');
  estado.servidor.set('c', { id: 'c' });
  assert.deepEqual(Array.from(await servico.listarOcorrencias(true), d => d.id).sort(), ['b', 'c']);
  assert.equal(estado.documentosLidos, 3);
});

test('alterações são divididas em lotes de até 30 IDs', async () => {
  const estado = ambiente(Array.from({ length: 65 }, (_, i) => ({ id: `oc${i}` })));
  const { servico } = await criarPagina(estado);
  await servico.listarOcorrencias();
  for (const id of estado.servidor.keys()) estado.versoes.set(id, '2');
  await servico.listarOcorrencias(true);
  assert.deepEqual(estado.consultas.slice(1).map(ids => ids.length), [30, 30, 5]);
});

test('SDK pode remover documentos do cache: repõe somente os que faltam', async () => {
  const estado = ambiente([{ id: 'a' }, { id: 'b' }]);
  const { servico } = await criarPagina(estado);
  await servico.listarOcorrencias();
  estado.cache.delete('a');
  const pagina = await criarPagina(estado);
  assert.equal((await pagina.servico.listarOcorrencias()).length, 2);
  assert.equal(estado.documentosLidos, 3);
});

test('requisições simultâneas compartilham a mesma sincronização', async () => {
  const estado = ambiente([{ id: 'a' }]);
  const { servico } = await criarPagina(estado);
  const listas = await Promise.all([servico.listarOcorrencias(), servico.listarOcorrencias()]);
  assert.equal(listas[0].length, 1);
  assert.equal(listas[1].length, 1);
  assert.equal(estado.chamadasApi, 1);
  assert.equal(estado.documentosLidos, 1);
});

test('API indisponível não dispara releitura completa nem afirma que cache está atualizado', async () => {
  const estado = ambiente([{ id: 'a' }]);
  const { servico } = await criarPagina(estado);
  await servico.listarOcorrencias();
  estado.erroApi = 'Backend indisponível';
  await assert.rejects(servico.listarOcorrencias(true), /Backend indisponível/);
  assert.equal(estado.documentosLidos, 1);
});

test('falha do Firestore mantém versões anteriores para tentar novamente', async () => {
  const estado = ambiente([{ id: 'a' }]);
  const { servico } = await criarPagina(estado);
  await servico.listarOcorrencias();
  const marcadorAnterior = estado.storage.values().next().value;
  estado.versoes.set('a', '2');
  estado.erroFirestore = 'Sem permissão';
  await assert.rejects(servico.listarOcorrencias(true), /Sem permissão/);
  assert.equal(estado.storage.values().next().value, marcadorAnterior);
  delete estado.erroFirestore;
  await servico.listarOcorrencias(true);
  assert.equal(estado.documentosLidos, 2);
});

test('índice vazio elimina toda a coleção local sem leituras do Firestore', async () => {
  const estado = ambiente([{ id: 'a' }]);
  const { servico } = await criarPagina(estado);
  await servico.listarOcorrencias();
  estado.servidor.clear();
  assert.equal((await servico.listarOcorrencias(true)).length, 0);
  assert.equal(estado.documentosLidos, 1);
});

test('cache em memória e marcadores são separados por usuário', async () => {
  const estado = ambiente([{ id: 'a' }]);
  const { servico } = await criarPagina(estado);
  await servico.listarOcorrencias();
  estado.usuario = { uid: 'u2', getIdToken: async () => 'token-2' };
  await servico.listarOcorrencias();
  assert.equal(estado.chamadasApi, 2);
  assert.equal(estado.storage.size, 2);
});

test('renovação após cinco minutos reconcilia exclusões sem reler a coleção', async () => {
  const estado = ambiente([{ id: 'a' }, { id: 'b' }]);
  estado.agora = 1_000_000;
  const { servico } = await criarPagina(estado);
  await servico.listarOcorrencias();
  estado.servidor.delete('a');
  estado.agora += 300_001;
  assert.equal((await servico.listarOcorrencias()).length, 1);
  assert.equal(estado.documentosLidos, 2);
  assert.equal(estado.chamadasApi, 2);
});

test('sem sessão autenticada não faz chamadas à API ou ao Firestore', async () => {
  const estado = ambiente([{ id: 'a' }]);
  estado.usuario = null;
  const { servico } = await criarPagina(estado);
  await assert.rejects(servico.listarOcorrencias(), /Entre novamente/);
  assert.equal(estado.chamadasApi, 0);
  assert.equal(estado.documentosLidos, 0);
});
