import assert from 'node:assert/strict';
import test from 'node:test';
import {
  criarIntervaloComparacao,
  intervaloAnteriorTreinamento,
  lerDataComparacao,
  formatarVariacaoTreinamento,
} from '../src/utils/comparativoTreinamento.ts';

const data = (valor) => lerDataComparacao(valor);
const intervalo = (inicio, fim) => ({ inicio: data(inicio), fim: data(fim) });
const partes = (valor) => [valor.getFullYear(), valor.getMonth() + 1, valor.getDate()];

test('mês anterior cruza o ano e inclui o último dia inteiro', () => {
  const anterior = intervaloAnteriorTreinamento('mes', intervalo('2026-01-01', '2026-01-19'));
  assert.deepEqual(partes(anterior.inicio), [2025, 12, 1]);
  assert.deepEqual(partes(anterior.fim), [2025, 12, 31]);
  assert.equal(anterior.fim.getHours(), 23);
  assert.equal(anterior.fim.getMilliseconds(), 999);
});

test('meses escolhidos respeitam fevereiro bissexto e o fim de mês', () => {
  const atual = intervalo('2026-10-01', '2026-10-19');
  const fevereiro = criarIntervaloComparacao('mes', data('2024-02-29'), atual);
  assert.deepEqual(partes(fevereiro.inicio), [2024, 2, 1]);
  assert.deepEqual(partes(fevereiro.fim), [2024, 2, 29]);
  const setembro = criarIntervaloComparacao('mes', data('2026-09-30'), atual);
  assert.deepEqual(partes(setembro.fim), [2026, 9, 30]);
});

test('semana anterior é completa mesmo quando a atual só tem segunda-feira', () => {
  const anterior = intervaloAnteriorTreinamento('semana', intervalo('2026-10-19', '2026-10-19'));
  assert.deepEqual(partes(anterior.inicio), [2026, 10, 12]);
  assert.deepEqual(partes(anterior.fim), [2026, 10, 18]);
});

test('domingo escolhido pertence à semana que começou na segunda anterior', () => {
  const anterior = criarIntervaloComparacao('semana', data('2026-10-11'), intervalo('2026-10-19', '2026-10-22'));
  assert.deepEqual(partes(anterior.inicio), [2026, 10, 5]);
  assert.deepEqual(partes(anterior.fim), [2026, 10, 11]);
});

test('personalizado anterior mantém duração inclusiva ao cruzar meses', () => {
  const anterior = intervaloAnteriorTreinamento('personalizado', intervalo('2026-03-01', '2026-03-10'));
  assert.deepEqual(partes(anterior.inicio), [2026, 2, 19]);
  assert.deepEqual(partes(anterior.fim), [2026, 2, 28]);
  const escolhido = criarIntervaloComparacao('personalizado', data('2026-01-28'), intervalo('2026-03-01', '2026-03-10'));
  assert.deepEqual(partes(escolhido.fim), [2026, 2, 6]);
});

test('intervalo de um dia compara com exatamente o dia anterior', () => {
  const anterior = intervaloAnteriorTreinamento('personalizado', intervalo('2026-03-01', '2026-03-01'));
  assert.deepEqual(partes(anterior.inicio), [2026, 2, 28]);
  assert.deepEqual(partes(anterior.fim), [2026, 2, 28]);
});

test('rejeita datas vazias, incompletas e inexistentes', () => {
  for (const valor of ['', '2026-10', '2026-02-29', '2026-13-01', '2026-04-31']) {
    assert.equal(lerDataComparacao(valor), null);
  }
});

test('variação usa pontos percentuais para CSAT e não inventa base para zero ou falta de dados', () => {
  assert.equal(formatarVariacaoTreinamento(80, 60, true), '+20,0 p.p.');
  assert.equal(formatarVariacaoTreinamento(15, 10, false), '+50,0%');
  assert.equal(formatarVariacaoTreinamento(0, 10, false), '-100,0%');
  assert.equal(formatarVariacaoTreinamento(0, 0, false), '0,0%');
  assert.equal(formatarVariacaoTreinamento(10, 0, false), 'Sem base percentual (anterior: 0)');
  assert.equal(formatarVariacaoTreinamento(null, 10, false), 'Sem dados para comparar');
});
