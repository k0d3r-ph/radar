import type { Firestore } from 'firebase-admin/firestore';

export const COLECOES_SINCRONIZADAS = ['ocorrencias', 'empresas', 'gamificacao_pontos', 'checklist_tarefas', 'validacao_tentativas'] as const;
export type ColecaoSincronizada = typeof COLECOES_SINCRONIZADAS[number];
type DocumentoIndice = { id: string; versao: string };
type EstadoIndice = {
  documentos: DocumentoIndice[];
  dados: Map<string, Record<string, unknown>>;
  pronto: Promise<void>;
  cancelar: () => void;
  erro?: Error;
  tentarNovamenteEm: number;
};

/** Um listener por coleção/processo, compartilhado por todos os navegadores. */
export class IndiceSincronizacao {
  private readonly indices = new Map<ColecaoSincronizada, EstadoIndice>();

  constructor(private readonly db: Firestore) {}

  async listar(colecao: ColecaoSincronizada): Promise<DocumentoIndice[]> {
    let estado = this.indices.get(colecao);
    if (estado?.erro && Date.now() >= estado.tentarNovamenteEm) {
      estado.cancelar();
      this.indices.delete(colecao);
      estado = undefined;
    }
    if (!estado) {
      let concluir!: () => void;
      let falhar!: (erro: Error) => void;
      estado = {
        documentos: [], dados: new Map(), cancelar: () => {}, tentarNovamenteEm: 0,
        pronto: new Promise<void>((resolve, reject) => { concluir = resolve; falhar = reject; }),
      };
      this.indices.set(colecao, estado);
      const atual = estado;
      const registrarErro = (erro: Error) => {
        atual.erro = erro;
        atual.tentarNovamenteEm = Date.now() + 30_000;
        falhar(erro);
      };
      try {
        atual.cancelar = this.db.collection(colecao).onSnapshot(snapshot => {
          atual.dados = new Map(snapshot.docs.map(d => [d.id, { ...d.data(), id: d.id }]));
          atual.documentos = snapshot.docs.map(documento => ({
            id: documento.id,
            // Detecta gravações sem updatedAt e independe do relógio do navegador.
            versao: `${documento.updateTime.seconds}:${documento.updateTime.nanoseconds}`,
          }));
          concluir();
        }, registrarErro);
      } catch (erro) {
        registrarErro(erro instanceof Error ? erro : new Error('Falha ao iniciar o índice.'));
      }
    }
    await estado.pronto;
    if (estado.erro) throw estado.erro;
    return estado.documentos;
  }

  encerrar(): void {
    for (const estado of this.indices.values()) estado.cancelar();
    this.indices.clear();
  }

  async dados(colecao: ColecaoSincronizada): Promise<Record<string, unknown>[]> {
    await this.listar(colecao);
    return [...this.indices.get(colecao)!.dados.values()];
  }
}
