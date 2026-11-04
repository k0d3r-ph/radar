import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ManagerOpsSyncService, PRIORIDADE_DA_DAILY, PRIORIDADE_PARA_DAILY,
  dueDateApartirDoPrazo, prazoApartirDoDueDate, textoApartirDoCombinado, tituloApartirDaDescricao,
} from '../dist/infrastructure/managerOps/ManagerOpsSyncService.js';

test('prazoApartirDoDueDate: vencimento às 18h de Brasília do dia informado', () => {
  const timestamp = prazoApartirDoDueDate('2026-11-05');
  assert.equal(new Date(timestamp).toISOString(), '2026-11-05T21:00:00.000Z');
});

test('dueDateApartirDoPrazo e prazoApartirDoDueDate são inversas no fuso de Brasília', () => {
  const dueDate = '2026-03-10';
  assert.equal(dueDateApartirDoPrazo(prazoApartirDoDueDate(dueDate)), dueDate);
});

test('tituloApartirDaDescricao: corta em 160 caracteres com reticências, preenche texto curto demais', () => {
  assert.equal(tituloApartirDaDescricao('Ligar para o cliente'), 'Ligar para o cliente');
  assert.equal(tituloApartirDaDescricao('Oi'), 'Oi.');
  assert.equal(tituloApartirDaDescricao('   '), 'Tarefa do Radar');
  const longo = 'x'.repeat(200);
  const titulo = tituloApartirDaDescricao(longo);
  assert.equal(titulo.length, 160);
  assert.equal(titulo.endsWith('...'), true);
});

test('textoApartirDoCombinado: junta título e descrição só quando a descrição existe', () => {
  assert.equal(textoApartirDoCombinado({ title: 'Revisar macro', description: null }), 'Revisar macro');
  assert.equal(textoApartirDoCombinado({ title: 'Revisar macro', description: '  ' }), 'Revisar macro');
  assert.equal(
    textoApartirDoCombinado({ title: 'Revisar macro', description: 'Clientes recebendo resposta errada' }),
    'Revisar macro\n\nClientes recebendo resposta errada',
  );
});

test('mapeamento de prioridade é consistente nos dois sentidos (exceto urgente, sem equivalente)', () => {
  assert.equal(PRIORIDADE_PARA_DAILY.baixa, 'LOW');
  assert.equal(PRIORIDADE_PARA_DAILY.normal, 'NORMAL');
  assert.equal(PRIORIDADE_PARA_DAILY.alta, 'HIGH');
  assert.equal(PRIORIDADE_PARA_DAILY.urgente, 'HIGH');
  for (const daily of ['LOW', 'NORMAL', 'HIGH']) {
    assert.equal(PRIORIDADE_PARA_DAILY[PRIORIDADE_DA_DAILY[daily]], daily);
  }
});

// Firestore falso mínimo: suporta doc().get/set/update, collection().add/get, e
// where(campo, operador, valor) com '==' e '>', que é tudo que o serviço usa.
function database(usuariosIniciais = []) {
  const colecoes = new Map();
  colecoes.set('usuarios', new Map(usuariosIniciais.map(u => [u.uid, u])));
  const singles = new Map(); // docs fora de coleção (ex.: integracoes/managerOps)
  let proximoId = 1;

  function dadosColecao(nome) {
    if (!colecoes.has(nome)) colecoes.set(nome, new Map());
    return colecoes.get(nome);
  }

  function snap(id, dados) {
    return { id, exists: dados !== undefined, data: () => dados && structuredClone(dados), ref: docRef(id) };
  }

  function docRef(id, nomeColecao = 'checklist_tarefas') {
    return {
      id,
      get: async () => snap(id, dadosColecao(nomeColecao).get(id)),
      set: async (valor, opcoes) => {
        assert.ok(Object.values(valor).every(dado => dado !== undefined), 'Firestore não aceita campos undefined');
        const atual = opcoes?.merge ? (singles.get(id) || {}) : {};
        singles.set(id, { ...atual, ...valor });
      },
      update: async valor => {
        assert.ok(Object.values(valor).every(dado => dado !== undefined), 'Firestore não aceita campos undefined');
        const atual = dadosColecao(nomeColecao).get(id);
        dadosColecao(nomeColecao).set(id, { ...atual, ...valor });
      },
    };
  }

  function query(nomeColecao, filtros = [], limite = Infinity) {
    return {
      where: (campo, operador, valor) => query(nomeColecao, [...filtros, { campo, operador, valor }], limite),
      limit: n => query(nomeColecao, filtros, n),
      get: async () => {
        const todos = [...dadosColecao(nomeColecao).entries()]
          .filter(([, dados]) => filtros.every(({ campo, operador, valor }) => {
            const atual = dados[campo];
            if (operador === '==') return atual === valor;
            if (operador === '>') return typeof atual === 'number' && atual > valor;
            throw new Error(`operador não suportado no fake: ${operador}`);
          }))
          .slice(0, limite)
          .map(([id, dados]) => snap(id, dados));
        return { empty: todos.length === 0, docs: todos };
      },
    };
  }

  return {
    doc: path => {
      if (path.includes('/')) {
        const [col, id] = path.split('/');
        return docRef(id, col);
      }
      return {
        id: path,
        get: async () => ({ exists: singles.has(path), data: () => singles.get(path) && structuredClone(singles.get(path)) }),
        set: async (valor, opcoes) => {
          const atual = opcoes?.merge ? (singles.get(path) || {}) : {};
          singles.set(path, { ...atual, ...valor });
        },
      };
    },
    collection: nome => ({
      ...query(nome),
      add: async dados => {
        assert.ok(Object.values(dados).every(dado => dado !== undefined), 'Firestore não aceita campos undefined');
        const id = `gerado-${proximoId++}`;
        dadosColecao(nome).set(id, structuredClone(dados));
        return docRef(id, nome);
      },
      doc: id => docRef(id, nome),
    }),
    // Acesso direto pros testes conferirem o estado gravado.
    _tarefas: () => dadosColecao('checklist_tarefas'),
  };
}

function cliente(sobrescritas = {}) {
  const chamadas = { listar: 0, criar: [], atualizar: [], excluir: [] };
  return {
    chamadas,
    fns: {
      listarTodosCombinados: sobrescritas.listarTodosCombinados || (async () => { chamadas.listar++; return []; }),
      criarCombinado: sobrescritas.criarCombinado || (async (_apiKey, dados) => {
        chamadas.criar.push(dados);
        return { id: `combinado-${chamadas.criar.length}`, ...dados, status: 'OPEN', priority: dados.priority || 'NORMAL', updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), member: { email: dados.memberEmail } };
      }),
      atualizarCombinado: sobrescritas.atualizarCombinado || (async (_apiKey, id, dados) => { chamadas.atualizar.push({ id, dados }); return { id }; }),
      excluirCombinado: sobrescritas.excluirCombinado || (async (_apiKey, id) => { chamadas.excluir.push(id); }),
    },
  };
}

const usuaria = { uid: 'uid-clarice', nome: 'Clarice', email: 'clarice@empresa.com.br' };

function agreement(sobrescritas = {}) {
  return {
    id: 'combinado-1',
    title: 'Revisar macro',
    description: 'Clientes recebendo resposta errada',
    status: 'OPEN',
    priority: 'NORMAL',
    origin: 'API',
    member: { id: 'm-1', name: 'Clarice', email: 'clarice@empresa.com.br' },
    central: null,
    dueDate: '2026-11-05',
    originalDueDate: '2026-11-05',
    completedAt: null,
    outcome: null,
    createdAt: '2026-11-03T13:02:11.000Z',
    updatedAt: '2026-11-03T13:02:11.000Z',
    ...sobrescritas,
  };
}

test('puxar: combinado novo da Daily cria tarefa no Radar com o prazo e marca o vínculo', async () => {
  const db = database([usuaria]);
  const c = cliente({ listarTodosCombinados: async () => [agreement()] });
  await new ManagerOpsSyncService(db, 'chave', c.fns).sincronizar();
  const tarefas = [...db._tarefas().values()];
  assert.equal(tarefas.length, 1);
  assert.equal(tarefas[0].treinadorId, 'uid-clarice');
  assert.equal(tarefas[0].idTarefaDaily, 'combinado-1');
  assert.equal(tarefas[0].descricao, 'Revisar macro\n\nClientes recebendo resposta errada');
  assert.equal(new Date(tarefas[0].slaEm).toISOString(), '2026-11-05T21:00:00.000Z');
});

test('puxar: combinado aberto sem prazo persiste sem campos undefined', async () => {
  const db = database([usuaria]);
  const c = cliente({ listarTodosCombinados: async () => [agreement({ dueDate: null })] });
  await new ManagerOpsSyncService(db, 'chave', c.fns).sincronizar();
  const tarefa = [...db._tarefas().values()][0];
  assert.equal(tarefa.concluida, false);
  assert.equal(tarefa.slaEm, undefined);
  assert.equal(tarefa.concluidaEm, undefined);
});

test('puxar: atualizar combinado aberto não envia campos undefined ao Firestore', async () => {
  const db = database([usuaria]);
  db._tarefas().set('tarefa-1', {
    treinadorId: 'uid-clarice', treinadorNome: 'Clarice', descricao: 'Texto anterior',
    concluida: false, criadoPorId: 'uid-clarice', criadoPorNome: 'Clarice',
    createdAt: 1000, updatedAt: 1000, idTarefaDaily: 'combinado-1', managerOpsSyncedAt: 1000,
  });
  const c = cliente({ listarTodosCombinados: async () => [agreement()] });
  await new ManagerOpsSyncService(db, 'chave', c.fns).sincronizar();
  const tarefa = db._tarefas().get('tarefa-1');
  assert.equal(tarefa.descricao, 'Revisar macro\n\nClientes recebendo resposta errada');
  assert.equal(tarefa.excluida, false);
});

test('puxar: combinado sem responsável correspondente no Radar não cria tarefa (fica em semResponsavel)', async () => {
  const db = database([]); // nenhum usuário cadastrado
  const c = cliente({ listarTodosCombinados: async () => [agreement()] });
  const stats = await new ManagerOpsSyncService(db, 'chave', c.fns).sincronizar();
  assert.equal(stats.puxadas.semResponsavel, 1);
  assert.equal(db._tarefas().size, 0);
});

test('conflito: edição local mais recente que a Daily não é sobrescrita na puxada', async () => {
  const db = database([usuaria]);
  db._tarefas().set('tarefa-1', {
    treinadorId: 'uid-clarice', treinadorNome: 'Clarice', descricao: 'Texto editado no Radar',
    concluida: false, criadoPorId: '', criadoPorNome: 'Daily (sincronização automática)',
    createdAt: 1000, updatedAt: 2_000_000_000_000, // bem mais recente que o combinado de teste
    idTarefaDaily: 'combinado-1', managerOpsSyncedAt: 1000,
  });
  const c = cliente({ listarTodosCombinados: async () => [agreement()] }); // updatedAt de 2026
  await new ManagerOpsSyncService(db, 'chave', c.fns).sincronizar();
  assert.equal(db._tarefas().get('tarefa-1').descricao, 'Texto editado no Radar');
});

test('empurrar: tarefa nova do Radar cria combinado na Daily e grava o vínculo', async () => {
  const db = database([usuaria]);
  db._tarefas().set('tarefa-1', {
    treinadorId: 'uid-clarice', treinadorNome: 'Clarice', descricao: 'Ligar para o cliente',
    concluida: false, criadoPorId: 'uid-clarice', criadoPorNome: 'Clarice',
    createdAt: Date.now(), prioridade: 'alta', slaEm: Date.parse('2026-11-05T21:00:00.000Z'),
  });
  const c = cliente();
  await new ManagerOpsSyncService(db, 'chave', c.fns).sincronizar();
  assert.equal(c.chamadas.criar.length, 1);
  assert.equal(c.chamadas.criar[0].memberEmail, 'clarice@empresa.com.br');
  assert.equal(c.chamadas.criar[0].priority, 'HIGH');
  assert.equal(c.chamadas.criar[0].dueDate, '2026-11-05');
  assert.equal(db._tarefas().get('tarefa-1').idTarefaDaily, 'combinado-1');
});

test('empurrar: concluir a tarefa no Radar manda status DONE; reabrir depois não reenvia status', async () => {
  const db = database([usuaria]);
  db._tarefas().set('tarefa-1', {
    treinadorId: 'uid-clarice', treinadorNome: 'Clarice', descricao: 'Ligar para o cliente',
    concluida: true, criadoPorId: 'uid-clarice', criadoPorNome: 'Clarice',
    createdAt: 1000, updatedAt: 2000, idTarefaDaily: 'combinado-1', managerOpsSyncedAt: 1000,
  });
  const c = cliente();
  await new ManagerOpsSyncService(db, 'chave', c.fns).sincronizar();
  assert.deepEqual(c.chamadas.atualizar[0], { id: 'combinado-1', dados: { status: 'DONE' } });

  // Reabre a tarefa localmente — já foi sincronizada como DONE antes (managerOpsSyncedAt
  // avançou), então precisa de uma edição nova (updatedAt) pra ser reconsiderada.
  db._tarefas().set('tarefa-1', { ...db._tarefas().get('tarefa-1'), concluida: false, updatedAt: Date.now() + 10_000 });
  c.chamadas.atualizar.length = 0;
  await new ManagerOpsSyncService(db, 'chave', c.fns).sincronizar();
  assert.equal(c.chamadas.atualizar.length, 1);
  assert.equal('status' in c.chamadas.atualizar[0].dados, false);
});

test('empurrar: tarefa excluída manda excluir o combinado vinculado', async () => {
  const db = database([usuaria]);
  db._tarefas().set('tarefa-1', {
    treinadorId: 'uid-clarice', treinadorNome: 'Clarice', descricao: 'Ligar para o cliente',
    concluida: false, excluida: true, criadoPorId: 'uid-clarice', criadoPorNome: 'Clarice',
    createdAt: 1000, updatedAt: 2000, idTarefaDaily: 'combinado-1', managerOpsSyncedAt: 1000,
  });
  const c = cliente();
  await new ManagerOpsSyncService(db, 'chave', c.fns).sincronizar();
  assert.deepEqual(c.chamadas.excluir, ['combinado-1']);
});

test('ida e volta: puxar uma mudança da Daily não a empurra de volta no mesmo ciclo nem no seguinte', async () => {
  const db = database([usuaria]);
  const c = cliente({ listarTodosCombinados: async () => [agreement({ status: 'DONE', completedAt: '2026-11-04T10:00:00.000Z' })] });
  await new ManagerOpsSyncService(db, 'chave', c.fns).sincronizar();
  assert.equal(c.chamadas.criar.length, 0);
  assert.equal(c.chamadas.atualizar.length, 0);

  c.fns.listarTodosCombinados = async () => []; // nada novo na Daily neste ciclo
  await new ManagerOpsSyncService(db, 'chave', c.fns).sincronizar();
  assert.equal(c.chamadas.criar.length, 0);
  assert.equal(c.chamadas.atualizar.length, 0);
  assert.equal(c.chamadas.excluir.length, 0);
});

test('automática: tarefa automática do sistema nunca é empurrada para a Daily', async () => {
  const db = database([usuaria]);
  db._tarefas().set('tarefa-1', {
    treinadorId: 'uid-clarice', treinadorNome: 'Clarice', descricao: 'Lembrete automático',
    concluida: false, automatica: true, criadoPorId: '', criadoPorNome: 'Sistema',
    createdAt: Date.now(),
  });
  const c = cliente();
  await new ManagerOpsSyncService(db, 'chave', c.fns).sincronizar();
  assert.equal(c.chamadas.criar.length, 0);
  assert.equal(db._tarefas().get('tarefa-1').idTarefaDaily, undefined);
});

test('uma tarefa com erro ao empurrar não bloqueia as demais do mesmo ciclo', async () => {
  const db = database([usuaria, { uid: 'uid-bruno', nome: 'Bruno', email: 'bruno@empresa.com.br' }]);
  db._tarefas().set('tarefa-ruim', {
    treinadorId: 'uid-clarice', treinadorNome: 'Clarice', descricao: 'Vai falhar',
    concluida: false, criadoPorId: 'uid-clarice', criadoPorNome: 'Clarice', createdAt: 1000,
  });
  db._tarefas().set('tarefa-boa', {
    treinadorId: 'uid-bruno', treinadorNome: 'Bruno', descricao: 'Vai funcionar',
    concluida: false, criadoPorId: 'uid-bruno', criadoPorNome: 'Bruno', createdAt: 2000,
  });
  const c = cliente({
    criarCombinado: async (_apiKey, dados) => {
      if (dados.memberEmail === 'clarice@empresa.com.br') throw new Error('422 pessoa não encontrada');
      return { id: 'combinado-boa', ...dados, status: 'OPEN', priority: 'NORMAL', updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), member: { email: dados.memberEmail } };
    },
  });
  await new ManagerOpsSyncService(db, 'chave', c.fns).sincronizar();
  assert.equal(db._tarefas().get('tarefa-boa').idTarefaDaily, 'combinado-boa');
  assert.equal(db._tarefas().get('tarefa-ruim').idTarefaDaily, undefined);
});

test('empurrar: tarefa com falha temporária continua elegível para nova tentativa após o ciclo', async () => {
  const db = database([usuaria]);
  db._tarefas().set('tarefa-antiga', {
    treinadorId: 'uid-clarice', treinadorNome: 'Clarice', descricao: 'Tarefa que precisa ser enviada',
    concluida: false, criadoPorId: 'uid-clarice', criadoPorNome: 'Clarice', createdAt: 1000,
  });
  let tentativas = 0;
  const c = cliente({
    criarCombinado: async (_apiKey, dados) => {
      tentativas++;
      if (tentativas === 1) throw new Error('falha temporária');
      return { id: 'combinado-recuperado', ...dados, status: 'OPEN', priority: 'NORMAL', updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), member: { email: dados.memberEmail } };
    },
  });
  const service = new ManagerOpsSyncService(db, 'chave', c.fns);
  await service.sincronizar();
  assert.equal(db._tarefas().get('tarefa-antiga').idTarefaDaily, undefined);
  await service.sincronizar();
  assert.equal(tentativas, 2);
  assert.equal(db._tarefas().get('tarefa-antiga').idTarefaDaily, 'combinado-recuperado');
});
