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
const module = carregar(new URL('../src/utils/validacaoConhecimentoIndicadores.ts', import.meta.url));
await module.link((specifier, importador) => carregar(new URL(specifier, importador.identifier)));
await module.evaluate();
const { calcularValidacaoPorCliente: calcular, resultadoParcialValidacao, minimoPreviaParcial, CHAVE_MINIMO_PREVIA_PARCIAL } = module.namespace;

function tentativa(dados) {
  return { id: 't', treinadorId: 'u1', treinadorNome: 'Fulano', numero: 1, anteriorId: null,
    questoes: [], secoes: [], avisos: [], revisao: 1, createdAt: 0, updatedAt: 0,
    treinamentoDataSolicitacao: '', treinamentoTempoAgenda: '', treinamentoSolicitante: '',
    empresa: 'Empresa', status: 'concluida', ...dados };
}

test('mantém só a tentativa concluída mais recente de cada cliente', () => {
  const resultado = calcular([
    tentativa({ empresaId: 'e1', numero: 1, concluidaEm: 1000, aprovada: false }),
    tentativa({ empresaId: 'e1', numero: 2, concluidaEm: 2000, aprovada: true }),
    tentativa({ empresaId: 'e2', numero: 1, concluidaEm: 1500, aprovada: true }),
  ]);
  assert.equal(resultado.length, 2);
  const porEmpresa = new Map(resultado.map((r) => [r.empresaId, r]));
  assert.deepEqual(porEmpresa.get('e1'), { empresaId: 'e1', aprovada: true, previa: false, dataReferencia: 2000 });
  assert.deepEqual(porEmpresa.get('e2'), { empresaId: 'e2', aprovada: true, previa: false, dataReferencia: 1500 });
});

test('ignora tentativas abertas sem validação parcial e canceladas', () => {
  const resultado = calcular([
    tentativa({ empresaId: 'e1', status: 'andamento', concluidaEm: 9999, aprovada: true }),
    tentativa({ empresaId: 'e1', status: 'pausada', concluidaEm: 9999, aprovada: true }),
    tentativa({ empresaId: 'e1', status: 'cancelada', concluidaEm: 9999, aprovada: true }),
  ]);
  assert.deepEqual(resultado, []);
});

test('ignora tentativa concluída sem concluidaEm registrado', () => {
  const resultado = calcular([tentativa({ empresaId: 'e1', concluidaEm: undefined, aprovada: true })]);
  assert.deepEqual(resultado, []);
});

test('ordem de chegada no array não importa, só o concluidaEm mais recente vence', () => {
  const resultado = calcular([
    tentativa({ empresaId: 'e1', numero: 3, concluidaEm: 3000, aprovada: false }),
    tentativa({ empresaId: 'e1', numero: 1, concluidaEm: 1000, aprovada: true }),
    tentativa({ empresaId: 'e1', numero: 2, concluidaEm: 2000, aprovada: true }),
  ]);
  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].aprovada, false);
  assert.equal(resultado[0].dataReferencia, 3000);
});

const q = (respostaParcial) => ({ id: Math.random().toString(36), secao: 'Temas iniciais', texto: 'P', preferida: false, resposta: null, respostaParcial, origem: 'banco' });

test('resultado parcial usa só as perguntas marcadas e o mínimo de 80% inclusive', () => {
  assert.equal(resultadoParcialValidacao([q(null), q(undefined)]), null);
  // 4 corretas + 1 parcial = 9/10 unidades (90%); a pergunta sem marcação parcial não conta.
  assert.deepEqual(resultadoParcialValidacao([q('correto'), q('correto'), q('correto'), q('correto'), q('parcial'), q(null)]), { marcadas: 5, aprovada: true });
  // Exatamente 80%: 3 corretas + 2 parciais = 8/10.
  assert.equal(resultadoParcialValidacao([q('correto'), q('correto'), q('correto'), q('parcial'), q('parcial')]).aprovada, true);
  // 79,x%: 3 corretas + 1 parcial + 1 incorreta = 7/10.
  assert.equal(resultadoParcialValidacao([q('correto'), q('correto'), q('correto'), q('parcial'), q('incorreto')]).aprovada, false);
});

test('avaliação aberta com validação parcial entra como prévia pela data da parcial', () => {
  const resultado = calcular([
    tentativa({ empresaId: 'e1', status: 'andamento', updatedAt: 9000, parcialAtualizadaEm: 4000, questoes: [q('correto'), q('correto')] }),
    tentativa({ empresaId: 'e2', status: 'pausada', updatedAt: 5000, questoes: [q('incorreto'), q(null)] }),
  ], 1);
  const porEmpresa = new Map(resultado.map((r) => [r.empresaId, r]));
  assert.deepEqual(porEmpresa.get('e1'), { empresaId: 'e1', aprovada: true, previa: true, dataReferencia: 4000 });
  // Registro antigo sem parcialAtualizadaEm usa updatedAt.
  assert.deepEqual(porEmpresa.get('e2'), { empresaId: 'e2', aprovada: false, previa: true, dataReferencia: 5000 });
});

test('conclusão substitui a prévia e nova parcial após reprovação substitui a final antiga', () => {
  const concluida = calcular([
    tentativa({ empresaId: 'e1', status: 'concluida', concluidaEm: 6000, aprovada: false, parcialAtualizadaEm: 4000, questoes: [q('correto')] }),
  ]);
  assert.deepEqual(concluida, [{ empresaId: 'e1', aprovada: false, previa: false, dataReferencia: 6000 }]);

  const refazendo = calcular([
    tentativa({ empresaId: 'e1', status: 'concluida', numero: 1, concluidaEm: 6000, aprovada: false }),
    tentativa({ empresaId: 'e1', status: 'andamento', numero: 2, parcialAtualizadaEm: 7000, questoes: [q('correto'), q('correto')] }),
  ], 1);
  assert.deepEqual(refazendo, [{ empresaId: 'e1', aprovada: true, previa: true, dataReferencia: 7000 }]);
});

test('prévia exige o mínimo de perguntas com validação parcial (padrão 5)', () => {
  const marcadas = (n) => [...Array(n)].map(() => q('correto')).concat([q(null), q(null)]);
  const aberta = (n) => tentativa({ empresaId: 'e1', status: 'andamento', parcialAtualizadaEm: 4000, questoes: marcadas(n) });
  assert.deepEqual(calcular([aberta(4)]), []);
  assert.equal(calcular([aberta(5)]).length, 1);
  // Abaixo do mínimo, a reprovação anterior continua valendo.
  const anterior = tentativa({ empresaId: 'e1', concluidaEm: 1000, aprovada: false });
  assert.deepEqual(calcular([anterior, aberta(4)]), [{ empresaId: 'e1', aprovada: false, previa: false, dataReferencia: 1000 }]);
  // Mínimo configurado pelo Master.
  assert.deepEqual(calcular([aberta(4)], 3).map((r) => r.previa), [true]);
  assert.deepEqual(calcular([aberta(5)], 6), []);
});

test('mínimo salvo só vale se for inteiro de 1 a 100; senão usa o padrão 5', () => {
  assert.equal(minimoPreviaParcial(undefined), 5);
  assert.equal(minimoPreviaParcial({}), 5);
  assert.equal(minimoPreviaParcial({ [CHAVE_MINIMO_PREVIA_PARCIAL]: 3 }), 3);
  for (const invalido of [0, 101, 2.5, -1, NaN]) assert.equal(minimoPreviaParcial({ [CHAVE_MINIMO_PREVIA_PARCIAL]: invalido }), 5);
});
