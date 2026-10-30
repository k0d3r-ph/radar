import assert from 'node:assert/strict';
import test from 'node:test';
import {
  definirContagemReagendamento,
  formatarDataDigitada,
  incrementarReagendamentoSeDataAlterada,
  linhasTemaParaTextos,
  normalizarTextosTema,
  textosParaLinhasTema,
} from '../src/utils/temasEsteira.ts';

test('alinha tema e data pela linha, inclusive com datas faltando', () => {
  assert.deepEqual(textosParaLinhasTema('Início\nCadastro\nDebug', '10/10\n\n'), [
    { tema: 'Início', data: '10/10', reagendamentos: 0, mesmoDiaDoProximo: false },
    { tema: 'Cadastro', data: '', reagendamentos: 0, mesmoDiaDoProximo: false },
    { tema: 'Debug', data: '', reagendamentos: 0, mesmoDiaDoProximo: false },
  ]);
});

test('texto vazio vira um campo vazio e a conversão de volta é exata', () => {
  assert.deepEqual(textosParaLinhasTema('', ''), [{
    tema: '',
    data: '',
    reagendamentos: 0,
    mesmoDiaDoProximo: false,
  }]);
  const linhas = [
    { tema: 'Cadastro de ', data: '', reagendamentos: 0, mesmoDiaDoProximo: false },
    { tema: '', data: '', reagendamentos: 0, mesmoDiaDoProximo: false },
  ];
  assert.deepEqual(linhasTemaParaTextos(linhas), {
    temaText: 'Cadastro de \n',
    dataText: '\n',
    reagendamentosText: '0\n0',
    blocoText: '\n',
  });
  assert.deepEqual(textosParaLinhasTema('Cadastro de \n', '\n'), linhas);
});

test('ao gravar apara os textos e remove linhas vazias sem desalinhar as datas', () => {
  assert.deepEqual(normalizarTextosTema(' Início \n\nDebug\n', '10/10\n\n12/10\n'), {
    temaText: 'Início\nDebug',
    dataText: '10/10\n12/10',
    reagendamentosText: '0\n0',
    blocoText: '\n',
  });
  assert.deepEqual(normalizarTextosTema('\n', '\n'), {
    temaText: '',
    dataText: '',
    blocoText: '',
    reagendamentosText: '',
  });
  assert.deepEqual(normalizarTextosTema('Início\n', '\n15/10'), {
    temaText: 'Início\n',
    dataText: '\n15/10',
    reagendamentosText: '0\n0',
    blocoText: '\n',
  });
});

test('incrementa somente a fase reagendada, sem contar as próximas datas recalculadas', () => {
  const fases = textosParaLinhasTema(
    'Início\nCadastro\nDebug',
    '10/10\n12/10\n14/10',
    '',
    '0\n1\n3',
  ).map((linha, indice) => ({
    ...linha,
    data: ['10/10', '13/10', '15/10'][indice],
  }));
  const reagendadas = incrementarReagendamentoSeDataAlterada(fases, 1, '12/10');

  assert.deepEqual(reagendadas.map((linha) => linha.reagendamentos), [0, 2, 3]);
  assert.equal(
    linhasTemaParaTextos(reagendadas).reagendamentosText,
    '0\n2\n3',
  );
});

test('uma data inicialmente vazia não é contada como reagendamento', () => {
  const linhas = textosParaLinhasTema('Início\nCadastro', '10/10\n').map((linha, indice) => ({
    ...linha,
    data: ['11/10', '13/10'][indice],
  }));

  assert.deepEqual(
    incrementarReagendamentoSeDataAlterada(linhas, 1, "").map(
      (linha) => linha.reagendamentos,
    ),
    [0, 0],
  );
});

test('a contagem de reagendamentos pode ser alterada e zerada manualmente', () => {
  const linhas = textosParaLinhasTema('Início\nCadastro', '10/10\n12/10', '', '2\n4');

  const ajustada = definirContagemReagendamento(linhas, 1, 1);
  assert.deepEqual(ajustada.map((linha) => linha.reagendamentos), [2, 1]);

  const zerada = definirContagemReagendamento(ajustada, 0, 0);
  assert.deepEqual(zerada.map((linha) => linha.reagendamentos), [0, 1]);
  assert.equal(linhasTemaParaTextos(zerada).reagendamentosText, '0\n1');
});

test('formata datas digitadas em DD/MM automaticamente', () => {
  assert.equal(formatarDataDigitada('1'), '1');
  assert.equal(formatarDataDigitada('01'), '01/');
  assert.equal(formatarDataDigitada('010'), '01/0');
  assert.equal(formatarDataDigitada('0102'), '01/02');
  assert.equal(formatarDataDigitada('01/02'), '01/02');
  assert.equal(formatarDataDigitada('01/02/2026'), '01/02');
});
