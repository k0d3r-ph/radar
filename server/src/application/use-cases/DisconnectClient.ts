import { IWhatsAppService } from '../../domain/interfaces/IWhatsAppService.js';

export class DisconnectClient {
  constructor(private whatsappService: IWhatsAppService) {}

  async execute(): Promise<void> {
    await this.whatsappService.disconnect();
  }
}
