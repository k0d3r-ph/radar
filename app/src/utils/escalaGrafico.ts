/** Escala com folga superior e intervalos distintos, sem fracionar contagens inteiras. */
export function calcularEscalaEixoY(valores: number[]): { maximo: number; marcacoes: number[] } {
  const validos = valores.filter(Number.isFinite);
  const maior = Math.max(0, ...validos);
  if (maior === 0) return { maximo: 1, marcacoes: [0, 1] };

  const limite = maior * 1.1;
  const passoIdeal = limite / 5;
  const ordem = 10 ** Math.floor(Math.log10(passoIdeal));
  const multiplicador = [1, 2, 2.5, 5, 10].find((n) => n * ordem >= passoIdeal) ?? 10;
  const passoCalculado = multiplicador * ordem;
  const passo = validos.every(Number.isInteger) ? Math.max(1, Math.ceil(passoCalculado)) : passoCalculado;
  const quantidade = Math.ceil(limite / passo);
  const marcacoes = Array.from({ length: quantidade + 1 }, (_, i) => Number((i * passo).toPrecision(12)));
  return { maximo: marcacoes[marcacoes.length - 1], marcacoes };
}
