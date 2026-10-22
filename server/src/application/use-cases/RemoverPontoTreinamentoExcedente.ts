import type { Firestore } from 'firebase-admin/firestore';

export class PontoExcedenteError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export class RemoverPontoTreinamentoExcedente {
  constructor(private readonly db: Firestore) {}

  async execute(id: string, role: string): Promise<void> {
    if (role !== 'master') throw new PontoExcedenteError(403, 'Somente masters podem remover pontos excedentes de treinamento.');
    if (!id || id.includes('/')) throw new PontoExcedenteError(400, 'Informe um lançamento válido.');
    const ref = this.db.collection('gamificacao_pontos').doc(id);
    await this.db.runTransaction(async tx => {
      const ponto = await tx.get(ref);
      if (!ponto.exists) return; // Repetir a exclusão é seguro.
      if (ponto.data()!.tipoAcao !== 'treinamento') {
        throw new PontoExcedenteError(400, 'Esta ação remove apenas pontos excedentes de treinamento.');
      }
      // O vínculo oficial parte da ocorrência/reserva. Pontos duplicados podem
      // conter ocorrenciaId mesmo sem serem o lançamento usado pelo treinamento.
      const [ocorrencias, reservas] = await Promise.all([
        tx.get(this.db.collection('ocorrencias').where('gamificacaoPontoId', '==', id).limit(1)),
        tx.get(this.db.collection('csatReservas').where('gamificacaoPontoId', '==', id).limit(1)),
      ]);
      if (!ocorrencias.empty || !reservas.empty) {
        throw new PontoExcedenteError(409, 'Este ponto está vinculado a um treinamento ou reserva CSAT e não pode ser removido por aqui. Atualize a tela.');
      }
      tx.delete(ref);
    });
  }
}
