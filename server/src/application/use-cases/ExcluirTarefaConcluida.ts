import type { Firestore } from 'firebase-admin/firestore';

export class ExclusaoTarefaError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export class ExcluirTarefaConcluida {
  constructor(private readonly db: Firestore) {}

  async execute(id: string, uid: string, master: boolean) {
    if (!id || id.includes('/') || id.length > 1500) throw new ExclusaoTarefaError(400, 'Informe uma tarefa válida.');
    const ref = this.db.collection('checklist_tarefas').doc(id);
    await this.db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) throw new ExclusaoTarefaError(404, 'Tarefa não encontrada. Atualize a lista.');
      const tarefa = snapshot.data()!;
      if (!master && tarefa.treinadorId !== uid) throw new ExclusaoTarefaError(403, 'Você só pode excluir suas próprias tarefas.');
      if (tarefa.excluida) return;
      if (tarefa.concluida !== true) throw new ExclusaoTarefaError(409, 'A tarefa não está concluída. Atualize a lista antes de excluir.');
      const agora = Date.now();
      // Mantém o ID do ciclo para que o gerador não recrie a tarefa automática.
      tx.update(ref, { excluida: true, excluidaEm: agora, excluidaPorId: uid, updatedAt: agora });
    });
  }
}
