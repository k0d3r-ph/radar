import { IWhatsAppService } from '../../domain/interfaces/IWhatsAppService.js';

export interface SendMediaMessageInput {
  to: string;
  message: string;
  imageBase64?: string;
  filename?: string;
}

export class SendMediaMessage {
  constructor(private whatsappService: IWhatsAppService) {}

  async execute(input: SendMediaMessageInput): Promise<boolean> {
    if (!input.to) {
      throw new Error('O número de destino (to) é obrigatório.');
    }
    if (!input.message) {
      throw new Error('A mensagem é obrigatória.');
    }
    return await this.whatsappService.enqueueMessage(
      input.to,
      input.message,
      input.imageBase64,
      input.filename
    );
  }
}
