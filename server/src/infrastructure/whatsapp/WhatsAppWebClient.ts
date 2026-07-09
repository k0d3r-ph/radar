import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode';
import { IWhatsAppService } from '../../domain/interfaces/IWhatsAppService.js';
import { WhatsAppSession, ConnectionStatus } from '../../domain/entities/WhatsAppSession.js';

const { Client, LocalAuth, MessageMedia } = pkg;

export class WhatsAppWebClient implements IWhatsAppService {
  private client: any = null;
  private session: WhatsAppSession;
  private statusCallback: ((session: WhatsAppSession) => void) | null = null;
  private initializingPromise: Promise<void> | null = null;

  constructor() {
    this.session = new WhatsAppSession('disconnected');
  }

  onStatusChange(callback: (session: WhatsAppSession) => void): void {
    this.statusCallback = callback;
    // Dispara imediatamente o status atual para o novo listener
    callback(this.session);
  }

  private updateStatus(status: ConnectionStatus, qrCode?: string, userInfo?: { name: string; number: string }) {
    this.session = new WhatsAppSession(status, qrCode, userInfo);
    if (this.statusCallback) {
      this.statusCallback(this.session);
    }
  }

  getStatus(): WhatsAppSession {
    return this.session;
  }

  async initialize(): Promise<void> {
    if (this.client) {
      console.log('Cliente WhatsApp já instanciado. Status atual:', this.session.status);
      return;
    }

    if (this.initializingPromise) {
      return this.initializingPromise;
    }

    this.initializingPromise = (async () => {
      try {
        console.log('Iniciando instância do cliente WhatsApp...');
        this.updateStatus('authenticating');

        this.client = new Client({
          authStrategy: new LocalAuth({
            clientId: 'radar-whatsapp-session',
            dataPath: './.wwebjs_auth'
          }),
          webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html',
            strict: false
          },
          puppeteer: {
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-accelerated-2d-canvas',
              '--no-first-run',
              '--no-zygote',
              '--disable-gpu'
            ],
            // Em ambientes Windows, o puppeteer geralmente encontra a instalação local
          }
        });

        this.client.on('qr', async (qr: string) => {
          console.log('QR Code recebido. Convertendo para Base64...');
          try {
            const qrCodeBase64 = await qrcode.toDataURL(qr);
            this.updateStatus('qrcode', qrCodeBase64);
          } catch (err) {
            console.error('Erro ao gerar imagem base64 do QR Code:', err);
            this.updateStatus('disconnected');
          }
        });

        this.client.on('authenticated', () => {
          console.log('Cliente autenticado com sucesso!');
          this.updateStatus('authenticating');
        });

        this.client.on('auth_failure', (msg: any) => {
          console.error('Falha na autenticação do WhatsApp Web:', msg);
          this.updateStatus('disconnected');
          this.client = null;
          this.initializingPromise = null;
        });

        this.client.on('ready', () => {
          console.log('WhatsApp Web está pronto!');
          const name = this.client.info.pushname || 'Radar CRM';
          const number = this.client.info.wid.user || '';
          this.updateStatus('connected', undefined, { name, number });
        });

        this.client.on('disconnected', (reason: any) => {
          console.log('Cliente desconectado do WhatsApp Web. Razão:', reason);
          this.updateStatus('disconnected');
          try {
            this.client.destroy();
          } catch (e) {
            // Ignora erros ao fechar
          }
          this.client = null;
          this.initializingPromise = null;
        });

        await this.client.initialize();
      } catch (error) {
        console.error('Erro crítico na inicialização do WhatsApp Web:', error);
        this.updateStatus('disconnected');
        this.client = null;
        this.initializingPromise = null;
        throw error;
      }
    })();

    return this.initializingPromise;
  }

  async disconnect(): Promise<void> {
    if (!this.client) {
      console.log('Nenhum cliente ativo para desconectar.');
      this.updateStatus('disconnected');
      return;
    }

    console.log('Desconectando e limpando sessão do WhatsApp...');
    try {
      this.updateStatus('authenticating');
      await this.client.logout();
      await this.client.destroy();
    } catch (error) {
      console.error('Erro ao realizar logout/destroy do cliente WhatsApp:', error);
      // Força a destruição se falhar
      try {
        await this.client.destroy();
      } catch (e) {}
    } finally {
      this.client = null;
      this.initializingPromise = null;
      this.updateStatus('disconnected');
    }
  }

  async sendMessage(to: string, message: string, imageBase64?: string, filename?: string): Promise<boolean> {
    if (this.session.status !== 'connected' || !this.client) {
      throw new Error('Não há uma sessão conectada ativa no WhatsApp.');
    }

    try {
      // Limpa e formata o telefone
      let cleanNumber = to.replace(/\D/g, '');
      if (cleanNumber.length === 10 || cleanNumber.length === 11) {
        // Assume Brasil e adiciona DDI 55
        cleanNumber = '55' + cleanNumber;
      }
      
      const chatId = `${cleanNumber}@c.us`;
      console.log(`Enviando mensagem para: ${chatId}`);

      if (imageBase64) {
        // Trata formato base64 com ou sem prefixo MIME
        let base64Data = imageBase64;
        let mimeType = 'image/png';
        
        if (imageBase64.includes(';base64,')) {
          const parts = imageBase64.split(';base64,');
          const mimePart = parts[0];
          mimeType = mimePart.replace('data:', '');
          base64Data = parts[1];
        }

        const media = new MessageMedia(mimeType, base64Data, filename || 'esteira.png');
        await this.client.sendMessage(chatId, media, { caption: message });
        console.log('Mensagem com imagem enviada com sucesso!');
      } else {
        await this.client.sendMessage(chatId, message);
        console.log('Mensagem de texto enviada com sucesso!');
      }

      return true;
    } catch (error) {
      console.error('Erro ao enviar mensagem pelo WhatsApp:', error);
      throw error;
    }
  }

  async takeScreenshot(): Promise<string | null> {
    if (this.client && this.client.pupPage) {
      try {
        const screenshot = await this.client.pupPage.screenshot({ encoding: 'base64' });
        return screenshot;
      } catch (err) {
        console.error('Erro ao tirar screenshot do Puppeteer:', err);
        return null;
      }
    }
    return null;
  }
}
