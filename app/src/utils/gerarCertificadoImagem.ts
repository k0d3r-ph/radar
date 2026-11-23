import modelo from "../assets/certificado/modelo.jpg";
import fonteNome from "../assets/certificado/great-vibes-latin.woff2";
import fonteTexto from "../assets/certificado/open-sans-latin.woff2";
import { montarTextoCertificado } from "./certificadoTreinamento";
import type { ConteudoCertificado } from "./certificadoTreinamento";

/*
 * O modelo é a arte original do certificado com nome, texto e data apagados
 * (logo, selo e assinatura preservados). As medidas abaixo são do modelo,
 * 1280 × 904 px, e reproduzem as posições da arte original.
 */
const LARGURA = 1280;
const ALTURA = 904;
const FAMILIA_NOME = "RadarCertificadoNome";
const FAMILIA_TEXTO = "RadarCertificadoTexto";
const COR_TEXTO = "#0f2c35";

let recursos: Promise<HTMLImageElement> | null = null;

function carregarImagem(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Não foi possível carregar o modelo do certificado."));
    img.src = src;
  });
}

async function carregarRecursos(): Promise<HTMLImageElement> {
  const fontes = [
    new FontFace(FAMILIA_NOME, `url(${fonteNome})`),
    new FontFace(FAMILIA_TEXTO, `url(${fonteTexto})`, { weight: "400" }),
  ];
  const [imagem] = await Promise.all([
    carregarImagem(modelo),
    ...fontes.map(async (fonte) => {
      await fonte.load();
      document.fonts.add(fonte);
    }),
  ]);
  return imagem;
}

/** Carrega modelo e fontes uma única vez por sessão; uma falha permite nova tentativa. */
function obterRecursos(): Promise<HTMLImageElement> {
  if (!recursos) {
    recursos = carregarRecursos().catch((erro) => {
      recursos = null;
      throw erro;
    });
  }
  return recursos;
}

function quebrarLinhas(ctx: CanvasRenderingContext2D, texto: string, larguraMax: number): string[] {
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    const teste = atual ? `${atual} ${palavra}` : palavra;
    if (atual && ctx.measureText(teste).width > larguraMax) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = teste;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

/** Desenha o certificado e devolve o canvas (1280 × 904). */
export async function desenharCertificado(conteudo: ConteudoCertificado): Promise<HTMLCanvasElement> {
  const imagem = await obterRecursos();
  const canvas = document.createElement("canvas");
  canvas.width = LARGURA;
  canvas.height = ALTURA;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("O navegador não permitiu desenhar o certificado.");

  ctx.drawImage(imagem, 0, 0, LARGURA, ALTURA);
  ctx.textBaseline = "alphabetic";

  // Nome do participante, manuscrito; reduz a fonte para nomes longos não
  // invadirem o selo.
  const nome = conteudo.participante.replace(/\s+/g, " ").trim();
  let tamanhoNome = 124;
  ctx.font = `${tamanhoNome}px "${FAMILIA_NOME}", cursive`;
  while (tamanhoNome > 56 && ctx.measureText(nome).width > 800) {
    tamanhoNome -= 4;
    ctx.font = `${tamanhoNome}px "${FAMILIA_NOME}", cursive`;
  }
  ctx.fillStyle = "#272b2c";
  ctx.textAlign = "left";
  ctx.fillText(nome, 74, 400);

  // Texto de conclusão.
  ctx.font = `24px "${FAMILIA_TEXTO}", "Open Sans", sans-serif`;
  ctx.fillStyle = COR_TEXTO;
  const linhas = quebrarLinhas(ctx, montarTextoCertificado(conteudo), 712);
  linhas.forEach((linha, i) => ctx.fillText(linha, 92, 541 + i * 33.5));

  // Data de geração, sobre a linha "Data".
  ctx.font = `28px "${FAMILIA_TEXTO}", "Open Sans", sans-serif`;
  ctx.fillStyle = "#f0fdfe";
  ctx.textAlign = "center";
  ctx.fillText(conteudo.dataGeracao.trim(), 237, 790);

  return canvas;
}

/** Certificado em JPEG (data URL), pronto para pré-visualizar, baixar ou enviar. */
export async function gerarCertificadoImagem(conteudo: ConteudoCertificado): Promise<string> {
  const canvas = await desenharCertificado(conteudo);
  return canvas.toDataURL("image/jpeg", 0.92);
}
