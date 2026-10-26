import test from 'node:test';
import assert from 'node:assert/strict';
import { ExcluirTarefaConcluida } from '../dist/application/use-cases/ExcluirTarefaConcluida.js';
import { ChecklistController } from '../dist/adapters/controllers/ChecklistController.js';
import { SincronizarTarefasAutomaticas } from '../dist/application/use-cases/SincronizarTarefasAutomaticas.js';
import { firestoreMemoria } from './helpers/firestoreMemoria.mjs';

test('excluir concluídas manuais e automáticas preserva conclusão e registra autor sem apagar atendimentos', async () => {
  for (const automatica of [false, true]) {
    const original = { treinadorId: 'u1', concluida: true, concluidaEm: 123, automatica, descricao: 'Tarefa realizada', createdAt: 1 };
    const { db, data } = firestoreMemoria([['checklist_tarefas/t1', original], ['ocorrencias/o1', { descricao: 'Atendimento' }]]);
    const excluir = new ExcluirTarefaConcluida(db);
    await excluir.execute('t1', 'u1', false);
    const excluida = structuredClone(data.get('checklist_tarefas/t1'));
    assert.equal(excluida.excluida, true);
    assert.equal(excluida.excluidaPorId, 'u1');
    assert.ok(excluida.excluidaEm);
    assert.equal(excluida.concluidaEm, 123);
    assert.equal(excluida.concluida, true);
    assert.deepEqual(data.get('ocorrencias/o1'), { descricao: 'Atendimento' });
    await excluir.execute('t1', 'u1', false);
    assert.deepEqual(data.get('checklist_tarefas/t1'), excluida);
  }
});
test('exclusão confere responsável e conclusão atual; Master pode excluir tarefa da equipe', async () => {
  const { db, data } = firestoreMemoria([['checklist_tarefas/t1', { treinadorId: 'u1', concluida: true }]]);
  const excluir = new ExcluirTarefaConcluida(db);
  await assert.rejects(excluir.execute('t1', 'outro', false), /próprias tarefas/);
  data.get('checklist_tarefas/t1').concluida = false;
  await assert.rejects(excluir.execute('t1', 'u1', false), /não está concluída/);
  assert.equal(data.get('checklist_tarefas/t1').excluida, undefined);
  data.get('checklist_tarefas/t1').concluida = true;
  await excluir.execute('t1', 'master', true);
  assert.equal(data.get('checklist_tarefas/t1').excluidaPorId, 'master');
  await assert.rejects(excluir.execute('t1', 'outro', false), /próprias tarefas/);
  await assert.rejects(excluir.execute('../t1', 'u1', false), /válida/);
});
test('tarefa automática excluída não reaparece no mesmo ciclo; um novo atraso continua gerando tarefa', async () => {
  const agora = Date.parse('2026-10-26T00:00:00-03:00'), dia = 86400000;
  const { db, data } = firestoreMemoria([
    ['usuarios/u1', { role: 'treinador', nome: 'Treinador' }],
    ['empresas/e1', { nomeEmpresa: 'Cliente', responsavel: 'Treinador', currentPhase: 0, temaText: 'Início\nValidação do conhecimento' }],
    ['ocorrencias/o1', { empresa: 'Cliente', tipo: 'Treinamento', dataOcorrencia: agora - 4 * dia }],
  ]);
  const indice = { dados: async nome => [...data].filter(([k]) => k.startsWith(`${nome}/`)).map(([k, v]) => ({ ...structuredClone(v), id: k.split('/')[1] })) };
  const sincronizar = new SincronizarTarefasAutomaticas(db, indice);
  await sincronizar.execute(agora);
  const chave = [...data.keys()].find(k => k.startsWith('checklist_tarefas/'));
  data.get(chave).concluida = true;
  await new ExcluirTarefaConcluida(db).execute(chave.split('/')[1], 'u1', false);
  const excluida = structuredClone(data.get(chave));
  await sincronizar.execute(agora + dia);
  assert.deepEqual(data.get(chave), excluida);
  assert.equal([...data.keys()].filter(k => k.startsWith('checklist_tarefas/')).length, 1);
  data.set('ocorrencias/o2', { empresa: 'Cliente', tipo: 'Treinamento', dataOcorrencia: agora });
  await sincronizar.execute(agora + 4 * dia);
  const tarefas = [...data].filter(([k]) => k.startsWith('checklist_tarefas/')).map(([, v]) => v);
  assert.equal(tarefas.length, 2);
  assert.equal(tarefas.filter(t => !t.excluida && !t.concluida).length, 1);
});
test('API exige token válido e usuário ativo antes de autorizar a exclusão', async () => {
  const usuarios = new Map([
    ['u1', { role: 'treinador' }], ['outro', { role: 'treinador' }],
    ['inativo', { role: 'master', inativo: true }], ['senha', { role: 'master', needsPasswordChange: true }],
    ['desconhecido', { role: 'desconhecido' }],
  ]);
  for (const [token, esperado] of [['', 401], ['invalido', 401], ['inativo', 403], ['senha', 403], ['desconhecido', 403], ['outro', 403], ['u1', 200]]) {
    const { db, data } = firestoreMemoria([['checklist_tarefas/t1', { treinadorId: 'u1', concluida: true }]]);
    const controller = new ChecklistController(db, { verifyIdToken: async (valor, revogado) => { assert.equal(revogado, true); if (!usuarios.has(valor)) throw Error('Token inválido'); return { uid: valor }; } }, { buscarPorUid: async uid => usuarios.get(uid) });
    let status = 200;
    const res = { set() {}, status(n) { status = n; return this; }, json() {} };
    await controller.excluirConcluida({ headers: { authorization: `Bearer ${token}` }, params: { id: 't1' } }, res);
    assert.equal(status, esperado);
    assert.equal(data.get('checklist_tarefas/t1').excluida === true, esperado === 200);
  }
});
