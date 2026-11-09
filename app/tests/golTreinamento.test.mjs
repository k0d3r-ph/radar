import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { SourceTextModule } from 'node:vm';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const modulos = new Map();

function resolverArquivo(url) {
  const caminho = fileURLToPath(url);
  if (existsSync(caminho) && statSync(caminho).isFile()) return caminho;
  if (existsSync(`${caminho}.ts`)) return `${caminho}.ts`;
  const indice = join(caminho, 'index.ts');
  if (existsSync(indice)) return indice;
  throw new Error(`Módulo de teste não encontrado: ${caminho}`);
}

function carregar(url) {
  const caminho = resolverArquivo(url);
  const identificador = pathToFileURL(caminho).href;
  if (modulos.has(identificador)) return modulos.get(identificador);
  const source = readFileSync(caminho, 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = new SourceTextModule(code, { identifier: identificador });
  modulos.set(identificador, module);
  return module;
}
const module = carregar(new URL('../src/utils/golTreinamento.ts', import.meta.url));
await module.link((specifier, importador) => carregar(new URL(specifier, importador.identifier)));
await module.evaluate();
const {
  calcularGolNoPrazo: calcular,
  calcularNaoRealizadosGolTreinamento: calcularNaoRealizados,
} = module.namespace;

const DIA_MS = 24 * 60 * 60 * 1000;

function dataISO(data) {
  const y = data.getFullYear();
  const m = String(data.getMonth() + 1).padStart(2, '0');
  const d = String(data.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function empresa(dados) {
  return { nomeEmpresa: 'Cliente', ...dados };
}

function ocorrenciaGol(empresaNome, dataOcorrencia) {
  return { empresa: empresaNome, tipo: 'Gol', dataOcorrencia, descricao: '', departamento: '' };
}

test('mês de referência é o do fim do prazo de 30 dias, não o mês em que o Gol foi batido', () => {
  // Entrou em 15/jan, prazo vence 14/fev — mas só bateu o Gol bem depois, em abril.
  const entrada = new Date(2026, 0, 15);
  const golBemDepois = new Date(2026, 3, 10);
  const resultado = calcular(
    [empresa({ nomeEmpresa: 'Cliente C', dataEntrada: dataISO(entrada) })],
    [ocorrenciaGol('Cliente C', golBemDepois.getTime())],
  );
  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].atingiuGol, true);
  assert.equal(resultado[0].noPrazo, false);
  // Mês de referência deve ser fevereiro (fim do prazo), não abril (mês do Gol).
  assert.equal(resultado[0].dataReferencia.getMonth(), 1);
  assert.equal(resultado[0].dataReferencia.getFullYear(), 2026);
});

test('Gol batido dentro do prazo conta no mês em que o cliente completa 30 dias, não no mês do Gol', () => {
  // Exemplo validado com o supervisor (TC Tracker): entrou 07/10, bateu o Gol 28/10,
  // completa 30 dias em 06/11 — conta em novembro, não em outubro.
  const entrada = new Date(2026, 9, 7);
  const golDentroDoPrazo = new Date(2026, 9, 28);
  const resultado = calcular(
    [empresa({ nomeEmpresa: 'TC Tracker', dataEntrada: dataISO(entrada) })],
    [ocorrenciaGol('TC Tracker', golDentroDoPrazo.getTime())],
  );
  assert.equal(resultado[0].noPrazo, true);
  assert.equal(resultado[0].dataReferencia.getMonth(), 10); // novembro
  assert.equal(resultado[0].dataReferencia.getFullYear(), 2026);
});

test('cliente ainda dentro da janela de 30 dias, sem Gol, fica fora do cálculo', () => {
  const entrada = new Date(Date.now() - 5 * DIA_MS);
  const resultado = calcular([empresa({ nomeEmpresa: 'Cliente Novo', dataEntrada: dataISO(entrada) })], []);
  assert.deepEqual(resultado, []);
});

test('cliente sem Gol e com prazo vencido conta como não realizado, no mês do vencimento', () => {
  const entrada = new Date(Date.now() - 40 * DIA_MS);
  const resultado = calcular([empresa({ nomeEmpresa: 'Cliente Sem Gol', dataEntrada: dataISO(entrada) })], []);
  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].atingiuGol, false);
  assert.equal(resultado[0].noPrazo, false);
});

test('quebra de não realizados inclui apenas clientes cujo prazo de 30 dias venceu', () => {
  const empresas = [
    empresa({ nomeEmpresa: 'Prazo vencido', dataEntrada: dataISO(new Date(Date.now() - 40 * DIA_MS)) }),
    empresa({ nomeEmpresa: 'Dentro do prazo', dataEntrada: dataISO(new Date(Date.now() - 5 * DIA_MS)) }),
  ];

  const resultado = calcularNaoRealizados(empresas, []);

  assert.deepEqual(resultado.map((item) => item.empresa), ['Prazo vencido']);
});

test('empresa sem dataEntrada não entra no cálculo', () => {
  const resultado = calcular([empresa({ nomeEmpresa: 'Sem Data' })], []);
  assert.deepEqual(resultado, []);
});
