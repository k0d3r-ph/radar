import type { Request, Response } from 'express';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { GerenciarValidacaoConhecimento } from '../../application/use-cases/GerenciarValidacaoConhecimento.js';
import type { UsuarioValidacao } from '../../application/use-cases/GerenciarValidacaoConhecimento.js';
import { CsatError } from '../../infrastructure/web/csat.js';

export class ValidacaoConhecimentoController {
  private readonly repo: GerenciarValidacaoConhecimento | null;
  constructor(private readonly db: Firestore | null, private readonly auth: Auth | null) { this.repo = db ? new GerenciarValidacaoConhecimento(db) : null; }
  executar = (acao: 'perguntas' | 'adicionar' | 'atualizarPergunta' | 'indicadores' | 'listar' | 'iniciar' | 'salvar' | 'concluir' | 'cancelar') => async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!this.db || !this.auth || !this.repo) throw new CsatError(503, 'Validação indisponível.');
      const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
      let uid: string;
      try { uid = (await this.auth.verifyIdToken(token || '', true)).uid; } catch { throw new CsatError(401, 'Entre novamente no Radar.'); }
      const cadastro = (await this.db.collection('usuarios').doc(uid).get()).data();
      if (!cadastro || cadastro.inativo || cadastro.needsPasswordChange || !['master', 'treinador'].includes(cadastro.role)) throw new CsatError(403, 'Somente Master e treinadores podem acessar a validação.');
      const user: UsuarioValidacao = { uid, nome: String(cadastro.nome || 'Treinamento'), role: cadastro.role };
      const body: Record<string, unknown> = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      let result: unknown;
      switch (acao) {
        case 'perguntas': result = await this.repo.perguntas(); break;
        case 'adicionar': result = await this.repo.adicionarPergunta(body, user); break;
        case 'atualizarPergunta': result = await this.repo.atualizarPergunta(req.params.id, body, user); break;
        case 'indicadores': result = await this.repo.indicadores(req.query.inicio, req.query.fim); break;
        case 'listar': result = await this.repo.listar(String(req.query.empresaId || '')); break;
        case 'iniciar': result = await this.repo.iniciar(body, user); break;
        case 'salvar': result = await this.repo.salvar(req.params.id, body, user); break;
        case 'concluir': result = await this.repo.concluir(req.params.id, body.revisao, user); break;
        case 'cancelar': result = await this.repo.cancelar(req.params.id, body.revisao, user); break;
      }
      res.json(result);
    } catch (error) {
      if (error instanceof CsatError) res.status(error.status).json({ error: error.message });
      else { console.error('[Validação] Falha na operação.', error instanceof Error ? error.message : 'Erro desconhecido'); res.status(500).json({ error: 'Não foi possível salvar ou carregar a validação. Seus dados foram preservados; tente novamente.' }); }
    }
  };
}
