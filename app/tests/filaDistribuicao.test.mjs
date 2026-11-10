import assert from 'node:assert/strict';
import test from 'node:test';
import { elegivelFilaDistribuicao, incluidoNaFilaDistribuicao } from '../src/utils/filaDistribuicao.ts';

test('treinadores e masters entram na fila por padrão', () => {
  assert.equal(elegivelFilaDistribuicao({ nome: 'Ana Souza', role: 'treinador' }), true);
  assert.equal(elegivelFilaDistribuicao({ nome: 'Bruno', role: 'master' }), true);
  assert.equal(elegivelFilaDistribuicao({ nome: 'Carla', role: 'cs' }), false);
});

test('cadastro antigo sem o campo mantém a exceção anterior por nome', () => {
  assert.equal(incluidoNaFilaDistribuicao({ nome: 'Jeff Lima', role: 'treinador' }), false);
  assert.equal(incluidoNaFilaDistribuicao({ nome: 'Jean', role: 'master' }), false);
});

test('a escolha gravada no cadastro prevalece sobre a exceção por nome', () => {
  assert.equal(elegivelFilaDistribuicao({ nome: 'Jeff Lima', role: 'treinador', participaDistribuicao: true }), true);
  assert.equal(elegivelFilaDistribuicao({ nome: 'Ana', role: 'treinador', participaDistribuicao: false }), false);
});

test('férias e inativação tiram da fila sem perder a inclusão', () => {
  const jeff = { nome: 'Jeff', role: 'treinador', participaDistribuicao: true };
  assert.equal(elegivelFilaDistribuicao({ ...jeff, suspensoDistribuicao: true }), false);
  assert.equal(incluidoNaFilaDistribuicao({ ...jeff, suspensoDistribuicao: true }), true);
  assert.equal(elegivelFilaDistribuicao({ ...jeff, inativo: true }), false);
});
