import type { Request, Response } from 'express';
import type { ChatWhatsApp } from '../../application/use-cases/ChatWhatsApp.js';
import type { CursorMensagemChat } from '../../domain/interfaces/RepositorioChatWhatsApp.js';
import { ErroChatWhatsApp } from '../../domain/whatsappChat.js';
import type { UsuarioRadar } from '../middlewares/autenticacaoRadar.js';

/** Nome de quem enviou pelo Radar, a partir do cadastro em `usuarios`. */
export type BuscarNomeUsuario = (uid: string) => Promise<string | null>;

function responderErro(res: Response, erro: unknown, padrao: string): void {
  if (erro instanceof ErroChatWhatsApp) {
    res.status(erro.status).json({ success: false, error: erro.message });
    return;
  }
  console.error(`[Chat WhatsApp] ${padrao}`, erro);
  res.status(500).json({ success: false, error: erro instanceof Error && erro.message ? erro.message : padrao });
}

function lerCursor(req: Request): CursorMensagemChat | undefined {
  const enviadaEm = Number(req.query.antesEm);
  const id = typeof req.query.antesId === 'string' ? req.query.antesId : '';
  return Number.isFinite(enviadaEm) && enviadaEm > 0 && id ? { enviadaEm, id } : undefined;
}

/** Rotas do chat (ver server/WHATSAPP_CHAT.md). Exigem master ou treinador. */
export class ChatWhatsAppController {
  constructor(private readonly chat: ChatWhatsApp, private readonly buscarNome: BuscarNomeUsuario) {}

  async conversas(req: Request, res: Response): Promise<void> {
    try {
      const conversas = await this.chat.listarConversas({ recarregarVinculos: req.query.recarregar === '1' });
      res.json({ success: true, conversas });
    } catch (erro) {
      responderErro(res, erro, 'Não foi possível carregar as conversas.');
    }
  }

  async mensagens(req: Request, res: Response): Promise<void> {
    try {
      const mensagens = await this.chat.listarMensagens(req.params.id, lerCursor(req));
      res.json({ success: true, mensagens });
    } catch (erro) {
      responderErro(res, erro, 'Não foi possível carregar as mensagens.');
    }
  }

  async enviar(req: Request, res: Response): Promise<void> {
    try {
      const usuario = res.locals.usuarioRadar as UsuarioRadar;
      const nome = await this.buscarNome(usuario.uid).catch(() => null);
      const mensagem = await this.chat.enviar(req.params.id, req.body?.texto, { uid: usuario.uid, nome });
      res.json({ success: true, mensagem });
    } catch (erro) {
      responderErro(res, erro, 'Não foi possível enviar a mensagem pelo WhatsApp.');
    }
  }

  async marcarLida(req: Request, res: Response): Promise<void> {
    try {
      const conversa = await this.chat.marcarComoLida(req.params.id);
      res.json({ success: true, conversa });
    } catch (erro) {
      responderErro(res, erro, 'Não foi possível marcar a conversa como lida.');
    }
  }
}
