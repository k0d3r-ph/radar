import type pg from 'pg';
import { TABELAS_RAIZ } from './colecoes.js';

export const COLECOES_SINCRONIZADAS = ['ocorrencias', 'empresas', 'gamificacao_pontos', 'checklist_tarefas', 'validacao_tentativas'] as const;
export type ColecaoSincronizada = typeof COLECOES_SINCRONIZADAS[number];
type DocumentoIndice = { id: string; versao: string };
type Entrada = { versao: bigint; dados: Record<string, unknown> };
type EstadoIndice = {
  documentos: Map<string, Entrada>;
  /** xmin do último snapshot lido: transações ainda não visíveis naquela leitura têm xid >= este valor. */
  limiteTransacao: string | null;
  atualizadoEm: number;
  carregando?: Promise<void>;
  erro?: Error;
  tentarNovamenteEm: number;
};

export interface OpcoesIndice {
  /** Intervalo mínimo entre consultas ao banco; chamadas dentro dele reutilizam a memória. */
  intervaloMinimoMs?: number;
  /** Espera após uma falha antes de consultar de novo. */
  esperaAposErroMs?: number;
}

const RETENCAO_EXCLUSOES = '30 days';
const INTERVALO_LIMPEZA_MS = 6 * 60 * 60_000;

/**
 * Mantém em memória, por processo, os documentos e versões das coleções sincronizadas.
 * Cada consulta lê só o que mudou desde a anterior (inclusive exclusões), em vez de reler a tabela.
 */
export class IndiceSincronizacao {
  private readonly indices = new Map<ColecaoSincronizada, EstadoIndice>();
  private readonly intervaloMinimoMs: number;
  private readonly esperaAposErroMs: number;
  private ultimaLimpeza = 0;

  constructor(private readonly pool: pg.Pool, opcoes: OpcoesIndice = {}) {
    this.intervaloMinimoMs = opcoes.intervaloMinimoMs ?? 1_000;
    this.esperaAposErroMs = opcoes.esperaAposErroMs ?? 5_000;
  }

  async listar(colecao: ColecaoSincronizada): Promise<DocumentoIndice[]> {
    const estado = await this.atualizar(colecao);
    return [...estado.documentos.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([id, entrada]) => ({ id, versao: entrada.versao.toString() }));
  }

  async dados(colecao: ColecaoSincronizada): Promise<Record<string, unknown>[]> {
    const estado = await this.atualizar(colecao);
    return [...estado.documentos.entries()].map(([id, entrada]) => ({ ...entrada.dados, id }));
  }

  encerrar(): void {
    this.indices.clear();
  }

  private async atualizar(colecao: ColecaoSincronizada): Promise<EstadoIndice> {
    let estado = this.indices.get(colecao);
    if (!estado) {
      estado = { documentos: new Map(), limiteTransacao: null, atualizadoEm: 0, tentarNovamenteEm: 0 };
      this.indices.set(colecao, estado);
    }
    const atual = estado;
    if (atual.carregando) { await atual.carregando; return this.verificar(atual); }
    const agora = Date.now();
    // Depois de uma falha não serve dados possivelmente desatualizados nem insiste a cada requisição.
    if (atual.erro && agora < atual.tentarNovamenteEm) throw atual.erro;
    if (!atual.erro && atual.limiteTransacao !== null && agora - atual.atualizadoEm < this.intervaloMinimoMs) return atual;

    atual.carregando = this.buscarMudancas(colecao, atual)
      .then(() => { atual.erro = undefined; atual.atualizadoEm = Date.now(); })
      .catch((erro: unknown) => {
        atual.erro = erro instanceof Error ? erro : new Error('Falha ao atualizar o índice.');
        atual.tentarNovamenteEm = Date.now() + this.esperaAposErroMs;
      })
      .finally(() => { atual.carregando = undefined; });
    await atual.carregando;
    void this.limparExclusoesAntigas();
    return this.verificar(atual);
  }

  private verificar(estado: EstadoIndice): EstadoIndice {
    if (estado.erro) throw estado.erro;
    return estado;
  }

  private async buscarMudancas(colecao: ColecaoSincronizada, estado: EstadoIndice): Promise<void> {
    const tabela = TABELAS_RAIZ[colecao];
    const cliente = await this.pool.connect();
    try {
      // Mesmo snapshot para o xmin e as duas consultas.
      await cliente.query('begin isolation level repeatable read read only');
      const { rows: [{ xmin }] } = await cliente.query<{ xmin: string }>('select pg_snapshot_xmin(pg_current_snapshot())::text as xmin');
      const desde = estado.limiteTransacao;
      const { rows: documentos } = await cliente.query<{ id: string; dados: Record<string, unknown>; versao: string }>(
        desde === null
          ? `select id, dados, versao from ${tabela}`
          : `select id, dados, versao from ${tabela} where transacao >= $1::xid8`,
        desde === null ? [] : [desde],
      );
      const { rows: exclusoes } = desde === null ? { rows: [] as { chave: string; versao: string }[] }
        : await cliente.query<{ chave: string; versao: string }>(
          'select chave, versao from radar_exclusoes where tabela = $1 and transacao >= $2::xid8', [tabela, desde]);
      await cliente.query('commit');

      for (const documento of documentos) {
        estado.documentos.set(documento.id, { versao: BigInt(documento.versao), dados: documento.dados });
      }
      // Só remove se a exclusão for posterior à versão conhecida (o documento pode ter sido recriado).
      for (const exclusao of exclusoes) {
        const conhecido = estado.documentos.get(exclusao.chave);
        if (conhecido && conhecido.versao < BigInt(exclusao.versao)) estado.documentos.delete(exclusao.chave);
      }
      estado.limiteTransacao = xmin;
    } catch (erro) {
      await cliente.query('rollback').catch(() => undefined);
      throw erro;
    } finally {
      cliente.release();
    }
  }

  /** O registro de exclusões só precisa cobrir o intervalo entre duas leituras do índice. */
  private async limparExclusoesAntigas(): Promise<void> {
    const agora = Date.now();
    if (agora - this.ultimaLimpeza < INTERVALO_LIMPEZA_MS) return;
    this.ultimaLimpeza = agora;
    try {
      await this.pool.query(`delete from radar_exclusoes where excluido_em < now() - interval '${RETENCAO_EXCLUSOES}'`);
    } catch {
      console.error('[Sincronização] Não foi possível limpar o registro de exclusões antigas.');
    }
  }
}
