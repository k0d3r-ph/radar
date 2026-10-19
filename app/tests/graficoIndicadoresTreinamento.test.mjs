import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule } from 'node:vm';
import ts from 'typescript';

const modulos = new Map();
async function carregar(nome) {
  if (modulos.has(nome)) return modulos.get(nome);
  const code = ts.transpileModule(readFileSync(new URL(`../src/utils/${nome}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = new SourceTextModule(code);
  modulos.set(nome, module);
  await module.link(specifier => carregar(specifier.replace('./', '')));
  return module;
}
const module = await carregar('graficoIndicadoresTreinamento');
await module.evaluate();
const { construirGraficoIndicadoresTreinamento: construir } = module.namespace;
const indicadores = modulos.get('indicadoresTreinamento').namespace;
const data = valor => new Date(`${valor}T12:00:00`);
const intervalo = (inicio, fim) => ({ inicio: new Date(`${inicio}T00:00:00`), fim: new Date(`${fim}T23:59:59.999`) });
const ocorrencia = (dia, extras = {}) => ({
  tipo: 'Treinamento', empresa: 'Cliente', responsavel: 'Natália Teixeira', createdAt: data(dia).getTime(),
  temaOcorrencia: ['Cadastro'], treinamentoResultados: [], ...extras,
});
const eventos = indicadores.construirEventosIndicadoresTreinamento([{ nomeEmpresa: 'Cliente' }], [
  ocorrencia('2026-10-01', { treinamentoResultados: ['Bom'], treinamentoDataSolicitacao: '2026-09-30' }),
  ocorrencia('2026-10-01', { treinamentoDataSolicitacao: '2026-09-28' }),
  ocorrencia('2026-10-01', { responsavel: 'Outro treinador', treinamentoResultados: ['Bom'] }),
  ocorrencia('2026-09-01', { treinamentoResultados: ['Bom'], treinamentoDataSolicitacao: '2026-08-30' }),
  ocorrencia('2026-09-04'),
], [], []);
const opcoes = {
  atual: intervalo('2026-10-01', '2026-10-03'), comparacoes: [], granularidade: 'dia', incluirFinsDeSemana: true,
  eventos, kpi: 'treinamentosRealizados', treinador: 'Natália Teixeira', cor: '#3b82f6',
};

test('tooltip apresenta realizados, CSAT e espera do dia com o mesmo filtro de treinador', () => {
  const grafico = construir(opcoes);
  assert.deepEqual(grafico.series[0].values, [2, 0, 0]);
  const detalhes = grafico.series[0].pointDetails;
  assert.equal(detalhes[0].dateLabel, '01/10/2026');
  assert.equal(detalhes[0].valueLabel, '2');
  assert.deepEqual(detalhes[0].metrics.map(m => m.value), ['50,0%', '2,0 dias']);
  assert.deepEqual(detalhes[1].metrics.map(m => m.value), ['—', '—']);
});

test('compara todos os períodos selecionados com cores distintas e datas reais no tooltip', () => {
  const grafico = construir({ ...opcoes, comparacoes: [intervalo('2026-09-01', '2026-09-04'), intervalo('2026-08-01', '2026-08-04')] });
  assert.deepEqual(grafico.categorias, ['Dia 1', 'Dia 2', 'Dia 3', 'Dia 4']);
  assert.equal(grafico.series.length, 3);
  assert.equal(new Set(grafico.series.map(s => s.color)).size, 3);
  assert.deepEqual(grafico.series[0].values, [2, 0, 0, null]);
  assert.deepEqual(grafico.series[1].values, [1, 0, 0, 1]);
  assert.equal(grafico.series[0].pointDetails[3], null);
  assert.equal(grafico.series[1].pointDetails[0].dateLabel, '01/09/2026');
  assert.deepEqual(grafico.series[1].pointDetails[0].metrics.map(m => m.value), ['100,0%', '2,0 dias']);
  assert.equal(construir({ ...opcoes, comparacoes: [] }).series.length, 1);
});

test('mês curto não inventa registros para os dias 30 e 31', () => {
  const grafico = construir({ ...opcoes, atual: intervalo('2024-03-01', '2024-03-31'), comparacoes: [intervalo('2024-02-01', '2024-02-29')] });
  assert.equal(grafico.categorias.length, 31);
  assert.equal(grafico.series[1].values[28], 0);
  assert.deepEqual(grafico.series[1].values.slice(29), [null, null]);
});

test('semanas respeitam os limites do período e agregam CSAT e espera do intervalo', () => {
  const grafico = construir({ ...opcoes, granularidade: 'semana', atual: intervalo('2026-09-30', '2026-10-06') });
  assert.deepEqual(grafico.series[0].values, [2, 0]);
  assert.equal(grafico.series[0].pointDetails[0].dateLabel, '30/09/2026 a 04/10/2026');
  assert.deepEqual(grafico.series[0].pointDetails[0].metrics.map(m => m.value), ['50,0%', '2,0 dias']);
});

test('CSAT sem amostra permanece lacuna e não zero de desempenho', () => {
  const grafico = construir({ ...opcoes, kpi: 'taxaCsat' });
  assert.deepEqual(grafico.series[0].values, [50, null, null]);
  assert.deepEqual(grafico.series[0].pointDetails[0].metrics, []);
});
