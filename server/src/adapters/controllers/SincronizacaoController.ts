import type { Request, Response } from 'express';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { COLECOES_SINCRONIZADAS, IndiceSincronizacao, type ColecaoSincronizada } from '../../infrastructure/firebase/IndiceSincronizacao.js';

export class SincronizacaoController {
  private readonly indice: IndiceSincronizacao | null;

  constructor(private readonly db: Firestore | null, private readonly auth: Auth | null) {
    this.indice = db ? new IndiceSincronizacao(db) : null;
  }

  async listar(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    if (!this.db || !this.auth || !this.indice) {
      res.status(503).json({ error: 'Sincronização indisponível.' }); return;
    }
    const colecao = req.params.colecao as ColecaoSincronizada;
    if (!COLECOES_SINCRONIZADAS.includes(colecao)) {
      res.status(400).json({ error: 'Coleção inválida.' }); return;
    }
    const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) { res.status(401).json({ error: 'Entre novamente no Radar.' }); return; }
    let uid: string;
    try { uid = (await this.auth.verifyIdToken(token || '', true)).uid; }
    catch { res.status(401).json({ error: 'Entre novamente no Radar.' }); return; }
    try {
      const usuario = (await this.db.collection('usuarios').doc(uid).get()).data();
      if (!usuario || usuario.needsPasswordChange
        || !['master', 'treinador', 'suporte', 'hardware', 'comercial', 'financeiro', 'cs', 'crc', 'painel'].includes(usuario.role)) {
        res.status(403).json({ error: 'Usuário sem acesso ao Radar.' }); return;
      }
      if (colecao === 'gamificacao_pontos' && !['master', 'treinador'].includes(usuario.role)) {
        res.status(403).json({ error: 'Usuário sem acesso à gamificação.' }); return;
      }
      // Somente IDs/versões: os dados seguem sendo lidos pelo SDK do navegador
      // sob as regras do Firestore e permissões de cada usuário.
      res.json({ documentos: await this.indice.listar(colecao) });
    } catch {
      res.status(503).json({ error: 'Não foi possível sincronizar os dados. Tente novamente.' });
    }
  }
}
