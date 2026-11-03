import assert from 'node:assert/strict';
import test from 'node:test';
import { montarMensagemProgressoValidacao } from '../src/utils/notificacaoValidacao.ts';

test('mensagem de progresso inclui o tema final da esteira e a data da validação', () => {
  const mensagem = montarMensagemProgressoValidacao('03/11/2026');

  assert.match(mensagem, /Validação do conhecimento/);
  assert.match(mensagem, /03\/11\/2026/);
  assert.match(mensagem, /progresso atualizado da sua esteira/);
  assert.match(mensagem, /\{nome\}/);
});
