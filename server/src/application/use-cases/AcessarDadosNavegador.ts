import {
  ErroBancoDocumentos,
  type BancoDocumentos, type Consulta, type DadosDocumento, type DirecaoOrdenacao, type OperadorFiltro,
} from '../../domain/interfaces/BancoDocumentos.js';
import {
  CAMPO_REMOVIDO, atualizar, atualizarCampos, ehObjetoSimples, mesclar, normalizarDocumento, normalizarValor,
  type AlteracaoCampo, type Objeto,
} from '../../domain/operacoesDocumento.js';
import {
  ehColecaoNavegador, podeConsultar, podeGravar, podeLer,
  type ColecaoNavegador, type ContextoAcesso, type OperacaoGravacao,
} from '../../domain/regrasAcessoDados.js';

/** Códigos no mesmo formato do SDK do Firestore, que o frontend já reconhece. */
export type CodigoErroDados = 'invalid-argument' | 'unauthenticated' | 'permission-denied' | 'not-found' | 'aborted' | 'unavailable';

export class ErroAcessoDados extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 503, readonly codigo: CodigoErroDados, mensagem: string) {
    super(mensagem);
  }
}

const negado = () => new ErroAcessoDados(403, 'permission-denied', 'Você não tem permissão para esta ação.');
const invalido = (mensagem: string) => new ErroAcessoDados(400, 'invalid-argument', mensagem);

/** Marcador de `deleteField()` enviado pelo navegador. */
const MARCADOR_REMOCAO = 'deleteField';
const LIMITE_ESCRITAS = 500;
const LIMITE_RESULTADOS = 20_000;
const ID_VALIDO = /^[^/\s][^/]{0,1499}$/;
const OPERADORES: OperadorFiltro[] = ['==', '<', '<=', '>', '>=', 'in'];

export interface DocumentoLido { id: string; existe: boolean; dados?: DadosDocumento; versao?: string }

export interface PedidoConsulta {
  filtros?: { campo: string; operador: OperadorFiltro; valor: unknown }[];
  ordens?: { campo: string; direcao?: DirecaoOrdenacao }[];
  limite?: number;
}

export interface EscritaNavegador {
  tipo: 'set' | 'update' | 'delete';
  caminho: string;
  dados?: unknown;
  merge?: boolean;
  /** `update` por caminhos literais (FieldPath): cada parte do caminho pode conter ponto. */
  campos?: { caminho: unknown; valor: unknown }[];
}

const MAX_PROFUNDIDADE_CAMPO = 20;

/** Valida e normaliza a lista de `campos` de um update por caminhos literais. */
function prepararCampos(campos: unknown): AlteracaoCampo[] {
  if (!Array.isArray(campos) || campos.length === 0 || campos.length > LIMITE_ESCRITAS) throw invalido('Campos de atualização inválidos.');
  return campos.map(item => {
    const caminho = (item as { caminho?: unknown })?.caminho;
    if (!Array.isArray(caminho) || caminho.length === 0 || caminho.length > MAX_PROFUNDIDADE_CAMPO
      || !caminho.every(parte => typeof parte === 'string' && parte.length > 0 && parte.length <= 1500)) {
      throw invalido('Caminho de campo inválido.');
    }
    const nome = (caminho as string[]).join('.');
    return { caminho: caminho as string[], valor: normalizarValor(decodificar((item as { valor?: unknown }).valor), nome, true) };
  });
}

export interface PedidoGravacao {
  /** Documentos lidos numa transação do navegador: a gravação só ocorre se nenhum mudou. */
  leituras?: { caminho: string; versao: string | null }[];
  escritas: EscritaNavegador[];
}

function separarCaminho(caminho: unknown): { colecao: ColecaoNavegador; id: string } {
  if (typeof caminho !== 'string') throw invalido('Caminho de documento inválido.');
  const partes = caminho.split('/');
  if (partes.length !== 2 || !ID_VALIDO.test(partes[1]) || partes[1] === '.' || partes[1] === '..') throw invalido('Caminho de documento inválido.');
  if (!ehColecaoNavegador(partes[0])) throw negado();
  return { colecao: partes[0], id: partes[1] };
}

/** Troca o marcador JSON de remoção pelo símbolo interno, em qualquer profundidade de objeto. */
function decodificar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(decodificar);
  if (!ehObjetoSimples(valor)) return valor;
  const chaves = Object.keys(valor);
  if (chaves.length === 1 && chaves[0] === '__radar__' && valor.__radar__ === MARCADOR_REMOCAO) return CAMPO_REMOVIDO;
  return Object.fromEntries(chaves.map(chave => [chave, decodificar(valor[chave])]));
}

function converterErroBanco(erro: unknown): never {
  if (erro instanceof ErroBancoDocumentos) {
    if (erro.code === 5) throw new ErroAcessoDados(404, 'not-found', 'O registro não existe mais. Atualize a tela.');
    throw invalido(erro.message);
  }
  throw erro;
}

/**
 * Acesso do navegador aos dados: as mesmas operações que o SDK do Firestore oferecia, com as
 * permissões de regrasAcessoDados conferidas no servidor sobre o documento resultante.
 */
export class AcessarDadosNavegador {
  constructor(private readonly db: BancoDocumentos) {}

  async ler(ctx: ContextoAcesso, caminho: string): Promise<DocumentoLido> {
    const { colecao, id } = separarCaminho(caminho);
    if (!podeLer(ctx, colecao, id)) throw negado();
    const instantaneo = await this.db.doc(caminho).get();
    return instantaneo.exists
      ? { id, existe: true, dados: instantaneo.data(), versao: instantaneo.versao }
      : { id, existe: false };
  }

  async consultar(ctx: ContextoAcesso, nomeColecao: string, pedido: PedidoConsulta): Promise<DocumentoLido[]> {
    if (!ehColecaoNavegador(nomeColecao) || !podeConsultar(ctx, nomeColecao)) throw negado();
    const filtros = pedido.filtros ?? [];
    const ordens = pedido.ordens ?? [];
    if (!Array.isArray(filtros) || filtros.length > 10 || !Array.isArray(ordens) || ordens.length > 3) throw invalido('Consulta inválida.');
    const limite = pedido.limite ?? LIMITE_RESULTADOS;
    if (!Number.isInteger(limite) || limite < 0 || limite > LIMITE_RESULTADOS) throw invalido('Limite de consulta inválido.');

    let consulta: Consulta = this.db.collection(nomeColecao);
    try {
      for (const filtro of filtros) {
        if (typeof filtro?.campo !== 'string' || !OPERADORES.includes(filtro.operador)) throw invalido('Filtro de consulta inválido.');
        consulta = consulta.where(filtro.campo, filtro.operador, filtro.valor);
      }
      for (const ordem of ordens) {
        if (typeof ordem?.campo !== 'string') throw invalido('Ordenação inválida.');
        consulta = consulta.orderBy(ordem.campo, ordem.direcao ?? 'asc');
      }
      consulta = consulta.limit(limite);
      const resultado = await consulta.get();
      return resultado.docs.map(d => ({ id: d.id, existe: true, dados: d.data(), versao: d.versao }));
    } catch (erro) {
      return converterErroBanco(erro);
    }
  }

  /** Aplica as escritas de uma vez (lote ou commit de transação do navegador). */
  async gravar(ctx: ContextoAcesso, pedido: PedidoGravacao): Promise<void> {
    const escritas = pedido?.escritas;
    const leituras = pedido?.leituras ?? [];
    if (!Array.isArray(escritas) || !escritas.length || escritas.length > LIMITE_ESCRITAS || !Array.isArray(leituras) || leituras.length > LIMITE_ESCRITAS) {
      throw invalido('Gravação inválida.');
    }
    for (const leitura of leituras) {
      separarCaminho(leitura?.caminho);
      if (leitura.versao !== null && typeof leitura.versao !== 'string') throw invalido('Versão de leitura inválida.');
    }
    // Validação e cópia dos dados antes de abrir a transação.
    const preparadas: { colecao: ColecaoNavegador; id: string; caminho: string; tipo: EscritaNavegador['tipo']; merge: boolean; dados: Objeto; campos?: AlteracaoCampo[] }[] = escritas.map(escrita => {
      const destino = separarCaminho(escrita?.caminho);
      if (!['set', 'update', 'delete'].includes(escrita.tipo)) throw invalido('Tipo de gravação inválido.');
      if (escrita.tipo === 'delete') return { ...destino, caminho: escrita.caminho, tipo: escrita.tipo, merge: false, dados: {} as Objeto };
      const permitirRemocao = escrita.tipo === 'update' || escrita.merge === true;
      try {
        if (escrita.tipo === 'update' && escrita.campos !== undefined) {
          return { ...destino, caminho: escrita.caminho, tipo: escrita.tipo, merge: false, dados: {} as Objeto,
            campos: prepararCampos(escrita.campos) };
        }
        return { ...destino, caminho: escrita.caminho, tipo: escrita.tipo, merge: escrita.merge === true,
          dados: normalizarDocumento(decodificar(escrita.dados) as DadosDocumento, permitirRemocao) };
      } catch (erro) {
        return converterErroBanco(erro);
      }
    });

    const caminhos = [...new Set([...leituras.map(l => l.caminho), ...preparadas.map(e => e.caminho)])];
    try {
      await this.db.runTransaction(async tx => {
        const instantaneos = await Promise.all(caminhos.map(c => tx.get(this.db.doc(c))));
        const atuais = new Map(caminhos.map((c, i) => [c, instantaneos[i]]));
        for (const leitura of leituras) {
          if ((atuais.get(leitura.caminho)!.versao ?? null) !== leitura.versao) {
            throw new ErroAcessoDados(409, 'aborted', 'Os dados foram alterados por outra pessoa. Tente novamente.');
          }
        }
        const estado = new Map<string, Objeto | undefined>(caminhos.map(c => [c, atuais.get(c)!.data()]));
        const alterados = new Set<string>();
        for (const escrita of preparadas) {
          const antes = estado.get(escrita.caminho);
          let depois: Objeto | undefined;
          if (escrita.tipo === 'delete') depois = undefined;
          else if (escrita.tipo === 'update') {
            if (!antes) throw new ErroAcessoDados(404, 'not-found', 'O registro não existe mais. Atualize a tela.');
            depois = escrita.campos ? atualizarCampos(antes, escrita.campos) : atualizar(antes, escrita.dados);
          } else depois = escrita.merge ? mesclar(antes ?? {}, escrita.dados) : escrita.dados;
          const operacao: OperacaoGravacao = escrita.tipo === 'delete' ? 'delete' : antes ? 'update' : 'create';
          // Permissão antes de tudo, inclusive ao excluir o que não existe: não revela quais ids existem.
          if (!podeGravar(ctx, escrita.colecao, escrita.id, operacao, antes, depois)) throw negado();
          if (operacao === 'delete' && !antes) continue;
          estado.set(escrita.caminho, depois);
          alterados.add(escrita.caminho);
        }
        for (const caminho of alterados) {
          const final = estado.get(caminho);
          if (final === undefined) tx.delete(this.db.doc(caminho));
          else tx.set(this.db.doc(caminho), final);
        }
      });
    } catch (erro) {
      if (erro instanceof ErroAcessoDados) throw erro;
      return converterErroBanco(erro);
    }
  }
}
