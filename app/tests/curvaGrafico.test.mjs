import assert from 'node:assert/strict';
import test from 'node:test';
import { construirCurvaGrafico, construirCurvaComLacunas } from '../src/utils/curvaGrafico.ts';

test('trata série vazia, ponto único e dois pontos sem coordenadas inválidas', () => {
  assert.equal(construirCurvaGrafico([]), '');
  assert.equal(construirCurvaGrafico([{ x: 10, y: 20 }]), 'M 10,20');
  assert.equal(construirCurvaGrafico([{ x: 10, y: 20 }, { x: 30, y: 40 }]), 'M 10,20 L 30,40');
});

test('curvas continuam passando exatamente pelos pontos registrados', () => {
  for (const valores of [[0, 10, 0, 20, 0], [1, 2, 100, 101], [5, 5, 0, 0, 8], [100, 5, 4, 0]]) {
    const pontos = valores.map((y, i) => ({ x: i * 10, y }));
    const caminho = construirCurvaGrafico(pontos);
    const segmentos = caminho.split(' C ').slice(1);
    assert.equal(segmentos.length, pontos.length - 1);
    segmentos.forEach((segmento, i) => {
      const controles = segmento.split(' ').map(par => par.split(',').map(Number));
      const fim = controles[2];
      assert.deepEqual(fim, [pontos[i + 1].x, pontos[i + 1].y]);
      assert.ok(controles.flat().every(Number.isFinite));
    });
  }
});

test('valores consecutivos iguais formam arco quando os vizinhos sobem e descem', () => {
  const pontos = [0, 10, 10, 0].map((y, i) => ({ x: i * 10, y }));
  const segmento = construirCurvaGrafico(pontos).split(' C ')[2];
  const [c1, c2] = segmento.split(' ').map(par => par.split(',').map(Number));
  const meio = 0.125 * 10 + 0.375 * c1[1] + 0.375 * c2[1] + 0.125 * 10;
  assert.ok(meio > 10);
});

test('uma série constante permanece reta e o limite de zero evita valores negativos no gráfico', () => {
  const constante = construirCurvaGrafico([5, 5, 5].map((y, i) => ({ x: i * 10, y })));
  for (const segmento of constante.split(' C ').slice(1)) {
    assert.ok(segmento.split(' ').every(par => Number(par.split(',')[1]) === 5));
  }
  const pontos = [0, 10, 10, 0].map((y, i) => ({ x: i * 10, y }));
  const limitado = construirCurvaGrafico(pontos, 10);
  for (const segmento of limitado.split(' C ').slice(1)) {
    assert.ok(segmento.split(' ').every(par => Number(par.split(',')[1]) <= 10));
  }
});

test('dias ausentes interrompem o traçado em vez de conectar ou inventar valor zero', () => {
  assert.equal(construirCurvaComLacunas([{ x: 0, y: 10 }, { x: 1, y: 20 }, null, { x: 3, y: 30 }]),
    'M 0,10 L 1,20 M 3,30');
  assert.equal(construirCurvaComLacunas([null, null]), '');
});
