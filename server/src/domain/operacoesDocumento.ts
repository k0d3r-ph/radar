/**
 * Semântica de gravação dos documentos (a mesma do Firestore): validação dos valores, merge
 * recursivo e update com caminhos "a.b". Usada pelo adaptador do PostgreSQL e pela API de dados
 * do navegador, que precisa calcular o documento resultante antes de conferir as permissões.
 */
import { ErroBancoDocumentos, type DadosDocumento } from './interfaces/BancoDocumentos.js';

/**
 * Remove um campo em `update` ou `set(..., { merge: true })`, como `FieldValue.delete()`/`deleteField()`.
 * A API de dados recebe esse marcador do navegador como {"__radar__":"deleteField"}.
 */
export const CAMPO_REMOVIDO: unique symbol = Symbol.for('radar.campoRemovido');

export type Objeto = Record<string, unknown>;
export const ehObjetoSimples = (valor: unknown): valor is Objeto => {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const prototipo = Object.getPrototypeOf(valor);
  return prototipo === Object.prototype || prototipo === null;
};

/**
 * Copia o valor garantindo que ele cabe em JSON sem perda. Como no Firestore, `undefined` é recusado;
 * números não finitos (que o JSON não representa) viram null.
 */
export function normalizarValor(valor: unknown, caminho: string, permitirRemocao: boolean): unknown {
  if (valor === CAMPO_REMOVIDO) {
    if (!permitirRemocao) throw new ErroBancoDocumentos(3, `Remoção de campo só é aceita em update ou merge (campo "${caminho}").`);
    return valor;
  }
  if (valor === null || typeof valor === 'string' || typeof valor === 'boolean') return valor;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (valor === undefined) throw new ErroBancoDocumentos(3, `Valor undefined não pode ser gravado (campo "${caminho}").`);
  if (Array.isArray(valor)) return valor.map((item, i) => normalizarValor(item, `${caminho}[${i}]`, false));
  if (ehObjetoSimples(valor)) {
    const copia: Objeto = {};
    for (const [chave, item] of Object.entries(valor)) {
      copia[chave] = normalizarValor(item, caminho ? `${caminho}.${chave}` : chave, permitirRemocao);
    }
    return copia;
  }
  throw new ErroBancoDocumentos(3, `Tipo de valor não suportado no campo "${caminho}" (${Object.prototype.toString.call(valor)}).`);
}

export function normalizarDocumento(dados: DadosDocumento, permitirRemocao: boolean): Objeto {
  if (!ehObjetoSimples(dados)) throw new ErroBancoDocumentos(3, 'O documento deve ser um objeto.');
  return normalizarValor(dados, '', permitirRemocao) as Objeto;
}

/** Mescla recursiva de mapas; arrays e demais valores substituem o anterior (semântica do merge do Firestore). */
export function mesclar(base: Objeto, novo: Objeto): Objeto {
  const resultado: Objeto = { ...base };
  for (const [chave, valor] of Object.entries(novo)) {
    if (valor === CAMPO_REMOVIDO) delete resultado[chave];
    else if (ehObjetoSimples(valor) && ehObjetoSimples(resultado[chave])) resultado[chave] = mesclar(resultado[chave] as Objeto, valor);
    else resultado[chave] = removerSentinelas(valor);
  }
  return resultado;
}

function removerSentinelas(valor: unknown): unknown {
  if (!ehObjetoSimples(valor)) return valor;
  const copia: Objeto = {};
  for (const [chave, item] of Object.entries(valor)) if (item !== CAMPO_REMOVIDO) copia[chave] = removerSentinelas(item);
  return copia;
}

/** Um campo de `update`: caminho já separado em partes literais (uma parte pode conter ponto). */
export interface AlteracaoCampo { caminho: string[]; valor: unknown }

/**
 * `update` por caminhos literais, como `FieldPath` do Firestore: cada caminho substitui só
 * aquele campo (criando os mapas intermediários) e CAMPO_REMOVIDO apaga o campo.
 */
export function atualizarCampos(base: Objeto, alteracoes: AlteracaoCampo[]): Objeto {
  const resultado = structuredClone(base);
  for (const { caminho, valor } of alteracoes) {
    let alvo: Objeto = resultado;
    for (const parte of caminho.slice(0, -1)) {
      if (!ehObjetoSimples(alvo[parte])) {
        if (valor === CAMPO_REMOVIDO) { alvo = {}; break; }
        alvo[parte] = {};
      }
      alvo = alvo[parte] as Objeto;
    }
    const ultima = caminho[caminho.length - 1];
    if (valor === CAMPO_REMOVIDO) delete alvo[ultima];
    else alvo[ultima] = removerSentinelas(valor);
  }
  return resultado;
}

/** `update` com objeto: cada chave substitui o campo inteiro; "a.b" altera só o campo aninhado. */
export function atualizar(base: Objeto, alteracoes: Objeto): Objeto {
  return atualizarCampos(base, Object.entries(alteracoes).map(([chave, valor]) => ({ caminho: chave.split('.'), valor })));
}
