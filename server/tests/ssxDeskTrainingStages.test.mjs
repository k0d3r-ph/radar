import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TrainingStagesSyncService, linhasEtapaTreinamento, reconciliarEtapasEmpresa, resolverCompanyIdDesk,
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

test('linhasEtapaTreinamento: status por fase a partir de currentPhase — a fase atual também conta como Concluído', () => {
  // currentPhase só avança quando um tema é efetivamente ensinado (nunca aponta pra um
  // tema ainda não dado) — por isso não existe "Em andamento": só Concluído ou Não concluído.
  const linhas = linhasEtapaTreinamento({
    temaText: 'Tema 1\nTema 2\nTema 3', currentPhase: 1, updatedAt: 0,
  });
  assert.deepEqual(linhas.map(l => l.status), ['Concluído', 'Concluído', 'Não concluído']);
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

test('linhasEtapaTreinamento: última fase vira Concluído assim que alcançada, sem depender de dataFinalizacao', () => {
  // currentPhase na última fase já é suficiente — não precisa de dataFinalizacao preenchida
  // pra tirar a última etapa de "Em andamento" (que nem existe mais como status possível).
  const linhas = linhasEtapaTreinamento({ temaText: 'Tema 1\nTema 2', currentPhase: 1, updatedAt: 0 });
  assert.deepEqual(linhas.map(l => l.status), ['Concluído', 'Concluído']);
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
});

test('resolverCompanyIdDesk: sem idCentral no Radar, cai para nome exato e único (mesma regra da sincronização de entrada)', () => {
  const companies = [
    { id: 'c1', name: 'Alfa', idCentral: '100' },
    { id: 'c2', name: 'Numpe', idCentral: null },
    { id: 'c3', name: 'Beta', idCentral: '200' },
    { id: 'c4', name: 'Beta', idCentral: '201' }, // nome ambíguo no Desk
    { id: 'c5', name: 'Gama', idCentral: '300' },
  ];
  // Sem idCentral cadastrado no Radar (caso comum de cadastro antigo) — resolve por nome único.
  assert.equal(resolverCompanyIdDesk({ nomeEmpresa: 'Numpe' }, companies), 'c2');
  // Ignora acentos, caixa e espaços nas extremidades, igual à sincronização de entrada.
  assert.equal(resolverCompanyIdDesk({ nomeEmpresa: '  NUMPÉ  ' }, companies), 'c2');
  // Nome ambíguo no Desk (duas empresas "Beta") não resolve só por nome.
  assert.equal(resolverCompanyIdDesk({ nomeEmpresa: 'Beta' }, companies), undefined);
  // idCentral já preenchido no Radar, mas divergente do idCentral já cadastrado no Desk
  // pra essa empresa (achada por nome) — não aceita o nome por cima de um conflito real.
  assert.equal(resolverCompanyIdDesk({ nomeEmpresa: 'Gama', idCentral: '999' }, companies), undefined);
  // idCentral do Radar sem match e a empresa achada por nome não tem idCentral cadastrado
  // no Desk (nenhum conflito real, só o Radar aponta pra um idCentral que não existe lá) — resolve.
  assert.equal(resolverCompanyIdDesk({ nomeEmpresa: 'Numpe', idCentral: '999' }, companies), 'c2');
  assert.equal(resolverCompanyIdDesk({}, companies), undefined); // sem idCentral
});

function etapaDesk(sobrescritas = {}) {
  return {
    id: 'etapa', companyId: 'company-1', name: 'Tema', status: 'Em andamento', sortOrder: 0,
    notes: null, createdAt: '', updatedAt: '', ...sobrescritas,
  };
}

test('reconciliarEtapasEmpresa: sem dados do Desk, confia cegamente no array local (comportamento anterior)', () => {
  const linhas = linhasEtapaTreinamento({ temaText: 'Tema 1\nTema 2', currentPhase: 0, updatedAt: 0 });
  const resultado = reconciliarEtapasEmpresa(linhas, ['id-salvo', ''], []);
  assert.deepEqual(resultado.ids, ['id-salvo', '']);
  assert.deepEqual(resultado.idsDuplicados, []);
});

test('reconciliarEtapasEmpresa: recupera o id certo quando a linha foi reordenada (id salvo aponta para outro nome)', () => {
  // "Validação 2" estava na posição 1 (id "etapa-2"); depois de um tema ensinado fora de
  // ordem, reordenarTemasEnsinados moveu "Validação 1" pra posição 1 e "Validação 2" pra 0
  // — o array local (por posição) não acompanhou, mas o Desk ainda tem as duas etapas.
  const linhas = linhasEtapaTreinamento({
    temaText: 'Validação 2\nValidação 1', currentPhase: 1, updatedAt: 0,
  });
  const etapasDesk = [
    etapaDesk({ id: 'etapa-1', name: 'Validação 1' }),
    etapaDesk({ id: 'etapa-2', name: 'Validação 2' }),
  ];
  // Array local ainda na ordem antiga: posição 0 tinha "Validação 1" (id etapa-1), posição
  // 1 tinha "Validação 2" (id etapa-2) — agora desalinhado com o novo temaText.
  const resultado = reconciliarEtapasEmpresa(linhas, ['etapa-1', 'etapa-2'], etapasDesk);
  assert.deepEqual(resultado.ids, ['etapa-2', 'etapa-1'], 'recupera o id de cada etapa pelo nome, não pela posição antiga');
  assert.deepEqual(resultado.idsDuplicados, []);
});

test('reconciliarEtapasEmpresa: etapa duplicada no Desk (sobra de uma reordenação antiga) é marcada pra excluir', () => {
  const linhas = linhasEtapaTreinamento({ temaText: 'Validação 1\nValidação 2', currentPhase: 1, updatedAt: 0 });
  const etapasDesk = [
    etapaDesk({ id: 'etapa-1a', name: 'Validação 1' }),
    etapaDesk({ id: 'etapa-1b', name: 'Validação 1' }), // duplicata: sobrou de uma reordenação
    etapaDesk({ id: 'etapa-2', name: 'Validação 2' }),
  ];
  const resultado = reconciliarEtapasEmpresa(linhas, ['etapa-1a', 'etapa-2'], etapasDesk);
  assert.deepEqual(resultado.ids, ['etapa-1a', 'etapa-2']);
  assert.deepEqual(resultado.idsDuplicados, ['etapa-1b']);
});

test('reconciliarEtapasEmpresa: id salvo não existe mais no Desk, mas uma etapa com o mesmo nome existe — reusa em vez de recriar', () => {
  const linhas = linhasEtapaTreinamento({ temaText: 'Tema 1', currentPhase: 0, updatedAt: 0 });
  const etapasDesk = [etapaDesk({ id: 'etapa-nova', name: 'Tema 1' })];
  const resultado = reconciliarEtapasEmpresa(linhas, ['etapa-antiga-sumida'], etapasDesk);
  assert.deepEqual(resultado.ids, ['etapa-nova']);
});

test('reconciliarEtapasEmpresa: etapa já existe com o id e nome certos, mas o status no Desk ficou desatualizado (caso real do Altotrak)', () => {
  // "Conclusão" já tinha id e nome batendo, mas um envio passado mandou "Em andamento" —
  // o Radar recalcula "Concluído" agora (currentPhase já alcançou a última fase).
  const linhas = linhasEtapaTreinamento({ temaText: 'Tema 1\nConclusão', currentPhase: 1, updatedAt: 0 });
  const etapasDesk = [
    etapaDesk({ id: 'etapa-1', name: 'Tema 1', status: 'Concluído' }),
    etapaDesk({ id: 'etapa-2', name: 'Conclusão', status: 'Em andamento' }), // desatualizada
  ];
  const resultado = reconciliarEtapasEmpresa(linhas, ['etapa-1', 'etapa-2'], etapasDesk);
  assert.deepEqual(resultado.ids, ['etapa-1', 'etapa-2'], 'mantém os ids certos, não recria nada');
  assert.equal(resultado.statusDivergente, true, 'sinaliza a divergência pra forçar o reenvio');
});

test('reconciliarEtapasEmpresa: tudo já bate (id, nome e status) — sem divergência', () => {
  const linhas = linhasEtapaTreinamento({ temaText: 'Tema 1\nTema 2', currentPhase: 1, updatedAt: 0 });
  const etapasDesk = [
    etapaDesk({ id: 'etapa-1', name: 'Tema 1', status: 'Concluído' }),
    etapaDesk({ id: 'etapa-2', name: 'Tema 2', status: 'Concluído' }),
  ];
  const resultado = reconciliarEtapasEmpresa(linhas, ['etapa-1', 'etapa-2'], etapasDesk);
  assert.equal(resultado.statusDivergente, false);
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
  assert.deepEqual(c.chamadas.criar[0], { companyId: 'company-1', name: 'Tema 1', status: 'Concluído', sortOrder: 0 });
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
  assert.deepEqual(c.chamadas.criar[0], { companyId: 'company-1', name: 'Tema 1', status: 'Concluído', sortOrder: 0 });
  // O novo id (não mais 'etapa-velha') fica salvo; a linha 2 (PUT normal) mantém o id antigo.
  assert.deepEqual(db._empresas().get('e1').ssxDeskTrainingStageIds, ['etapa-1', 'etapa-2']);
});

test('PUT 404 numa etapa recém-confirmada na listagem do Desk NÃO recria (evita duplicar sob falha transitória da API — caso real do Numpe, 3ª geração de etapas)', async () => {
  const db = database();
  db._empresas().set('e1', empresa({
    temaText: 'Tema 1\nTema 2',
    ssxDeskTrainingStageIds: ['etapa-1', 'etapa-2'], ssxDeskTrainingStagesSyncedAt: 500, updatedAt: Date.now(),
  }));
  const companies = [{
    id: 'company-1', name: 'Cliente Teste', idCentral: '100',
    // A listagem do Desk CONFIRMA que etapa-1 existe segundos antes do PUT — diferente do
    // teste acima (sem trainingStages nenhum, onde um 404 é tratado como exclusão real).
    trainingStages: {
      hasStages: true,
      items: [
        etapaDesk({ id: 'etapa-1', name: 'Tema 1' }),
        etapaDesk({ id: 'etapa-2', name: 'Tema 2' }),
      ],
    },
  }];
  const c = cliente({
    companies,
    atualizarEtapaTreinamento: async (_apiKey, id) => {
      if (id === 'etapa-1') throw new SsxDeskHttpError('SSX Desk (atualizar etapa) respondeu HTTP 404.', 404);
      return { id };
    },
  });
  const service = new TrainingStagesSyncService(db, 'chave', c.fns, semEspera);
  const stats = await service.sincronizar();
  assert.equal(stats.processadas, 0);
  assert.equal(c.chamadas.criar.length, 0, 'não recria — a etapa foi confirmada existente segundos antes');
  const estado = (await db.doc('integracoes/ssxDeskTrainingStages').get()).data();
  assert.deepEqual(estado.empresasComFalha, ['e1'], 'fica marcada pra tentar de novo no próximo ciclo');
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

test('empresa com etapas duplicadas no Desk (reordenação antiga): recupera os ids certos por nome e exclui a sobra', async () => {
  const db = database();
  db._empresas().set('e1', empresa({
    temaText: 'Validação 1\nValidação 2',
    // Array local desalinhado (mesmo bug relatado): guardava "Validação 2" na posição 0.
    ssxDeskTrainingStageIds: ['etapa-2', 'etapa-1a'],
    ssxDeskTrainingStagesSyncedAt: 500, updatedAt: Date.now(),
  }));
  const companies = [{
    id: 'company-1', name: 'Cliente Teste', idCentral: '100',
    trainingStages: {
      hasStages: true,
      items: [
        etapaDesk({ id: 'etapa-1a', name: 'Validação 1', sortOrder: 0 }),
        etapaDesk({ id: 'etapa-1b', name: 'Validação 1', sortOrder: 1 }), // duplicata órfã
        etapaDesk({ id: 'etapa-2', name: 'Validação 2', sortOrder: 2 }),
      ],
    },
  }];
  const c = cliente({ companies });
  const service = new TrainingStagesSyncService(db, 'chave', c.fns, semEspera);
  const stats = await service.sincronizar();
  assert.equal(stats.processadas, 1);
  assert.equal(c.chamadas.criar.length, 0, 'não recria etapas que já existem, só deslocadas');
  assert.deepEqual(c.chamadas.excluir, ['etapa-1b'], 'exclui só a duplicata órfã');
  assert.deepEqual(
    c.chamadas.atualizar.map(a => a.id).sort(),
    ['etapa-1a', 'etapa-2'],
    'atualiza as duas etapas certas (recuperadas por nome), não as posições desalinhadas',
  );
  assert.deepEqual(db._empresas().get('e1').ssxDeskTrainingStageIds, ['etapa-1a', 'etapa-2']);
});

test('Desk reporta hasStages=true sem itens e já há ids salvos: não recria (caso real do Numpe, duas gerações de etapas)', async () => {
  const db = database();
  db._empresas().set('e1', empresa({
    temaText: 'Tema 1\nTema 2',
    ssxDeskTrainingStageIds: ['etapa-1', 'etapa-2'],
    ssxDeskTrainingStagesSyncedAt: 500, updatedAt: Date.now(),
  }));
  const companies = [{
    id: 'company-1', name: 'Cliente Teste', idCentral: '100',
    // hasStages: true, mas o Desk não devolveu os itens nesta resposta (API instável) —
    // sem essa checagem, o fallback "sem dados do Desk" recriaria as duas etapas,
    // duplicando as que já existem (não visíveis aqui só porque a API falhou em listá-las).
    trainingStages: { hasStages: true, items: [] },
  }];
  const c = cliente({ companies });
  const service = new TrainingStagesSyncService(db, 'chave', c.fns, semEspera);
  const stats = await service.sincronizar();
  assert.equal(stats.processadas, 0);
  assert.equal(c.chamadas.criar.length, 0, 'não cria nada — melhor pular o ciclo do que arriscar duplicar');
  assert.equal(c.chamadas.atualizar.length, 0);
  const estado = (await db.doc('integracoes/ssxDeskTrainingStages').get()).data();
  assert.deepEqual(estado.empresasComFalha, ['e1'], 'fica marcada pra tentar de novo no próximo ciclo');
});

test('Desk reporta hasStages=true sem itens, mas é empresa nova (sem ids salvos) — cria normalmente', async () => {
  const db = database();
  db._empresas().set('e1', empresa({ temaText: 'Tema 1\nTema 2' })); // sem ssxDeskTrainingStageIds
  const companies = [{
    id: 'company-1', name: 'Cliente Teste', idCentral: '100',
    trainingStages: { hasStages: true, items: [] },
  }];
  const c = cliente({ companies });
  const service = new TrainingStagesSyncService(db, 'chave', c.fns, semEspera);
  const stats = await service.sincronizar();
  assert.equal(stats.processadas, 1);
  assert.equal(c.chamadas.criar.length, 2, 'sem id local salvo, não há risco de duplicar — cria normalmente');
});

test('empresa parada (updatedAt antigo) mas com uma etapa desatualizada no Desk: reenvia e corrige, mesmo sem precisaReenviar por updatedAt (caso real do Altotrak)', async () => {
  const db = database();
  db._empresas().set('e1', empresa({
    temaText: 'Tema 1\nConclusão', currentPhase: 1,
    ssxDeskTrainingStageIds: ['etapa-1', 'etapa-2'],
    // syncedAt bem DEPOIS de updatedAt — pelo critério de "mudou desde o último envio",
    // essa empresa estaria "em dia" e não seria reenviada.
    ssxDeskTrainingStagesSyncedAt: Date.now(), updatedAt: Date.now() - 1_000_000,
  }));
  const companies = [{
    id: 'company-1', name: 'Cliente Teste', idCentral: '100',
    trainingStages: {
      hasStages: true,
      items: [
        etapaDesk({ id: 'etapa-1', name: 'Tema 1', status: 'Concluído', sortOrder: 0 }),
        etapaDesk({ id: 'etapa-2', name: 'Conclusão', status: 'Em andamento', sortOrder: 1 }), // travada
      ],
    },
  }];
  const c = cliente({ companies });
  const service = new TrainingStagesSyncService(db, 'chave', c.fns, semEspera);
  const stats = await service.sincronizar();
  assert.equal(stats.processadas, 1, 'reprocessa mesmo sem updatedAt ter mudado, por causa da divergência de status');
  const putConclusao = c.chamadas.atualizar.find((a) => a.id === 'etapa-2');
  assert.ok(putConclusao, 'reenviou a etapa "Conclusão"');
  assert.equal(putConclusao.dados.status, 'Concluído', 'corrige o status travado no Desk');
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
