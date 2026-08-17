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

    if (!to || !message) {
      res.status(400).json({ success: false, error: 'Parâmetros "to" e "message" são obrigatórios.' });
      return;
    }

    // Responde imediatamente — o envio pelo Puppeteer acontece em background.
    // Isso evita que o frontend fique bloqueado aguardando o WhatsApp Web
    // (getNumberId + sendMessage podem levar 10–30 s em VMs com poucos recursos).
    res.status(202).json({ success: true, message: 'Envio iniciado.' });

    this.sendMediaMessageUseCase
      .execute({ to, message, imageBase64, filename })
      .then(() => console.log(`[WhatsApp] Mensagem enviada com sucesso para ${to}.`))
      .catch((err: any) =>
        console.error(`[WhatsApp] Falha ao enviar mensagem para ${to}:`, err?.message || err)
      );
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
