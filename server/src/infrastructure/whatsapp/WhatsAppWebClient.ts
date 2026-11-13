import fs from 'fs';
import path from 'path';
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

  private cleanSingletonLock() {
    const dataPath = process.env.WWEBJS_AUTH_PATH || './.wwebjs_auth';
    const clientId = 'radar-whatsapp-session';
    const sessionDir = path.join(dataPath, `session-${clientId}`);

    // Os arquivos Singleton* são links simbólicos para "<hostname>-<pid>" do processo que os
    // criou. Ao recriar o container, o alvo some e o link fica quebrado: fs.existsSync segue
    // o link e devolve false, então a trava nunca era removida e o Chromium recusava o perfil
    // ("The profile appears to be in use by another Chromium process"). Remove o próprio link.
    for (const fileName of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
      const filePath = path.join(sessionDir, fileName);
      try {
        fs.unlinkSync(filePath);
        console.log(`[WhatsApp] Lock do Chromium removido: ${filePath}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn(`[WhatsApp] Aviso ao tentar limpar ${fileName}:`, error);
        }
      }
    }
  }

  private deleteSessionFolder() {
    try {
      const dataPath = process.env.WWEBJS_AUTH_PATH || './.wwebjs_auth';
      const clientId = 'radar-whatsapp-session';
      const sessionPath = path.join(dataPath, `session-${clientId}`);
      if (fs.existsSync(sessionPath)) {
        console.log(`[WhatsApp] Removendo pasta de sessão do WhatsApp em: ${sessionPath}`);
        fs.rmSync(sessionPath, { recursive: true, force: true });
        console.log('[WhatsApp] Pasta de sessão limpa com sucesso.');
      }
    } catch (error) {
      console.error('[WhatsApp] Erro ao tentar remover pasta de sessão:', error);
    }
  }

  async initialize(): Promise<void> {
    if (this.client) {
      console.log('Cliente WhatsApp já instanciado. Status atual:', this.session.status);
      return;
    }

    if (this.initializingPromise) {
      return this.initializingPromise;
    }

    this.cleanSingletonLock();

    this.initializingPromise = (async () => {
      let initTimeout: NodeJS.Timeout | null = null;
      const clearInitTimeout = () => {
        if (initTimeout) {
          clearTimeout(initTimeout);
          initTimeout = null;
        }
      };

      try {
        console.log('Iniciando instância do cliente WhatsApp...');
        this.updateStatus('authenticating');

        this.client = new Client({
          authStrategy: new LocalAuth({
            clientId: 'radar-whatsapp-session',
            dataPath: process.env.WWEBJS_AUTH_PATH || './.wwebjs_auth'
          }),
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          // VM com poucos recursos: o carregamento do WhatsApp Web pode ser lento.
          // 300s (5 min) para dar margem suficiente sem precisar re-escanear o QR.
          authTimeoutMs: 300000,
          puppeteer: {
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            protocolTimeout: 300000,
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

        // Timeout de segurança para evitar travamento infinito no estado 'authenticating'.
        // Definido como 360s (6 min) — acima do authTimeoutMs de 300s — para que o
        // próprio erro da lib dispare antes deste, evitando descarte prematuro da sessão.
        initTimeout = setTimeout(async () => {
          if (this.session.status === 'authenticating') {
            console.error('[WhatsApp] Timeout de 360s atingido durante a inicialização.');
            this.updateStatus('disconnected');
            if (this.client) {
              try {
                await this.client.destroy();
              } catch (destroyError) {
                console.error('[WhatsApp] Erro ao destruir cliente após timeout:', destroyError);
              }
            }
            this.client = null;
            this.initializingPromise = null;
          }
        }, 360000);

        this.client.on('loading_screen', (percent: any, message: any) => {
          console.log(`[WhatsApp] Carregando: ${percent}% - ${message}`);
        });

        this.client.on('qr', async (qr: string) => {
          clearInitTimeout();
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
          clearInitTimeout();
          console.log('Cliente autenticado com sucesso!');
          this.updateStatus('authenticating');
        });

        this.client.on('auth_failure', async (msg: any) => {
          clearInitTimeout();
          console.error('Falha na autenticação do WhatsApp Web:', msg);
          this.updateStatus('disconnected');
          try {
            await this.client.destroy();
          } catch (e) {
            console.warn('[WhatsApp] Erro ao destruir cliente no auth_failure (pode ser ignorado):', e);
          }
          this.deleteSessionFolder();
          this.client = null;
          this.initializingPromise = null;
        });

        this.client.on('ready', () => {
          clearInitTimeout();
          console.log('WhatsApp Web está pronto!');
          const name = this.client.info?.pushname || 'Radar CRM';
          const number = this.client.info?.wid?.user || '';
          this.updateStatus('connected', undefined, { name, number });
        });

        this.client.on('disconnected', async (reason: any) => {
          clearInitTimeout();
          console.log('Cliente desconectado do WhatsApp Web. Razão:', reason);
          this.updateStatus('disconnected');
          try {
            await this.client.destroy();
          } catch (e) {
            console.warn('[WhatsApp] Erro ao destruir cliente no disconnected (pode ser ignorado):', e);
          }
          this.deleteSessionFolder();
          this.client = null;
          this.initializingPromise = null;
        });

        await this.client.initialize();
      } catch (error) {
        clearInitTimeout();
        console.error('Erro crítico na inicialização do WhatsApp Web:', error);
        this.updateStatus('disconnected');
        if (this.client) {
          try {
            await this.client.destroy();
          } catch (destroyError) {
            console.error('Erro ao destruir cliente após falha de inicialização:', destroyError);
          }
        }
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
      // Cada chamada deve conter apenas um número, nunca uma lista concatenada.
      if (!/^[+\d\s().-]+$/.test(to)) {
        throw new Error('Informe apenas um telefone por envio, com DDD.');
      }
      let cleanNumber = to.replace(/\D/g, '').replace(/^0+/, '');
      if (cleanNumber.length === 10 || cleanNumber.length === 11) {
        cleanNumber = '55' + cleanNumber;
      }
      if (!/^55\d{10,11}$/.test(cleanNumber)) {
        throw new Error('Número de WhatsApp inválido. Informe DDD e número.');
      }

      // Não inventa um chatId quando o número não existe ou a consulta falha.
      // Usa o identificador retornado pelo WhatsApp, inclusive se ele normalizar
      // a representação do telefone cadastrado.
      let resolveTimer: ReturnType<typeof setTimeout> | undefined;
      let resolvedId;
      try {
        resolvedId = await Promise.race([
          this.client.getNumberId(cleanNumber),
          new Promise<never>((_, reject) => {
            resolveTimer = setTimeout(() => reject(new Error(
              'Tempo limite ao verificar o número no WhatsApp. Tente novamente.',
            )), 10000);
          }),
        ]);
      } finally {
        clearTimeout(resolveTimer);
      }
      if (!resolvedId?._serialized) {
        throw new Error(`O número ${cleanNumber} não está cadastrado no WhatsApp. Confira o DDD e o número.`);
      }
      const chatId = resolvedId._serialized;

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
        const sent = await this.client.sendMessage(chatId, media, {
          caption: message,
          waitUntilMsgSent: true,
        });
        if (!sent) throw new Error('O WhatsApp não confirmou o envio da imagem.');
        console.log('Mensagem com imagem enviada com sucesso!');
      } else {
        const sent = await this.client.sendMessage(chatId, message, { waitUntilMsgSent: true });
        if (!sent) throw new Error('O WhatsApp não confirmou o envio da mensagem.');
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
