/**
 * Acesso aos dados do Radar pela API (/api/dados), no lugar do SDK do Firestore.
 *
 * Reproduz as funções do `firebase/firestore` que os serviços usavam (doc, getDoc, setDoc,
 * updateDoc, query, runTransaction, writeBatch, deleteField...), com a mesma semântica. As
 * permissões são conferidas no servidor (server/src/domain/regrasAcessoDados.ts), e os erros
 * mantêm os códigos do Firestore (ex.: "permission-denied").
 */
import { auth } from './firebase';
import { RADAR_API_URL } from './apiConfig.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mesmo tipo livre do DocumentData do Firestore
export type DocumentData = Record<string, any>;
export type WhereFilterOp = '==' | '<' | '<=' | '>' | '>=' | 'in';
export type OrderByDirection = 'asc' | 'desc';
export type CodigoErroDados =
  | 'invalid-argument' | 'unauthenticated' | 'permission-denied' | 'not-found' | 'aborted' | 'unavailable';

/** Erro no mesmo formato do FirebaseError: `code` + mensagem em português. */
export class ErroDados extends Error {
  readonly code: CodigoErroDados;
  constructor(code: CodigoErroDados, mensagem: string) {
    super(mensagem);
    this.name = 'ErroDados';
    this.code = code;
  }
}

/** Marcador do banco do Radar (`db` em firebase.ts); mantém as chamadas `doc(db, ...)` dos serviços. */
export interface BancoRadar { readonly tipo: 'radar' }

export class CollectionReference {
  readonly type = 'collection';
  readonly path: string;
  constructor(path: string) { this.path = path; }
  get id(): string { return this.path.split('/').at(-1)!; }
}

export class DocumentReference {
  readonly type = 'document';
  readonly path: string;
  constructor(path: string) { this.path = path; }
  get id(): string { return this.path.split('/').at(-1)!; }
  get parent(): CollectionReference { return new CollectionReference(this.path.split('/').slice(0, -1).join('/')); }
}

type Restricao =
  | { tipo: 'where'; campo: string; operador: WhereFilterOp; valor: unknown }
  | { tipo: 'orderBy'; campo: string; direcao: OrderByDirection }
  | { tipo: 'limit'; quantidade: number };
export type QueryConstraint = Restricao;

export class Query {
  readonly colecao: CollectionReference;
  readonly restricoes: readonly Restricao[];
  constructor(colecao: CollectionReference, restricoes: readonly Restricao[] = []) {
    this.colecao = colecao;
    this.restricoes = restricoes;
  }
}

export class DocumentSnapshot<T = DocumentData> {
  readonly ref: DocumentReference;
  /** Versão da última gravação; usada pelas transações. null se o documento não existe. */
  readonly versao: string | null;
  protected readonly conteudo: T | undefined;
  constructor(ref: DocumentReference, conteudo: T | undefined, versao: string | null) {
    this.ref = ref;
    this.conteudo = conteudo;
    this.versao = versao;
  }
  get id(): string { return this.ref.id; }
  /** Como no Firestore, garante ao TypeScript que data() existe depois do teste. */
  exists(): this is QueryDocumentSnapshot<T> { return this.conteudo !== undefined; }
  data(): T | undefined { return this.conteudo === undefined ? undefined : structuredClone(this.conteudo); }
}

export class QueryDocumentSnapshot<T = DocumentData> extends DocumentSnapshot<T> {
  override data(): T { return structuredClone(this.conteudo as T); }
}

export class QuerySnapshot<T = DocumentData> {
  readonly docs: QueryDocumentSnapshot<T>[];
  constructor(docs: QueryDocumentSnapshot<T>[]) { this.docs = docs; }
  get empty(): boolean { return this.docs.length === 0; }
  get size(): number { return this.docs.length; }
  forEach(callback: (documento: QueryDocumentSnapshot<T>) => void): void { this.docs.forEach(callback); }
}

export interface SetOptions { merge?: boolean }

// ------------------------------------------------------------------ referências e consultas

const ALFABETO_ID = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function gerarId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, b => ALFABETO_ID[b % ALFABETO_ID.length]).join('');
}

function juntar(segmentos: string[]): string {
  const caminho = segmentos.join('/');
  if (caminho.split('/').some(parte => !parte)) throw new ErroDados('invalid-argument', `Caminho inválido: "${caminho}".`);
  return caminho;
}

function exigirBanco(db: BancoRadar): void {
  if (db?.tipo !== 'radar') throw new ErroDados('invalid-argument', 'Banco de dados inválido.');
}

export function collection(db: BancoRadar, ...segmentos: string[]): CollectionReference {
  exigirBanco(db);
  return new CollectionReference(juntar(segmentos));
}

/** `doc(db, 'colecao', id)`, `doc(db, 'colecao/id')` ou `doc(colecao)` (id gerado, como no Firestore). */
export function doc(base: BancoRadar | CollectionReference, ...segmentos: string[]): DocumentReference {
  if (base instanceof CollectionReference) {
    return new DocumentReference(juntar([base.path, ...(segmentos.length ? segmentos : [gerarId()])]));
  }
  exigirBanco(base);
  return new DocumentReference(juntar(segmentos));
}

export function query(ref: CollectionReference | Query, ...restricoes: QueryConstraint[]): Query {
  return ref instanceof Query ? new Query(ref.colecao, [...ref.restricoes, ...restricoes]) : new Query(ref, restricoes);
}
export const where = (campo: string, operador: WhereFilterOp, valor: unknown): QueryConstraint => ({ tipo: 'where', campo, operador, valor });
export const orderBy = (campo: string, direcao: OrderByDirection = 'asc'): QueryConstraint => ({ tipo: 'orderBy', campo, direcao });
export const limit = (quantidade: number): QueryConstraint => ({ tipo: 'limit', quantidade });

// ------------------------------------------------------------------ valores

const MARCADOR_REMOCAO = Object.freeze({ __radar__: 'deleteField' });
export type FieldValue = typeof MARCADOR_REMOCAO;
/** Remove o campo em updateDoc ou setDoc com merge. */
export const deleteField = (): FieldValue => MARCADOR_REMOCAO;

/**
 * Caminho de campo literal, como o FieldPath do Firestore: cada parte é um nome de campo,
 * mesmo contendo ponto (ex.: o nome de um tema em `aplicacaoTemasDias`).
 */
export class FieldPath {
  readonly segmentos: readonly string[];
  constructor(...segmentos: string[]) {
    if (!segmentos.length || segmentos.some(parte => typeof parte !== 'string' || parte.length === 0)) {
      throw new ErroDados('invalid-argument', 'Caminho de campo inválido.');
    }
    this.segmentos = segmentos;
  }
}

/** Recusa valores que o Firestore também recusava, em vez de perdê-los no JSON. */
function validarValor(valor: unknown, caminho: string): void {
  if (valor === undefined) throw new ErroDados('invalid-argument', `Valor undefined não pode ser gravado (campo "${caminho}").`);
  if (valor === null || ['string', 'number', 'boolean'].includes(typeof valor)) return;
  if (Array.isArray(valor)) { valor.forEach((item, i) => validarValor(item, `${caminho}[${i}]`)); return; }
  // Objeto simples de qualquer contexto (protótipo Object.prototype ou null); recusa Date, classes etc.
  const prototipo = typeof valor === 'object' ? Object.getPrototypeOf(valor) : undefined;
  if (prototipo === undefined || (prototipo !== null && Object.getPrototypeOf(prototipo) !== null)) {
    throw new ErroDados('invalid-argument', `Tipo de valor não suportado no campo "${caminho}".`);
  }
  for (const [chave, item] of Object.entries(valor as object)) validarValor(item, caminho ? `${caminho}.${chave}` : chave);
}

// ------------------------------------------------------------------ comunicação com a API

async function requisitar<T>(caminho: string, corpo?: unknown): Promise<T> {
  const usuario = auth.currentUser;
  if (!usuario) throw new ErroDados('unauthenticated', 'Entre novamente no Radar.');
  const token = await usuario.getIdToken();
  let resposta: Response;
  try {
    resposta = await fetch(`${RADAR_API_URL}/api/dados/${caminho}`, {
      method: corpo === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ErroDados('unavailable', 'Sem conexão com o servidor do Radar. Verifique a internet e tente novamente.');
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const codigo = typeof dados.code === 'string' ? dados.code as CodigoErroDados : resposta.status === 403 ? 'permission-denied' : 'unavailable';
    throw new ErroDados(codigo, dados.error || 'Não foi possível acessar os dados. Tente novamente.');
  }
  return dados as T;
}

type DocumentoApi = { id: string; existe: boolean; dados?: DocumentData; versao?: string };
const caminhoApi = (ref: DocumentReference) => ref.path.split('/').map(encodeURIComponent).join('/');

export async function getDoc<T = DocumentData>(ref: DocumentReference): Promise<DocumentSnapshot<T>> {
  const lido = await requisitar<DocumentoApi>(caminhoApi(ref));
  return new DocumentSnapshot<T>(ref, lido.existe ? lido.dados as T : undefined, lido.versao ?? null);
}
/** Sem cache local: toda leitura já vem do servidor. */
export const getDocFromServer = getDoc;

export async function getDocs<T = DocumentData>(alvo: Query | CollectionReference): Promise<QuerySnapshot<T>> {
  const consulta = alvo instanceof Query ? alvo : new Query(alvo);
  const corpo = {
    filtros: consulta.restricoes.flatMap(r => r.tipo === 'where' ? [{ campo: r.campo, operador: r.operador, valor: r.valor }] : []),
    ordens: consulta.restricoes.flatMap(r => r.tipo === 'orderBy' ? [{ campo: r.campo, direcao: r.direcao }] : []),
    limite: consulta.restricoes.flatMap(r => r.tipo === 'limit' ? [r.quantidade] : []).at(-1),
  };
  const { documentos } = await requisitar<{ documentos: DocumentoApi[] }>(
    `${encodeURIComponent(consulta.colecao.path)}/consultar`, corpo);
  return new QuerySnapshot<T>(documentos.map(d =>
    new QueryDocumentSnapshot<T>(new DocumentReference(`${consulta.colecao.path}/${d.id}`), d.dados as T, d.versao ?? '')));
}
export const getDocsFromServer = getDocs;

type CampoAtualizado = { caminho: string[]; valor: unknown };
type Escrita = { tipo: 'set' | 'update' | 'delete'; caminho: string; dados?: DocumentData; merge?: boolean; campos?: CampoAtualizado[] };

function escrita(tipo: Escrita['tipo'], ref: DocumentReference, dados?: DocumentData, opcoes?: SetOptions): Escrita {
  if (dados !== undefined) validarValor(dados, '');
  return { tipo, caminho: ref.path, dados, merge: opcoes?.merge === true };
}

/**
 * `update` nas duas formas do Firestore: objeto (`{ 'a.b': valor }`) ou pares campo/valor
 * (`'a.b', valor` ou `new FieldPath('a', 'b.c'), valor`, repetidos).
 */
function escritaUpdate(ref: DocumentReference, args: unknown[]): Escrita {
  if (args.length === 1 && !(args[0] instanceof FieldPath)) return escrita('update', ref, args[0] as DocumentData);
  if (args.length < 2 || args.length % 2 !== 0) throw new ErroDados('invalid-argument', 'Atualização com pares campo/valor incompletos.');
  const campos: CampoAtualizado[] = [];
  for (let i = 0; i < args.length; i += 2) {
    const campo = args[i];
    const caminho = campo instanceof FieldPath ? [...campo.segmentos]
      : typeof campo === 'string' && campo.length > 0 ? campo.split('.') : null;
    if (!caminho || caminho.some(parte => !parte)) throw new ErroDados('invalid-argument', 'Caminho de campo inválido.');
    validarValor(args[i + 1], caminho.join('.'));
    campos.push({ caminho, valor: args[i + 1] });
  }
  return { tipo: 'update', caminho: ref.path, campos, merge: false };
}

async function enviar(escritas: Escrita[], leituras: { caminho: string; versao: string | null }[] = []): Promise<void> {
  if (!escritas.length) return;
  await requisitar('gravar', { leituras, escritas });
}

export async function setDoc(ref: DocumentReference, dados: DocumentData, opcoes?: SetOptions): Promise<void> {
  return enviar([escrita('set', ref, dados, opcoes)]);
}
export function updateDoc(ref: DocumentReference, dados: DocumentData): Promise<void>;
export function updateDoc(ref: DocumentReference, campo: string | FieldPath, valor: unknown, ...maisCamposEValores: unknown[]): Promise<void>;
export async function updateDoc(ref: DocumentReference, ...args: unknown[]): Promise<void> {
  return enviar([escritaUpdate(ref, args)]);
}
export async function deleteDoc(ref: DocumentReference): Promise<void> {
  return enviar([escrita('delete', ref)]);
}
export async function addDoc(colecao: CollectionReference, dados: DocumentData): Promise<DocumentReference> {
  const ref = doc(colecao);
  await setDoc(ref, dados);
  return ref;
}

// ------------------------------------------------------------------ lotes e transações

export interface WriteBatch {
  set(ref: DocumentReference, dados: DocumentData, opcoes?: SetOptions): WriteBatch;
  update(ref: DocumentReference, dados: DocumentData): WriteBatch;
  update(ref: DocumentReference, campo: string | FieldPath, valor: unknown, ...maisCamposEValores: unknown[]): WriteBatch;
  delete(ref: DocumentReference): WriteBatch;
  commit(): Promise<void>;
}

export function writeBatch(db: BancoRadar): WriteBatch {
  exigirBanco(db);
  const escritas: Escrita[] = [];
  const lote: WriteBatch = {
    set(ref, dados, opcoes) { escritas.push(escrita('set', ref, dados, opcoes)); return lote; },
    update(ref: DocumentReference, ...args: unknown[]) { escritas.push(escritaUpdate(ref, args)); return lote; },
    delete(ref) { escritas.push(escrita('delete', ref)); return lote; },
    commit: () => enviar(escritas),
  };
  return lote;
}

/** Transação: lê no servidor e grava tudo de uma vez, só se nenhum documento lido mudou. */
export class Transaction {
  readonly leituras = new Map<string, string | null>();
  readonly escritas: Escrita[] = [];

  async get<T = DocumentData>(ref: DocumentReference): Promise<DocumentSnapshot<T>> {
    if (this.escritas.length) throw new ErroDados('invalid-argument', 'Em uma transação, todas as leituras devem preceder as escritas.');
    const instantaneo = await getDoc<T>(ref);
    this.leituras.set(ref.path, instantaneo.versao);
    return instantaneo;
  }
  set(ref: DocumentReference, dados: DocumentData, opcoes?: SetOptions): this { this.escritas.push(escrita('set', ref, dados, opcoes)); return this; }
  update(ref: DocumentReference, dados: DocumentData): this;
  update(ref: DocumentReference, campo: string | FieldPath, valor: unknown, ...maisCamposEValores: unknown[]): this;
  update(ref: DocumentReference, ...args: unknown[]): this { this.escritas.push(escritaUpdate(ref, args)); return this; }
  delete(ref: DocumentReference): this { this.escritas.push(escrita('delete', ref)); return this; }
}

const MAX_TENTATIVAS = 5;

export async function runTransaction<T>(db: BancoRadar, funcao: (transacao: Transaction) => Promise<T>): Promise<T> {
  exigirBanco(db);
  for (let tentativa = 1; ; tentativa++) {
    const transacao = new Transaction();
    const resultado = await funcao(transacao);
    try {
      await enviar(transacao.escritas, [...transacao.leituras].map(([caminho, versao]) => ({ caminho, versao })));
      return resultado;
    } catch (erro) {
      // Outra pessoa alterou um dos documentos lidos: refaz a função com os dados atuais.
      if (erro instanceof ErroDados && erro.code === 'aborted' && tentativa < MAX_TENTATIVAS) {
        await new Promise(resolve => setTimeout(resolve, 100 * 2 ** tentativa * (0.5 + Math.random())));
        continue;
      }
      throw erro;
    }
  }
}
