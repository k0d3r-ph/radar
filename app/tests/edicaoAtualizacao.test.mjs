import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Exercita o handler real do Histórico com a persistência isolada, sem montar integrações.
const fonte = ts.createSourceFile('Historico.tsx', readFileSync(new URL('../src/pages/Historico/Historico.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function encontrar(no) {
  if (ts.isFunctionDeclaration(no) && no.name?.text === 'salvarEdicaoAtualizacao') handler = no;
  ts.forEachChild(no, encontrar);
}
encontrar(fonte);
assert.ok(handler, 'handler de edição encontrado');
const codigo = ts.transpileModule(ts.createPrinter().printNode(ts.EmitHint.Unspecified, handler, fonte), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

test('editar o texto como master preserva data e autor originais, inclusive em edições repetidas', async () => {
  const dataOriginal = Date.parse('2026-06-01T10:30:00-03:00');
  const outraAtualizacao = { descricao: 'Outro comentário', updatedAt: dataOriginal + 1000, responsavel: 'Outra pessoa' };
  let salvo;
  let selecionada = { id: 'ocorrencia', updatedAt: 1, atualizacoes: [
    { descricao: 'Texto original', updatedAt: dataOriginal, responsavel: 'Treinador original' }, outraAtualizacao,
  ] };
  const estado = {
    role: 'master', selecionada, editingUpdateText: '  Texto corrigido  ',
    toast: { error: mensagem => { throw Error(mensagem); }, success() {} }, console,
    salvarOcorrencia: async dados => { salvo = { ...dados, updatedAt: (salvo?.updatedAt ?? dados.updatedAt) + 1 }; },
    carregar: async () => [salvo], setSalvando() {}, setEditingUpdateIdx() {}, setEditingUpdateText() {},
    setSelecionada: valor => { selecionada = valor; },
  };
  for (const texto of ['  Texto corrigido  ', 'Segunda correção']) {
    estado.selecionada = selecionada;
    estado.editingUpdateText = texto;
    await runInNewContext(`${codigo}\nsalvarEdicaoAtualizacao(0);`, estado);
    assert.equal(salvo.atualizacoes[0].descricao, texto.trim());
    assert.equal(salvo.atualizacoes[0].updatedAt, dataOriginal);
    assert.equal(salvo.atualizacoes[0].responsavel, 'Treinador original');
    assert.deepEqual(salvo.atualizacoes[1], outraAtualizacao);
  }
  assert.equal(salvo.updatedAt, 3, 'o documento continua recebendo atualização para sincronização');
});
