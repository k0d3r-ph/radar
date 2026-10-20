/**
 * Gera `src/themes.light.generated.css`: a versão clara de todas as regras do app que
 * usam cores pensadas para fundo escuro. O modo escuro continua sendo o CSS original
 * (nada aqui o altera); o claro é derivado dele com regras de contraste, para que toda
 * página nova ou alterada ganhe um modo claro coerente só rodando:
 *
 *   npm run tema:claro      (a partir de app/)
 *
 * Princípios do mapeamento:
 * - Só cores "de tema escuro" mudam: superfícies escuras neutras, textos claros, bordas
 *   brancas translúcidas e sombras pretas. Cores já claras (páginas escritas em claro)
 *   e destaques saturados (botões, badges, cards ativos) são mantidos.
 * - Texto colorido é escurecido até atingir contraste AA (4,5:1) sobre o fundo claro.
 * - Quando a mesma regra define fundo e texto, o texto é validado contra o novo fundo.
 *
 * Ajustes finos que o algoritmo não resolve ficam na seção "Modo claro" de themes.css,
 * carregada depois deste arquivo.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const RAIZ = fileURLToPath(new URL('../src/', import.meta.url));
const SAIDA = join(RAIZ, 'themes.light.generated.css');
const PREFIXO = 'body.light-theme';

import {
  REGEX_COR, parseCor, formatar, misturar, luminancia, contraste, neutra, escurecerAteContraste,
  BRANCO, SUPERFICIE_ESCURA, P, mapearFundo, mapearTexto, mapearBorda, mapearSombra,
} from './temaClaroCores.mjs';

// ───────────────────────── declarações ─────────────────────────

function papelDaPropriedade(prop) {
  const p = prop.toLowerCase();
  if (p.startsWith('--')) {
    // Variáveis próprias de um componente: o papel vem do nome (ex.: --gp-text, --gp-border).
    if (p.startsWith('--lt-')) return null;
    if (/border|borda|outline/.test(p)) return 'borda';
    if (/shadow|sombra|glow/.test(p)) return 'sombra';
    if (/text|texto|muted|suave|secundario|accent|acento|destaque|gold|negative|perigo|label|link|fg/.test(p)) return 'texto';
    return 'fundo';
  }
  if (['color', 'fill', 'stroke', 'caret-color', '-webkit-text-fill-color', 'text-decoration-color'].includes(p)) return 'texto';
  if (p === 'background' || p === 'background-color' || p === 'background-image') return 'fundo';
  if (p.startsWith('border') || p.startsWith('outline') || p === 'column-rule' || p === 'column-rule-color') return 'borda';
  if (p === 'box-shadow' || p === 'text-shadow' || p === 'filter') return 'sombra';
  return null;
}

function trocarCores(valor, mapear, seletor = '') {
  // Dentro de gradientes só as cores neutras mudam; destaques coloridos são preservados.
  const gradientes = [];
  let resultado = valor.replace(/(?:repeating-)?(?:linear|radial|conic)-gradient\((?:[^()]|\([^()]*\))*\)/gi, (g) => {
    gradientes.push(g.replace(REGEX_COR, (m) => {
      const cor = parseCor(m);
      return cor ? formatar(mapear(cor, { emGradiente: true, seletor })) : m;
    }));
    return `\u0000${gradientes.length - 1}\u0000`;
  });
  resultado = resultado.replace(REGEX_COR, (m) => {
    const cor = parseCor(m);
    return cor ? formatar(mapear(cor, { seletor })) : m;
  });
  return resultado.replace(/\u0000(\d+)\u0000/g, (_, i) => gradientes[Number(i)]);
}

const MAPEADORES = { texto: mapearTexto, fundo: mapearFundo, borda: mapearBorda, sombra: mapearSombra };

/** Seletores em que texto branco fica sobre um destaque colorido definido em outra regra. */
const SELETOR_SOBRE_DESTAQUE = /(\.active|\.ativo|\.selected|selecionad|primary|\.btn-(salvar|confirmar|criar|enviar|danger|success|exportar)|badge|pill|tag-|toast|-count|\[aria-pressed="true"\]|:checked|avatar|tooltip)/i;

function primeiraCor(valor) {
  const m = valor.match(REGEX_COR);
  return m ? parseCor(m[0]) : null;
}

function converterRegra(rule) {
  const decls = rule.nodes.filter((n) => n.type === 'decl');
  const novas = [];
  const fundoOriginal = decls.find((d) => papelDaPropriedade(d.prop) === 'fundo');
  const corFundoOriginal = fundoOriginal ? primeiraCor(fundoOriginal.value) : null;
  const fundoTemGradiente = fundoOriginal && /gradient\(/i.test(fundoOriginal.value);
  const fundoDestaqueMantido = corFundoOriginal && corFundoOriginal.a >= 0.6 && !neutra(corFundoOriginal) &&
    (fundoTemGradiente || luminancia(corFundoOriginal) >= 0.07);

  // Toda declaração de cor é reemitida (mesmo sem mudança) para que a cascata entre as
  // regras prefixadas repita a original: uma regra base mapeada não pode vencer uma
  // regra mais específica cujo destaque foi mantido.
  const temCor = (d) => { const tem = REGEX_COR.test(d.value); REGEX_COR.lastIndex = 0; return tem; };
  let novoFundo = null;
  for (const d of decls) {
    const papel = papelDaPropriedade(d.prop);
    if (!papel || !temCor(d) || papel === 'texto') continue;
    const valor = trocarCores(d.value, MAPEADORES[papel], rule.selector);
    if (papel === 'fundo') novoFundo = primeiraCor(valor);
    novas.push({ prop: d.prop, value: valor, important: d.important });
  }

  for (const d of decls) {
    if (papelDaPropriedade(d.prop) !== 'texto') continue;
    const original = primeiraCor(d.value);
    if (!original) continue;
    const textoClaro = luminancia(misturar(original, SUPERFICIE_ESCURA)) > 0.45;
    const sobreDestaque = fundoDestaqueMantido || SELETOR_SOBRE_DESTAQUE.test(rule.selector);
    if (textoClaro && sobreDestaque && (neutra(original) || luminancia(original) > 0.45)) {
      novas.push({ prop: d.prop, value: d.value, important: d.important });
      continue;
    }
    let valor = trocarCores(d.value, mapearTexto);
    const fundoFinal = novoFundo && novoFundo.a >= 0.6 ? misturar(novoFundo, BRANCO) : null;
    const corFinal = primeiraCor(valor);
    if (fundoFinal && corFinal && contraste(misturar(corFinal, fundoFinal), fundoFinal) < 4.5) {
      const ajustada = neutra(corFinal) ? P.texto : escurecerAteContraste(corFinal, fundoFinal);
      valor = valor.replace(REGEX_COR, () => formatar(ajustada));
    }
    novas.push({ prop: d.prop, value: valor, important: d.important });
  }
  return novas;
}

/** Elementos que precisam ficar iguais nos dois temas (ex.: prévia exportada como imagem na Esteira). */
const SELETOR_SEM_TEMA = /\.preview(?![\w-])/;

function prefixarSeletor(sel) {
  const s = sel.trim();
  if (/light-theme|dark-theme/.test(s) || SELETOR_SEM_TEMA.test(s)) return null;
  if (/^:root\b|^html\b/.test(s)) return null;
  if (/^body\b/.test(s)) return s.replace(/^body/, PREFIXO);
  return `${PREFIXO} ${s}`;
}

// ───────────────────────── arquivos ─────────────────────────

function listarCss(dir) {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return listarCss(caminho);
    return nome.endsWith('.css') && caminho !== SAIDA ? [caminho] : [];
  });
}

const blocos = [];
let totalRegras = 0;
for (const arquivo of listarCss(RAIZ).sort()) {
  const raiz = postcss.parse(readFileSync(arquivo, 'utf8'), { from: arquivo });
  const saida = postcss.root();
  raiz.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes/i.test(rule.parent.name)) return;
    const seletores = rule.selectors.map(prefixarSeletor);
    if (seletores.some((s) => s === null)) return;
    const novas = converterRegra(rule);
    if (novas.length === 0) return;
    const nova = postcss.rule({ selector: seletores.join(',\n') });
    novas.forEach((d) => nova.append(postcss.decl(d)));
    // Recria as @media/@supports em volta, na mesma ordem.
    let alvo = nova;
    for (let pai = rule.parent; pai && pai.type === 'atrule'; pai = pai.parent) {
      const envoltorio = postcss.atRule({ name: pai.name, params: pai.params });
      envoltorio.append(alvo);
      alvo = envoltorio;
    }
    saida.append(alvo);
    totalRegras++;
  });
  if (saida.nodes.length) {
    blocos.push(`/* ── ${relative(RAIZ, arquivo).split(sep).join('/')} ── */\n${saida.toString()}`);
  }
}

// Variáveis dos estilos inline (criadas por temaClaroInline.mjs nos .tsx).
const listarTsx = (dir) => readdirSync(dir).flatMap((nome) => {
  const caminho = join(dir, nome);
  if (statSync(caminho).isDirectory()) return listarTsx(caminho);
  return nome.endsWith('.tsx') ? [caminho] : [];
});
const variaveisInline = new Map();
const MAPEADOR_INLINE = { texto: mapearTexto, fundo: mapearFundo, borda: mapearBorda, sombra: mapearSombra };
for (const arquivo of listarTsx(RAIZ)) {
  for (const [, nome, papel, hex] of readFileSync(arquivo, 'utf8').matchAll(/(--lt-(texto|fundo|borda|sombra)-([0-9a-f]{6}(?:[0-9a-f]{2})?))\b/g)) {
    const cor = parseCor(`#${hex}`);
    // Em style inline, preto translúcido forte é sempre o fundo escurecido de um modal.
    if (cor && !variaveisInline.has(nome)) variaveisInline.set(nome, formatar(MAPEADOR_INLINE[papel](cor, { seletor: 'overlay' })));
  }
}
if (variaveisInline.size) {
  const linhas = [...variaveisInline].sort().map(([nome, valor]) => `    ${nome}: ${valor};`).join('\n');
  blocos.unshift(`/* ── variáveis dos estilos inline (.tsx) ── */\n${PREFIXO} {\n${linhas}\n}`);
}

writeFileSync(
  SAIDA,
  `/* ARQUIVO GERADO por app/scripts/gerarTemaClaro.mjs — não edite à mão.\n   Rode "npm run tema:claro" depois de alterar cores em qualquer CSS. */\n\n${blocos.join('\n\n')}\n`,
);
console.log(`Tema claro gerado: ${totalRegras} regras em ${relative(process.cwd(), SAIDA)}`);
