import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const texto = readFileSync(new URL('../src/pages/ValidacaoConhecimento/ValidacaoConhecimento.tsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('pagina.tsx', texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visitar(node) {
  if (ts.isJsxAttribute(node) && node.name.getText() === 'onClick' && node.initializer?.expression?.getText().includes('cancelarTentativaConhecimento')) handler = node.initializer.expression;
  ts.forEachChild(node, visitar);
}
visitar(source);
assert.ok(handler, 'Ação de cancelar avaliação não encontrada');
const codigo = ts.transpileModule(`(${handler.getText()});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function cenario({ anterior = false, confirmar = true, falhar = false } = {}) {
  const atual = { id: 'teste', numero: anterior ? 2 : 1, empresa: 'Cliente', status: 'andamento', questoes: [{ resposta: 'correto' }] };
  const concluida = { id: 'anterior', numero: 1, status: 'concluida', aprovada: false };
  const estado = { atual, tentativas: anterior ? [atual, concluida] : [atual], alterada: true, chamadas: 0, sucessos: [], erro: '', foco: 0, descricao: '' };
  let pendente;
  const clicar = runInNewContext(codigo, {
    atual, tentativas: estado.tentativas,
    confirmar: async opcoes => { estado.descricao = opcoes.descricao; return confirmar; },
    executar: acao => { pendente = acao().catch(e => { estado.erro = e.message; }); return pendente; },
    cancelarTentativaConhecimento: async t => { assert.equal(t, atual); estado.chamadas++; if (falhar) throw Error('Sem conexão'); return { id: t.id }; },
    setTentativas: lista => { estado.tentativas = lista; }, setAtual: t => { estado.atual = t; }, setAlterada: valor => { estado.alterada = valor; },
    toast: { success: mensagem => estado.sucessos.push(mensagem) },
    requestAnimationFrame: callback => callback(),
    gerarRef: { current: { scrollIntoView() {}, focus() { estado.foco++; } } },
  });
  return { estado, atual, concluida, cancelar: async () => { await clicar(); await pendente; } };
}

test('cancelar retira o formulário do histórico e permite gerar novamente sem uma tentativa cancelada', async () => {
  const { estado, cancelar } = cenario();
  await cancelar();
  assert.equal(estado.chamadas, 1);
  assert.equal(estado.tentativas.length, 0);
  assert.equal(estado.atual, null);
  assert.equal(estado.alterada, false);
  assert.equal(estado.foco, 1);
  assert.match(estado.descricao, /sem contar como tentativa/);
});

test('cancelar uma repetição retorna à avaliação concluída, preservando suas respostas', async () => {
  const { estado, concluida, cancelar } = cenario({ anterior: true });
  await cancelar();
  assert.equal(estado.tentativas.length, 1);
  assert.equal(estado.tentativas[0], concluida);
  assert.equal(estado.atual, concluida);
  assert.equal(estado.alterada, false);
});

test('voltar no modal preserva formulário e respostas sem chamar a API', async () => {
  const { estado, atual, cancelar } = cenario({ confirmar: false });
  await cancelar();
  assert.equal(estado.chamadas, 0);
  assert.equal(estado.atual, atual);
  assert.equal(estado.alterada, true);
  assert.equal(estado.foco, 0);
});

test('falha ao cancelar preserva formulário e alterações para tentar novamente', async () => {
  const { estado, atual, cancelar } = cenario({ falhar: true });
  await cancelar();
  assert.equal(estado.atual, atual);
  assert.equal(estado.tentativas[0], atual);
  assert.equal(estado.alterada, true);
  assert.equal(estado.erro, 'Sem conexão');
  assert.equal(estado.sucessos.length, 0);
  assert.equal(estado.foco, 0);
});
