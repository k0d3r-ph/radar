import assert from 'node:assert/strict';
import test from 'node:test';
import { calcularStatusEsteiraCliente } from '../src/utils/monitoramento/calcularStatusEsteiraCliente.ts';

const DIA = 86400000;
const agora = Date.parse('2026-10-22T12:00:00-03:00');

function empresaConcluida(overrides = {}) {
  return {
    nomeEmpresa: 'Cliente Concluído',
    temaText: 'Fase 1',
    currentPhase: 0,
    dataEntrada: '2026-01-01',
    dataFinalizacao: '2026-09-25',
    ...overrides,
  };
}

function ocorrenciaTreinamentoAvulso(dataOcorrencia) {
  return {
    empresa: 'Cliente Concluído',
    tipo: 'Treinamento',
    descricao: '',
    departamento: 'CS',
    responsavel: '',
    dataOcorrencia,
    createdAt: dataOcorrencia,
  };
}

test('esteira concluída: treinamento avulso posterior não reseta a contagem do follow up final', () => {
  // dataFinalizacao há 25 dias (> 20) — deveria estar vermelho mesmo com um
  // treinamento avulso (ex.: Videotelemetria) registrado há 2 dias.
  const empresa = empresaConcluida();
  const treinamentoRecente = ocorrenciaTreinamentoAvulso(agora - 2 * DIA);
  const status = calcularStatusEsteiraCliente(empresa, [treinamentoRecente], agora);
  assert.equal(status.farol, 'vermelho');
  assert.ok(status.tme > 20, `tme deveria ser > 20, veio ${status.tme}`);
});

test('esteira concluída: informativa com data de agendamento também não reseta a contagem', () => {
  const empresa = empresaConcluida();
  const informativa = { ...ocorrenciaTreinamentoAvulso(agora - 1 * DIA), tipo: 'Informativa' };
  const status = calcularStatusEsteiraCliente(empresa, [informativa], agora);
  assert.equal(status.farol, 'vermelho');
});

test('esteira concluída sem nenhum treinamento posterior: farol ainda ancora em dataFinalizacao', () => {
  const empresa = empresaConcluida();
  const status = calcularStatusEsteiraCliente(empresa, [], agora);
  assert.equal(status.farol, 'vermelho');
});

test('esteira concluída há menos de 20 dias: farol permanece verde', () => {
  const empresa = empresaConcluida({ dataFinalizacao: '2026-10-15' });
  const status = calcularStatusEsteiraCliente(empresa, [], agora);
  assert.equal(status.farol, 'verde');
});

test('dataFollowUpFinal preenchida força farol verde mesmo com mais de 20 dias', () => {
  const empresa = empresaConcluida({ dataFollowUpFinal: '2026-10-20' });
  const status = calcularStatusEsteiraCliente(empresa, [], agora);
  assert.equal(status.farol, 'verde');
});

test('cliente ainda em andamento (não concluído) continua usando o último treinamento como base', () => {
  const empresa = {
    nomeEmpresa: 'Cliente Em Andamento',
    temaText: 'Fase 1\nFase 2',
    currentPhase: 0,
    dataEntrada: '2026-09-01',
  };
  const treinamentoAntigo = { ...ocorrenciaTreinamentoAvulso(agora - 30 * DIA), empresa: 'Cliente Em Andamento' };
  const status = calcularStatusEsteiraCliente(empresa, [treinamentoAntigo], agora);
  assert.equal(status.progresso, 50);
  assert.ok(status.tme >= 29 && status.tme <= 30, `tme deveria ser ~30, veio ${status.tme}`);
  assert.equal(status.farol, 'vermelho');
});
