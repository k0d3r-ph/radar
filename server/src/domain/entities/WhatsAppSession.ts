export type ConnectionStatus = 'disconnected' | 'qrcode' | 'authenticating' | 'connected';

export interface WhatsAppUserInfo {
  name: string;
  number: string;
}

export class WhatsAppSession {
  constructor(
    public status: ConnectionStatus,
    public qrCode?: string,
    public userInfo?: WhatsAppUserInfo
  ) {}
}
