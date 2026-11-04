import type { Firestore } from 'firebase-admin/firestore';

const TAMANHO_LOTE = 450; // Abaixo do limite de 500 operações por lote do Firestore.

/** Soft-delete em massa das tarefas concluídas, mesmo efeito de ExcluirTarefaConcluida por item. */
export class LimparTarefasConcluidas {
  private executando = false;
  constructor(private readonly db: Firestore) {}

  async execute(agora = Date.now()): Promise<number> {
    if (this.executando) return 0;
    this.executando = true;
    try {
      const snapshot = await this.db.collection('checklist_tarefas').where('concluida', '==', true).get();
      const pendentes = snapshot.docs.filter(doc => !doc.data().excluida);
      let removidas = 0;
      for (let inicio = 0; inicio < pendentes.length; inicio += TAMANHO_LOTE) {
        const lote = pendentes.slice(inicio, inicio + TAMANHO_LOTE);
        const batch = this.db.batch();
        lote.forEach(doc => batch.update(doc.ref, {
          excluida: true, excluidaEm: agora, excluidaPorId: 'sistema', updatedAt: agora,
        }));
        await batch.commit();
        removidas += lote.length;
      }
      return removidas;
    } finally { this.executando = false; }
  }
}
