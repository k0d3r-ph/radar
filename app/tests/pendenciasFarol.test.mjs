import assert from 'node:assert/strict';
import test from 'node:test';
import { calcularFarol } from '../src/utils/monitoramento/calcularFarol.ts';
import { pendenciaAtiva, vencimentoPendencia } from '../src/utils/pendencias.ts';

const pendencia = { ativa: true, tipoId: 'pendencia-1', tipoNome: 'Aguardando retorno' };
const base = { progresso: 50, tme: 2 };
const prazo = Date.parse('2026-10-02T00:00:00-03:00');

test('pendência ativa prevalece sobre farol tradicional mesmo sem treinamento anterior', () => {
  for (const estado of [base, { ...base, alerta: true }, { progresso: 0, tme: null }, { progresso: 100, tme: 1, dataFollowUpFinal: '2026-09-30' }]) {
    assert.equal(calcularFarol({ ...estado, pendencia }), 'laranja');
  }
});

test('sem prazo permanece ativa até o usuário desmarcar', () => {
  assert.equal(calcularFarol({ ...base, pendencia, agora: prazo + 100 * 86400000 }), 'laranja');
  assert.equal(calcularFarol({ ...base, pendencia: { ...pendencia, ativa: false } }), 'amarelo');
});

test('data escolhida é inclusiva em Brasília e expira na meia-noite seguinte', () => {
  const comPrazo = { ...pendencia, venceEm: '2026-10-01' };
  assert.equal(vencimentoPendencia(comPrazo.venceEm), prazo);
  assert.equal(calcularFarol({ ...base, pendencia: comPrazo, agora: prazo - 1 }), 'laranja');
  assert.equal(calcularFarol({ ...base, pendencia: comPrazo, agora: prazo }), 'amarelo');
});

test('ao vencer restaura verde, amarelo, vermelho e ausência de status conforme a regra atual', () => {
  const vencida = { ...pendencia, venceEm: '2026-10-01' };
  for (const [estado, status] of [
    [base, 'amarelo'], [{ ...base, tme: 4 }, 'vermelho'], [{ ...base, alerta: true }, 'vermelho'],
    [{ ...base, tme: -1 }, 'verde'], [{ ...base, tme: null }, 'none'],
    [{ ...base, dataFollowUpFinal: '2026-09-30' }, 'verde'],
  ]) assert.equal(calcularFarol({ ...estado, pendencia: vencida, agora: prazo }), status);
});

test('checkpoint futuro não ativa laranja; só pendências explícitas do cadastro', () => {
  assert.equal(calcularFarol({ ...base, dataCheckpoint: prazo + 1, agora: prazo }), 'amarelo');
  assert.equal(pendenciaAtiva({ ...pendencia, tipoId: '' }), false);
  assert.equal(pendenciaAtiva({ ...pendencia, tipoNome: '' }), false);
});

test('datas inválidas não mantêm o cliente indefinidamente no laranja', () => {
  for (const venceEm of ['2026-02-30', '2026-13-01', 'amanhã']) {
    assert.equal(Number.isNaN(vencimentoPendencia(venceEm)), true);
    assert.equal(pendenciaAtiva({ ...pendencia, venceEm }), false);
  }
  assert.equal(vencimentoPendencia('2028-02-29'), Date.parse('2028-03-01T00:00:00-03:00'));
});
