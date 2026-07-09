import { IWhatsAppService } from '../../domain/interfaces/IWhatsAppService.js';

export class InitializeClient {
  constructor(private whatsappService: IWhatsAppService) {}

  async execute(): Promise<void> {
    await this.whatsappService.initialize();
  }
}
