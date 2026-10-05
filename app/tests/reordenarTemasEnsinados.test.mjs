import assert from 'node:assert/strict';
import test from 'node:test';
import { reordenarTemasEnsinados } from '../src/utils/reordenarTemasEnsinados.ts';

test('linha vazia antes da conclusão não bloqueia a finalização (Isad)', () => {
  const resultado = reordenarTemasEnsinados(
    ['Mapeamento dos objetivos', 'Relatórios', 'Funções do aplicativo', '', 'Conclusão'],
    ['25/08', '09/09', '09/09', '', ''], [4], '05/10',
  );
  assert.deepEqual(resultado.newTemas, ['Mapeamento dos objetivos', 'Relatórios', 'Funções do aplicativo', 'Conclusão']);
  assert.deepEqual(resultado.newDatas, ['25/08', '09/09', '09/09', '05/10']);
  assert.equal(resultado.ultimoIndice, resultado.newTemas.length - 1);
});

test('conclusão não avança sobre treinamento realmente pendente', () => {
  const resultado = reordenarTemasEnsinados(
    ['Início', 'Relatórios', ' ', 'Conclusão'], ['01/10', '', '', ''], [3], '05/10',
  );
  assert.equal(resultado.ultimoIndice, 0);
  assert.deepEqual(resultado.newDatas, ['01/10', '', '05/10']);
});

test('remove linhas vazias preservando datas e índices de temas fora de sequência', () => {
  const resultado = reordenarTemasEnsinados(
    ['', 'Início', 'Relatórios', '', 'Regras', 'Conclusão', ''],
    ['', '01/10', '', '', '', '', ''], [4], '05/10',
  );
  assert.deepEqual(resultado.newTemas, ['Início', 'Regras', 'Relatórios', 'Conclusão']);
  assert.deepEqual(resultado.newDatas, ['01/10', '05/10', '', '']);
  assert.equal(resultado.ultimoIndice, 1);
});

test('esteira vazia não tem fase concluída', () => {
  const resultado = reordenarTemasEnsinados(['', ' '], ['', ''], [], '05/10');
  assert.deepEqual(resultado.newTemas, []);
  assert.equal(resultado.ultimoIndice, -1);
});
