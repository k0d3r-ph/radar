import assert from 'node:assert/strict';
import test from 'node:test';
import { podeEditarOcorrencia } from '../src/utils/permissoesOcorrencia.ts';

test('master e treinador mantêm acesso de edição', () => {
  assert.equal(podeEditarOcorrencia('master', '', { departamento: 'CS' }), true);
  assert.equal(podeEditarOcorrencia('treinador', '', { departamento: 'Suporte' }), true);
});

test('supervisor edita somente ocorrências do departamento do seu perfil', () => {
  assert.equal(podeEditarOcorrencia('cs', 'supervisor', { departamento: 'CS' }), true);
  assert.equal(podeEditarOcorrencia('suporte', 'supervisor', { departamento: 'Suporte' }), true);
  assert.equal(podeEditarOcorrencia('hardware', 'supervisor', { departamento: 'Hardware' }), true);
  assert.equal(podeEditarOcorrencia('comercial', 'supervisor', { departamento: 'Comercial' }), true);
  assert.equal(podeEditarOcorrencia('cs', 'supervisor', { departamento: 'Suporte' }), false);
});

test('analistas e usuários sem cargo de supervisor não editam ocorrências', () => {
  assert.equal(podeEditarOcorrencia('cs', 'analista', { departamento: 'CS' }), false);
  assert.equal(podeEditarOcorrencia('cs', '', { departamento: 'CS' }), false);
  assert.equal(podeEditarOcorrencia('suporte', 'analista', { departamento: 'Suporte' }), false);
  assert.equal(podeEditarOcorrencia('financeiro', 'supervisor', { departamento: 'Comercial' }), false);
});
