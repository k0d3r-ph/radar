import type { Empresa } from "../types";
import base from "../assets/base.png";

function quebrarTexto(texto: string, maxChars = 15): string[] {
  const palavras = texto.split(" ");
  const linhas: string[] = [];
  let linhaAtual = "";

  for (const palavra of palavras) {
    const teste = linhaAtual ? `${linhaAtual} ${palavra}` : palavra;
    if (teste.length > maxChars) {
      linhas.push(linhaAtual);
      linhaAtual = palavra;
    } else {
      linhaAtual = teste;
    }
  }

  if (linhaAtual) {
    linhas.push(linhaAtual);
  }

  return linhas;
}

export async function generateEsteiraImage(empresa: Empresa): Promise<string> {
  const temasArray = (empresa.temaText || "").split("\n").map((linha) => linha.trim());
  const datasArray = (empresa.dataText || "").split("\n").map((linha) => linha.trim());

  const temas = temasArray
    .map((tema, index) => {
      if (!tema) return null;
      const item: { tema: string; data?: string } = { tema };
      if (datasArray[index]) {
        item.data = datasArray[index];
      }
      return item;
    })
    .filter((x): x is { tema: string; data?: string } => x !== null);

  const maxPorLinha = 5;
  const espacamentoX = 200;
  const yTopo = 240;
  const gapY = 240;

  const totalLinhas = Math.ceil(temas.length / maxPorLinha);
  const linhasExtras = Math.max(0, totalLinhas - 3);
  const compressao = linhasExtras * 100;
  const gapDinamico = Math.max(150, gapY - compressao);

  const pontos = temas.map((_, index) => {
    const linha = Math.floor(index / maxPorLinha);
    const coluna = index % maxPorLinha;

    const xBase =
      linha % 2 === 0
        ? 200 + coluna * espacamentoX
        : 200 + (maxPorLinha - 1 - coluna) * espacamentoX;

    const y = linha === 0 ? yTopo : yTopo + linha * gapDinamico;

    return { x: xBase, y };
  });

  const pathD = pontos.reduce((acc, ponto, index, arr) => {
    if (index === 0) {
      return `M ${ponto.x} ${ponto.y}`;
    }

    const anterior = arr[index - 1];
    const linhaAnterior = Math.floor((index - 1) / maxPorLinha);
    const linhaAtual = Math.floor(index / maxPorLinha);

    if (linhaAtual === linhaAnterior) {
      return `${acc} L ${ponto.x} ${ponto.y}`;
    }

    const direcao = linhaAtual % 2 === 1 ? 1 : -1;
    const curvaOffset = 180;

    const c1x = anterior.x + direcao * curvaOffset;
    const c1y = anterior.y;

    const c2x = ponto.x + direcao * curvaOffset;
    const c2y = ponto.y;

    return `${acc} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ponto.x} ${ponto.y}`;
  }, "");

  // Tenta carregar e registrar as fontes do Google Fonts no browser para o canvas
  try {
    const css = await fetch(
      "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;800&display=swap",
    ).then((r) => r.text());
    const blocks = css.match(/@font-face\s*\{[^}]*\}/g) || [];
    for (const block of blocks) {
      const weightMatch = block.match(/font-weight:\s*(\d+)/);
      const urlMatch = block.match(/url\((https:[^)]*)\)/);
      if (urlMatch) {
        const url = urlMatch[1];
        const weight = weightMatch ? weightMatch[1] : "400";
        try {
          const ff = new FontFace("Roboto", `url(${url})`, {
            weight: String(weight),
          });
          await ff.load();
          document.fonts.add(ff);
        } catch {
          // ignore font load error
        }
      }
    }
  } catch {
    // ignore fetch error
  }

  // Gera o HTML do SVG em string
  const circlesHtml = pontos.map((ponto, i) => {
    const isActive = i === empresa.currentPhase;
    const item = temas[i];

    let activeMarkerHtml = "";
    if (isActive) {
      activeMarkerHtml = `
        <g>
          <text
            x="${ponto.x}"
            y="${item.data ? ponto.y - 80 : ponto.y - 40}"
            text-anchor="middle"
            fill="#ffcc00"
            font-size="14px"
            font-weight="bold"
            font-family="Roboto, sans-serif"
          >
            Você está aqui
          </text>
          <circle
            cx="${ponto.x}"
            cy="${ponto.y}"
            r="22"
            fill="none"
            stroke="#ffcc00"
            stroke-width="2"
            stroke-dasharray="4,4"
          />
        </g>
      `;
    }

    let dateHtml = "";
    if (item.data) {
      dateHtml = `
        <text
          x="${ponto.x}"
          y="${ponto.y - 34}"
          text-anchor="middle"
          fill="#ffcc00"
          font-size="14px"
          font-weight="bold"
          font-family="Roboto, sans-serif"
        >
          ${item.data}
        </text>
      `;
    }

    const textLines = quebrarTexto(item.tema || "");
    const tspans = textLines.map((linha, idx) => `
      <tspan x="${ponto.x}" dy="${idx === 0 ? 0 : 24}">${linha}</tspan>
    `).join("");

    return `
      <g>
        ${activeMarkerHtml}
        <circle
          cx="${ponto.x}"
          cy="${ponto.y}"
          r="${isActive ? 16 : 12}"
          fill="${isActive ? '#ffcc00' : 'none'}"
          stroke="${isActive ? '#ffcc00' : '#ffffff'}"
          stroke-width="4"
        />
        ${dateHtml}
        <text
          x="${ponto.x}"
          y="${ponto.y + 50}"
          text-anchor="middle"
          fill="#ffffff"
          font-size="16px"
          font-weight="500"
          font-family="Roboto, sans-serif"
        >
          ${tspans}
        </text>
      </g>
    `;
  }).join("\n");

  const svgString = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
      <text
        x="750"
        y="70"
        text-anchor="middle"
        dominant-baseline="hanging"
        fill="#ffffff"
        font-family="Roboto, sans-serif"
        font-size="40px"
        font-weight="800"
        letter-spacing="2px"
      >
        ${empresa.nomeEmpresa || "Nome da Empresa"}
      </text>
      <path d="${pathD}" fill="none" stroke="white" stroke-width="4" />
      ${circlesHtml}
    </svg>
  `;

  // Desenha no Canvas
  const dpr = 1; // Para envio de whatsapp, tamanho padrão 1600x900
  const canvas = document.createElement("canvas");
  canvas.width = 1600 * dpr;
  canvas.height = 900 * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível criar contexto do canvas.");

  // Desenha o background base
  const bg = new Image();
  bg.crossOrigin = "anonymous";
  bg.src = base;
  await new Promise((res, rej) => {
    bg.onload = res;
    bg.onerror = rej;
  });
  ctx.drawImage(bg, 0, 0, 1600, 900);

  // Desenha o SVG por cima
  const svgUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = svgUrl;
  });
  ctx.drawImage(img, 0, 0, 1600, 900);

  // Exporta em base64 PNG
  return canvas.toDataURL("image/png");
}
