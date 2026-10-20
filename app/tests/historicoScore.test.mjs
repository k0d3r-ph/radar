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
const module = await carregar('historicoScore');
await module.evaluate();
const { construirLinhaTempoScore: construir, tipoNoInstante, fatiarIntervaloPorTipo } = module.namespace;

const DIA = 24 * 60 * 60 * 1000;
const t0 = new Date(2026, 8, 1, 9).getTime();
const dia = n => t0 + n * DIA;
const respostasBoas = {
  entraComputador: 'Sim', compartilhaTela: 'Sim', fazPerguntas: 'Sim', recordaTemas: 'Sim',
  faltouDoisDias: 'Não', estruturaNecessaria: 'Sim', clienteReclamante: 'Não', clienteSumido: 'Não',
};
const empresa = { nomeEmpresa: 'Cliente', tipo: 'Fast', score: 6.5 };
const calculo = (n, score, respostas = respostasBoas, extras = {}) => ({
  id: `calc-${n}`, empresa: 'Cliente', tipo: 'Treinamento', departamento: 'Treinamento', descricao: '',
  responsavel: 'X', createdAt: dia(n), dataOcorrencia: 0, scoreCalculado: score, scoreAnswers: respostas, ...extras,
});
const duvida = (n, departamento = 'Suporte', id = `duv-${n}`) => ({
  id, empresa: ' cliente ', tipo: 'Dúvida', departamento, descricao: 'Dúvida', responsavel: 'X',
  createdAt: dia(n), dataOcorrencia: dia(n),
});

test('duas dúvidas no Suporte derrubam para Safety e o vencimento devolve para Fast', () => {
  const linha = construir(empresa, [calculo(0, 6.5), duvida(5), duvida(8)], dia(0), dia(30));
  assert.deepEqual(linha.trechos.map(t => t.tipo), ['Fast', 'Safety', 'Fast']);
  const [queda, volta] = linha.mudancas;
  assert.equal(queda.data, dia(5));
  assert.equal(queda.scoreAntes, 6.5);
  assert.equal(queda.scoreDepois, 5.5);
  assert.equal(queda.causas[0].natureza, 'reducao');
  assert.match(queda.causas[0].texto, /Dúvida registrada com o Suporte/);
  assert.equal(queda.causas[0].ocorrencia.id, 'duv-5');
  assert.equal(queda.estimado, true);
  // A primeira redução vence no dia 20; com uma só ativa, o score volta a 5,5 (ainda Safety).
  // A segunda vence no dia 23 e o cliente volta a Fast.
  assert.equal(volta.data, dia(23));
  assert.equal(volta.para, 'Fast');
  assert.equal(volta.causas[0].natureza, 'expiracao');
  assert.equal(tipoNoInstante(linha, dia(10)), 'Safety');
  assert.equal(tipoNoInstante(linha, dia(40)), 'Fast');
});

test('novo cálculo explica as respostas que mudaram', () => {
  const ruins = { ...respostasBoas, recordaTemas: 'Não', clienteSumido: 'Sim' };
  const linha = construir(empresa, [calculo(0, 7), calculo(10, 2, ruins)], dia(0), dia(20));
  assert.equal(linha.mudancas.length, 1);
  const [mudanca] = linha.mudancas;
  assert.equal(mudanca.de, 'Fast');
  assert.equal(mudanca.para, 'Safety');
  assert.equal(mudanca.causas[0].texto, 'Novo cálculo de score: 7 → 2');
  assert.deepEqual(mudanca.causas[0].detalhes, ['Recorda temas anteriores: Sim → Não', 'Cliente sumiu: Não → Sim']);
  assert.equal(mudanca.estimado, false);
});

test('redução gravada no cadastro é exata e não é contada de novo pela ocorrência', () => {
  const comAjuste = {
    ...empresa,
    scoreAjustesTemporarios: [{ motivo: 'Contato com o Suporte (dúvida)', valor: 1, criadoEm: dia(5), expiraEm: dia(20), ocorrenciaId: 'duv-5' }],
  };
  const linha = construir(comAjuste, [calculo(0, 6.5), duvida(5)], dia(0), dia(10));
  assert.equal(linha.mudancas.length, 1);
  assert.equal(linha.mudancas[0].scoreDepois, 5.5);
  assert.equal(linha.mudancas[0].estimado, false);
});

test('sem cálculo fica sem classificação até o primeiro score', () => {
  const semScore = { nomeEmpresa: 'Cliente', tipo: '' };
  const linha = construir(semScore, [calculo(4, 3, { ...respostasBoas, fazPerguntas: 'Não' })], dia(0), dia(10));
  assert.deepEqual(linha.trechos.map(t => t.tipo), [null, 'Safety']);
  assert.equal(linha.mudancas[0].de, null);
  assert.match(linha.mudancas[0].causas[0].texto, /Primeiro cálculo de score: 3/);
  assert.deepEqual(linha.mudancas[0].causas[0].detalhes, ['Faz perguntas: Não']);
});

test('score apenas no cadastro vale para a jornada inteira como estimado', () => {
  const linha = construir({ nomeEmpresa: 'Cliente', tipo: 'Safety', score: 4 }, [], dia(0), dia(10));
  assert.deepEqual(linha.trechos.map(t => [t.tipo, t.estimado]), [['Safety', true]]);
  assert.equal(linha.temEstimativa, true);
});

test('lê o score das ocorrências de mudança, mas ignora as mudanças automáticas por redução', () => {
  const ocorrencias = [
    { empresa: 'Cliente', tipo: 'Mudança de score', descricao: 'Cálculo inicial de score: Fast\n\nScore atual: 8', departamento: 'CS', responsavel: 'X', createdAt: dia(0), dataOcorrencia: 0 },
    { empresa: 'Cliente', tipo: 'Mudança de score', descricao: 'Mudança automática de Fast para Safety\n\nScore efetivo: 1', departamento: 'CS', responsavel: 'X', createdAt: dia(3), dataOcorrencia: 0 },
  ];
  const linha = construir({ nomeEmpresa: 'Cliente', tipo: 'Fast' }, ocorrencias, dia(0), dia(10));
  assert.deepEqual(linha.trechos.map(t => t.tipo), ['Fast']);
});

test('intervalo maior que 5 dias entre agendas também reduz o score', () => {
  const agenda = (n, agendadoPara) => ({
    id: `ag-${n}`, empresa: 'Cliente', tipo: 'Informativa', departamento: 'CS', descricao: '', responsavel: 'X',
    createdAt: dia(n), dataOcorrencia: dia(agendadoPara),
  });
  const linha = construir({ ...empresa, score: 6 }, [calculo(0, 6), agenda(1, 2), agenda(3, 12)], dia(0), dia(10));
  assert.equal(linha.mudancas[0].data, dia(3));
  assert.match(linha.mudancas[0].causas[0].texto, /Intervalo maior que 5 dias entre agendas/);
});

test('redução que derruba Fast para Safety gera a descrição da mudança automática', () => {
  const { descreverQuedaParaSafetyPorReducao: descrever } = modulos.get('score').namespace;
  const agora = Date.now();
  const ajuste = { motivo: 'Contato com o Suporte (dúvida)', valor: 1, criadoEm: agora, expiraEm: agora + 15 * DIA };
  const texto = descrever({ score: 6.5, tipo: 'Fast' }, [ajuste], 'dúvida registrada com o Suporte.');
  assert.match(texto, /^Mudança automática de Fast para Safety/);
  assert.match(texto, /Score efetivo: 5,5/);
  assert.doesNotMatch(texto, /Score atual:/);
  assert.equal(descrever({ score: 8, tipo: 'Fast' }, [ajuste], 'x'), null);
  assert.equal(descrever({ score: 5, tipo: 'Safety' }, [ajuste], 'x'), null);
});

test('redução recente fora do cadastro (removida à mão) não volta pela reconstrução', () => {
  const linha = construir(empresa, [calculo(0, 6.5), duvida(5)], dia(0), dia(10), dia(10));
  assert.deepEqual(linha.trechos.map(t => t.tipo), ['Fast']);
});

test('fatia o intervalo de uma etapa pelas mudanças de tipo', () => {
  const linha = construir(empresa, [calculo(0, 6.5), duvida(5), duvida(8)], dia(0), dia(30));
  const fatias = fatiarIntervaloPorTipo(linha, dia(0), dia(10));
  assert.deepEqual(fatias.map(f => [f.tipo, Number(f.inicio.toFixed(2)), Number(f.fim.toFixed(2))]), [['Fast', 0, 0.5], ['Safety', 0.5, 1]]);
  assert.deepEqual(fatiarIntervaloPorTipo(linha, dia(12), dia(12)), [{ inicio: 0, fim: 1, tipo: 'Safety' }]);
});

test('mudança exatamente no fim do intervalo aparece no marcador final', () => {
  const linha = construir(empresa, [calculo(0, 7), calculo(10, 4)], dia(0), dia(10));
  assert.equal(linha.mudancas.at(-1).data, dia(10));
  assert.equal(tipoNoInstante(linha, dia(10)), 'Safety');
});

test('cálculos distintos em menos de dez minutos não são descartados como duplicados', () => {
  const linha = construir(empresa, [calculo(0, 7), {
    empresa: 'Cliente', tipo: 'Mudança de score', createdAt: dia(0) + 60_000,
    descricao: 'Mudança de score de Fast para Safety\nScore atual: 4',
  }], dia(0), dia(1));
  assert.equal(linha.mudancas[0].scoreDepois, 4);
});

test('contato importado antigo considera quando ocorreu, não quando foi sincronizado', () => {
  const linha = construir(empresa, [calculo(0, 6.5), {
    ...duvida(25), dataOcorrencia: dia(5), ssxDesk: { conversationId: 'fixture' },
  }], dia(0), dia(30), dia(30));
  assert.deepEqual(linha.mudancas.map(m => [m.data, m.para]), [[dia(5), 'Safety'], [dia(20), 'Fast']]);
});

test('score efetivo muda automaticamente no contato e no vencimento, sem novo questionário', () => {
  const { obterTipoEfetivo, calcularScoreEfetivo } = modulos.get('score').namespace;
  const e = { ...empresa, score: 6, scoreAjustesTemporarios: [{ motivo: 'Contato com o Suporte (dúvida)', valor: 1, criadoEm: dia(5), expiraEm: dia(20) }] };
  assert.equal(obterTipoEfetivo(e, dia(4)), 'Fast');
  assert.equal(obterTipoEfetivo(e, dia(5)), 'Safety');
  assert.equal(calcularScoreEfetivo(e, dia(5)), 5);
  assert.equal(obterTipoEfetivo(e, dia(20)), 'Fast');
});

test('exemplos do emulador cobrem queda por suporte, recuperação e respostas do questionário', async () => {
  const codigo = ts.transpileModule(readFileSync(new URL('../../server/scripts/fixturesJornada.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const fixture = new SourceTextModule(codigo);
  await fixture.link(() => modulos.get('score'));
  await fixture.evaluate();
  const agora = dia(50);
  const { empresas, ocorrencias } = fixture.namespace.criarExemplosJornada(agora);
  assert.equal(empresas.length, 8);
  assert.ok(ocorrencias.length > 70);
  for (const registro of [...empresas, ...ocorrencias]) assert.ok(registro.id.startsWith('demo-jornada-'));
  for (const [chave, esperado] of [['suporte', ['Fast', 'Safety']], ['recuperacao', ['Fast', 'Safety', 'Fast']], ['respostas', ['Fast', 'Safety']], ['sem-score', [null]]]) {
    const e = empresas.find(e => e.id === `demo-jornada-${chave}`);
    const linha = construir(e, ocorrencias, Date.parse(`${e.dataEntrada}T00:00:00-03:00`), agora, agora);
    const tipos = linha.trechos.map(t => t.tipo).filter(t => t !== null || chave === 'sem-score');
    assert.deepEqual(tipos, esperado, chave);
  }
});
