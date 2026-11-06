import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TrainingStagesSyncService, linhasEtapaTreinamento, resolverCompanyIdDesk,
} from '../dist/infrastructure/ssxDesk/TrainingStagesSyncService.js';
import { listarEmpresasDesk, SsxDeskHttpError } from '../dist/infrastructure/ssxDesk/trainingStages.js';

// Formato real confirmado de GET /companies (ver PLANO_BACKEND_PENDENTE.md): "data" +
// "meta.total", sem "hasMore"/"offset" — diferente da paginação de training-conversations.
const COMPANY_DESK_REAL = {
  id: '56f9...', name: 'Empresa Matriz Ltda', industry: 'Tecnologia', phone: '1140040000',
  isInTraining: true, idCentral: '1042',
  trainingStages: {
    hasStages: true,
    items: [
      { id: 'd4ai...', name: 'Treinamento inicial', status: 'Concluído', sortOrder: 0, notes: null,
        createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-15T09:30:00.000Z' },
    ],
  },
  evaluation: { count: 3, overallAverage: 4.2 },
};

test('listarEmpresasDesk: aceita o formato real (data + meta.total, sem hasMore), ignorando campos extras', async () => {
  const resultado = await listarEmpresasDesk('chave-de-teste', async (url, options) => {
    assert.equal(url.toString(), 'https://ssxdesk.ssatx.com.br/api/integrations/v1/companies');
    assert.equal(options.headers.Authorization, 'Bearer chave-de-teste');
    assert.equal(options.redirect, 'error');
    return Response.json({ data: [COMPANY_DESK_REAL], meta: { total: 1 } });
  });
  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].id, '56f9...');
  assert.equal(resultado[0].idCentral, '1042');
});

test('listarEmpresasDesk: erra de forma explícita quando a lista vem incompleta (sem contrato de paginação confirmado)', async () => {
  await assert.rejects(
    listarEmpresasDesk('chave', async () => Response.json({ data: [COMPANY_DESK_REAL], meta: { total: 5 } })),
    /1 de 5/,
  );
});

test('listarEmpresasDesk: falhas HTTP e respostas inválidas são rejeitadas sem expor a chave', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(listarEmpresasDesk('segredo', async () => new Response('segredo', { status })),
      error => error.message.includes(String(status)) && !error.message.includes('segredo'));
  }
  await assert.rejects(listarEmpresasDesk('segredo', async () => Response.json({ data: [{}], meta: { total: 1 } })), /formato/);
});

test('linhasEtapaTreinamento: status por fase a partir de currentPhase', () => {
  const linhas = linhasEtapaTreinamento({
    temaText: 'Tema 1\nTema 2\nTema 3', currentPhase: 1, updatedAt: 0,
  });
  assert.deepEqual(linhas.map(l => l.status), ['Concluído', 'Em andamento', 'Não concluído']);
  assert.deepEqual(linhas.map(l => l.tema), ['Tema 1', 'Tema 2', 'Tema 3']);
});

test('linhasEtapaTreinamento: linha em branco mantém o índice (não desalinha ids antigos)', () => {
  const linhas = linhasEtapaTreinamento({
    temaText: 'Tema 1\n\nTema 3', currentPhase: 0, updatedAt: 0,
    ssxDeskTrainingStageIds: ['id-0', '', 'id-2'],
  });
  assert.equal(linhas[1].tema, '');
  assert.equal(linhas[0].idDesk, 'id-0');
  assert.equal(linhas[2].idDesk, 'id-2');
});

test('linhasEtapaTreinamento: última fase vira Concluído quando a esteira foi finalizada', () => {
  // Sem dataFinalizacao: cliente só chegou na última fase, ainda trabalhando nela.
  const emAndamento = linhasEtapaTreinamento({
    temaText: 'Tema 1\nTema 2', currentPhase: 1, updatedAt: 0,
  });
  assert.equal(emAndamento[1].status, 'Em andamento');

  // Com dataFinalizacao: esteira inteira já terminada — a última fase também conta como
  // concluída (sem isso, ela nunca teria uma fase seguinte pra currentPhase "passar por cima").
  const finalizada = linhasEtapaTreinamento({
    temaText: 'Tema 1\nTema 2', currentPhase: 1, updatedAt: 0, dataFinalizacao: '2026-11-01',
  });
  assert.deepEqual(finalizada.map(l => l.status), ['Concluído', 'Concluído']);
});

test('linhasEtapaTreinamento: dataFinalizacao só afeta a última fase, não fases intermediárias', () => {
  const linhas = linhasEtapaTreinamento({
    temaText: 'Tema 1\nTema 2\nTema 3', currentPhase: 1, updatedAt: 0, dataFinalizacao: '2026-11-01',
  });
  // currentPhase aponta pra fase do meio, não pra última — dataFinalizacao não se aplica aqui
  // (não deveria acontecer na prática, mas o código não deve tratar como "tudo concluído").
  assert.deepEqual(linhas.map(l => l.status), ['Concluído', 'Em andamento', 'Não concluído']);
});

test('resolverCompanyIdDesk: só resolve quando o idCentral identifica uma única empresa do Desk', () => {
  const companies = [
    { id: 'c1', name: 'Alfa', idCentral: '100' },
    { id: 'c2', name: 'Beta', idCentral: '200' },
    { id: 'c3', name: 'Beta (duplicada)', idCentral: '200' },
  ];
  assert.equal(resolverCompanyIdDesk({ idCentral: '100' }, companies), 'c1');
  assert.equal(resolverCompanyIdDesk({ idCentral: '200' }, companies), undefined); // ambíguo
  assert.equal(resolverCompanyIdDesk({ idCentral: '999' }, companies), undefined); // sem match
  assert.equal(resolverCompanyIdDesk({}, companies), undefined); // sem idCentral
});

// Firestore falso mínimo: suporta doc().get/set/update/update, collection().where('updatedAt','>',x).get.
function database() {
  const empresas = new Map();
  const singles = new Map();

  function snap(id, dados) {
    return { id, exists: dados !== undefined, data: () => dados && structuredClone(dados) };
  }

  function docRefEmpresa(id) {
    return {
      id,
      get: async () => snap(id, empresas.get(id)),
      update: async valor => {
        assert.ok(Object.values(valor).every(v => v !== undefined), 'Firestore não aceita campos undefined');
        assert.ok(!('ssxDeskTrainingStageIds' in valor) || valor.ssxDeskTrainingStageIds.every(v => typeof v === 'string'),
          'Firestore não aceita undefined dentro de arrays');
        empresas.set(id, { ...empresas.get(id), ...valor });
      },
    };
  }

  return {
    doc: path => {
      if (path.startsWith('empresas/')) return docRefEmpresa(path.split('/')[1]);
      return {
        get: async () => ({ exists: singles.has(path), data: () => singles.get(path) && structuredClone(singles.get(path)) }),
        set: async (valor, opcoes) => {
          const atual = opcoes?.merge ? (singles.get(path) || {}) : {};
          singles.set(path, { ...atual, ...valor });
        },
      };
    },
    collection: nome => {
      assert.equal(nome, 'empresas');
      return {
        where: (campo, operador, valor) => ({
          get: async () => {
            assert.equal(campo, 'updatedAt');
            assert.equal(operador, '>');
            const docs = [...empresas.entries()]
              .filter(([, dados]) => dados.updatedAt > valor)
              .map(([id, dados]) => snap(id, dados));
            return { docs };
          },
        }),
        doc: id => docRefEmpresa(id),
      };
    },
    _empresas: () => empresas,
  };
}

function empresa(sobrescritas = {}) {
  return {
    nomeEmpresa: 'Cliente Teste', idCentral: '100', temaText: 'Tema 1\nTema 2',
    currentPhase: 0, updatedAt: Date.now(), ...sobrescritas,
  };
}

function cliente(sobrescritas = {}) {
  const chamadas = { criar: [], atualizar: [], excluir: [] };
  const companies = sobrescritas.companies || [{ id: 'company-1', name: 'Cliente Teste', idCentral: '100' }];
  return {
    chamadas,
    fns: {
      listarEmpresasDesk: sobrescritas.listarEmpresasDesk || (async () => companies),
      criarEtapaTreinamento: sobrescritas.criarEtapaTreinamento || (async (_apiKey, dados) => {
        chamadas.criar.push(dados);
        return { id: `etapa-${chamadas.criar.length}`, ...dados, notes: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      }),
      atualizarEtapaTreinamento: sobrescritas.atualizarEtapaTreinamento || (async (_apiKey, id, dados) => {
        chamadas.atualizar.push({ id, dados });
        return { id, ...dados };
      }),
      excluirEtapaTreinamento: sobrescritas.excluirEtapaTreinamento || (async (_apiKey, id) => { chamadas.excluir.push(id); }),
    },
  };
}

const semEspera = async () => {};

test('empresa nova: cada linha com tema gera POST e grava o id retornado', async () => {
  const db = database();
  db._empresas().set('e1', empresa());
  const c = cliente();
  const service = new TrainingStagesSyncService(db, 'chave', c.fns, semEspera);
  const stats = await service.sincronizar();
  assert.equal(stats.processadas, 1);
  assert.equal(c.chamadas.criar.length, 2);
  assert.deepEqual(c.chamadas.criar[0], { companyId: 'company-1', name: 'Tema 1', status: 'Em andamento', sortOrder: 0 });
  assert.deepEqual(c.chamadas.criar[1], { companyId: 'company-1', name: 'Tema 2', status: 'Não concluído', sortOrder: 1 });
  assert.deepEqual(db._empresas().get('e1').ssxDeskTrainingStageIds, ['etapa-1', 'etapa-2']);
});

test('linha já enviada só gera PUT quando a empresa mudou desde o último envio', async () => {
  const db = database();
  db._empresas().set('e1', empresa({
    ssxDeskTrainingStageIds: ['etapa-1', 'etapa-2'], ssxDeskTrainingStagesSyncedAt: 500, updatedAt: 500,
  }));
  const c = cliente();
  const service = new TrainingStagesSyncService(db, 'chave', c.fns, semEspera);

  // Nada mudou desde o último envio: a empresa entra na janela (há uma consulta de
  // "o que mudou desde o cursor"), mas nenhuma chamada ao Desk é feita.
  const stats1 = await service.sincronizar();
  assert.equal(stats1.ignoradas, 1);
  assert.equal(c.chamadas.atualizar.length, 0);
  assert.equal(c.chamadas.criar.length, 0);

  // Edita a empresa (avança currentPhase e updatedAt): agora deve reenviar como PUT.
  db._empresas().set('e1', { ...db._empresas().get('e1'), currentPhase: 1, updatedAt: Date.now() + 10_000 });
  const stats2 = await service.sincronizar();
  assert.equal(stats2.processadas, 1);
  assert.equal(c.chamadas.criar.length, 0);
  assert.equal(c.chamadas.atualizar.length, 2);
  assert.deepEqual(c.chamadas.atualizar[0].dados.status, 'Concluído');
});

test('trilha encolhida exclui as linhas excedentes do Desk', async () => {
  const db = database();
  db._empresas().set('e1', empresa({
    temaText: 'Tema 1', // era 2 linhas, agora só 1
    ssxDeskTrainingStageIds: ['etapa-1', 'etapa-2'], ssxDeskTrainingStagesSyncedAt: 500, updatedAt: Date.now(),
  }));
  const c = cliente();
  const service = new TrainingStagesSyncService(db, 'chave', c.fns, semEspera);
  await service.sincronizar();
  assert.deepEqual(c.chamadas.excluir, ['etapa-2']);
  assert.deepEqual(db._empresas().get('e1').ssxDeskTrainingStageIds, ['etapa-1']);
});

test('empresa sem idCentral resolvível fica em semVinculo, sem travar as demais', async () => {
  const db = database();
  db._empresas().set('sem-vinculo', empresa({ idCentral: '999' }));
  db._empresas().set('com-vinculo', empresa({ idCentral: '100', temaText: 'Tema único' }));
  const c = cliente();
  const service = new TrainingStagesSyncService(db, 'chave', c.fns, semEspera);
  const stats = await service.sincronizar();
  assert.equal(stats.semVinculo, 1);
  assert.equal(stats.processadas, 1);
  assert.equal(db._empresas().get('sem-vinculo').ssxDeskTrainingStageIds, undefined);
  assert.deepEqual(db._empresas().get('com-vinculo').ssxDeskTrainingStageIds, ['etapa-1']);
});

test('cursor sempre avança mesmo com uma empresa falhando, e a falha é retentada por id', async () => {
  const db = database();
  db._empresas().set('e-ruim', empresa({ idCentral: '100' }));
  const c = cliente({
    criarEtapaTreinamento: async () => { throw new Error('500 falha do Desk'); },
  });
  const service = new TrainingStagesSyncService(db, 'chave', c.fns, semEspera);

  await service.sincronizar();
  const estado1 = (await db.doc('integracoes/ssxDeskTrainingStages').get()).data();
  assert.ok(estado1.lastPushedAt > 0, 'o cursor deve avançar mesmo com uma empresa falhando');
  assert.deepEqual(estado1.empresasComFalha, ['e-ruim']);

  // Empresa nova criada depois que o cursor já avançou: só ela cairia na janela de tempo
  // do próximo ciclo — a antiga precisa continuar sendo tentada por id.
  db._empresas().set('e-nova', empresa({ idCentral: '100', updatedAt: Date.now() + 10_000 }));
  let tentativas = 0;
  c.fns.criarEtapaTreinamento = async (_apiKey, dados) => {
    tentativas++;
    return { id: `etapa-${tentativas}`, ...dados, notes: null, createdAt: '', updatedAt: '' };
  };
  await service.sincronizar();
  const estado2 = (await db.doc('integracoes/ssxDeskTrainingStages').get()).data();
  assert.equal(estado2.empresasComFalha.length, 0, 'a empresa que falhou foi retentada e desta vez funcionou');
  assert.notEqual(db._empresas().get('e-ruim').ssxDeskTrainingStageIds, undefined);
  assert.notEqual(db._empresas().get('e-nova').ssxDeskTrainingStageIds, undefined);
});

test('linha removida (ficou em branco) exclui o id salvo antes, sem recriar', async () => {
  const db = database();
  db._empresas().set('e1', empresa({
    temaText: 'Tema 1\n\nTema 3',
    ssxDeskTrainingStageIds: ['etapa-1', 'etapa-2', 'etapa-3'], ssxDeskTrainingStagesSyncedAt: 500, updatedAt: Date.now(),
  }));
  const c = cliente();
  const service = new TrainingStagesSyncService(db, 'chave', c.fns, semEspera);
  await service.sincronizar();
  assert.deepEqual(c.chamadas.excluir, ['etapa-2']);
  assert.equal(c.chamadas.criar.length, 0);
  assert.deepEqual(db._empresas().get('e1').ssxDeskTrainingStageIds, ['etapa-1', '', 'etapa-3']);
});

test('PUT 404 (id salvo não existe mais no Desk) recria a etapa em vez de falhar pra sempre', async () => {
  const db = database();
  db._empresas().set('e1', empresa({
    ssxDeskTrainingStageIds: ['etapa-velha', 'etapa-2'], ssxDeskTrainingStagesSyncedAt: 500, updatedAt: Date.now(),
  }));
  const tentativasPut = [];
  const c = cliente({
    atualizarEtapaTreinamento: async (_apiKey, id, dados) => {
      tentativasPut.push(id);
      if (id === 'etapa-velha') throw new SsxDeskHttpError('SSX Desk (atualizar etapa) respondeu HTTP 404.', 404);
      return { id, ...dados };
    },
  });
  const service = new TrainingStagesSyncService(db, 'chave', c.fns, semEspera);
  const stats = await service.sincronizar();
  assert.equal(stats.processadas, 1);
  assert.deepEqual(tentativasPut, ['etapa-velha', 'etapa-2'], 'tentou o PUT nas duas linhas antes de recriar a que falhou');
  assert.equal(c.chamadas.criar.length, 1, 'recriou só a linha cujo id tinha sumido do Desk');
  assert.deepEqual(c.chamadas.criar[0], { companyId: 'company-1', name: 'Tema 1', status: 'Em andamento', sortOrder: 0 });
  // O novo id (não mais 'etapa-velha') fica salvo; a linha 2 (PUT normal) mantém o id antigo.
  assert.deepEqual(db._empresas().get('e1').ssxDeskTrainingStageIds, ['etapa-1', 'etapa-2']);
});

test('erro HTTP diferente de 404 no PUT continua propagando (não tenta recriar à toa)', async () => {
  const db = database();
  db._empresas().set('e1', empresa({
    temaText: 'Tema 1',
    ssxDeskTrainingStageIds: ['etapa-1'], ssxDeskTrainingStagesSyncedAt: 500, updatedAt: Date.now(),
  }));
  const c = cliente({
    atualizarEtapaTreinamento: async () => { throw new SsxDeskHttpError('500', 500); },
  });
  const service = new TrainingStagesSyncService(db, 'chave', c.fns, semEspera);
  const stats = await service.sincronizar();
  assert.equal(c.chamadas.criar.length, 0, 'não recria por causa de um erro que não é 404');
  assert.equal(stats.processadas, 0);
  const estado = (await db.doc('integracoes/ssxDeskTrainingStages').get()).data();
  assert.deepEqual(estado.empresasComFalha, ['e1']);
});

test('empresa sem temaText fica em semTemas, sem chamar o Desk', async () => {
  const db = database();
  db._empresas().set('e1', empresa({ temaText: '' }));
  const c = cliente();
  const service = new TrainingStagesSyncService(db, 'chave', c.fns, semEspera);
  const stats = await service.sincronizar();
  assert.equal(stats.semTemas, 1);
  assert.equal(c.chamadas.criar.length, 0);
});
