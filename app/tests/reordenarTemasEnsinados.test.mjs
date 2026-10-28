import assert from 'node:assert/strict';
import test from 'node:test';
import { reordenarTemasEnsinados } from '../src/utils/reordenarTemasEnsinados.ts';

test('linha vazia antes da conclusão não bloqueia a finalização (Isad)', () => {
  const resultado = reordenarTemasEnsinados(
    ['Mapeamento dos objetivos', 'Relatórios', 'Funções do aplicativo', '', 'Conclusão'],
    ['25/08', '09/09', '09/09', '', ''], [4], '05/10', 2,
  );
  assert.deepEqual(resultado.newTemas, ['Mapeamento dos objetivos', 'Relatórios', 'Funções do aplicativo', 'Conclusão']);
  assert.deepEqual(resultado.newDatas, ['25/08', '09/09', '09/09', '05/10']);
  assert.equal(resultado.ultimoIndice, resultado.newTemas.length - 1);
});

test('conclusão não avança sobre treinamento realmente pendente', () => {
  const resultado = reordenarTemasEnsinados(
    ['Início', 'Relatórios', ' ', 'Conclusão'], ['01/10', '', '', ''], [3], '05/10', 0,
  );
  assert.equal(resultado.ultimoIndice, 0);
  assert.deepEqual(resultado.newDatas, ['01/10', '', '05/10']);
});

test('remove linhas vazias preservando datas e índices de temas fora de sequência', () => {
  const resultado = reordenarTemasEnsinados(
    ['', 'Início', 'Relatórios', '', 'Regras', 'Conclusão', ''],
    ['', '01/10', '', '', '', '', ''], [4], '05/10', 0,
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

test('validação do conhecimento é a âncora final e só conclui após os demais temas', () => {
  const pendente = reordenarTemasEnsinados(
    ['Início', 'Validação do conhecimento', 'Relatórios'], ['01/10', '', ''], [1], '05/10', 0,
  );
  assert.deepEqual(pendente.newTemas, ['Início', 'Relatórios', 'Validação do conhecimento']);
  assert.equal(pendente.ultimoIndice, 0);

  const concluida = reordenarTemasEnsinados(
    ['Início', 'Relatórios', 'Validação do conhecimento'], ['01/10', '03/10', ''], [2], '05/10', 1,
  );
  assert.deepEqual(concluida.newDatas, ['01/10', '03/10', '05/10']);
  assert.equal(concluida.ultimoIndice, 2);
});

test('com validação presente, "Conclusão" antiga vira tema comum antes dela', () => {
  const resultado = reordenarTemasEnsinados(
    ['Início', 'Conclusão', 'Validação do conhecimento'], ['01/10', '', ''], [1], '05/10', 0,
  );
  assert.deepEqual(resultado.newTemas, ['Início', 'Conclusão', 'Validação do conhecimento']);
  assert.equal(resultado.ultimoIndice, 1);
});

test('datas futuras do planejamento não contam como tema ensinado (currentPhase é quem manda)', () => {
  const linhasTema = ['Início', 'Tema A', 'Tema B', 'Tema C', 'Conclusão'];
  // "Gerar planejamento" preencheu datas futuras em todas as fases, inclusive
  // nas que ainda não foram ensinadas — currentPhase=0 (só "Início" feito) é
  // quem reflete o progresso real.
  const linhasDataPlanejadas = ['01/10', '03/10', '05/10', '07/10', '09/10'];

  const resultado = reordenarTemasEnsinados(
    linhasTema, linhasDataPlanejadas, [1], '10/10', 0,
  );
  assert.equal(resultado.ultimoIndice, 1);
  assert.notEqual(resultado.ultimoIndice, resultado.newTemas.length - 1);

  // Sem currentPhase (comportamento legado, para registros antigos sem o campo),
  // a varredura por data ainda é usada e reproduz o bug: a esteira aparece como
  // concluída mesmo com só um tema realmente ensinado.
  const legado = reordenarTemasEnsinados(
    linhasTema, linhasDataPlanejadas, [1], '10/10',
  );
  assert.equal(legado.ultimoIndice, legado.newTemas.length - 1);
});
