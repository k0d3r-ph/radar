import assert from 'node:assert/strict';
import test from 'node:test';
import { avaliarMotivoEsperaTreinamento, calcularDiasEsperaTreinamento, motivoEsperaValido } from '../src/utils/esperaTreinamento.ts';

const dados = { tipo: 'Treinamento', temas: ['Cadastro'], solicitacao: '2026-10-05', realizacao: '2026-10-08' };

test('segunda a quinta são três dias e exigem motivo, dois dias não exigem', () => {
  assert.deepEqual(avaliarMotivoEsperaTreinamento(dados), { dias: 3, motivo: null, precisaConfirmar: true });
  assert.deepEqual(avaliarMotivoEsperaTreinamento({ ...dados, realizacao: '2026-10-07' }), { dias: 2, motivo: null, precisaConfirmar: false });
});

test('edição preserva as duas respostas e espera reduzida remove classificação anterior', () => {
  for (const motivo of ['cliente', 'agenda_treinador']) {
    assert.deepEqual(avaliarMotivoEsperaTreinamento({ ...dados, motivo }), { dias: 3, motivo, precisaConfirmar: false });
    assert.equal(avaliarMotivoEsperaTreinamento({ ...dados, motivo, realizacao: '2026-10-06' }).motivo, null);
  }
});

test('ausência, cancelamento e outros tipos não pedem nem mantêm justificativa de realização', () => {
  for (const extras of [{ temas: ['Ausente'] }, { temas: [' Cancelado '] }, { tipo: 'Dúvida' }]) {
    assert.deepEqual(avaliarMotivoEsperaTreinamento({ ...dados, motivo: 'cliente', ...extras }), { dias: null, motivo: null, precisaConfirmar: false });
  }
});

test('datas de negócio respeitam virada de mês, ano e ano bissexto sem deslocamentos', () => {
  assert.equal(calcularDiasEsperaTreinamento('2026-12-30', '2027-01-02'), 2);
  assert.equal(calcularDiasEsperaTreinamento('2024-02-28', '2024-03-02'), 2);
  assert.equal(calcularDiasEsperaTreinamento('2026-10-01', '2026-10-08'), 5);
  for (const [inicio, fim] of [['2026-02-30', '2026-03-03'], ['', '2026-03-03'], ['2026-03-04', '2026-03-03']]) {
    assert.equal(calcularDiasEsperaTreinamento(inicio, fim), null);
  }
});

test('finais de semana não aumentam a espera nem disparam confirmação antecipada', () => {
  for (const [inicio, fim, esperado] of [
    ['2026-10-09', '2026-10-12', 1],
    ['2026-10-10', '2026-10-12', 1],
    ['2026-10-09', '2026-10-11', 0],
    ['2026-10-10', '2026-10-11', 0],
    ['2026-10-11', '2026-10-11', 0],
    ['2026-10-01', '2026-10-15', 10],
    ['2026-10-01', '2026-10-19', 12],
  ]) assert.equal(calcularDiasEsperaTreinamento(inicio, fim), esperado, `${inicio} a ${fim}`);
  assert.equal(avaliarMotivoEsperaTreinamento({ ...dados, solicitacao: '2026-10-09', realizacao: '2026-10-12' }).precisaConfirmar, false);
  assert.equal(avaliarMotivoEsperaTreinamento({ ...dados, solicitacao: '2026-10-09', realizacao: '2026-10-14' }).precisaConfirmar, true);
});

test('somente respostas previstas são aceitas', () => {
  assert.equal(motivoEsperaValido('cliente'), true);
  assert.equal(motivoEsperaValido('agenda_treinador'), true);
  for (const valor of [true, false, null, '', 'outro']) assert.equal(motivoEsperaValido(valor), false);
});

test('espera longa exige escolha explícita mesmo em registros antigos ou com motivo inválido', () => {
  for (const motivo of [undefined, null, '', 'outro', true, false]) {
    const resultado = avaliarMotivoEsperaTreinamento({ ...dados, motivo });
    assert.equal(resultado.precisaConfirmar, true);
    assert.equal(resultado.motivo, null);
  }
});
