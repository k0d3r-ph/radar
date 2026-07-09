import { IWhatsAppService } from '../../domain/interfaces/IWhatsAppService.js';
import { WhatsAppSession } from '../../domain/entities/WhatsAppSession.js';

export class GetConnectionStatus {
  constructor(private whatsappService: IWhatsAppService) {}

  execute(): WhatsAppSession {
    return this.whatsappService.getStatus();
  }
}
