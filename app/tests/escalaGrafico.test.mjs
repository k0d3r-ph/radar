import assert from 'node:assert/strict';
import test from 'node:test';
import { calcularEscalaEixoY } from '../src/utils/escalaGrafico.ts';

test('valores entre zero e um têm folga superior e rótulos inteiros sem repetição', () => {
  assert.deepEqual(calcularEscalaEixoY([0, 1, 1, 0]), { maximo: 2, marcacoes: [0, 1, 2] });
});

test('mantém folga superior e marcações crescentes para contagens e valores fracionários', () => {
  for (const valores of [[2, 3], [10, 18], [100, 120], [0.1, 0.2], [0.001, 0.002], [1.2, 3.75]]) {
    const { maximo, marcacoes } = calcularEscalaEixoY(valores);
    assert.ok(maximo > Math.max(...valores));
    assert.equal(marcacoes[0], 0);
    assert.equal(marcacoes.at(-1), maximo);
    assert.equal(new Set(marcacoes).size, marcacoes.length);
    assert.equal(new Set(marcacoes.map(v => v.toLocaleString('pt-BR', { maximumFractionDigits: 12 }))).size, marcacoes.length);
    if (valores.every(Number.isInteger)) assert.ok(marcacoes.every(Number.isInteger));
  }
});

test('séries vazias ou zeradas possuem escala válida', () => {
  for (const valores of [[], [0, 0]]) assert.deepEqual(calcularEscalaEixoY(valores), { maximo: 1, marcacoes: [0, 1] });
});
