import { Request, Response } from 'express';
import { SendMediaMessage } from '../../application/use-cases/SendMediaMessage.js';
import { DisconnectClient } from '../../application/use-cases/DisconnectClient.js';
import { GetConnectionStatus } from '../../application/use-cases/GetConnectionStatus.js';

export class WhatsAppController {
  constructor(
    private sendMediaMessageUseCase: SendMediaMessage,
    private disconnectClientUseCase: DisconnectClient,
    private getConnectionStatusUseCase: GetConnectionStatus
  ) {}

  async send(req: Request, res: Response): Promise<void> {
    const { to, message, imageBase64, filename } = req.body;

    if (typeof to !== 'string' || !to.trim() || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ success: false, error: 'Parâmetros "to" e "message" são obrigatórios.' });
      return;
    }

    // Checagem síncrona (sem custo, não passa pelo Puppeteer): se a sessão não
    // está conectada, o envio nem seria tentado — então respondemos o erro na
    // hora, em vez de aceitar com 202 e deixar o frontend marcar "enviado"
    // para uma mensagem que nunca sairá. Ver sendMessage() em WhatsAppWebClient,
    // que lança esse mesmo erro internamente quando desconectado.
    const session = this.getConnectionStatusUseCase.execute();
    if (session.status !== 'connected') {
      res.status(503).json({
        success: false,
        error: 'WhatsApp desconectado — não há sessão ativa.',
      });
      return;
    }

    // Só confirma após o WhatsApp Web concluir o envio. Aceitar a requisição
    // não confirma envio nem entrega no aparelho do destinatário.
    try {
      const enviado = await this.sendMediaMessageUseCase.execute({ to, message, imageBase64, filename });
      if (!enviado) throw new Error('O WhatsApp não confirmou o envio da mensagem.');
      res.status(200).json({ success: true, message: 'Mensagem enviada.' });
    } catch (error: unknown) {
      res.status(502).json({
        success: false,
        error: error instanceof Error ? error.message : 'Falha ao enviar mensagem pelo WhatsApp.',
      });
    }
  }

  async status(req: Request, res: Response): Promise<void> {
    try {
      const session = this.getConnectionStatusUseCase.execute();
      res.status(200).json({ success: true, session });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Erro ao obter status da conexão.' });
    }
  }

  async disconnect(req: Request, res: Response): Promise<void> {
    try {
      await this.disconnectClientUseCase.execute();
      res.status(200).json({ success: true, message: 'WhatsApp desconectado com sucesso.' });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Erro ao desconectar WhatsApp.' });
    }
  }
}
