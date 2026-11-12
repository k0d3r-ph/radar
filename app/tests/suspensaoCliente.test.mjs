import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alteracoesEncerrarSuspensao,
  clienteEstaSuspenso,
  encerraSuspensao,
} from '../src/utils/suspensaoCliente.ts';

const suspenso = { isSuspended: true, dataSuspensao: '2026-10-01' };

test('cancelado, concluído unilateralmente ou concluído deixa de estar suspenso', () => {
  for (const estadoFinal of [
    { isCancelled: true },
    { conclusaoUnilateralCapacitacao: true },
    { dataFinalizacao: '2026-10-10', dataFollowUpFinal: '2026-10-20' },
  ]) {
    assert.equal(encerraSuspensao(estadoFinal), true);
    assert.equal(clienteEstaSuspenso({ ...suspenso, ...estadoFinal }), false);
  }
});

test('só a data de finalização, sem follow up final, ainda não conclui nem encerra a suspensão', () => {
  assert.equal(encerraSuspensao({ dataFinalizacao: '2026-10-10' }), false);
  assert.equal(clienteEstaSuspenso({ ...suspenso, dataFinalizacao: '2026-10-10' }), true);
  assert.equal(clienteEstaSuspenso({ ...suspenso, isOngoing: true }), true);
});

test('encerrar a suspensão leva os dias suspensos para o acumulado e registra o instante', () => {
  const agora = Date.parse('2026-10-11T15:00:00-03:00');
  const historico = [{
    empresa: 'Altotrak', suspenderCliente: true,
    createdAt: Date.parse('2026-10-01T10:00:00-03:00'),
    dataOcorrencia: Date.parse('2026-10-01T10:00:00-03:00'),
  }];
  const campos = alteracoesEncerrarSuspensao({ ...suspenso, diasSuspensoAcumulado: 3 }, historico, agora);
  assert.deepEqual(campos, {
    isSuspended: false,
    dataSuspensao: '',
    diasSuspensoAcumulado: 13,
    suspensaoEncerradaEm: agora,
  });
});

test('cliente que não está suspenso não recebe alteração', () => {
  assert.equal(alteracoesEncerrarSuspensao({ isSuspended: false }, []), null);
});
