import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TrainingStagesSyncService, linhasEtapaTreinamento, resolverCompanyIdDesk,
} from '../dist/infrastructure/ssxDesk/TrainingStagesSyncService.js';

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

test('empresa sem temaText fica em semTemas, sem chamar o Desk', async () => {
  const db = database();
  db._empresas().set('e1', empresa({ temaText: '' }));
  const c = cliente();
  const service = new TrainingStagesSyncService(db, 'chave', c.fns, semEspera);
  const stats = await service.sincronizar();
  assert.equal(stats.semTemas, 1);
  assert.equal(c.chamadas.criar.length, 0);
});
