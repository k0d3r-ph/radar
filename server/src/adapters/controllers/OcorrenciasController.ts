import type { Request, Response } from 'express';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { FavoritoError, SetOcorrenciaFavorita } from '../../application/use-cases/SetOcorrenciaFavorita.js';

export class OcorrenciasController {
  constructor(private readonly db: Firestore | null, private readonly auth: Auth | null) {}

  async definirFavorita(req: Request, res: Response): Promise<void> {
    if (!this.db || !this.auth) { res.status(503).json({ error: 'Serviço de ocorrências indisponível.' }); return; }
    const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) { res.status(401).json({ error: 'Entre no Radar para alterar as estrelas.' }); return; }
    let uid: string;
    try { uid = (await this.auth.verifyIdToken(token, true)).uid; }
    catch { res.status(401).json({ error: 'Sessão expirada. Entre novamente no Radar.' }); return; }
    if (typeof req.body?.favorita !== 'boolean' || !req.params.id || req.params.id.includes('/')) {
      res.status(400).json({ error: 'Informe a ocorrência e a marcação da estrela.' }); return;
    }
    try {
      const usuario = await this.db.collection('usuarios').doc(uid).get();
      const dados = await new SetOcorrenciaFavorita(this.db).execute(req.params.id, req.body.favorita, uid, usuario.data()?.role || '');
      res.status(200).json(dados);
    } catch (error) {
      if (error instanceof FavoritoError) res.status(error.status).json({ error: error.message });
      else { console.error('[Ocorrências] Falha ao alterar estrela.'); res.status(500).json({ error: 'Não foi possível alterar a estrela. Tente novamente.' }); }
    }
  }
}
