import type { Request, Response } from 'express';
import { GerenciarUsuarios, GestaoUsuariosError } from '../../application/use-cases/GerenciarUsuarios.js';
import type { UsuarioRadar } from '../middlewares/autenticacaoRadar.js';

/** Rotas de gestão de usuários. A autenticação e o perfil já foram conferidos pelo AutenticadorRadar. */
export class UsuariosController {
  constructor(private readonly gerenciar: GerenciarUsuarios | null) {}

  async criar(req: Request, res: Response): Promise<void> {
    await this.executar(res, 'cadastrar o usuário', async (gerenciar, solicitante) => {
      const { uid } = await gerenciar.criar(solicitante, req.body ?? {});
      res.status(201).json({ success: true, uid });
    });
  }

  async redefinirSenha(req: Request, res: Response): Promise<void> {
    await this.executar(res, 'redefinir a senha', async (gerenciar, solicitante) => {
      await gerenciar.redefinirSenha(solicitante, req.params.uid, req.body?.novaSenha);
      res.json({ success: true });
    });
  }

  async excluir(req: Request, res: Response): Promise<void> {
    await this.executar(res, 'excluir o usuário', async (gerenciar, solicitante) => {
      await gerenciar.excluir(solicitante, req.params.uid);
      res.json({ success: true });
    });
  }

  private async executar(
    res: Response,
    acao: string,
    operacao: (gerenciar: GerenciarUsuarios, solicitante: UsuarioRadar) => Promise<void>,
  ): Promise<void> {
    res.set('Cache-Control', 'no-store');
    if (!this.gerenciar) {
      res.status(503).json({ success: false, error: 'Gestão de usuários indisponível no servidor.' });
      return;
    }
    try {
      await operacao(this.gerenciar, res.locals.usuarioRadar as UsuarioRadar);
    } catch (erro) {
      if (erro instanceof GestaoUsuariosError) {
        res.status(erro.status).json({ success: false, error: erro.message });
        return;
      }
      console.error(`[Usuários] Falha ao ${acao}.`);
      res.status(500).json({ success: false, error: `Não foi possível ${acao}. Tente novamente.` });
    }
  }
}
