import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import ts from 'typescript';

function ambiente(registros) {
  return {
    servidor: new Map(registros.map(d => [d.id, { ...d }])),
    // Cópia local (IndexedDB em produção): registros por id; cacheGravado = já houve uma gravação.
    cache: new Map(), cacheGravado: false, storage: new Map(), versoes: new Map(registros.map(d => [d.id, '1'])),
    consultas: [], documentos: new Map(), documentosLidos: 0, chamadasApi: 0,
    usuario: { uid: 'u1', getIdToken: async () => 'token' },
  };
}

async function criarPagina(estado) {
  const resposta = (ok, corpo) => ({ ok, json: async () => corpo });
  const context = createContext({
    Date: class extends Date { static now() { return estado.agora ?? Date.now(); } }, console, AbortSignal, JSON,
    localStorage: {
      getItem: chave => estado.storage.get(chave) ?? null,
      setItem: (chave, valor) => estado.storage.set(chave, valor),
      removeItem: chave => estado.storage.delete(chave),
    },
    fetch: async (url, opcoes = {}) => {
      if (String(url).endsWith('/documentos')) {
        // Conteúdo servido pela memória do backend (POST /api/sincronizacao/:colecao/documentos).
        if (estado.erroDocumentos) return resposta(false, { error: estado.erroDocumentos });
        const ids = JSON.parse(opcoes.body || '{}').ids;
        estado.consultas.push(ids ? Array.from(ids) : 'completa');
        const registros = [...estado.servidor.values()].filter(d => !ids || ids.includes(d.id));
        estado.documentosLidos += registros.length;
        return resposta(true, { documentos: registros.map(d => ({ ...d })) });
      }
      estado.chamadasApi++;
      if (estado.erroApi) return resposta(false, { error: estado.erroApi });
      return resposta(true, { documentos: [...estado.servidor.keys()].map(id => ({ id, versao: estado.versoes.get(id) || '1' })) });
    },
  });
  const dados = new SyntheticModule([
    'collection', 'addDoc', 'deleteDoc', 'runTransaction', 'doc',
    'getDocsFromServer', 'getDocFromServer', 'query', 'where', 'orderBy', 'limit',
  ], function () {
    this.setExport('collection', (_db, nome) => ({ colecao: nome }));
    this.setExport('doc', (...args) => {
      const segmentos = args.length === 1 && args[0]?.colecao
        ? [args[0].colecao, 'novo-documento']
        : args.slice(1);
      return { id: segmentos.at(-1), path: segmentos.join('/') };
    });
    this.setExport('where', (campo, operador, valor) => ({ campo, operador, valor }));
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
    this.setExport('getDocsFromServer', () => { throw new Error('A sincronização não deve consultar a API de dados.'); });
  }, { context });
  const cacheDocumentos = new SyntheticModule(['lerCache', 'gravarCache', 'apagarCache'], function () {
    this.setExport('lerCache', async () => (estado.cacheGravado ? [...estado.cache.values()].map(d => ({ ...d })) : null));
    this.setExport('gravarCache', async (_chave, registros) => {
      estado.cache = new Map(registros.map(d => [d.id, { ...d }]));
      estado.cacheGravado = true;
    });
    this.setExport('apagarCache', async () => { estado.cache.clear(); estado.cacheGravado = false; });
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
    if (nome === './dados') return dados;
    if (nome === './cacheDocumentos') return cacheDocumentos;
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
  assert.equal(estado.cache.has('2060'), true); // Fantasma permanece na cópia local.
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
  assert.equal(empresa.dataFollowUpFinal, '');
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

test('marca ocorrência informativa antiga e restaura a esteira ao desmarcar', async () => {
  const estado = ambiente([]);
  estado.documentos.set('empresas/empresa-1', {
    nomeEmpresa: 'Empresa A',
    temaText: 'Introdução\nCadastros\nRelatórios',
    currentPhase: 0,
    dataFollowUpFinal: '2026-09-10',
  });
  estado.documentos.set('ocorrencias/ocorrencia-antiga', {
    empresa: 'Empresa A',
    tipo: 'Informativa',
    descricao: 'Registro histórico',
    departamento: 'CS',
    responsavel: 'CS',
    createdAt: new Date('2026-10-01T15:00:00.000Z').getTime(),
    updatedAt: 1,
  });
  const { servico } = await criarPagina(estado);

  await servico.salvarOcorrencia(
    {
      id: 'ocorrencia-antiga',
      empresa: 'Empresa A',
      tipo: 'Informativa',
      descricao: 'Registro histórico',
      departamento: 'CS',
      responsavel: 'CS',
      conclusaoUnilateralCapacitacao: true,
    },
    {
      concluirEsteiraUnilateralmente: {
        empresaId: 'empresa-1',
        dataFinalizacao: '2026-10-01',
      },
    },
  );

  const empresaConcluida = estado.documentos.get('empresas/empresa-1');
  const ocorrenciaConcluida = estado.documentos.get(
    'ocorrencias/ocorrencia-antiga',
  );
  assert.equal(empresaConcluida.dataFinalizacao, '2026-10-01');
  assert.equal(empresaConcluida.dataFollowUpFinal, '');
  assert.equal(empresaConcluida.conclusaoUnilateralOcorrenciaId, 'ocorrencia-antiga');
  assert.equal(ocorrenciaConcluida.conclusaoUnilateralCapacitacao, true);
  assert.equal(
    ocorrenciaConcluida.conclusaoUnilateralEstadoAnterior.currentPhase,
    0,
  );

  await servico.salvarOcorrencia(
    {
      id: 'ocorrencia-antiga',
      empresa: 'Empresa A',
      tipo: 'Informativa',
      descricao: 'Registro histórico',
      departamento: 'CS',
      responsavel: 'CS',
      conclusaoUnilateralCapacitacao: false,
    },
    { reverterConclusaoUnilateralmente: true },
  );

  const empresaRestaurada = estado.documentos.get('empresas/empresa-1');
  const ocorrenciaRestaurada = estado.documentos.get(
    'ocorrencias/ocorrencia-antiga',
  );
  assert.equal(empresaRestaurada.dataFinalizacao, '');
  assert.equal(empresaRestaurada.dataFollowUpFinal, '2026-09-10');
  assert.equal(empresaRestaurada.conclusaoUnilateralOcorrenciaId, '');
  assert.equal(ocorrenciaRestaurada.conclusaoUnilateralCapacitacao, false);
  assert.equal(ocorrenciaRestaurada.conclusaoUnilateralEstadoAnterior, null);
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

test('alterações são divididas em lotes de até 500 IDs', async () => {
  const estado = ambiente(Array.from({ length: 1100 }, (_, i) => ({ id: `oc${i}` })));
  const { servico } = await criarPagina(estado);
  await servico.listarOcorrencias();
  for (const id of estado.servidor.keys()) estado.versoes.set(id, '2');
  await servico.listarOcorrencias(true);
  assert.deepEqual(estado.consultas.slice(1).map(ids => ids.length), [500, 500, 100]);
});

test('cópia local incompleta: repõe somente os documentos que faltam', async () => {
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

test('falha ao buscar documentos mantém versões anteriores para tentar novamente', async () => {
  const estado = ambiente([{ id: 'a' }]);
  const { servico } = await criarPagina(estado);
  await servico.listarOcorrencias();
  const marcadorAnterior = estado.storage.values().next().value;
  estado.versoes.set('a', '2');
  estado.erroDocumentos = 'Sem permissão';
  await assert.rejects(servico.listarOcorrencias(true), /Sem permissão/);
  assert.equal(estado.storage.values().next().value, marcadorAnterior);
  delete estado.erroDocumentos;
  await servico.listarOcorrencias(true);
  assert.equal(estado.documentosLidos, 2);
});

test('índice vazio elimina toda a coleção local sem buscar documentos', async () => {
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

test('sem sessão autenticada não faz chamadas à API', async () => {
  const estado = ambiente([{ id: 'a' }]);
  estado.usuario = null;
  const { servico } = await criarPagina(estado);
  await assert.rejects(servico.listarOcorrencias(), /Entre novamente/);
  assert.equal(estado.chamadasApi, 0);
  assert.equal(estado.documentosLidos, 0);
});
