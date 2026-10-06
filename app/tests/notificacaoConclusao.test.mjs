import assert from 'node:assert/strict';
import test from 'node:test';
import { podeNotificarConclusao, camposResultadoConclusao } from '../src/utils/notificacaoConclusao.ts';

const concluida = { nomeEmpresa: 'Isad Rastreamento', temaText: 'Início\nCadastro\nConclusão', currentPhase: 2 };

test('treinador e master podem reenviar para cliente concluido sem status anterior', () => {
  for (const role of ['treinador', 'master']) {
    assert.equal(podeNotificarConclusao(concluida, role), true);
    assert.equal(podeNotificarConclusao({ ...concluida, currentPhase: 0, dataFinalizacao: '2026-10-06' }, role), true);
    assert.equal(podeNotificarConclusao({ ...concluida, whatsappStatusConclusao: 'enviado' }, role), true);
    assert.equal(podeNotificarConclusao({ ...concluida, temaText: 'Conclusão', currentPhase: 0 }, role), true);
  }
});

test('outros perfis, ongoing e esteiras incompletas nao podem reenviar', () => {
  for (const role of ['cs', 'suporte', 'comercial', 'financeiro', 'hardware', 'painel', undefined]) {
    assert.equal(podeNotificarConclusao(concluida, role), false);
  }
  assert.equal(podeNotificarConclusao({ ...concluida, isOngoing: true }, 'master'), false);
  assert.equal(podeNotificarConclusao({ ...concluida, currentPhase: 1 }, 'treinador'), false);
  assert.equal(podeNotificarConclusao({ nomeEmpresa: 'Sem esteira', temaText: '', currentPhase: 0 }, 'master'), false);
});

test('resultado da conclusao preserva campos de outras notificacoes e da esteira', () => {
  for (const status of ['enviado', 'parcial', 'falhou', 'nao_enviado', 'sem_destinatario']) {
    const destinatarios = status === 'enviado' ? [{ nome: 'CS', telefone: '5511999999999', status: 'enviado' }] : [];
    assert.deepEqual(camposResultadoConclusao({ status, enviadoEm: 123, destinatarios }), {
      whatsappStatusConclusao: status,
      whatsappEnviadoEmConclusao: 123,
      whatsappDestinatariosConclusao: destinatarios,
    });
  }
});
