import type { Request, Response } from 'express';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import type { IUsuariosRepository } from '../../domain/interfaces/IUsuariosRepository.js';
import { ExcluirTarefaConcluida, ExclusaoTarefaError } from '../../application/use-cases/ExcluirTarefaConcluida.js';

export class ChecklistController {
  constructor(private readonly db: Firestore | null, private readonly auth: Auth | null, private readonly usuarios: IUsuariosRepository | null) {}

  async excluirConcluida(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    if (!this.db || !this.auth || !this.usuarios) { res.status(503).json({ error: 'Serviço de tarefas indisponível.' }); return; }
    const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    let uid: string;
    try { uid = (await this.auth.verifyIdToken(token || '', true)).uid; }
    catch { res.status(401).json({ error: 'Entre novamente no Radar para excluir a tarefa.' }); return; }
    try {
      const usuario = await this.usuarios.buscarPorUid(uid);
      if (!usuario || usuario.inativo || usuario.needsPasswordChange || !['master', 'treinador', 'suporte', 'hardware', 'comercial', 'financeiro', 'cs', 'crc', 'painel'].includes(usuario.role)) {
        res.status(403).json({ error: 'Seu usuário não tem permissão para excluir tarefas.' }); return;
      }
      await new ExcluirTarefaConcluida(this.db).execute(req.params.id, uid, usuario.role === 'master');
      res.json({ sucesso: true });
    } catch (error) {
      if (error instanceof ExclusaoTarefaError) res.status(error.status).json({ error: error.message });
      else { console.error('[Checklist] Falha ao excluir tarefa concluída.'); res.status(500).json({ error: 'Não foi possível excluir a tarefa. Tente novamente.' }); }
    }
  }
}
