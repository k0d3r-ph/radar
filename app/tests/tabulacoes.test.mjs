import assert from 'node:assert/strict';
import test from 'node:test';
import { temaDisponivelParaPerfil, perfisPadraoTema } from '../src/utils/tabulacoes.ts';
const tema = (nome, categoria = 'tipo', perfisDisponiveis) => ({ id: '1', nome, categoria, createdAt: 0, perfisDisponiveis });
test('Problema fica disponivel para treinador e suporte por padrao', () => {
  assert.equal(temaDisponivelParaPerfil(tema('Problema'), 'treinador'), true);
  assert.equal(temaDisponivelParaPerfil(tema('Problema'), 'suporte'), true);
  assert.equal(temaDisponivelParaPerfil(tema('Problema'), 'financeiro'), false);
});
test('configuracao explicita substitui padroes para todas as categorias', () => {
  for (const categoria of ['tipo', 'duvida', 'solicitacao', 'pendencia']) {
    const item = tema('Personalizada', categoria, ['cs']);
    assert.equal(temaDisponivelParaPerfil(item, 'cs'), true);
    assert.equal(temaDisponivelParaPerfil(item, 'treinador'), false);
    assert.equal(temaDisponivelParaPerfil(item, 'master'), false);
    assert.equal(temaDisponivelParaPerfil({ ...item, perfisDisponiveis: [] }, 'cs'), false);
  }
});
test('padroes preservam restricoes e assuntos existentes', () => {
  assert.equal(temaDisponivelParaPerfil(tema('Financeira'), 'treinador'), false);
  assert.equal(temaDisponivelParaPerfil(tema('Financeira'), 'financeiro'), true);
  assert.equal(temaDisponivelParaPerfil(tema('D\u00favida'), 'treinador'), true);
  assert.equal(temaDisponivelParaPerfil(tema('Solicita\u00e7\u00e3o'), 'suporte'), true);
  assert.equal(temaDisponivelParaPerfil(tema('Personalizada'), 'cs'), true);
  assert.equal(temaDisponivelParaPerfil(tema('Assunto', 'duvida'), 'suporte'), true);
  assert.equal(temaDisponivelParaPerfil(tema('Problema'), undefined), false);
  assert.ok(perfisPadraoTema(tema('Problema')).includes('master'));
});
