import assert from 'node:assert/strict';
import test from 'node:test';
import { apresentarTarefa, urgenciaTarefa } from '../src/utils/tarefasChecklist.ts';

const agora = Date.parse('2026-10-26T12:00:00-03:00');
test('apresenta tarefas antigas sem repetir empresa na ação e preserva a descrição gravada', () => {
  const tarefa = { automatica: true, origemAutomatica: 'follow_up_final', empresa: 'Isad & Rastreamento', empresaId: 'cliente-1', descricao: 'Isad & Rastreamento: Realizar e registrar o Follow-up final.', baseAutomatica: agora - 21 * 86400000 };
  const apresentacao = apresentarTarefa(tarefa, agora);
  assert.equal(apresentacao.titulo, 'Realizar follow-up final');
  assert.match(apresentacao.motivo, /há 21 dias/);
  assert.equal(new URL(apresentacao.historicoUrl, 'http://localhost').searchParams.get('empresa'), tarefa.empresa);
  assert.equal(apresentacao.esteiraUrl, '/esteira/cliente-1');
  assert.equal(tarefa.descricao, 'Isad & Rastreamento: Realizar e registrar o Follow-up final.');
});
test('mantém descrições manuais/legadas e não inventa tempo sem data-base', () => {
  assert.equal(apresentarTarefa({ descricao: 'Enviar material', automatica: false }, agora).titulo, 'Enviar material');
  const legado = apresentarTarefa({ descricao: 'Acompanhamento antigo', automatica: true }, agora);
  assert.equal(legado.titulo, 'Acompanhamento antigo'); assert.equal(legado.automatica, true);
  const agenda = apresentarTarefa({ automatica: true, origemAutomatica: 'agendar_treinamento', empresa: 'Cliente', descricao: '' }, agora);
  assert.doesNotMatch(agenda.motivo, /\d+ dias/);
});
test('ordem mantém prioridade e prazo anteriores ao redesenho', () => {
  assert.ok(urgenciaTarefa({ prioridade: 'alta' }, agora) < urgenciaTarefa({ prioridade: 'normal' }, agora));
  assert.ok(urgenciaTarefa({ prioridade: 'normal', slaEm: agora - 1000 }, agora) < urgenciaTarefa({ prioridade: 'urgente' }, agora));
});
