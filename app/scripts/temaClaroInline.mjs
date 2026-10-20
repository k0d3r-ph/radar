/**
 * Converte cores de tema escuro escritas em `style={{ ... }}` nos componentes .tsx para
 * `var(--lt-<papel>-<cor>, <cor original>)`. No modo escuro a variável não existe e vale
 * a cor original; no claro, gerarTemaClaro.mjs define cada variável encontrada.
 *
 *   node scripts/temaClaroInline.mjs           (a partir de app/; idempotente)
 *
 * Só mexe dentro de blocos `style={{ }}` e só em cores que mudam no modo claro, para não
 * tocar em cores passadas a SVG/gráficos (atributos SVG não aceitam var()).
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REGEX_COR, parseCor, formatar, luminancia, mapearFundo, mapearTexto, mapearBorda, mapearSombra,
} from './temaClaroCores.mjs';

const RAIZ = fileURLToPath(new URL('../src/', import.meta.url));

const PAPEL_POR_CHAVE = [
  [/^(color|fill|stroke|caretColor)$/, 'texto', mapearTexto],
  [/^(background|backgroundColor|backgroundImage)$/, 'fundo', mapearFundo],
  [/^(border|border(Top|Right|Bottom|Left)|border(Top|Right|Bottom|Left)?Color|outline|outlineColor)$/, 'borda', mapearBorda],
  [/^(boxShadow|textShadow)$/, 'sombra', mapearSombra],
];

/** Nome estável da variável: papel + cor em hex de 6 ou 8 dígitos. */
export function nomeVariavel(papel, cor) {
  const hex = formatar({ ...cor, a: 1 }).slice(1);
  const alfa = cor.a >= 0.999 ? '' : Math.round(cor.a * 255).toString(16).padStart(2, '0');
  return `--lt-${papel}-${hex}${alfa}`;
}

function blocosStyle(codigo) {
  const blocos = [];
  let i = 0;
  while ((i = codigo.indexOf('style={{', i)) !== -1) {
    let profundidade = 0;
    let j = i + 'style={'.length;
    for (; j < codigo.length; j++) {
      if (codigo[j] === '{') profundidade++;
      else if (codigo[j] === '}') {
        profundidade--;
        if (profundidade === 0) break;
      }
    }
    blocos.push([i, j]);
    i = j;
  }
  return blocos;
}

/** Chave do objeto de estilo à qual pertence a string que começa em `posicao`. */
function chaveAnterior(bloco, posicao) {
  const antes = bloco.slice(0, posicao);
  const chaves = [...antes.matchAll(/([a-zA-Z]+)\s*:(?!:)/g)];
  return chaves.length ? chaves[chaves.length - 1][1] : null;
}

/** O próprio style define um fundo colorido que se mantém no claro (ex.: pílula verde com texto branco)? */
function temFundoDestaque(bloco) {
  return [...bloco.matchAll(/background(?:Color)?\s*:[^,}]*/g)].some(([trecho]) =>
    (trecho.match(REGEX_COR) || []).some((m) => {
      const cor = parseCor(m);
      return cor && cor.a >= 0.6 && formatar(mapearFundo(cor, {})) === formatar(cor) && luminancia(cor) < 0.6;
    }));
}

function converterBloco(bloco) {
  const fundoDestaque = temFundoDestaque(bloco);
  return bloco.replace(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g, (literal, aspas, conteudo, posicao) => {
    if (conteudo.includes('var(--lt-') || !REGEX_COR.test(conteudo)) {
      REGEX_COR.lastIndex = 0;
      return literal;
    }
    REGEX_COR.lastIndex = 0;
    const chave = chaveAnterior(bloco, posicao);
    const regra = chave && PAPEL_POR_CHAVE.find(([re]) => re.test(chave));
    if (!regra) return literal;
    const [, papel, mapear] = regra;
    const convertido = conteudo.replace(REGEX_COR, (m) => {
      const cor = parseCor(m);
      if (!cor) return m;
      if (papel === 'texto' && fundoDestaque && luminancia(cor) > 0.45) return m;
      if (formatar(mapear(cor, {})) === formatar(cor)) return m;
      return `var(${nomeVariavel(papel, cor)}, ${m})`;
    });
    return `${aspas}${convertido}${aspas}`;
  });
}

function listarTsx(dir) {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return listarTsx(caminho);
    return nome.endsWith('.tsx') ? [caminho] : [];
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const arquivo of listarTsx(RAIZ)) {
    const codigo = readFileSync(arquivo, 'utf8');
    let resultado = '';
    let cursor = 0;
    for (const [ini, fim] of blocosStyle(codigo)) {
      resultado += codigo.slice(cursor, ini) + converterBloco(codigo.slice(ini, fim + 1));
      cursor = fim + 1;
    }
    resultado += codigo.slice(cursor);
    if (resultado !== codigo) {
      writeFileSync(arquivo, resultado);
      const qtd = (resultado.match(/var\(--lt-/g) || []).length - (codigo.match(/var\(--lt-/g) || []).length;
      console.log(`${qtd} cores convertidas em ${relative(RAIZ, arquivo)}`);
    }
  }
}
