import { randomInt } from 'node:crypto';
import type pg from 'pg';
import {
  ErroBancoDocumentos,
  type BancoDocumentos, type Consulta, type DadosDocumento, type DirecaoOrdenacao, type InstantaneoConsulta,
  type InstantaneoDocumento, type InstantaneoDocumentoConsulta, type LoteEscrita, type OpcoesGravacao, type OperadorFiltro, type ReferenciaColecao,
  type ReferenciaDocumento, type Transacao,
} from '../../domain/interfaces/BancoDocumentos.js';
import { resolverColecao, validarSegmento, type DestinoColecao } from './colecoes.js';
import { atualizar, mesclar, normalizarDocumento, normalizarValor } from '../../domain/operacoesDocumento.js';

export { CAMPO_REMOVIDO } from '../../domain/operacoesDocumento.js';

const ALFABETO_ID = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function gerarIdDocumento(): string {
  let id = '';
  for (let i = 0; i < 20; i++) id += ALFABETO_ID[randomInt(ALFABETO_ID.length)];
  return id;
}

// O Firestore Admin espera o lock; aqui a transação em conflito é refeita. Com espera exponencial
// e aleatória, mesmo dezenas de gravações simultâneas no mesmo documento terminam sem erro.
const MAX_TENTATIVAS = 10;
const esperaAntesDaTentativa = (tentativa: number) => Math.min(1_000, 10 * 2 ** tentativa) * (0.5 + Math.random());
const CODIGOS_CONFLITO = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected
const CAMPO_VALIDO = /^[A-Za-z0-9_]+$/;

type Objeto = Record<string, unknown>;

/** Expressão SQL do campo; só aceita nomes simples, então pode entrar literalmente no SQL. */
function expressaoCampo(campo: string): string {
  const partes = campo.split('.');
  if (!partes.every(p => CAMPO_VALIDO.test(p))) throw new ErroBancoDocumentos(3, `Campo de consulta inválido: "${campo}".`);
  return `(dados${partes.map(p => ` -> '${p}'`).join('')})`;
}

function aninhar(campo: string, valor: unknown): Objeto {
  return campo.split('.').reduceRight<unknown>((acumulado, parte) => ({ [parte]: acumulado }), valor) as Objeto;
}

const tipoJson = (valor: unknown) => valor === null ? 'null' : typeof valor === 'string' ? 'string' : typeof valor === 'number' ? 'number' : 'boolean';

// ---------------------------------------------------------------------------------------------

class Instantaneo implements InstantaneoDocumento {
  constructor(readonly ref: ReferenciaDocumentoPostgres, private readonly conteudo: Objeto | undefined, readonly versao?: string) {}
  get id() { return this.ref.id; }
  get exists() { return this.conteudo !== undefined; }
  data(): DadosDocumento | undefined { return this.conteudo === undefined ? undefined : structuredClone(this.conteudo); }
}

class InstantaneoDeConsulta extends Instantaneo implements InstantaneoDocumentoConsulta {
  constructor(ref: ReferenciaDocumentoPostgres, private readonly conteudoExistente: Objeto, versao: string) { super(ref, conteudoExistente, versao); }
  override data(): DadosDocumento { return structuredClone(this.conteudoExistente); }
}

class InstantaneoLista implements InstantaneoConsulta {
  constructor(readonly docs: InstantaneoDocumentoConsulta[]) {}
  get empty() { return this.docs.length === 0; }
  get size() { return this.docs.length; }
  forEach(callback: (documento: InstantaneoDocumentoConsulta) => void) { this.docs.forEach(callback); }
}

type Filtro = { campo: string; operador: OperadorFiltro; valor: unknown };
type Ordem = { campo: string; direcao: DirecaoOrdenacao };

class ConsultaPostgres implements Consulta {
  constructor(
    protected readonly banco: BancoDocumentosPostgres,
    readonly destino: DestinoColecao,
    private readonly filtros: Filtro[] = [],
    private readonly ordens: Ordem[] = [],
    private readonly limite?: number,
  ) {}

  where(campo: string, operador: OperadorFiltro, valor: unknown): Consulta {
    if (!['==', '<', '<=', '>', '>=', 'in'].includes(operador)) throw new ErroBancoDocumentos(3, `Operador não suportado: ${operador}`);
    if (operador === 'in' && (!Array.isArray(valor) || valor.length === 0 || valor.length > 30)) {
      throw new ErroBancoDocumentos(3, `O filtro "in" exige uma lista de 1 a 30 valores (campo "${campo}").`);
    }
    if (operador !== 'in' && operador !== '==' && typeof valor !== 'number' && typeof valor !== 'string') {
      throw new ErroBancoDocumentos(3, `Filtro ${operador} só aceita número ou texto (campo "${campo}").`);
    }
    expressaoCampo(campo);
    return new ConsultaPostgres(this.banco, this.destino, [...this.filtros, { campo, operador, valor }], this.ordens, this.limite);
  }

  orderBy(campo: string, direcao: DirecaoOrdenacao = 'asc'): Consulta {
    expressaoCampo(campo);
    if (direcao !== 'asc' && direcao !== 'desc') throw new ErroBancoDocumentos(3, `Direção inválida: ${direcao}`);
    return new ConsultaPostgres(this.banco, this.destino, this.filtros, [...this.ordens, { campo, direcao }], this.limite);
  }

  limit(quantidade: number): Consulta {
    if (!Number.isInteger(quantidade) || quantidade < 0) throw new ErroBancoDocumentos(3, `Limite inválido: ${quantidade}`);
    return new ConsultaPostgres(this.banco, this.destino, this.filtros, this.ordens, quantidade);
  }

  get(): Promise<InstantaneoConsulta> {
    return this.executar(this.banco.pool);
  }

  /** Monta o SQL. Semântica do Firestore: igualdade e intervalos só casam com o mesmo tipo JSON. */
  montarSql(): { text: string; values: unknown[] } {
    const valores: unknown[] = [];
    const parametro = (valor: unknown) => { valores.push(valor); return `$${valores.length}`; };
    const condicoes: string[] = [];
    if (this.destino.paiId !== undefined) condicoes.push(`pai_id = ${parametro(this.destino.paiId)}`);
    for (const { campo, operador, valor } of this.filtros) {
      const expr = expressaoCampo(campo);
      const normalizado = normalizarValor(valor, campo, false);
      const escalar = normalizado === null || ['string', 'number', 'boolean'].includes(typeof normalizado);
      if (operador === 'in') {
        // Igualdade exata do JSON (tipo incluído) com qualquer item da lista.
        condicoes.push(`${expr} in (select jsonb_array_elements(${parametro(JSON.stringify(normalizado))}::jsonb))`);
      } else if (operador === '==') {
        if (escalar) {
          // @> usa o índice GIN; o tipo evita que um array que contém o valor seja considerado igual.
          condicoes.push(`dados @> ${parametro(JSON.stringify(aninhar(campo, normalizado)))}::jsonb and jsonb_typeof(${expr}) = '${tipoJson(normalizado)}'`);
        } else {
          condicoes.push(`${expr} = ${parametro(JSON.stringify(normalizado))}::jsonb`);
        }
      } else if (typeof normalizado === 'number') {
        condicoes.push(`radar_numero(${expr}) ${operador} ${parametro(normalizado)}::numeric`);
      } else if (typeof normalizado === 'string') {
        condicoes.push(`radar_texto(${expr}) ${operador} ${parametro(normalizado)}::text collate "C"`);
      } else {
        throw new ErroBancoDocumentos(3, `Filtro ${operador} só aceita número ou texto (campo "${campo}").`);
      }
    }
    // Como no Firestore, ordenar por um campo exclui documentos que não o possuem.
    for (const { campo } of this.ordens) condicoes.push(`${expressaoCampo(campo)} is not null`);
    const ordemFinal = this.ordens.at(-1)?.direcao ?? 'asc';
    const ordenacao = [...this.ordens.map(o => `${expressaoCampo(o.campo)} ${o.direcao}`), `id ${ordemFinal}`];
    const colunas = this.destino.paiId !== undefined ? 'pai_id, id, dados, versao' : 'id, dados, versao';
    let text = `select ${colunas} from ${this.destino.tabela}`;
    if (condicoes.length) text += ` where ${condicoes.join(' and ')}`;
    text += ` order by ${ordenacao.join(', ')}`;
    if (this.limite !== undefined) text += ` limit ${parametro(this.limite)}`;
    return { text, values: valores };
  }

  async executar(executor: pg.Pool | pg.PoolClient): Promise<InstantaneoConsulta> {
    const { rows } = await executor.query<{ id: string; dados: Objeto; versao: string }>(this.montarSql());
    const colecao = new ReferenciaColecaoPostgres(this.banco, this.destino);
    return new InstantaneoLista(rows.map(r => new InstantaneoDeConsulta(new ReferenciaDocumentoPostgres(this.banco, colecao, r.id), r.dados, r.versao)));
  }
}

class ReferenciaColecaoPostgres extends ConsultaPostgres implements ReferenciaColecao {
  constructor(banco: BancoDocumentosPostgres, destino: DestinoColecao) { super(banco, destino); }
  get id() { return this.destino.nome; }
  get path() { return this.destino.caminho; }
  doc(id?: string): ReferenciaDocumento {
    return new ReferenciaDocumentoPostgres(this.banco, this, id === undefined ? gerarIdDocumento() : validarSegmento(id, 'documento'));
  }
}

class ReferenciaDocumentoPostgres implements ReferenciaDocumento {
  constructor(private readonly banco: BancoDocumentosPostgres, readonly parent: ReferenciaColecaoPostgres, readonly id: string) {}
  get path() { return `${this.parent.path}/${this.id}`; }
  get destino() { return this.parent.destino; }
  collection(nome: string): ReferenciaColecao { return this.banco.collection(`${this.path}/${validarSegmento(nome, 'coleção')}`); }
  get(): Promise<InstantaneoDocumento> { return this.banco.lerDocumento(this.banco.pool, this); }
  set(dados: DadosDocumento, opcoes?: OpcoesGravacao) { return this.banco.runTransaction(async tx => { tx.set(this, dados, opcoes); }); }
  update(dados: DadosDocumento) { return this.banco.runTransaction(async tx => { tx.update(this, dados); }); }
  create(dados: DadosDocumento) { return this.banco.runTransaction(async tx => { tx.create(this, dados); }); }
  delete() { return this.banco.runTransaction(async tx => { tx.delete(this); }); }
}

type Escrita =
  | { tipo: 'set'; ref: ReferenciaDocumentoPostgres; dados: Objeto; merge: boolean }
  | { tipo: 'update'; ref: ReferenciaDocumentoPostgres; dados: Objeto }
  | { tipo: 'create'; ref: ReferenciaDocumentoPostgres; dados: Objeto }
  | { tipo: 'delete'; ref: ReferenciaDocumentoPostgres };

function comoReferencia(referencia: ReferenciaDocumento): ReferenciaDocumentoPostgres {
  if (!(referencia instanceof ReferenciaDocumentoPostgres)) throw new ErroBancoDocumentos(3, 'Referência de outro banco de documentos.');
  return referencia;
}

/** Acumula escritas; usado por transações e lotes. Os dados são validados e copiados na chamada. */
class Escritas {
  readonly lista: Escrita[] = [];
  set(ref: ReferenciaDocumento, dados: DadosDocumento, opcoes?: OpcoesGravacao) {
    const merge = opcoes?.merge === true;
    this.lista.push({ tipo: 'set', ref: comoReferencia(ref), dados: normalizarDocumento(dados, merge), merge });
  }
  update(ref: ReferenciaDocumento, dados: DadosDocumento) {
    this.lista.push({ tipo: 'update', ref: comoReferencia(ref), dados: normalizarDocumento(dados, true) });
  }
  create(ref: ReferenciaDocumento, dados: DadosDocumento) {
    this.lista.push({ tipo: 'create', ref: comoReferencia(ref), dados: normalizarDocumento(dados, false) });
  }
  delete(ref: ReferenciaDocumento) { this.lista.push({ tipo: 'delete', ref: comoReferencia(ref) }); }
}

class TransacaoPostgres implements Transacao {
  readonly escritas = new Escritas();
  constructor(private readonly banco: BancoDocumentosPostgres, private readonly cliente: pg.PoolClient) {}

  private exigirLeituraAntesDeEscrita() {
    if (this.escritas.lista.length) throw new ErroBancoDocumentos(3, 'Em uma transação, todas as leituras devem preceder as escritas.');
  }

  get(referencia: ReferenciaDocumento): Promise<InstantaneoDocumento>;
  get(consulta: Consulta): Promise<InstantaneoConsulta>;
  async get(alvo: ReferenciaDocumento | Consulta): Promise<InstantaneoDocumento | InstantaneoConsulta> {
    this.exigirLeituraAntesDeEscrita();
    if (alvo instanceof ReferenciaDocumentoPostgres) return this.banco.lerDocumento(this.cliente, alvo);
    if (alvo instanceof ConsultaPostgres) return alvo.executar(this.cliente);
    throw new ErroBancoDocumentos(3, 'Leitura de outro banco de documentos.');
  }

  getAll(...referencias: ReferenciaDocumento[]): Promise<InstantaneoDocumento[]> {
    return Promise.all(referencias.map(r => this.get(r)));
  }

  set(ref: ReferenciaDocumento, dados: DadosDocumento, opcoes?: OpcoesGravacao) { this.escritas.set(ref, dados, opcoes); return this; }
  update(ref: ReferenciaDocumento, dados: DadosDocumento) { this.escritas.update(ref, dados); return this; }
  create(ref: ReferenciaDocumento, dados: DadosDocumento) { this.escritas.create(ref, dados); return this; }
  delete(ref: ReferenciaDocumento) { this.escritas.delete(ref); return this; }
}

class LotePostgres implements LoteEscrita {
  private readonly escritas = new Escritas();
  private enviado = false;
  constructor(private readonly banco: BancoDocumentosPostgres) {}
  set(ref: ReferenciaDocumento, dados: DadosDocumento, opcoes?: OpcoesGravacao) { this.escritas.set(ref, dados, opcoes); return this; }
  update(ref: ReferenciaDocumento, dados: DadosDocumento) { this.escritas.update(ref, dados); return this; }
  create(ref: ReferenciaDocumento, dados: DadosDocumento) { this.escritas.create(ref, dados); return this; }
  delete(ref: ReferenciaDocumento) { this.escritas.delete(ref); return this; }
  async commit() {
    if (this.enviado) throw new ErroBancoDocumentos(3, 'Este lote já foi enviado.');
    this.enviado = true;
    const lista = this.escritas.lista;
    await this.banco.runTransaction(async tx => { (tx as TransacaoPostgres).escritas.lista.push(...lista); });
  }
}

const chaveSql = (ref: ReferenciaDocumentoPostgres) => ref.destino.paiId !== undefined
  ? { condicao: 'pai_id = $1 and id = $2', valores: [ref.destino.paiId, ref.id], colunas: 'pai_id, id', conflito: '(pai_id, id)' }
  : { condicao: 'id = $1', valores: [ref.id], colunas: 'id', conflito: '(id)' };

export class BancoDocumentosPostgres implements BancoDocumentos {
  constructor(readonly pool: pg.Pool) {}

  collection(caminho: string): ReferenciaColecao {
    return new ReferenciaColecaoPostgres(this, resolverColecao(caminho));
  }

  doc(caminho: string): ReferenciaDocumento {
    const partes = caminho.split('/');
    if (partes.length % 2 !== 0) throw new ErroBancoDocumentos(3, `Caminho de documento inválido: "${caminho}".`);
    return this.collection(partes.slice(0, -1).join('/')).doc(partes[partes.length - 1]);
  }

  batch(): LoteEscrita { return new LotePostgres(this); }

  async lerDocumento(executor: pg.Pool | pg.PoolClient, ref: ReferenciaDocumentoPostgres): Promise<InstantaneoDocumento> {
    const chave = chaveSql(ref);
    const { rows } = await executor.query<{ dados: Objeto; versao: string }>(`select dados, versao from ${ref.destino.tabela} where ${chave.condicao}`, chave.valores);
    return new Instantaneo(ref, rows[0]?.dados, rows[0]?.versao);
  }

  /**
   * Transação SERIALIZABLE: as leituras enxergam um retrato consistente e o PostgreSQL aborta a
   * transação se outra gravação concorrente invalidá-lo; nesse caso a função é executada de novo,
   * como o Firestore faz. As escritas só são aplicadas ao final.
   */
  async runTransaction<T>(funcao: (transacao: Transacao) => Promise<T>): Promise<T> {
    for (let tentativa = 1; ; tentativa++) {
      const cliente = await this.pool.connect();
      let liberarComErro: Error | undefined;
      try {
        await cliente.query('begin isolation level serializable');
        const transacao = new TransacaoPostgres(this, cliente);
        const resultado = await funcao(transacao);
        await this.aplicarEscritas(cliente, transacao.escritas.lista);
        await cliente.query('commit');
        return resultado;
      } catch (erro) {
        try { await cliente.query('rollback'); } catch (falhaRollback) { liberarComErro = falhaRollback as Error; }
        const codigo = (erro as { code?: unknown }).code;
        const conflito = typeof codigo === 'string' && CODIGOS_CONFLITO.has(codigo);
        if (conflito && tentativa < MAX_TENTATIVAS) {
          await new Promise(resolve => setTimeout(resolve, esperaAntesDaTentativa(tentativa)));
          continue;
        }
        if (conflito) console.error(`[PostgreSQL] Transação desistiu após ${MAX_TENTATIVAS} conflitos seguidos com outras gravações.`);
        throw erro;
      } finally {
        cliente.release(liberarComErro);
      }
    }
  }

  private async aplicarEscritas(cliente: pg.PoolClient, escritas: Escrita[]): Promise<void> {
    for (const escrita of escritas) {
      const { ref } = escrita;
      const tabela = ref.destino.tabela;
      const chave = chaveSql(ref);
      const n = chave.valores.length;
      const gravar = (dados: Objeto) => cliente.query(
        `insert into ${tabela} (${chave.colunas}, dados) values (${chave.valores.map((_, i) => `$${i + 1}`).join(', ')}, $${n + 1}::jsonb)
         on conflict ${chave.conflito} do update set dados = excluded.dados`,
        [...chave.valores, JSON.stringify(dados)],
      );

      if (escrita.tipo === 'delete') {
        await cliente.query(`delete from ${tabela} where ${chave.condicao}`, chave.valores);
      } else if (escrita.tipo === 'create') {
        try {
          await cliente.query(
            `insert into ${tabela} (${chave.colunas}, dados) values (${chave.valores.map((_, i) => `$${i + 1}`).join(', ')}, $${n + 1}::jsonb)`,
            [...chave.valores, JSON.stringify(escrita.dados)],
          );
        } catch (erro) {
          if ((erro as { code?: string }).code === '23505') throw new ErroBancoDocumentos(6, `Documento já existe: ${ref.path}`);
          throw erro;
        }
      } else if (escrita.tipo === 'set' && !escrita.merge) {
        await gravar(escrita.dados);
      } else {
        const { rows } = await cliente.query<{ dados: Objeto }>(`select dados from ${tabela} where ${chave.condicao} for update`, chave.valores);
        const atual = rows[0]?.dados;
        if (escrita.tipo === 'update') {
          if (!atual) throw new ErroBancoDocumentos(5, `Documento não encontrado para atualizar: ${ref.path}`);
          await gravar(atualizar(atual, escrita.dados));
        } else {
          await gravar(mesclar(atual ?? {}, escrita.dados));
        }
      }
    }
  }

  async encerrar(): Promise<void> {
    await this.pool.end();
  }
}
