import test from 'node:test';
import assert from 'node:assert/strict';
import { duracaoAgendaValida, formatarDuracaoAgenda } from '../../server/src/domain/duracaoAgenda.ts';

test('máscara transforma 0200 em 02:00, permite edição parcial e remove caracteres não numéricos', () => {
  for (const [entrada, esperado] of [['', ''], ['0', '0'], ['02', '02'], ['020', '02:0'], ['0200', '02:00'], ['02:00', '02:00'], ['0030', '00:30'], ['abc02h00!', '02:00'], ['123456', '12:34']]) {
    assert.equal(formatarDuracaoAgenda(entrada), esperado);
  }
});
test('duração exige HH:MM e minutos válidos; horas são duração, não horário do dia', () => {
  for (const valor of ['00:00', '00:30', '02:00', '23:59', '24:00', '99:59']) assert.equal(duracaoAgendaValida(valor), true);
  for (const valor of ['', '0200', '2:00', '02:0', '02:60', '99:99', 'duas horas', '-1:00', '00:000', '100:00', undefined, null]) assert.equal(duracaoAgendaValida(valor), false);
});
