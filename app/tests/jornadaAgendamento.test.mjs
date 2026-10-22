import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Exercita o cálculo real da página sem montar a interface ou acessar serviços.
const fonte = ts.createSourceFile('RelatorioJornadaCliente.tsx', readFileSync(new URL('../src/pages/RelatorioJornadaCliente/RelatorioJornadaCliente.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nomes = ['parseDataLocal', 'calcularDiasUteis', 'obterStatusTreinamento', 'calcularJornada'];
const declaracoes = new Map();
function visitar(no) {
  if (ts.isVariableDeclaration(no) && nomes.includes(no.name.getText(fonte))) declaracoes.set(no.name.getText(fonte), no.getText(fonte));
  ts.forEachChild(no, visitar);
}
visitar(fonte);
for (const nome of nomes) assert.ok(declaracoes.has(nome), `${nome} encontrado na página`);
const codigo = ts.transpileModule(nomes.map(nome => `const ${declaracoes.get(nome)};`).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const instante = valor => Date.parse(`2026-10-${valor}:00-03:00`);
const agora = instante('22T12:00');
class DataFixa extends Date {
  constructor(...args) { super(...(args.length ? args : [agora])); }
  static now() { return agora; }
}
const empresa = { nomeEmpresa: 'Cliente', dataEntrada: '2026-10-19' };
const ocorrencia = (id, tipo, criada, agendada = 0, extras = {}) => ({
  id, empresa: 'Cliente', tipo, createdAt: instante(criada), dataOcorrencia: agendada ? instante(agendada) : 0,
  temaOcorrencia: ['Cadastro'], ...extras,
});
function calcular(ocorrencias, cadastro = empresa) {
  const api = runInNewContext(`${codigo}\n({ calcularJornada, obterStatusTreinamento });`, { ocorrencias, Date: DataFixa });
  return { jornada: api.calcularJornada(cadastro), status: api.obterStatusTreinamento };
}

test('informativa com data futura gera Agendamento realizado como etapa atual, sem comprovar treinamento', () => {
  const agenda = ocorrencia('agenda', 'Informativa', '22T09:00', '23T10:00');
  const { jornada, status } = calcular([agenda]);
  const atual = jornada.find(s => s.active);
  assert.equal(atual.stage, 'Agendamento realizado');
  assert.equal(atual.ocorrencia.id, 'agenda');
  assert.equal(atual.startDate.getTime(), agenda.createdAt);
  assert.equal(atual.endDate.getTime(), agenda.dataOcorrencia);
  assert.equal(status(atual), 'agendado');
  assert.equal(jornada.some(s => s.stage === 'Em treinamento'), false);
});

test('informativa sem data não cria etapa nem tira cliente de Sem próximo passo definido', () => {
  const { jornada } = calcular([ocorrencia('info', 'Informativa', '22T09:00')]);
  assert.equal(jornada.at(-1).stage, 'Sem próximo passo definido');
  assert.equal(jornada.some(s => s.ocorrencia?.id === 'info'), false);
});

test('treinamento e checkpoint com data preservam suas etapas', () => {
  for (const tipo of ['Treinamento', 'Checkpoint']) {
    const { jornada } = calcular([ocorrencia('registro', tipo, '22T09:00', '23T10:00')]);
    assert.equal(jornada.find(s => s.active).stage, tipo === 'Treinamento' ? 'Em treinamento' : 'Checkpoint');
  }
});

test('agendamento e treinamento no mesmo dia permanecem etapas distintas', () => {
  const { jornada } = calcular([
    ocorrencia('agenda', 'Informativa', '22T08:00', '22T16:00'),
    ocorrencia('treino', 'Treinamento', '22T10:00', '22T16:00'),
  ]);
  const agenda = jornada.find(s => s.stage === 'Agendamento realizado');
  const treino = jornada.find(s => s.stage === 'Em treinamento');
  assert.ok(agenda);
  assert.ok(treino);
  assert.equal(agenda.ocorrencia.id, 'agenda');
  assert.equal(treino.ocorrencia.id, 'treino');
  assert.equal(agenda.endDate.getTime(), treino.startDate.getTime());
});

test('conclusão por treinamento preserva o vínculo e o reconhecimento da sessão realizada', () => {
  const { jornada, status } = calcular([
    ocorrencia('agenda', 'Informativa', '21T09:00', '22T10:00'),
    ocorrencia('conclusao', 'Treinamento', '22T11:00'),
  ]);
  const agenda = jornada.find(s => s.stage === 'Agendamento realizado');
  assert.equal(agenda.ocorrenciaFinalizadora.id, 'conclusao');
  assert.equal(status(agenda), 'realizado');
});

test('cancelamento e ausência sem reagendamento continuam sendo eventos de treinamento separados', () => {
  for (const tema of ['Cancelado', 'Ausente']) {
    const { jornada, status } = calcular([
      ocorrencia('agenda', 'Informativa', '21T09:00', '22T10:00'),
      ocorrencia('falha', 'Treinamento', '22T11:00', 0, { temaOcorrencia: [tema] }),
    ]);
    const evento = jornada.find(s => s.ocorrencia?.id === 'falha');
    assert.equal(evento.stage, 'Em treinamento');
    assert.equal(status(evento), tema.toLowerCase());
    assert.equal(jornada.find(s => s.ocorrencia?.id === 'agenda').stage, 'Agendamento realizado');
  }
});

test('encerramento e suspensão continuam prevalecendo sobre o agendamento', () => {
  const agenda = ocorrencia('agenda', 'Informativa', '20T09:00', '21T10:00');
  for (const extras of [{ isSuspended: true }, { dataFinalizacao: '2026-10-22' }, { isCancelled: true }]) {
    const { jornada } = calcular([agenda], { ...empresa, ...extras });
    const esperado = extras.isSuspended ? 'Suspenso' : extras.isCancelled ? 'Cliente Cancelado' : 'Finalizado';
    assert.equal(jornada.at(-1).stage, esperado);
  }
});
