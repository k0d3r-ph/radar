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
  listarTreinadoresIndicadoresTreinamento: listar, gerarPeriodosIndicadoresEntreDatas: periodos,
  listarEsperasLongasTreinamento: listarEsperas, recortarPeriodosIndicadores: recortar } = module.namespace;

const lancamento = (empresa, tema = 'Cadastro', treinador = 'Natália Teixeira') => ({
  tipoAcao: 'treinamento', treinadorNome: treinador, treinamentoEmpresa: empresa,
  treinamentoTema: tema, treinamentoDataSolicitacao: '2026-10-13',
  treinamentoDataRealizacao: '2026-10-15', treinamentoResultados: ['Bom'],
});
const inicio = new Date(2026, 9, 1);
const fim = new Date(2026, 9, 31, 23, 59, 59, 999);
const ocorrencia = (empresa, tema = ['Cadastro'], extras = {}) => ({
  tipo: 'Treinamento', empresa, responsavel: 'Natália Teixeira', temaOcorrencia: tema,
  createdAt: new Date(2026, 9, 15, 12).getTime(),
  treinamentoDataSolicitacao: '2026-10-13', treinamentoResultados: ['Bom'], ...extras,
});

test('inclui todos os status, inclusive ongoing, em realizados, CSAT e espera', () => {
  const empresas = [
    { nomeEmpresa: 'Ativo' }, { nomeEmpresa: 'Suspenso', isSuspended: true },
    { nomeEmpresa: 'Cancelado', isCancelled: true }, { nomeEmpresa: 'Concluído', progresso: 100 },
    { nomeEmpresa: 'Ongoing', isOngoing: true },
    { nomeEmpresa: 'Ongoing suspenso', isOngoing: true, isSuspended: true },
  ];
  const eventos = construir(empresas, empresas.map(e => ocorrencia(e.nomeEmpresa)), [], []);
  for (const chave of ['treinamentosRealizados', 'treinamentosComResultado', 'treinamentosBons', 'esperas']) {
    assert.equal(eventos[chave].length, 6, chave);
  }
  assert.equal(calcular('treinamentosRealizados', eventos, inicio, fim, 'Natália Teixeira'), 6);
  assert.equal(calcular('taxaCsat', eventos, inicio, fim, null), 100);
  assert.equal(calcular('tempoMedioEspera', eventos, inicio, fim, null), 2);
});

test('inclui ongoing também em ausências e cancelamentos, normalizando o nome', () => {
  const empresas = [{ nomeEmpresa: 'Clínica', isOngoing: true }, { nomeEmpresa: 'Suspenso', isSuspended: true }];
  const ocorrencias = ['Ausente', 'Cancelado'].flatMap(tema => [
    ocorrencia(' CLINICA ', [tema]), ocorrencia('Suspenso', [tema]),
  ]);
  const eventos = construir(empresas, ocorrencias, [], []);
  assert.equal(eventos.treinamentosAusentes.length, 2);
  assert.equal(eventos.treinamentosCancelados.length, 2);
  assert.equal(eventos.treinamentosRealizados.length, 0);
  assert.equal(eventos.esperas.length, 0);
});

test('preserva ocorrências antigas sem cadastro e não inventa espera sem vínculo', () => {
  const eventos = construir([], [ocorrencia('Empresa antiga'), ocorrencia('Sem cadastro')], [], []);
  assert.equal(eventos.treinamentosRealizados.length, 2);
  assert.equal(eventos.esperas.length, 0);
});

test('mantém Natália no filtro e seu histórico mesmo fora dos treinadores atuais', () => {
  const lancamentos = [lancamento('Cliente'), lancamento('Cliente', 'Cadastro', ' natalia teixeira '),
    lancamento('Cliente', 'Cadastro', 'Painel'), { tipoAcao: 'outro', treinadorNome: 'Outro usuário' }];
  const nomes = listar(['Bruno Silva'], lancamentos);
  assert.deepEqual(nomes, ['Bruno Silva', 'Natália Teixeira']);
  const eventos = construir([{ nomeEmpresa: 'Cliente', responsavel: 'Bruno' }], [
    ocorrencia('Cliente'), ocorrencia('Cliente', ['Cadastro'], { responsavel: 'Natalia' }),
  ], lancamentos.slice(0, 2),
    nomes.map(nome => ({ nome })));
  assert.equal(calcular('treinamentosRealizados', eventos, inicio, fim, 'Natália Teixeira'), 2);
  assert.equal(calcular('treinamentosRealizados', eventos, inicio, fim, 'Bruno Silva'), 0);
});

test('conta ocorrência sem tema ou sem ponto, sem somar lançamentos antigos sem vínculo', () => {
  const ocorrencias = [ocorrencia('A', []), ocorrencia('B', [], { temaOcorrencia: undefined }), ocorrencia('C')];
  const eventos = construir([], ocorrencias, [lancamento('C'), lancamento('A')], []);
  assert.equal(calcular('treinamentosRealizados', eventos, inicio, fim, null), 3);
  assert.equal(construir([], [], [lancamento('A')], []).treinamentosRealizados.length, 0);
});

test('empresa, data e autor da ocorrência prevalecem sobre o lançamento divergente', () => {
  const o = ocorrencia('Rastrek Bahia', ['Cadastro'], { id: 'o1', gamificacaoPontoId: 'p1' });
  const l = { ...lancamento('Rastrear Gestão'), id: 'p1', treinadorNome: 'Outro treinador', treinamentoDataRealizacao: '2026-11-02' };
  assert.equal(construir([{ nomeEmpresa: 'Rastrek Bahia', isOngoing: true }], [o], [l], [])
    .treinamentosRealizados.length, 1);
  const eventos = construir([], [o], [l], []);
  assert.equal(calcular('treinamentosRealizados', eventos, inicio, fim, 'Natália Teixeira'), 1);
});

test('usa data do Histórico e exclui treinamentos de fim de semana do cartão e das colunas', () => {
  const sexta = ocorrencia('Bezecom', ['Cadastro'], {
    id: 'sexta', gamificacaoPontoId: 'p1', createdAt: new Date(2026, 9, 16, 12).getTime(),
  });
  const sabado = ocorrencia('Cliente', ['Cadastro'], { createdAt: new Date(2026, 9, 17, 12).getTime() });
  const eventos = construir([], [sexta, sabado], [{ ...lancamento('Bezecom'), id: 'p1', treinamentoDataRealizacao: '2026-10-17' }], []);
  assert.equal(calcular('treinamentosRealizados', eventos, inicio, fim, null), 1);
  const dias = periodos(new Date(2026, 9, 16), new Date(2026, 9, 18), 'dia');
  assert.equal(dias.length, 1);
  assert.deepEqual(dias.map(d => calcular('treinamentosRealizados', eventos, d.inicio, d.fim, null)), [1]);
});

test('semanas vão de segunda a sexta e descartam recortes só com fim de semana', () => {
  const semanas = periodos(new Date(2026, 9, 17), new Date(2026, 9, 25), 'semana');
  assert.deepEqual(semanas.map(s => [s.inicio.getDate(), s.fim.getDate()]), [[12, 16], [19, 23]]);
  const recortadas = recortar(semanas, { inicio: new Date(2026, 9, 17), fim: new Date(2026, 9, 25, 23, 59) });
  assert.deepEqual(recortadas.map(s => [s.inicio.getDate(), s.fim.getDate()]), [[19, 23]]);
});

test('usa resultados e solicitação da ocorrência e só complementa campos ausentes por vínculo explícito', () => {
  const empresas = [{ nomeEmpresa: 'Cliente', isCancelled: true }];
  const o = ocorrencia('Cliente', ['Cadastro'], { id: 'o1', treinamentoResultados: undefined, treinamentoDataSolicitacao: undefined });
  const l = { ...lancamento('Cliente'), ocorrenciaId: 'o1', treinamentoDataRealizacao: '2026-10-25' };
  const eventos = construir(empresas, [o], [l], []);
  assert.equal(calcular('taxaCsat', eventos, inicio, fim, null), 100);
  assert.equal(calcular('tempoMedioEspera', eventos, inicio, fim, null), 2);
  const semCsat = construir(empresas, [{ ...o, treinamentoResultados: [] }], [l], []);
  assert.equal(calcular('taxaCsat', semCsat, inicio, fim, null), 0);
});

test('deduplica IDs de ocorrência e ignora datas ausentes, sem usar data de hoje', () => {
  const o = ocorrencia('Cliente', [], { id: 'o1' });
  const eventos = construir([], [o, o, ocorrencia('Sem data', [], { createdAt: undefined })], [], []);
  assert.equal(eventos.treinamentosRealizados.length, 1);
  const antiga = construir([], [ocorrencia('Antiga', [], { createdAt: undefined, dataOcorrencia: new Date(2026, 9, 15).getTime() })], [], []);
  assert.equal(calcular('treinamentosRealizados', antiga, inicio, fim, null), 1);
});

test('filtro inclui autores só das ocorrências e resolve primeiro nome sem duplicar Natália', () => {
  const ocorrencias = [ocorrencia('A', [], { responsavel: 'Natália' }), ocorrencia('B')];
  const nomes = listar([], [], ocorrencias);
  assert.deepEqual(nomes, ['Natália Teixeira']);
  const eventos = construir([], ocorrencias, [], nomes.map(nome => ({ nome })));
  assert.equal(calcular('treinamentosRealizados', eventos, inicio, fim, nomes[0]), 2);
});

test('mantém sessões distintas da mesma empresa no mesmo dia, sem casamento por semelhança', () => {
  const ocorrencias = [ocorrencia('Cliente', ['Cadastro'], { id: 'o1' }), ocorrencia('Cliente', ['Cadastro'], { id: 'o2' })];
  const eventos = construir([], ocorrencias, [lancamento('Cliente')], []);
  assert.equal(calcular('treinamentosRealizados', eventos, inicio, fim, null), 2);
});

test('indicadores de atendimento preservam exclusão dos fins de semana', () => {
  const eventos = construir([], [{ tipo: 'Dúvida', departamento: 'Treinamento', responsavel: 'Natália Teixeira',
    dataOcorrencia: new Date(2026, 9, 17, 12).getTime() }], [], []);
  assert.equal(eventos.atendimentosWhatsApp.length, 1);
  assert.equal(calcular('atendimentosWhatsApp', eventos, inicio, fim, null), 0);
});

test('unifica Jeff Borges da Costa e Jeff Costa no filtro e em todos os eventos do relatório', () => {
  const ocorrencias = [
    ocorrencia('Cliente', ['Cadastro'], { responsavel: 'Jeff Borges da Costa' }),
    ocorrencia('Cliente', ['Cadastro'], { responsavel: 'Jeff Costa' }),
    ocorrencia('Cliente', ['Cadastro'], { responsavel: 'Jeff' }),
    { tipo: 'Dúvida', departamento: 'Treinamento', responsavel: 'Jeff Borges da Costa', dataOcorrencia: new Date(2026, 9, 15).getTime() },
    { tipo: 'Dúvida', departamento: 'Suporte', empresa: 'Cliente', dataOcorrencia: new Date(2026, 9, 15).getTime() },
  ];
  const nomes = listar(['Jeff Costa'], [lancamento('Cliente', 'Cadastro', ' JEFF BORGES DA COSTA ')], ocorrencias);
  assert.deepEqual(nomes, ['Jeff Costa']);
  const eventos = construir([{ nomeEmpresa: 'Cliente', responsavel: 'Jeff Borges da Costa', isSuspended: true, dataSuspensao: '2026-10-15' }],
    ocorrencias, [], nomes.map(nome => ({ nome })));
  assert.equal(calcular('treinamentosRealizados', eventos, inicio, fim, 'Jeff Costa'), 3);
  assert.equal(calcular('treinamentosRealizados', eventos, inicio, fim, 'Jeff Borges da Costa'), 3);
  for (const chave of ['contatosSuporte', 'atendimentosWhatsApp', 'clientesSuspensos']) {
    assert.equal(calcular(chave, eventos, inicio, fim, 'Jeff Costa'), 1, chave);
  }
  assert.equal(calcular('treinamentosRealizados', eventos, inicio, fim, null), 3);
});

test('preserva pessoas com o mesmo primeiro nome e sobrenomes diferentes', () => {
  const ocorrencias = [ocorrencia('A', [], { responsavel: 'Jeff Costa' }), ocorrencia('B', [], { responsavel: 'Jeff Silva' })];
  const nomes = listar(['Jeff Costa', 'Jeff Silva'], [], ocorrencias);
  assert.deepEqual(nomes, ['Jeff Costa', 'Jeff Silva']);
  const eventos = construir([], ocorrencias, [], nomes.map(nome => ({ nome })));
  assert.equal(calcular('treinamentosRealizados', eventos, inicio, fim, 'Jeff Costa'), 1);
  assert.equal(calcular('treinamentosRealizados', eventos, inicio, fim, 'Jeff Silva'), 1);
});

test('mantém todos os motivos na média e detalha esperas longas respeitando período e treinador', () => {
  const eventos = construir([{ nomeEmpresa: 'Cliente' }], [
    ocorrencia('Cliente', ['Cadastro'], { id: 'cliente', treinamentoDataSolicitacao: '2026-10-08', treinamentoMotivoEspera: 'cliente' }),
    ocorrencia('Cliente', ['Cadastro'], { id: 'agenda', treinamentoDataSolicitacao: '2026-10-12', treinamentoMotivoEspera: 'agenda_treinador' }),
    ocorrencia('Cliente', ['Cadastro'], { id: 'legado', treinamentoDataSolicitacao: '2026-10-11' }),
    ocorrencia('Cliente', ['Cadastro'], { id: 'outro', treinamentoDataSolicitacao: '2026-10-08', responsavel: 'Outro treinador', treinamentoMotivoEspera: 'cliente' }),
  ], [], []);
  assert.equal(calcular('tempoMedioEspera', eventos, inicio, fim, 'Natália Teixeira'), 4);
  const esperas = listarEsperas(eventos, inicio, fim, 'Natália Teixeira');
  assert.deepEqual(esperas.map(e => e.motivo), ['cliente', 'agenda_treinador', null]);
  assert.deepEqual(esperas.map(e => e.ocorrenciaId), ['cliente', 'agenda', 'legado']);
  assert.equal(listarEsperas(eventos, new Date(2026, 10, 1), new Date(2026, 10, 30), null).length, 0);
});
