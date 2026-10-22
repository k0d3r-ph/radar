import type { Request, Response } from 'express';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import type { IUsuariosRepository } from '../../domain/interfaces/IUsuariosRepository.js';
import { PontoExcedenteError, RemoverPontoTreinamentoExcedente } from '../../application/use-cases/RemoverPontoTreinamentoExcedente.js';

export class GamificacaoController {
  constructor(
    private readonly db: Firestore | null,
    private readonly auth: Auth | null,
    private readonly usuariosRepo: IUsuariosRepository | null,
  ) {}

  async removerPontoExcedente(req: Request, res: Response): Promise<void> {
    if (!this.db || !this.auth || !this.usuariosRepo) { res.status(503).json({ error: 'Serviço de gamificação indisponível.' }); return; }
    const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) { res.status(401).json({ error: 'Entre no Radar para remover o lançamento.' }); return; }
    let uid: string;
    try { uid = (await this.auth.verifyIdToken(token, true)).uid; }
    catch { res.status(401).json({ error: 'Sessão expirada. Entre novamente no Radar.' }); return; }
    try {
      const usuario = await this.usuariosRepo.buscarPorUid(uid);
      await new RemoverPontoTreinamentoExcedente(this.db).execute(req.params.id, usuario?.role || '');
      res.status(200).json({ sucesso: true });
    } catch (error) {
      if (error instanceof PontoExcedenteError) res.status(error.status).json({ error: error.message });
      else { console.error('[Gamificação] Falha ao remover ponto excedente.'); res.status(500).json({ error: 'Não foi possível remover o lançamento. Tente novamente.' }); }
    }
  }
}
