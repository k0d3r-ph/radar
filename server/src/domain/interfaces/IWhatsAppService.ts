import { WhatsAppSession } from '../entities/WhatsAppSession.js';

export interface IWhatsAppService {
  initialize(): Promise<void>;
  getStatus(): WhatsAppSession;
  disconnect(): Promise<void>;
  sendMessage(to: string, message: string, imageBase64?: string, filename?: string): Promise<boolean>;
  onStatusChange(callback: (session: WhatsAppSession) => void): void;
  takeScreenshot?(): Promise<string | null>;
}
