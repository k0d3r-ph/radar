import assert from 'node:assert/strict';
import test from 'node:test';
import { podeEditarOcorrencia, podeIncluirAtualizacaoOcorrencia } from '../src/utils/permissoesOcorrencia.ts';

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

test('somente treinadores e masters incluem atualizações em ocorrências de validação', () => {
  const ocorrencia = { departamento: 'Treinamento', validacaoTentativaId: 'tentativa-1' };
  assert.equal(podeIncluirAtualizacaoOcorrencia('master', '', ocorrencia), true);
  assert.equal(podeIncluirAtualizacaoOcorrencia('treinador', '', ocorrencia), true);
  assert.equal(podeIncluirAtualizacaoOcorrencia('treinamento', 'supervisor', ocorrencia), false);
  assert.equal(podeIncluirAtualizacaoOcorrencia('cs', 'supervisor', ocorrencia), false);
});

test('permissões de atualizações comuns permanecem iguais às permissões de edição', () => {
  const ocorrencia = { departamento: 'CS' };
  assert.equal(podeIncluirAtualizacaoOcorrencia('cs', 'supervisor', ocorrencia), true);
  assert.equal(podeIncluirAtualizacaoOcorrencia('cs', 'analista', ocorrencia), false);
});
