import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule } from 'node:vm';
import ts from 'typescript';

async function carregar(nome) {
  const source = readFileSync(new URL(`../src/utils/${nome}.ts`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = new SourceTextModule(code);
  await module.link(specifier => carregar(specifier.replace('./', '')));
  return module;
}
const module = await carregar('indicadoresTreinamento');
await module.evaluate();
const { construirEventosIndicadoresTreinamento: construir, calcularValorKpiTreinamento: calcular,
  listarTreinadoresIndicadoresTreinamento: listar } = module.namespace;

const lancamento = (empresa, tema = 'Cadastro', treinador = 'Natália Teixeira') => ({
  tipoAcao: 'treinamento', treinadorNome: treinador, treinamentoEmpresa: empresa,
  treinamentoTema: tema, treinamentoDataSolicitacao: '2026-10-13',
  treinamentoDataRealizacao: '2026-10-15', treinamentoResultados: ['Bom'],
});
const inicio = new Date(2026, 9, 1);
const fim = new Date(2026, 9, 31, 23, 59, 59, 999);

test('inclui todos os status exceto ongoing em realizados, CSAT e espera', () => {
  const empresas = [
    { nomeEmpresa: 'Ativo' }, { nomeEmpresa: 'Suspenso', isSuspended: true },
    { nomeEmpresa: 'Cancelado', isCancelled: true }, { nomeEmpresa: 'Concluído', progresso: 100 },
    { nomeEmpresa: 'Ongoing', isOngoing: true },
    { nomeEmpresa: 'Ongoing suspenso', isOngoing: true, isSuspended: true },
  ];
  const eventos = construir(empresas, [], empresas.map(e => lancamento(e.nomeEmpresa)), []);
  for (const chave of ['treinamentosRealizados', 'treinamentosComResultado', 'treinamentosBons', 'esperas']) {
    assert.equal(eventos[chave].length, 4, chave);
  }
  assert.equal(calcular('treinamentosRealizados', eventos, inicio, fim, 'Natália Teixeira'), 4);
  assert.equal(calcular('taxaCsat', eventos, inicio, fim, null), 100);
  assert.equal(calcular('tempoMedioEspera', eventos, inicio, fim, null), 2);
});

test('exclui ongoing também em ausências e cancelamentos, normalizando o nome', () => {
  const empresas = [{ nomeEmpresa: 'Clínica', isOngoing: true }, { nomeEmpresa: 'Suspenso', isSuspended: true }];
  const lancamentos = ['Ausente', 'Cancelado'].flatMap(tema => [
    lancamento(' CLINICA ', tema), lancamento('Suspenso', tema),
  ]);
  const eventos = construir(empresas, [], lancamentos, []);
  assert.equal(eventos.treinamentosAusentes.length, 1);
  assert.equal(eventos.treinamentosCancelados.length, 1);
  assert.equal(eventos.treinamentosRealizados.length, 0);
  assert.equal(eventos.esperas.length, 0);
});

test('preserva lançamentos antigos sem cadastro e não inventa espera sem vínculo', () => {
  const eventos = construir([], [], [lancamento('Empresa antiga'), lancamento(undefined)], []);
  assert.equal(eventos.treinamentosRealizados.length, 2);
  assert.equal(eventos.esperas.length, 0);
});

test('mantém Natália no filtro e seu histórico mesmo fora dos treinadores atuais', () => {
  const lancamentos = [lancamento('Cliente'), lancamento('Cliente', 'Cadastro', ' natalia teixeira '),
    lancamento('Cliente', 'Cadastro', 'Painel'), { tipoAcao: 'outro', treinadorNome: 'Outro usuário' }];
  const nomes = listar(['Bruno Silva'], lancamentos);
  assert.deepEqual(nomes, ['Bruno Silva', 'Natália Teixeira']);
  const eventos = construir([{ nomeEmpresa: 'Cliente', responsavel: 'Bruno' }], [], lancamentos.slice(0, 2),
    nomes.map(nome => ({ nome })));
  assert.equal(calcular('treinamentosRealizados', eventos, inicio, fim, 'Natália Teixeira'), 2);
  assert.equal(calcular('treinamentosRealizados', eventos, inicio, fim, 'Bruno Silva'), 0);
});
