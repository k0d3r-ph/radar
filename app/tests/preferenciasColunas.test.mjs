import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { ampliarCatalogoColunas, resolverPreferenciasColunas } from '../src/utils/preferenciasColunas.ts';

// Lê as definições reais da Home, sem montar serviços, autenticação ou integrações.
const fonte = ts.createSourceFile('Home.tsx', readFileSync(new URL('../src/pages/Home/Home.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const padroes = new Map();
function visitar(no) {
  if (ts.isVariableDeclaration(no) && ts.isIdentifier(no.name) &&
    ['colunasEsteiraAtual', 'colunasOngoing', 'colunasSuspensos', 'colunasConcluidos', 'colunasCancelados'].includes(no.name.text)) {
    assert.ok(ts.isArrayLiteralExpression(no.initializer));
    padroes.set(no.name.text, no.initializer.elements.map(e => {
      const propriedades = new Map(e.properties.map(p => [p.name.getText(fonte), p.initializer]));
      return {
        key: propriedades.get('key').text,
        defaultWidth: Number(propriedades.get('defaultWidth').text),
        locked: propriedades.get('locked')?.kind === ts.SyntaxKind.TrueKeyword,
      };
    }));
  }
  ts.forEachChild(no, visitar);
}
visitar(fonte);
assert.equal(padroes.size, 5);
const catalogo = [...padroes.values()].flat();
const ampliar = nome => ampliarCatalogoColunas(padroes.get(nome), catalogo);
const visiveis = prefs => prefs.order.filter(k => !prefs.hidden.includes(k));

test('primeiro acesso mantém exatamente as colunas e a ordem de cada uma das cinco esteiras', () => {
  for (const [nome, colunas] of padroes) {
    const disponiveis = ampliar(nome);
    const prefs = resolverPreferenciasColunas(disponiveis, null);
    assert.deepEqual(visiveis(prefs), colunas.map(c => c.key), nome);
    assert.equal(new Set(disponiveis.map(c => c.key)).size, disponiveis.length);
    assert.equal(disponiveis.length, new Set(catalogo.map(c => c.key)).size);
    assert.deepEqual(prefs.widths, {});
  }
});

test('cache antigo mantém ordem personalizada, colunas ocultas e larguras sem exibir as adicionais', () => {
  const salvo = { order: ['valorContrato', 'cliente', 'comercial', 'contato', 'cs'], hidden: ['contato'], widths: { cliente: 321, valorContrato: 190 } };
  const prefs = resolverPreferenciasColunas(ampliar('colunasCancelados'), salvo);
  assert.deepEqual(visiveis(prefs), ['valorContrato', 'cliente', 'comercial', 'cs']);
  assert.deepEqual(prefs.widths, salvo.widths);
  assert.ok(prefs.hidden.includes('diasSuspenso'));
  assert.deepEqual(salvo.order, ['valorContrato', 'cliente', 'comercial', 'contato', 'cs'], 'não altera o objeto de cache recebido');
});

test('incluir Dias suspenso em Cancelados é preservado ao reabrir; restaurar volta ao padrão original', () => {
  const disponiveis = ampliar('colunasCancelados');
  const inicial = resolverPreferenciasColunas(disponiveis, null);
  const editado = {
    order: ['cliente', 'diasSuspenso', ...inicial.order.filter(k => !['cliente', 'diasSuspenso'].includes(k))],
    hidden: inicial.hidden.filter(k => k !== 'diasSuspenso'), widths: { diasSuspenso: 180 },
  };
  const recarregado = resolverPreferenciasColunas(disponiveis, JSON.parse(JSON.stringify(editado)));
  assert.equal(visiveis(recarregado)[1], 'diasSuspenso');
  assert.equal(recarregado.widths.diasSuspenso, 180);
  assert.equal(visiveis(resolverPreferenciasColunas(disponiveis, null)).includes('diasSuspenso'), false);
});

test('personalizar uma esteira não muda as demais e preserva renderizações e dimensões locais', () => {
  const suspensos = ampliar('colunasSuspensos');
  const cancelados = ampliar('colunasCancelados');
  assert.equal(suspensos.find(c => c.key === 'cliente').defaultWidth, 200);
  assert.equal(cancelados.find(c => c.key === 'cliente').defaultWidth, 220);
  assert.equal(suspensos.find(c => c.key === 'cliente'), padroes.get('colunasSuspensos')[0]);
  assert.equal(resolverPreferenciasColunas(ampliar('colunasOngoing'), null).hidden.includes('diasSuspenso'), true);
});

test('colunas essenciais continuam fixas apenas nas esteiras onde já eram essenciais', () => {
  assert.equal(ampliar('colunasEsteiraAtual').find(c => c.key === 'status').locked, true);
  assert.equal(ampliar('colunasCancelados').find(c => c.key === 'status').locked, false);
  const prefs = resolverPreferenciasColunas(ampliar('colunasCancelados'), { order: ['cliente'], hidden: ['cliente'], widths: {} });
  assert.equal(prefs.hidden.includes('cliente'), false);
});

test('cache corrompido usa o padrão e valores inválidos não geram duplicatas ou larguras incorretas', () => {
  const colunas = ampliar('colunasCancelados');
  for (const invalido of [null, [], 'texto', { order: [null], hidden: [], widths: {} }, { order: [], hidden: [], widths: [] }]) {
    assert.deepEqual(visiveis(resolverPreferenciasColunas(colunas, invalido)), padroes.get('colunasCancelados').map(c => c.key));
  }
  const prefs = resolverPreferenciasColunas(colunas, { order: ['cliente', 'cliente', 'removida'], hidden: ['removida'], widths: { cliente: 300, cs: -2, contato: '80', comercial: Infinity, removida: 180 } });
  assert.equal(prefs.order.filter(k => k === 'cliente').length, 1);
  assert.equal(prefs.order.includes('removida'), false);
  assert.deepEqual(prefs.widths, { cliente: 300 });
});
