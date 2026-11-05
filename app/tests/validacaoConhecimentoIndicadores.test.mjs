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
const { calcularValidacaoPorCliente: calcular } = module.namespace;

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
  assert.deepEqual(porEmpresa.get('e1'), { empresaId: 'e1', aprovada: true, concluidaEm: 2000 });
  assert.deepEqual(porEmpresa.get('e2'), { empresaId: 'e2', aprovada: true, concluidaEm: 1500 });
});

test('ignora tentativas não concluídas (em andamento, pausada, cancelada)', () => {
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
  assert.equal(resultado[0].concluidaEm, 3000);
});
