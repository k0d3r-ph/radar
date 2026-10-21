import assert from 'node:assert/strict';
import test from 'node:test';
import {
  linhasTemaParaTextos,
  normalizarTextosTema,
  textosParaLinhasTema,
} from '../src/utils/temasEsteira.ts';

test('alinha tema e data pela linha, inclusive com datas faltando', () => {
  assert.deepEqual(textosParaLinhasTema('Início\nCadastro\nDebug', '10/10\n\n'), [
    { tema: 'Início', data: '10/10' },
    { tema: 'Cadastro', data: '' },
    { tema: 'Debug', data: '' },
  ]);
});

test('texto vazio vira um campo vazio e a conversão de volta é exata', () => {
  assert.deepEqual(textosParaLinhasTema('', ''), [{ tema: '', data: '' }]);
  const linhas = [{ tema: 'Cadastro de ', data: '' }, { tema: '', data: '' }];
  assert.deepEqual(linhasTemaParaTextos(linhas), { temaText: 'Cadastro de \n', dataText: '\n' });
  assert.deepEqual(textosParaLinhasTema('Cadastro de \n', '\n'), linhas);
});

test('ao gravar apara os textos e remove linhas vazias sem desalinhar as datas', () => {
  assert.deepEqual(normalizarTextosTema(' Início \n\nDebug\n', '10/10\n\n12/10\n'), {
    temaText: 'Início\nDebug',
    dataText: '10/10\n12/10',
  });
  assert.deepEqual(normalizarTextosTema('\n', '\n'), { temaText: '', dataText: '' });
  assert.deepEqual(normalizarTextosTema('Início\n', '\n15/10'), { temaText: 'Início\n', dataText: '\n15/10' });
});
