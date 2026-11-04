import assert from 'node:assert/strict';
import test from 'node:test';
import { montarTemplateTreinamento, TEMPLATE_TREINAMENTO } from '../src/utils/templateTreinamento.ts';

test('template compartilhado mantém campos do treinamento e aceita participantes', () => {
  const template = montarTemplateTreinamento('Ana e Bruno');
  assert.match(template, /^Participantes: Ana e Bruno/);
  assert.match(template, /Relatório de treinamento:/);
  assert.match(template, /Cliente se manteve atento\?/);
  assert.equal(TEMPLATE_TREINAMENTO, montarTemplateTreinamento());
});
