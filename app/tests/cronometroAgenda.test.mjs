import test from 'node:test';
import assert from 'node:assert/strict';
import { converterDuracaoAgendaParaMs, formatarDuracaoCronometro, formatarTempoCronometro } from '../src/utils/cronometroAgenda.ts';

test('exibe o tempo decorrido em horas, minutos e segundos', () => {
  assert.equal(formatarTempoCronometro(3_723_000), '01:02:03');
  assert.equal(formatarTempoCronometro(0), '00:00:00');
});

test('arredonda a duração para o minuto mais próximo e exige pelo menos um minuto', () => {
  assert.equal(formatarDuracaoCronometro(1_000), '00:01');
  assert.equal(formatarDuracaoCronometro(89.5 * 60_000), '01:30');
});

test('rejeita duração fora do limite do campo HH:MM', () => {
  assert.throws(() => formatarDuracaoCronometro(100 * 60 * 60_000), /ultrapassou 99:59/);
  assert.throws(() => formatarDuracaoCronometro(Number.NaN), /inválido/);
});

test('converte a duração salva para retomar o cronômetro em outra agenda', () => {
  assert.equal(converterDuracaoAgendaParaMs('01:25'), 85 * 60_000);
  assert.equal(converterDuracaoAgendaParaMs('00:00'), 0);
  assert.equal(converterDuracaoAgendaParaMs('01:60'), 0);
});
