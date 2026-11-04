import type { Request, Response } from 'express';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { FavoritoError, SetOcorrenciaFavorita } from '../../application/use-cases/SetOcorrenciaFavorita.js';
import { AdicionarAtualizacaoValidacao, AtualizacaoValidacaoError } from '../../application/use-cases/AdicionarAtualizacaoValidacao.js';
import type { IUsuariosRepository } from '../../domain/interfaces/IUsuariosRepository.js';

export class OcorrenciasController {
  constructor(
    private readonly db: Firestore | null,
    private readonly auth: Auth | null,
    private readonly usuariosRepo: IUsuariosRepository | null,
  ) {}

  async definirFavorita(req: Request, res: Response): Promise<void> {
    if (!this.db || !this.auth || !this.usuariosRepo) { res.status(503).json({ error: 'Serviço de ocorrências indisponível.' }); return; }
    const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) { res.status(401).json({ error: 'Entre no Radar para alterar as estrelas.' }); return; }
    let uid: string;
    try { uid = (await this.auth.verifyIdToken(token, true)).uid; }
    catch { res.status(401).json({ error: 'Sessão expirada. Entre novamente no Radar.' }); return; }
    if (typeof req.body?.favorita !== 'boolean' || !req.params.id || req.params.id.includes('/')) {
      res.status(400).json({ error: 'Informe a ocorrência e a marcação da estrela.' }); return;
    }
    try {
      const usuario = await this.usuariosRepo.buscarPorUid(uid);
      const dados = await new SetOcorrenciaFavorita(this.db).execute(req.params.id, req.body.favorita, uid, usuario?.role || '');
      res.status(200).json(dados);
    } catch (error) {
      if (error instanceof FavoritoError) res.status(error.status).json({ error: error.message });
      else { console.error('[Ocorrências] Falha ao alterar estrela.'); res.status(500).json({ error: 'Não foi possível alterar a estrela. Tente novamente.' }); }
    }
  }

  async adicionarAtualizacaoValidacao(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    if (!this.db || !this.auth || !this.usuariosRepo) { res.status(503).json({ error: 'Serviço de ocorrências indisponível.' }); return; }
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) { res.status(401).json({ error: 'Entre no Radar para registrar uma atualização.' }); return; }
    let uid: string;
    try { uid = (await this.auth.verifyIdToken(token, true)).uid; }
    catch { res.status(401).json({ error: 'Sessão expirada. Entre novamente no Radar.' }); return; }
    const { id } = req.params;
    const descricao = typeof req.body?.descricao === 'string' ? req.body.descricao.trim() : '';
    if (!id || id.includes('/') || !descricao || descricao.length > 2000) {
      res.status(400).json({ error: 'Informe uma descrição válida para a atualização (até 2.000 caracteres).' }); return;
    }
    try {
      const usuario = await this.usuariosRepo.buscarPorUid(uid);
      if (!usuario || usuario.inativo || usuario.needsPasswordChange || !['master', 'treinador'].includes(usuario.role)) {
        res.status(403).json({ error: 'Apenas treinadores e masters podem registrar atualizações nesta ocorrência.' }); return;
      }
      const resultado = await new AdicionarAtualizacaoValidacao(this.db).execute(
        id,
        descricao,
        typeof usuario.nome === 'string' && usuario.nome.trim() ? usuario.nome.trim() : uid,
      );
      res.status(200).json(resultado);
    } catch (error) {
      if (error instanceof AtualizacaoValidacaoError) res.status(error.status).json({ error: error.message });
      else { console.error('[Ocorrências] Falha ao registrar atualização de validação.'); res.status(500).json({ error: 'Não foi possível registrar a atualização. Tente novamente.' }); }
    }
  }
}
