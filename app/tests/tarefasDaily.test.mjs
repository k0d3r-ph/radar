import assert from 'node:assert/strict';
import test from 'node:test';
import { obterPrazoTarefaDaily } from '../src/utils/tarefasDaily.ts';

test('data da tarefa vence às 18h no horário de São Paulo', () => {
  assert.equal(
    obterPrazoTarefaDaily('2026-11-03'),
    Date.parse('2026-11-03T18:00:00-03:00'),
  );
});

test('rejeita datas fora do formato ou inexistentes', () => {
  for (const data of ['03/11/2026', '2026-2-03', '2026-02-30']) {
    assert.throws(() => obterPrazoTarefaDaily(data), /Data de vencimento/);
  }
});
