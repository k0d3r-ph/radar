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
    try {
      const { to, message, imageBase64, filename } = req.body;
      const success = await this.sendMediaMessageUseCase.execute({
        to,
        message,
        imageBase64,
        filename
      });

      if (success) {
        res.status(200).json({ success: true, message: 'Mensagem enviada com sucesso.' });
      } else {
        res.status(500).json({ success: false, error: 'Falha ao enviar mensagem.' });
      }
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message || 'Erro ao processar requisição.' });
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
