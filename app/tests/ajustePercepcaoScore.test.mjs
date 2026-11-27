import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule } from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/utils/score.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = new SourceTextModule(code);
await module.link(() => {
  throw new Error('score.ts não deve importar módulos em tempo de execução');
});
await module.evaluate();
const {
  aplicarAjustePercepcao,
  normalizarValorAjustePercepcao,
  ajustePercepcaoValido,
  descreverAjustePercepcao,
  LIMITE_AJUSTE_PERCEPCAO_SCORE,
} = module.namespace;

test('sem ajuste, o resultado do questionário fica intacto', () => {
  const res = { score: 5, tipo: 'Safety', contadores: {} };
  assert.equal(aplicarAjustePercepcao(res, null), res);
  assert.equal(aplicarAjustePercepcao(res, { valor: 0 }), res);
});

test('ajuste positivo soma pontos e pode levar a Fast', () => {
  const res = aplicarAjustePercepcao({ score: 5, tipo: 'Safety', contadores: { recordaTemas: 2 } }, { valor: 1 });
  assert.equal(res.score, 6);
  assert.equal(res.tipo, 'Fast');
  assert.deepEqual(res.contadores, { recordaTemas: 2 });
});

test('ajuste negativo desconta pontos e pode levar a Safety', () => {
  const res = aplicarAjustePercepcao({ score: 6.5, tipo: 'Fast' }, { valor: -1 });
  assert.equal(res.score, 5.5);
  assert.equal(res.tipo, 'Safety');
});

test('valor fica limitado e arredondado ao passo', () => {
  assert.equal(normalizarValorAjustePercepcao(10), LIMITE_AJUSTE_PERCEPCAO_SCORE);
  assert.equal(normalizarValorAjustePercepcao(-10), -LIMITE_AJUSTE_PERCEPCAO_SCORE);
  assert.equal(normalizarValorAjustePercepcao(0.1 + 0.2 + 0.2), 0.5);
  assert.equal(normalizarValorAjustePercepcao(Number.NaN), 0);
  assert.equal(aplicarAjustePercepcao({ score: 4, tipo: 'Safety' }, { valor: 99 }).score, 4 + LIMITE_AJUSTE_PERCEPCAO_SCORE);
});

test('justificativa é obrigatória apenas quando há ajuste', () => {
  assert.equal(ajustePercepcaoValido({ valor: 0, justificativa: '' }), true);
  assert.equal(ajustePercepcaoValido({ valor: 1, justificativa: '   ' }), false);
  assert.equal(ajustePercepcaoValido({ valor: -0.5, justificativa: 'Cliente desatento' }), true);
});

test('descrição do ajuste para a ocorrência de mudança de score', () => {
  assert.equal(descreverAjustePercepcao(null), '');
  assert.equal(
    descreverAjustePercepcao({ valor: -1.5, justificativa: 'Pouco engajado', criadoEm: 0 }),
    'Ajuste por percepção do treinador: −1,5 (Pouco engajado)',
  );
});

test('reabrir o questionário traz o ajuste salvo no último cálculo', () => {
  const { rascunhoDoAjustePercepcao } = module.namespace;
  assert.deepEqual(rascunhoDoAjustePercepcao(null), { valor: 0, justificativa: '' });
  assert.deepEqual(
    rascunhoDoAjustePercepcao({ valor: 2, justificativa: 'Muito engajado', responsavel: 'Ana', criadoEm: 1 }),
    { valor: 2, justificativa: 'Muito engajado' },
  );
});

test('recalcular mantendo o ajuste preserva autor e data; mudar registra o usuário atual', () => {
  const { registrarAjustePercepcao } = module.namespace;
  const anterior = { valor: 2, justificativa: 'Muito engajado', responsavel: 'Ana', criadoEm: 1 };
  assert.equal(registrarAjustePercepcao({ valor: 2, justificativa: ' Muito engajado ' }, anterior, 'Bruno', 99), anterior);
  assert.deepEqual(
    registrarAjustePercepcao({ valor: -1, justificativa: 'Desatento' }, anterior, 'Bruno', 99),
    { valor: -1, justificativa: 'Desatento', responsavel: 'Bruno', criadoEm: 99 },
  );
  assert.equal(registrarAjustePercepcao({ valor: 0, justificativa: '' }, anterior, 'Bruno', 99), null);
});
