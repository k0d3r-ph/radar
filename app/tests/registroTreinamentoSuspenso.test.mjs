import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { bloquearTreinamentoSuspenso, normalizarEmpresaOcorrencia } from '../src/utils/registroTreinamento.ts';

const fonte = ts.createSourceFile('Historico.tsx', readFileSync(new URL('../src/pages/Historico/Historico.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler, patchScore;
function visitar(no) {
  if (ts.isFunctionDeclaration(no) && no.name?.text === 'salvarFormulario') handler = no;
  if (ts.isCallExpression(no) && no.expression.getText(fonte) === 'salvarEmpresas') {
    const argumento = no.arguments[0];
    if (argumento && ts.isObjectLiteralExpression(argumento) && argumento.properties.some(p => p.name?.getText(fonte) === 'score' && p.initializer?.getText(fonte) === 'novoScore')) patchScore = argumento;
  }
  ts.forEachChild(no, visitar);
}
visitar(fonte);
const codigo = no => ts.transpileModule(ts.createPrinter().printNode(ts.EmitHint.Unspecified, no, fonte), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

test('formulário real interrompe treinamento suspenso antes de validações e efeitos de gravação', async () => {
  assert.ok(handler);
  const mensagens = [];
  const estado = {
    reservaEditando: null, editandoId: null, editandoImportadaSsx: false, userName: 'Treinador',
    form: { empresa: 'Cliente', tipo: 'Treinamento', departamento: 'Treinamento', descricao: 'Realizado' },
    empresasList: [{ id: 'cliente', nomeEmpresa: 'Cliente', isSuspended: true }], ocorrencias: [],
    formatarNome: valor => valor, normalizar: normalizarEmpresaOcorrencia, bloquearTreinamentoSuspenso,
    MENSAGEM_TREINAMENTO_SUSPENSO: 'Cliente suspenso', toast: { error: m => mensagens.push(m) },
  };
  await runInNewContext(`${codigo(handler)}\nsalvarFormulario();`, estado);
  assert.deepEqual(mensagens, ['Cliente suspenso']);
});

test('atualização de score usa payload parcial e preserva suspensão concorrente', () => {
  assert.ok(patchScore);
  const objeto = ts.createPrinter().printNode(ts.EmitHint.Unspecified, patchScore, fonte);
  const patch = runInNewContext(`(${objeto})`, {
    empresaObjeto: { id: 'cliente', isSuspended: false, score: 8 }, novoScore: 7, novoTipo: 'Fast',
    calculoScoreResult: { isNeutro: false, contadores: {} }, respostasScore: {}, duvidasTemasHistorico: [], Date,
  });
  const persistido = { isSuspended: true, dataSuspensao: '2026-10-01', score: 8 };
  const atualizado = { ...persistido, ...patch };
  assert.equal(atualizado.isSuspended, true);
  assert.equal(atualizado.dataSuspensao, '2026-10-01');
  assert.equal(atualizado.score, 7);
});
