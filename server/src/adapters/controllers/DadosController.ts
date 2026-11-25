import type { Request, Response } from 'express';
import type { Auth } from 'firebase-admin/auth';
import type { BancoDocumentos } from '../../domain/interfaces/BancoDocumentos.js';
import type { ContextoAcesso } from '../../domain/regrasAcessoDados.js';
import { AcessarDadosNavegador, ErroAcessoDados } from '../../application/use-cases/AcessarDadosNavegador.js';
import { extrairToken } from '../middlewares/autenticacaoRadar.js';

/**
 * Rotas /api/dados: leitura, consulta e gravação dos dados usados pelas telas, no lugar do acesso
 * direto do navegador ao Firestore. O token do Firebase Auth identifica o usuário; o cadastro é
 * lido a cada requisição, então inativar um usuário corta o acesso imediatamente.
 */
export class DadosController {
  private readonly dados: AcessarDadosNavegador | null;

  constructor(private readonly db: BancoDocumentos | null, private readonly auth: Auth | null) {
    this.dados = db ? new AcessarDadosNavegador(db) : null;
  }

  /** Valida o acesso e devolve o caso de uso junto com o contexto (antes de qualquer uso de `this.dados`). */
  private async contexto(req: Request): Promise<{ ctx: ContextoAcesso; dados: AcessarDadosNavegador }> {
    if (!this.auth || !this.db || !this.dados) throw new ErroAcessoDados(503, 'unavailable', 'Dados indisponíveis no servidor.');
    const token = extrairToken(req.headers.authorization);
    if (!token) throw new ErroAcessoDados(401, 'unauthenticated', 'Entre novamente no Radar.');
    let uid: string, email: string | undefined;
    try { ({ uid, email } = await this.auth.verifyIdToken(token, true)); }
    catch { throw new ErroAcessoDados(401, 'unauthenticated', 'Entre novamente no Radar.'); }
    const cadastro = (await this.db.collection('usuarios').doc(uid).get()).data();
    return { ctx: { uid, email, cadastro }, dados: this.dados };
  }

  private async responder(res: Response, acao: () => Promise<unknown>): Promise<void> {
    res.set('Cache-Control', 'no-store');
    try {
      res.json(await acao());
    } catch (erro) {
      if (erro instanceof ErroAcessoDados) {
        res.status(erro.status).json({ error: erro.message, code: erro.codigo });
        return;
      }
      console.error('[Dados] Falha ao acessar o banco:', erro instanceof Error ? erro.message : 'erro desconhecido');
      res.status(503).json({ error: 'Não foi possível acessar os dados. Tente novamente.', code: 'unavailable' });
    }
  }

  ler(req: Request, res: Response) {
    return this.responder(res, async () => {
      const { ctx, dados } = await this.contexto(req);
      return dados.ler(ctx, `${req.params.colecao}/${req.params.id}`);
    });
  }

  consultar(req: Request, res: Response) {
    return this.responder(res, async () => {
      const { ctx, dados } = await this.contexto(req);
      return { documentos: await dados.consultar(ctx, req.params.colecao, req.body ?? {}) };
    });
  }

  gravar(req: Request, res: Response) {
    return this.responder(res, async () => {
      const { ctx, dados } = await this.contexto(req);
      await dados.gravar(ctx, req.body);
      return { ok: true };
    });
  }
}
