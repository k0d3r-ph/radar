import test from 'node:test';
import assert from 'node:assert/strict';
import { SincronizarTarefasAutomaticas } from '../dist/application/use-cases/SincronizarTarefasAutomaticas.js';
import { calcularSituacaoAcompanhamento } from '../dist/domain/acompanhamentoEsteira.js';
import { firestoreMemoria } from './helpers/firestoreMemoria.mjs';
const agora = Date.parse('2026-10-26T00:00:00-03:00');
const dia = 86400000;
const empresa = { nomeEmpresa: 'Cliente', responsavel: 'Treinador', temaText: 'Início\nTema\nValidação do conhecimento', currentPhase: 2, dataFinalizacao: '2026-10-06' };
test('follow-up usa 20 dias desde finalização mesmo com atividade recente; agenda usa 4 dias com esteira incompleta', () => {
  const contato = { empresa: 'Cliente', tipo: 'Treinamento', dataOcorrencia: agora - dia };
  assert.equal(calcularSituacaoAcompanhamento(empresa, [contato], agora - dia).tipo, null);
  assert.equal(calcularSituacaoAcompanhamento(empresa, [contato], agora).tipo, 'follow_up_final');
  assert.equal(calcularSituacaoAcompanhamento({ ...empresa, dataFollowUpFinal: '2026-10-26' }, [], agora).tipo, null);
  const incompleta = { ...empresa, currentPhase: 1, dataFinalizacao: undefined };
  assert.equal(calcularSituacaoAcompanhamento(incompleta, [{ ...contato, dataOcorrencia: agora - 3 * dia }], agora).tipo, null);
  assert.equal(calcularSituacaoAcompanhamento(incompleta, [{ ...contato, tipo: 'Informativa', dataOcorrencia: agora - 4 * dia }], agora).tipo, 'agendar_treinamento');
  for (const flags of [{ isCancelled: true }, { isOngoing: true }]) assert.equal(calcularSituacaoAcompanhamento({ ...empresa, ...flags }, [], agora).tipo, null);
  assert.equal(calcularSituacaoAcompanhamento(incompleta, [], agora).tipo, null);
  assert.equal(calcularSituacaoAcompanhamento({ ...empresa, dataFinalizacao: undefined }, [{ ...contato, dataOcorrencia: agora - 30 * dia }], agora).tipo, null);
});
function setup(cliente = empresa) {
  const { db, data } = firestoreMemoria([['empresas/e1', cliente], ['usuarios/u1', { role: 'treinador', nome: 'Treinador' }]]);
  const indice = { dados: async nome => [...data].filter(([k]) => k.startsWith(`${nome}/`) && k.split('/').length === 2).map(([k, v]) => ({ ...structuredClone(v), id: k.split('/')[1] })) };
  return { db, data, tarefa: new SincronizarTarefasAutomaticas(db, indice), indice };
}
test('cria uma tarefa por situação, preserva conclusão manual e conclui automaticamente sem apagar histórico', async () => {
  const { data, tarefa, db, indice } = setup();
  await Promise.all([tarefa.execute(agora), new SincronizarTarefasAutomaticas(db, indice).execute(agora)]);
  const chaves = [...data.keys()].filter(k => k.startsWith('checklist_tarefas/'));
  assert.equal(chaves.length, 1);
  const chave = chaves[0], original = structuredClone(data.get(chave));
  data.get(chave).concluida = true;
  await tarefa.execute(agora + dia);
  assert.equal(data.get(chave).concluida, true); assert.equal(data.get(chave).createdAt, original.createdAt);
  data.get(chave).concluida = false;
  data.get('empresas/e1').dataFollowUpFinal = '2026-10-26';
  await tarefa.execute(agora + dia);
  assert.equal(data.get(chave).concluida, true);
  assert.deepEqual(data.get(chave).historicoAutomatico.map(e => e.evento), ['criada', 'situacao_resolvida']);
});
test('suspensão não cria tarefa nova; pausa tarefa existente e preserva até o retorno', async () => {
  const { data, tarefa } = setup({ ...empresa, isSuspended: true });
  await tarefa.execute(agora);
  assert.equal([...data.keys()].some(k => k.startsWith('checklist_tarefas/')), false);
  data.get('empresas/e1').isSuspended = false; await tarefa.execute(agora);
  const chave = [...data.keys()].find(k => k.startsWith('checklist_tarefas/'));
  data.get('empresas/e1').isSuspended = true; await tarefa.execute(agora);
  assert.equal(data.get(chave).pausada, true); assert.equal(data.get(chave).concluida, false);
  data.get('empresas/e1').isSuspended = false; await tarefa.execute(agora);
  assert.equal(data.get(chave).pausada, false);
});
test('novo treinamento resolve tarefa de agenda; outro período atrasado cria tarefa de outro ciclo', async () => {
  const { data, tarefa } = setup({ ...empresa, currentPhase: 1, dataFinalizacao: '' });
  data.set('ocorrencias/antiga', { empresa: 'Cliente', tipo: 'Treinamento', dataOcorrencia: agora - 4 * dia });
  await tarefa.execute(agora);
  const chave = [...data.keys()].find(k => k.startsWith('checklist_tarefas/'));
  data.set('ocorrencias/nova', { empresa: 'Cliente', tipo: 'Treinamento', dataOcorrencia: agora });
  await tarefa.execute(agora);
  assert.equal(data.get(chave).concluida, true);
  await tarefa.execute(agora + 4 * dia);
  assert.equal([...data.keys()].filter(k => k.startsWith('checklist_tarefas/')).length, 2);
});
test('responsável com primeiro nome, acento ou nome completo encontra o treinador; homônimos não recebem tarefa', async () => {
  const { encontrarResponsavel } = await import('../dist/domain/acompanhamentoEsteira.js');
  const treinadores = [{ uid: 'a', nome: 'Pedro Henrique' }, { uid: 'b', nome: 'Ana Souza' }, { uid: 'c', nome: 'Ana Lima' }];
  assert.equal(encontrarResponsavel('Pedro', treinadores).treinador?.uid, 'a');
  assert.equal(encontrarResponsavel(' pédro  henrique ', treinadores).treinador?.uid, 'a');
  assert.equal(encontrarResponsavel('Ana Lima', treinadores).treinador?.uid, 'c');
  assert.deepEqual(encontrarResponsavel('Ana', treinadores), { treinador: null, ambiguo: true });
  assert.deepEqual(encontrarResponsavel('Carlos', treinadores), { treinador: null, ambiguo: false });

  const { data, tarefa } = setup({ ...empresa, responsavel: 'Treinador' });
  data.set('usuarios/u1', { role: 'treinador', nome: 'Treinador Completo' });
  await tarefa.execute(agora);
  const criada = [...data].find(([k]) => k.startsWith('checklist_tarefas/'))?.[1];
  assert.equal(criada?.treinadorId, 'u1');
});
