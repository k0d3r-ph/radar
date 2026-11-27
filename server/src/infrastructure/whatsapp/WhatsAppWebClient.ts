import fs from 'fs';
import path from 'path';
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode';
import { userAgentWhatsApp } from './userAgentWhatsApp.js';
import { IWhatsAppService } from '../../domain/interfaces/IWhatsAppService.js';
import type { ConversaRecenteWhatsApp, IWhatsAppChat } from '../../domain/interfaces/IWhatsAppChat.js';
import { WhatsAppSession, ConnectionStatus } from '../../domain/entities/WhatsAppSession.js';
import {
  classificarTipoMensagem,
  ehConversaIndividual,
  telefoneDoIdConversa,
  type MensagemChatWhatsApp,
} from '../../domain/whatsappChat.js';

const { Client, LocalAuth, MessageMedia } = pkg;

export class WhatsAppWebClient implements IWhatsAppService, IWhatsAppChat {
  private client: any = null;
  private session: WhatsAppSession;
  private readonly statusCallbacks: ((session: WhatsAppSession) => void)[] = [];
  private readonly mensagemCallbacks: ((mensagem: MensagemChatWhatsApp) => void)[] = [];
  private readonly conectadoCallbacks: (() => void)[] = [];
  /** Telefone de cada conversa `@lid` já resolvido (o WhatsApp não muda esse vínculo). */
  private readonly telefonesLid = new Map<string, string | null>();
  private initializingPromise: Promise<void> | null = null;

  constructor() {
    this.session = new WhatsAppSession('disconnected');
  }

  onStatusChange(callback: (session: WhatsAppSession) => void): void {
    this.statusCallbacks.push(callback);
    // Dispara imediatamente o status atual para o novo listener
    callback(this.session);
  }

  onMensagem(callback: (mensagem: MensagemChatWhatsApp) => void): void {
    this.mensagemCallbacks.push(callback);
  }

  onConectado(callback: () => void): void {
    this.conectadoCallbacks.push(callback);
  }

  estaConectado(): boolean {
    return this.session.status === 'connected' && !!this.client;
  }

  private updateStatus(status: ConnectionStatus, qrCode?: string, userInfo?: { name: string; number: string }) {
    this.session = new WhatsAppSession(status, qrCode, userInfo);
    for (const callback of this.statusCallbacks) {
      try {
        callback(this.session);
      } catch (erro) {
        console.error('[WhatsApp] Erro ao avisar mudança de status:', erro);
      }
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
        // Mesma versão do Chromium real: um Chrome antigo no user agent impede vincular aparelhos novos.
        const agenteNavegador = userAgentWhatsApp();
        console.log(`[WhatsApp] User agent: ${agenteNavegador}`);
        this.updateStatus('authenticating');

        this.client = new Client({
          authStrategy: new LocalAuth({
            clientId: 'radar-whatsapp-session',
            dataPath: process.env.WWEBJS_AUTH_PATH || './.wwebjs_auth'
          }),
          userAgent: agenteNavegador,
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
          for (const callback of this.conectadoCallbacks) {
            try {
              callback();
            } catch (erro) {
              console.error('[WhatsApp] Erro ao avisar conexão pronta:', erro);
            }
          }
        });

        // Toda mensagem criada numa conversa (recebida ou enviada de qualquer aparelho do número).
        this.client.on('message_create', (msg: any) => {
          if (this.mensagemCallbacks.length === 0) return;
          this.converterMensagem(msg).then((mensagem) => {
            if (!mensagem) return;
            for (const callback of this.mensagemCallbacks) {
              try {
                callback(mensagem);
              } catch (erro) {
                console.error('[WhatsApp] Erro ao repassar mensagem recebida:', erro);
              }
            }
          }).catch((erro) => console.error('[WhatsApp] Falha ao converter mensagem:', erro));
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

  /** Telefone (só dígitos) de uma conversa; para `@lid` pergunta ao WhatsApp e guarda em memória. */
  private async resolverTelefone(conversaId: string): Promise<string | null> {
    const direto = telefoneDoIdConversa(conversaId);
    if (direto || !conversaId.endsWith('@lid')) return direto;
    if (this.telefonesLid.has(conversaId)) return this.telefonesLid.get(conversaId) ?? null;
    let telefone: string | null = null;
    try {
      const [resultado] = await this.client.getContactLidAndPhone([conversaId]);
      telefone = resultado?.pn ? telefoneDoIdConversa(resultado.pn) : null;
    } catch (erro) {
      console.warn(`[WhatsApp] Não foi possível descobrir o telefone de ${conversaId}:`, erro);
      return null; // não guarda: tenta de novo na próxima mensagem
    }
    this.telefonesLid.set(conversaId, telefone);
    return telefone;
  }

  /** Converte a mensagem do whatsapp-web.js; `null` para grupos, status e avisos de sistema. */
  private async converterMensagem(msg: any): Promise<MensagemChatWhatsApp | null> {
    if (!msg?.id?._serialized || msg.isStatus) return null;
    const conversaId: string | undefined = msg.fromMe ? msg.to : msg.from;
    if (!ehConversaIndividual(conversaId)) return null;
    const tipo = classificarTipoMensagem(msg.type);
    if (!tipo) return null;
    return {
      id: msg.id._serialized,
      conversaId,
      telefone: await this.resolverTelefone(conversaId),
      nomeContato: msg.fromMe ? null : (msg._data?.notifyName || null),
      deMim: !!msg.fromMe,
      tipo,
      texto: typeof msg.body === 'string' ? msg.body : '',
      enviadaEm: (Number(msg.timestamp) || Math.floor(Date.now() / 1000)) * 1000,
    };
  }

  async enviarTexto(conversaId: string, texto: string): Promise<MensagemChatWhatsApp> {
    if (!this.estaConectado()) {
      throw new Error('Não há uma sessão conectada ativa no WhatsApp.');
    }
    const enviada = await this.client.sendMessage(conversaId, texto, { waitUntilMsgSent: true });
    if (!enviada) throw new Error('O WhatsApp não confirmou o envio da mensagem.');
    const mensagem = await this.converterMensagem(enviada);
    if (!mensagem) throw new Error('O WhatsApp enviou a mensagem, mas não foi possível registrá-la no Radar.');
    return mensagem;
  }

  async listarConversasRecentes(limite: number): Promise<ConversaRecenteWhatsApp[]> {
    if (!this.estaConectado()) return [];
    const chats: any[] = await this.client.getChats();
    return chats
      .filter((chat) => !chat.isGroup && ehConversaIndividual(chat.id?._serialized))
      .sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0))
      .slice(0, limite)
      .map((chat) => ({ conversaId: chat.id._serialized, naoLidas: Number(chat.unreadCount) || 0 }));
  }

  async buscarMensagens(conversaId: string, limite: number): Promise<MensagemChatWhatsApp[]> {
    if (!this.estaConectado()) return [];
    const chat = await this.client.getChatById(conversaId);
    const mensagens: any[] = await chat.fetchMessages({ limit: limite });
    const convertidas: MensagemChatWhatsApp[] = [];
    for (const msg of mensagens) {
      const mensagem = await this.converterMensagem(msg);
      if (mensagem) convertidas.push(mensagem);
    }
    return convertidas;
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
