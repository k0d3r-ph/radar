import type { Firestore } from 'firebase-admin/firestore';

export class AtualizacaoValidacaoError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export class AdicionarAtualizacaoValidacao {
  constructor(private readonly db: Firestore) {}

  async execute(id: string, descricao: string, responsavel: string) {
    const ref = this.db.collection('ocorrencias').doc(id);
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new AtualizacaoValidacaoError(404, 'Ocorrência não encontrada.');

      const ocorrencia = snapshot.data()!;
      if (typeof ocorrencia.validacaoTentativaId !== 'string' || !ocorrencia.validacaoTentativaId) {
        throw new AtualizacaoValidacaoError(409, 'Esta ocorrência não pertence à Validação do conhecimento.');
      }

      const atualizacoes = Array.isArray(ocorrencia.atualizacoes) ? ocorrencia.atualizacoes : [];
      const atualizacao = { descricao, updatedAt: Date.now(), responsavel };
      const novasAtualizacoes = [...atualizacoes, atualizacao];
      transaction.update(ref, { atualizacoes: novasAtualizacoes, updatedAt: atualizacao.updatedAt });
      return { atualizacoes: novasAtualizacoes, updatedAt: atualizacao.updatedAt };
    });
  }
}
