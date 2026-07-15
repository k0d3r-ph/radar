import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode';
import { IWhatsAppService } from '../../domain/interfaces/IWhatsAppService.js';
import { WhatsAppSession, ConnectionStatus } from '../../domain/entities/WhatsAppSession.js';
import { updateConnectionStatus, cleanPhoneNumber, saveMessage, getWorkingHoursConfig, uploadMediaToStorage, db } from '../firebase/firebase.js';
import { MessageQueue } from '../../application/services/MessageQueue.js';
import { isTimeOutOfOffice } from '../../domain/utils/workingHours.js';

const { Client, LocalAuth, MessageMedia } = pkg;

export class WhatsAppWebClient implements IWhatsAppService {
  private client: any = null;
  private session: WhatsAppSession;
  private statusCallback: ((session: WhatsAppSession) => void) | null = null;
  private initializingPromise: Promise<void> | null = null;
  public queue: MessageQueue;

  constructor() {
    this.session = new WhatsAppSession('disconnected');
    this.queue = new MessageQueue(this);
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
    updateConnectionStatus(status, qrCode, userInfo).catch((err) => {
      console.error('Erro ao salvar status de conexão no Firestore:', err);
    });
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
            dataPath: process.env.WWEBJS_AUTH_PATH || './.wwebjs_auth'
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
          const name = this.client.info?.pushname || 'Radar CRM';
          const number = this.client.info?.wid?.user || '';
          this.updateStatus('connected', undefined, { name, number });
          
          // Dispara o esvaziamento da fila de mensagens offline em background
          this.processOfflineQueue().catch(err => {
            console.error('Erro ao processar fila offline ao iniciar:', err);
          });
        });

        this.client.on('message', async (msg: any) => {
          try {
            await this.handleIncomingMessage(msg);
          } catch (err) {
            console.error('Erro ao tratar mensagem recebida:', err);
          }
        });

        this.client.on('message_create', async (msg: any) => {
          try {
            if (msg.fromMe) {
              await this.handleOutgoingMessageFromExternal(msg);
            }
          } catch (err) {
            console.error('Erro ao tratar mensagem externa enviada:', err);
          }
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
      // Limpa e formata o telefone
      let cleanNumber = to.replace(/\D/g, '');
      if (cleanNumber.length === 10 || cleanNumber.length === 11) {
        // Assume Brasil e adiciona DDI 55
        cleanNumber = '55' + cleanNumber;
      }
      
      let chatId = `${cleanNumber}@c.us`;
      
      // Tenta obter o ID correto registrado no WhatsApp (evita o erro "No LID for user")
      try {
        const resolvedId = await this.client.getNumberId(cleanNumber);
        if (resolvedId && resolvedId._serialized) {
          chatId = resolvedId._serialized;
          console.log(`Telefone resolvido via getNumberId: ${chatId}`);
        } else {
          console.log(`Número não encontrado/registrado via getNumberId: ${cleanNumber}. Tentando enviar para o chatId padrão.`);
        }
      } catch (err) {
        console.warn(`Erro ao resolver getNumberId para ${cleanNumber}:`, err);
      }
      
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
    } catch (error: any) {
      console.error('Erro ao enviar mensagem pelo WhatsApp:', error);
      
      // Auto-recuperação para erros conhecidos de queda do Puppeteer (Detached Frame / Execution Context)
      const errorMsg = error.message ? error.message.toLowerCase() : '';
      if (errorMsg.includes('detached frame') || errorMsg.includes('execution context') || errorMsg.includes('target closed') || errorMsg.includes('session closed')) {
        console.warn('⚠️ Detectada falha fatal no Puppeteer (Frame Desanexado). Forçando reinicialização do cliente...');
        this.updateStatus('disconnected');
        if (this.client) {
          try { await this.client.destroy(); } catch (e) {}
          this.client = null;
          this.initializingPromise = null;
        }
        throw new Error('A conexão com o WhatsApp sofreu uma instabilidade (Detached Frame). O sistema está reiniciando o serviço. Por favor, aguarde alguns segundos e tente enviar novamente (ou leia o QR Code se solicitado).');
      }

      throw error;
    }
  }

  async sendTyping(to: string, durationMs: number): Promise<void> {
    if (this.session.status !== 'connected' || !this.client) return;
    try {
      let cleanNumber = to.replace(/\D/g, '');
      if (cleanNumber.length === 10 || cleanNumber.length === 11) {
        cleanNumber = '55' + cleanNumber;
      }
      
      let chatId = `${cleanNumber}@c.us`;
      try {
        const resolvedId = await this.client.getNumberId(cleanNumber);
        if (resolvedId && resolvedId._serialized) {
          chatId = resolvedId._serialized;
        }
      } catch (err) {}

      const chat = await this.client.getChatById(chatId);
      await chat.sendStateTyping();
      await new Promise(resolve => setTimeout(resolve, durationMs));
    } catch (err) {
      console.warn('Erro ao simular digitação no WhatsApp Web:', err);
    }
  }

  async enqueueMessage(to: string, message: string, imageBase64?: string, filename?: string): Promise<boolean> {
    const cleanNum = cleanPhoneNumber(to);
    const messageDocId = db.collection('whatsapp_chats').doc(cleanNum).collection('messages').doc().id;
    
    let media: any = undefined;
    if (imageBase64) {
      media = {
        url: '',
        type: 'image' as const,
        mimeType: 'image/png',
        filename: filename || 'esteira.png',
        expiresAt: 0
      };

      try {
        let base64Data = imageBase64;
        let mimeType = 'image/png';
        
        if (imageBase64.includes(';base64,')) {
          const parts = imageBase64.split(';base64,');
          mimeType = parts[0].replace('data:', '');
          base64Data = parts[1];
        }
        
        const buffer = Buffer.from(base64Data, 'base64');
        const uploadResult = await uploadMediaToStorage(cleanNum, messageDocId, buffer, mimeType, filename);
        media.url = uploadResult.url;
        media.expiresAt = uploadResult.expiresAt;
      } catch (err) {
        console.error('Erro ao fazer upload de imagem enviada:', err);
      }
    }

    const messageData = {
      id: messageDocId,
      text: message,
      sender: 'agent' as const,
      timestamp: Date.now(),
      status: this.session.status === 'connected' ? ('pending' as const) : ('pending_connection' as const),
      ...(media ? { media } : {})
    };

    await saveMessage(cleanNum, messageDocId, messageData);

    this.queue.enqueue({
      to: cleanNum,
      message,
      imageBase64,
      filename,
      chatId: cleanNum,
      messageDocId
    }).catch(err => {
      console.error('Erro ao colocar na fila do MessageQueue:', err);
    });

    return true;
  }

  async getProfilePicUrl(number: string): Promise<string> {
    if (this.session.status !== 'connected' || !this.client) {
      return '';
    }
    try {
      const cleanNum = cleanPhoneNumber(number);
      const chatId = `${cleanNum}@c.us`;
      const url = await this.client.getProfilePicUrl(chatId);
      return url || '';
    } catch (err) {
      console.warn(`Erro ao buscar foto de perfil para ${number}:`, err);
      return '';
    }
  }

  private async handleIncomingMessage(msg: any): Promise<void> {
    if (!msg.from.endsWith('@c.us')) return;
    const cleanNum = cleanPhoneNumber(msg.from);
    console.log(`[Incoming] Mensagem recebida de ${cleanNum}: ${msg.body}`);

    let mediaObj: any = undefined;
    if (msg.hasMedia) {
      try {
        const media = await msg.downloadMedia();
        if (media && media.data) {
          const buffer = Buffer.from(media.data, 'base64');
          const uploadResult = await uploadMediaToStorage(cleanNum, msg.id._serialized, buffer, media.mimetype, media.filename);
          
          let mediaType: 'image' | 'video' | 'sticker' | 'audio' = 'image';
          if (media.mimetype.startsWith('video/')) mediaType = 'video';
          else if (media.mimetype.startsWith('audio/')) mediaType = 'audio';
          else if (media.mimetype.includes('webp') || msg.type === 'sticker') mediaType = 'sticker';
          
          mediaObj = {
            url: uploadResult.url,
            type: mediaType,
            mimeType: media.mimetype,
            filename: media.filename || undefined,
            expiresAt: uploadResult.expiresAt
          };
        }
      } catch (err) {
        console.error('Erro ao baixar/salvar mídia recebida:', err);
      }
    }

    const messageData = {
      id: msg.id._serialized,
      text: msg.body || '',
      sender: 'client' as const,
      timestamp: msg.timestamp * 1000,
      status: 'delivered' as const,
      ...(mediaObj ? { media: mediaObj } : {})
    };

    await saveMessage(cleanNum, msg.id._serialized, messageData);
    await this.handleOutOfOfficeAutoReply(cleanNum);
  }

  private async handleOutOfOfficeAutoReply(chatId: string): Promise<void> {
    try {
      const config = await getWorkingHoursConfig();
      if (!config || !config.workingHoursActive) return;

      const { outOfHoursMessage } = config;
      if (!outOfHoursMessage) return;

      const isOutOfHours = isTimeOutOfOffice(new Date(), config);

      if (isOutOfHours) {
        const lastMessages = await db.collection('whatsapp_chats')
          .doc(chatId)
          .collection('messages')
          .orderBy('timestamp', 'desc')
          .limit(5)
          .get();

        const alreadyReplied = lastMessages.docs.some(doc => {
          const data = doc.data();
          const isAutoMsg = data.sender === 'system' || (data.sender === 'agent' && data.text === outOfHoursMessage);
          const age = Date.now() - (data.timestamp || 0);
          return isAutoMsg && age < 2 * 60 * 60 * 1000;
        });

        if (alreadyReplied) {
          console.log(`[AutoReply] Já respondeu automaticamente a ${chatId} recentemente.`);
          return;
        }

        const messageDocId = db.collection('whatsapp_chats').doc(chatId).collection('messages').doc().id;
        const autoMsgData = {
          id: messageDocId,
          text: outOfHoursMessage,
          sender: 'system' as const,
          timestamp: Date.now(),
          status: 'pending' as const
        };

        await saveMessage(chatId, messageDocId, autoMsgData);

        this.queue.enqueue({
          to: chatId,
          message: outOfHoursMessage,
          chatId: chatId,
          messageDocId
        }).catch(err => {
          console.error('Erro ao enfileirar auto-resposta:', err);
        });
      }
    } catch (err) {
      console.error('Erro no processamento de expediente comercial:', err);
    }
  }

  private async handleOutgoingMessageFromExternal(msg: any): Promise<void> {
    if (!msg.to.endsWith('@c.us')) return;
    const cleanNum = cleanPhoneNumber(msg.to);
    console.log(`[OutgoingExternal] Sincronizando mensagem de ${cleanNum}: ${msg.body}`);

    const messageData = {
      id: msg.id._serialized,
      text: msg.body || '',
      sender: 'agent' as const,
      timestamp: msg.timestamp * 1000,
      status: 'sent' as const
    };

    await saveMessage(cleanNum, msg.id._serialized, messageData);
  }

  private async processOfflineQueue(): Promise<void> {
    console.log('[WhatsAppWebClient] Verificando fila de mensagens offline...');
    try {
      const chatsSnap = await db.collection('whatsapp_chats').get();
      const now = Date.now();
      const limit24h = 24 * 60 * 60 * 1000;

      for (const chatDoc of chatsSnap.docs) {
        const chatId = chatDoc.id;
        const pendingMsgs = await db.collection('whatsapp_chats')
          .doc(chatId)
          .collection('messages')
          .where('status', '==', 'pending_connection')
          .get();

        for (const msgDoc of pendingMsgs.docs) {
          const msgData = msgDoc.data();
          const age = now - (msgData.timestamp || now);

          if (age > limit24h) {
            console.log(`[OfflineQueue] Mensagem ${msgDoc.id} expirou (>24h). Descartando...`);
            await msgDoc.ref.update({
              status: 'failed_expired',
              expiredAt: now
            });
          } else {
            console.log(`[OfflineQueue] Enfileirando mensagem pendente recente ${msgDoc.id} para ${chatId}`);
            this.queue.enqueue({
              to: chatId,
              message: msgData.text || '',
              chatId: chatId,
              messageDocId: msgDoc.id
            }).catch(err => {
              console.error('Erro ao reinserir na fila:', err);
            });
          }
        }
      }
    } catch (err) {
      console.error('Erro no processamento de fila offline:', err);
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
