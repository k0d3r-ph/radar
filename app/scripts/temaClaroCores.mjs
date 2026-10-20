/**
 * Conversão de cores do tema escuro para o modo claro, compartilhada entre o gerador
 * de CSS (gerarTemaClaro.mjs) e a conversão dos estilos inline (temaClaroInline.mjs).
 */

// ───────────────────────── cores ─────────────────────────

export const NOMEADAS = { white: '#ffffff', black: '#000000' };
export const REGEX_COR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/g;

export function parseCor(texto) {
  const t = texto.trim().toLowerCase();
  const hex = NOMEADAS[t] ?? t;
  if (hex.startsWith('#')) {
    let h = hex.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const m = t.match(/^rgba?\(([^)]*)\)$/);
  if (!m) return null;
  const partes = m[1].split(/[\s,/]+/).filter(Boolean);
  if (partes.length < 3) return null;
  const num = (v) => (v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v));
  const alfa = partes[3] === undefined ? 1 : partes[3].endsWith('%') ? parseFloat(partes[3]) / 100 : parseFloat(partes[3]);
  const cor = { r: num(partes[0]), g: num(partes[1]), b: num(partes[2]), a: alfa };
  return [cor.r, cor.g, cor.b, cor.a].some((v) => Number.isNaN(v)) ? null : cor;
}

export const paraHex = ({ r, g, b }) =>
  '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

export function formatar(cor) {
  if (cor.a >= 0.999) return paraHex(cor);
  return `rgba(${Math.round(cor.r)}, ${Math.round(cor.g)}, ${Math.round(cor.b)}, ${+cor.a.toFixed(3)})`;
}

export function misturar(cor, fundo) {
  return {
    r: cor.r * cor.a + fundo.r * (1 - cor.a),
    g: cor.g * cor.a + fundo.g * (1 - cor.a),
    b: cor.b * cor.a + fundo.b * (1 - cor.a),
    a: 1,
  };
}

export function luminancia({ r, g, b }) {
  const canal = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

export function contraste(a, b) {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

export const croma = ({ r, g, b }) => Math.max(r, g, b) - Math.min(r, g, b);
export const neutra = (cor) => croma(cor) < 42;

export function paraHsl({ r, g, b }) {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
  else if (max === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  return { h: h / 6, s, l };
}

export function deHsl({ h, s, l }, a = 1) {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255, a };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const canal = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: canal(h + 1 / 3) * 255, g: canal(h) * 255, b: canal(h - 1 / 3) * 255, a };
}

export const BRANCO = { r: 255, g: 255, b: 255, a: 1 };
export const SUPERFICIE_ESCURA = { r: 30, g: 41, b: 59, a: 1 };
const c = (hex) => parseCor(hex);

/** Escurece mantendo matiz/saturação até o contraste mínimo sobre `fundo`. */
export function escurecerAteContraste(cor, fundo, minimo = 4.5) {
  const hsl = paraHsl(cor);
  // Amarelos escurecidos ficam oliva; puxa o matiz para âmbar, como na paleta clara usual.
  const matiz = hsl.h > 0.1 && hsl.h < 0.18 ? 0.09 : hsl.h;
  let candidato = { ...cor, a: 1 };
  for (let l = hsl.l; l >= 0.05 && contraste(candidato, fundo) < minimo; l -= 0.02) {
    candidato = deHsl({ h: matiz, s: Math.min(hsl.s, 0.85), l });
  }
  return candidato;
}

// Paleta do modo claro
export const P = {
  pagina: c('#f4f6fa'),
  superficie: c('#ffffff'),
  superficieSutil: c('#f8fafc'),
  superficieHover: c('#f1f5f9'),
  superficieForte: c('#e2e8f0'),
  texto: c('#0f172a'),
  texto2: c('#334155'),
  texto3: c('#475569'),
  textoMudo: c('#64748b'),
  textoApagado: c('#94a3b8'),
  bordaSutil: c('#e8edf3'),
  borda: c('#e2e8f0'),
  bordaForte: c('#cbd5e1'),
};

const FUNDO_NEUTRO_TABELA = {
  '#0b0f19': P.pagina, '#020617': P.pagina, '#030712': P.pagina, '#000000': P.pagina, '#0a0e17': P.pagina,
  '#0f172a': P.superficieSutil, '#111827': P.superficieSutil, '#0d1424': P.superficieSutil,
  '#1e293b': P.superficie, '#1f2937': P.superficie, '#18212f': P.superficie, '#1a2332': P.superficie,
  '#273549': P.superficieHover, '#283548': P.superficieHover, '#2d3a4f': P.superficieHover, '#253246': P.superficieHover,
  '#334155': P.superficieHover, '#374151': P.superficieHover,
  '#475569': P.superficieForte, '#4b5563': P.superficieForte,
  '#64748b': P.bordaForte,
};

/** Fundo preto translúcido só é "escurecimento de modal" nesses seletores; nos demais é painel. */
const SELETOR_OVERLAY = /overlay|backdrop|modal-bg|fundo-modal|modal-filtros-fundo|-mask\b|scrim/i;

export function mapearFundo(cor, { emGradiente = false, seletor = '' } = {}) {
  if (cor.a === 0) return cor;
  if (!neutra(cor)) {
    if (emGradiente) return cor;
    const plana = misturar(cor, SUPERFICIE_ESCURA);
    // Fundos escuros tingidos (ex.: seleção roxa/âmbar) viram tons claros do mesmo matiz.
    if (cor.a >= 0.5 && luminancia(plana) < 0.07) {
      const hsl = paraHsl(cor);
      return deHsl({ h: hsl.h, s: Math.min(Math.max(hsl.s, 0.45), 0.9), l: 0.95 });
    }
    return cor;
  }
  const lum = luminancia(cor);
  if (cor.a < 1) {
    if (lum > 0.6) {
      // Realces brancos translúcidos sobre o escuro (hover, faixas).
      if (cor.a <= 0.035) return P.superficieSutil;
      if (cor.a <= 0.09) return P.superficieHover;
      if (cor.a <= 0.16) return P.superficieForte;
      return P.bordaForte;
    }
    if (lum < 0.05) {
      if (cor.a >= 0.3 && SELETOR_OVERLAY.test(seletor)) return { ...c('#0f172a'), a: 0.4 };
      return cor.a >= 0.35 ? P.superficie : P.superficieSutil;
    }
    // Ardósias médias translúcidas (#334155/#475569 com alfa): hover e superfícies elevadas.
    if (lum < 0.35) return P.superficieHover;
    return cor;
  }
  const hex = paraHex(cor);
  if (FUNDO_NEUTRO_TABELA[hex]) return FUNDO_NEUTRO_TABELA[hex];
  if (lum < 0.006) return P.pagina;
  if (lum < 0.015) return P.superficieSutil;
  if (lum < 0.035) return P.superficie;
  if (lum < 0.08) return P.superficieHover;
  if (lum < 0.45) return P.superficieForte; // cinzas médios (ex.: botões secundários do escuro)
  return cor;
}

export function mapearTexto(cor) {
  if (cor.a === 0) return cor;
  const plana = misturar(cor, SUPERFICIE_ESCURA);
  const lum = luminancia(plana);
  if (neutra(cor)) {
    if (lum < 0.12) return cor; // já pensada para fundo claro (ou neutra média)
    if (lum >= 0.72) return P.texto;
    if (lum >= 0.5) return P.texto2;
    if (lum >= 0.3) return P.texto3;
    return P.textoMudo;
  }
  if (contraste(plana, BRANCO) >= 4.5) return { ...plana, a: 1 };
  return escurecerAteContraste(plana, BRANCO);
}

export function mapearBorda(cor) {
  if (cor.a === 0) return cor;
  const lum = luminancia(cor);
  if (neutra(cor)) {
    if (cor.a < 1 && lum > 0.6) {
      if (cor.a <= 0.06) return P.bordaSutil;
      if (cor.a <= 0.11) return P.borda;
      if (cor.a <= 0.2) return c('#d5dce5');
      return P.bordaForte;
    }
    if (cor.a < 1 && lum < 0.05) return P.borda;
    if (lum < 0.012) return P.superficie; // borda de "recorte" igual ao fundo escuro
    if (lum < 0.06) return P.borda;
    if (lum < 0.2) return P.bordaForte;
    if (lum > 0.6) return cor; // borda já pensada para fundo claro
    return P.bordaForte;
  }
  const plana = misturar(cor, SUPERFICIE_ESCURA);
  if (cor.a >= 0.5 && luminancia(plana) < 0.07) {
    const hsl = paraHsl(cor);
    return deHsl({ h: hsl.h, s: Math.min(Math.max(hsl.s, 0.45), 0.85), l: 0.78 });
  }
  return cor;
}

export function mapearSombra(cor) {
  if (cor.a === 0) return cor;
  if (neutra(cor)) {
    const lum = luminancia(cor);
    if (lum < 0.05) return { ...c('#0f172a'), a: Math.min(0.1, Math.max(0.04, cor.a * 0.22)) };
    return cor; // brilhos brancos internos ficam invisíveis no claro
  }
  return { ...cor, a: +(cor.a * 0.45).toFixed(3) };
}
