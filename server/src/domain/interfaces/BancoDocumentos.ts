/**
 * Contrato do banco de documentos usado pelos casos de uso.
 *
 * Reproduz o subconjunto da API do Firestore Admin que o Radar sempre usou (coleções,
 * documentos, consultas simples, transações e lotes), para que a troca do Firestore pelo
 * PostgreSQL não altere as regras de negócio. A implementação fica em
 * infrastructure/postgres/BancoDocumentosPostgres.ts.
 *
 * Os dados são objetos JSON: string, número finito, booleano, null, array e objeto simples.
 */

/**
 * Conteúdo de um documento. Mantém o mesmo tipo livre do `DocumentData` do Firestore: os casos
 * de uso já validam os campos que leem, e um tipo mais estrito exigiria reescrevê-los.
 */
export type DadosDocumento = Record<string, any>;

/** `in` recebe uma lista de até 30 valores, como no Firestore. */
export type OperadorFiltro = '==' | '<' | '<=' | '>' | '>=' | 'in';
export type DirecaoOrdenacao = 'asc' | 'desc';

export interface OpcoesGravacao {
  /** Mescla recursivamente com o documento existente, como `set(..., { merge: true })` do Firestore. */
  merge?: boolean;
}

export interface InstantaneoDocumento {
  readonly id: string;
  readonly ref: ReferenciaDocumento;
  readonly exists: boolean;
  /** Versão da última gravação (muda a cada escrita); ausente se o documento não existe. */
  readonly versao?: string;
  data(): DadosDocumento | undefined;
}

/** Documento retornado por consulta: sempre existe (como `QueryDocumentSnapshot`). */
export interface InstantaneoDocumentoConsulta extends InstantaneoDocumento {
  data(): DadosDocumento;
}

export interface InstantaneoConsulta {
  readonly docs: InstantaneoDocumentoConsulta[];
  readonly empty: boolean;
  readonly size: number;
  forEach(callback: (documento: InstantaneoDocumentoConsulta) => void): void;
}

export interface Consulta {
  where(campo: string, operador: OperadorFiltro, valor: unknown): Consulta;
  orderBy(campo: string, direcao?: DirecaoOrdenacao): Consulta;
  limit(quantidade: number): Consulta;
  get(): Promise<InstantaneoConsulta>;
}

export interface ReferenciaColecao extends Consulta {
  readonly id: string;
  readonly path: string;
  /** Sem id, gera um identificador aleatório de 20 caracteres, no mesmo formato do Firestore. */
  doc(id?: string): ReferenciaDocumento;
}

export interface ReferenciaDocumento {
  readonly id: string;
  readonly path: string;
  readonly parent: ReferenciaColecao;
  collection(nome: string): ReferenciaColecao;
  get(): Promise<InstantaneoDocumento>;
  set(dados: DadosDocumento, opcoes?: OpcoesGravacao): Promise<void>;
  /** Substitui os campos informados; falha se o documento não existir. */
  update(dados: DadosDocumento): Promise<void>;
  /** Falha se o documento já existir. */
  create(dados: DadosDocumento): Promise<void>;
  delete(): Promise<void>;
}

/** Leituras antes das escritas; as escritas só são aplicadas no commit, como no Firestore. */
export interface Transacao {
  get(referencia: ReferenciaDocumento): Promise<InstantaneoDocumento>;
  get(consulta: Consulta): Promise<InstantaneoConsulta>;
  getAll(...referencias: ReferenciaDocumento[]): Promise<InstantaneoDocumento[]>;
  set(referencia: ReferenciaDocumento, dados: DadosDocumento, opcoes?: OpcoesGravacao): Transacao;
  update(referencia: ReferenciaDocumento, dados: DadosDocumento): Transacao;
  create(referencia: ReferenciaDocumento, dados: DadosDocumento): Transacao;
  delete(referencia: ReferenciaDocumento): Transacao;
}

export interface LoteEscrita {
  set(referencia: ReferenciaDocumento, dados: DadosDocumento, opcoes?: OpcoesGravacao): LoteEscrita;
  update(referencia: ReferenciaDocumento, dados: DadosDocumento): LoteEscrita;
  create(referencia: ReferenciaDocumento, dados: DadosDocumento): LoteEscrita;
  delete(referencia: ReferenciaDocumento): LoteEscrita;
  commit(): Promise<void>;
}

export interface BancoDocumentos {
  collection(caminho: string): ReferenciaColecao;
  doc(caminho: string): ReferenciaDocumento;
  /** Repete a função quando há conflito com outra transação; ela não deve ter efeitos externos. */
  runTransaction<T>(funcao: (transacao: Transacao) => Promise<T>): Promise<T>;
  batch(): LoteEscrita;
}

/** Erro com o código numérico do gRPC usado pelo Firestore (5 = não encontrado, 6 = já existe). */
export class ErroBancoDocumentos extends Error {
  constructor(readonly code: 5 | 6 | 3, mensagem: string) {
    super(mensagem);
    this.name = 'ErroBancoDocumentos';
  }
}
