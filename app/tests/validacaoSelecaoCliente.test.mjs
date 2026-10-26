import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const texto = readFileSync(new URL('../src/pages/ValidacaoConhecimento/ValidacaoConhecimento.tsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('pagina.tsx', texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let funcao;
function visitar(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'selecionarCliente') funcao = node;
  ts.forEachChild(node, visitar);
}
visitar(source);
assert.ok(funcao, 'Seleção de cliente não encontrada');
const codigo = ts.transpileModule(`${funcao.getText()}\nselecionarCliente;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function cenario({ alterada = false, confirmar = true } = {}) {
  const atual = { id: 'avaliacao', questoes: [{ resposta: 'correto' }] };
  const estado = { empresaId: 'e1', atual, tentativas: [atual], carregando: false, alterada, erro: 'Mensagem existente', confirmacoes: 0, mutacoes: 0 };
  const setters = Object.fromEntries(['EmpresaId', 'Atual', 'Tentativas', 'Carregando', 'Alterada', 'Erro'].map(nome => [
    `set${nome}`, valor => { estado[nome[0].toLowerCase() + nome.slice(1)] = valor; estado.mutacoes++; },
  ]));
  const selecionar = runInNewContext(codigo, {
    empresaId: estado.empresaId, alterada, ...setters,
    // A URL (?empresa=) acompanha o cliente para os atalhos de outras telas.
    setSearchParams: (valor, opcoes) => { estado.parametros = valor; estado.opcoesUrl = opcoes; },
    confirmar: async () => { estado.confirmacoes++; return confirmar; },
  });
  return { estado, atual, selecionar };
}

for (const alterada of [false, true]) {
  test(`selecionar o mesmo cliente mantém avaliação e carregamento, com alterações pendentes: ${alterada}`, async () => {
    const { estado, atual, selecionar } = cenario({ alterada });
    await selecionar('e1');
    await selecionar('e1');
    assert.equal(estado.mutacoes, 0);
    assert.equal(estado.confirmacoes, 0);
    assert.equal(estado.carregando, false);
    assert.equal(estado.atual, atual);
    assert.equal(estado.alterada, alterada);
  });
}

test('selecionar outro cliente prepara o carregamento das avaliações do novo cliente', async () => {
  const { estado, selecionar } = cenario();
  await selecionar('e2');
  assert.equal(estado.empresaId, 'e2');
  assert.equal(estado.carregando, true);
  assert.equal(estado.atual, null);
  assert.equal(estado.tentativas.length, 0);
  assert.equal(estado.erro, '');
  assert.equal(JSON.stringify(estado.parametros), JSON.stringify({ empresa: 'e2' }));
  assert.equal(estado.opcoesUrl.replace, true);
});

test('trocar de cliente com alterações pendentes mantém a confirmação de descarte', async () => {
  for (const confirmar of [false, true]) {
    const { estado, atual, selecionar } = cenario({ alterada: true, confirmar });
    await selecionar('e2');
    assert.equal(estado.confirmacoes, 1);
    assert.equal(estado.empresaId, confirmar ? 'e2' : 'e1');
    assert.equal(estado.carregando, confirmar);
    assert.equal(estado.atual, confirmar ? null : atual);
    assert.equal(estado.alterada, !confirmar);
  }
});

test('limpar a seleção retorna ao estado vazio sem iniciar carregamento', async () => {
  const { estado, selecionar } = cenario();
  await selecionar('');
  assert.equal(estado.empresaId, '');
  assert.equal(JSON.stringify(estado.parametros), '{}');
  assert.equal(estado.carregando, false);
  assert.equal(estado.atual, null);
});
