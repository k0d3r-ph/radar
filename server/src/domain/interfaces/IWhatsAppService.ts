import { WhatsAppSession } from '../entities/WhatsAppSession.js';

export interface IWhatsAppService {
  initialize(): Promise<void>;
  getStatus(): WhatsAppSession;
  disconnect(): Promise<void>;
  sendMessage(to: string, message: string, imageBase64?: string, filename?: string): Promise<boolean>;
  enqueueMessage(to: string, message: string, imageBase64?: string, filename?: string): Promise<boolean>;
  getProfilePicUrl(number: string): Promise<string>;
  sendTyping(to: string, durationMs: number): Promise<void>;
  onStatusChange(callback: (session: WhatsAppSession) => void): void;
  takeScreenshot?(): Promise<string | null>;
}
