interface PontoGrafico {
  x: number;
  y: number;
}

/** Spline cúbica com tangentes compartilhadas, permitindo arcos entre valores iguais.
 * `yMaximo` limita os controles à linha de zero do SVG, sem desenhar contagens negativas. */
export function construirCurvaGrafico(pontos: PontoGrafico[], yMaximo = Infinity): string {
  if (pontos.length === 0) return "";
  const inicio = `M ${pontos[0].x},${pontos[0].y}`;
  if (pontos.length === 1) return inicio;
  if (pontos.length === 2) return `${inicio} L ${pontos[1].x},${pontos[1].y}`;

  const tangentes = pontos.map((ponto, i) => {
    const anterior = pontos[i - 1] ?? ponto;
    const proximo = pontos[i + 1] ?? ponto;
    return (proximo.y - anterior.y) / (proximo.x - anterior.x);
  });

  return pontos.slice(1).reduce((caminho, ponto, i) => {
    const anterior = pontos[i];
    const distancia = (ponto.x - anterior.x) / 3;
    const controle1Y = Math.min(yMaximo, anterior.y + distancia * tangentes[i]);
    const controle2Y = Math.min(yMaximo, ponto.y - distancia * tangentes[i + 1]);
    return `${caminho} C ${anterior.x + distancia},${controle1Y}`
      + ` ${ponto.x - distancia},${controle2Y} ${ponto.x},${ponto.y}`;
  }, inicio);
}

/** Interrompe a linha em dias sem amostra ou ausentes no período comparado. */
export function construirCurvaComLacunas(pontos: (PontoGrafico | null)[], yMaximo = Infinity): string {
  const segmentos: PontoGrafico[][] = [];
  let segmento: PontoGrafico[] = [];
  pontos.forEach((ponto) => {
    if (ponto === null) {
      segmento = [];
    } else {
      if (segmento.length === 0) segmentos.push(segmento);
      segmento.push(ponto);
    }
  });
  return segmentos.map((pontosSegmento) => construirCurvaGrafico(pontosSegmento, yMaximo)).join(" ");
}
