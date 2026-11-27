import { createServer } from 'http';
import { createExpressApp } from './express.js';
import { createSocketServer } from './socket.js';
import { WhatsAppWebClient } from '../whatsapp/WhatsAppWebClient.js';
import { WhatsAppController } from '../../adapters/controllers/WhatsAppController.js';
import { InitializeClient } from '../../application/use-cases/InitializeClient.js';
import { GetConnectionStatus } from '../../application/use-cases/GetConnectionStatus.js';
import { DisconnectClient } from '../../application/use-cases/DisconnectClient.js';
import { SendMediaMessage } from '../../application/use-cases/SendMediaMessage.js';
import { AutenticadorRadar } from '../../adapters/middlewares/autenticacaoRadar.js';
import { adminAuth } from '../firebase/firebaseAdmin.js';
import { banco, prepararBanco } from '../postgres/bancoDados.js';
import { UsuariosRepository } from '../postgres/UsuariosRepository.js';
import { config } from '../config/env.js';
import { ChatWhatsApp } from '../../application/use-cases/ChatWhatsApp.js';
import { ChatWhatsAppController } from '../../adapters/controllers/ChatWhatsAppController.js';
import { WhatsAppChatRepository } from '../postgres/WhatsAppChatRepository.js';
import { IndiceClientesBanco } from '../whatsapp/IndiceClientesBanco.js';
import { banco as bancoDocumentos, poolPostgres } from '../postgres/bancoDados.js';

/**
 * Processo do bot do WhatsApp. CSAT, ocorrências, sincronização, IA,
 * Centrais e gestão de usuários rodam separados em apiIndex.ts — ver comentário lá.
 */
async function bootstrap() {
  console.log('Iniciando Radar WhatsApp Server...');
  await prepararBanco();

  // 1. Instancia o cliente da infraestrutura
  const whatsappWebClient = new WhatsAppWebClient();

  // 2. Instancia os Casos de Uso
  const initializeClient = new InitializeClient(whatsappWebClient);
  const getConnectionStatus = new GetConnectionStatus(whatsappWebClient);
  const disconnectClient = new DisconnectClient(whatsappWebClient);
  const sendMediaMessage = new SendMediaMessage(whatsappWebClient);

  // 3. Instancia o Controlador
  const controller = new WhatsAppController(
    sendMediaMessage,
    disconnectClient,
    getConnectionStatus,
    config.whatsappEnvioAutomaticoBloqueado,
  );
  if (config.whatsappEnvioAutomaticoBloqueado) {
    console.warn('[WhatsApp] Envios automáticos bloqueados (WHATSAPP_ENVIO_AUTOMATICO_BLOQUEADO=true): só o chat envia.');
  }

  // 3b. Chat do WhatsApp (precisa do banco: conversas e mensagens ficam no PostgreSQL)
  let chat: ChatWhatsApp | null = null;
  let chatController: ChatWhatsAppController | undefined;
  if (poolPostgres && bancoDocumentos) {
    const bancoChat = bancoDocumentos;
    chat = new ChatWhatsApp(
      new WhatsAppChatRepository(poolPostgres),
      whatsappWebClient,
      new IndiceClientesBanco(bancoChat),
      { somenteClientes: config.whatsappChatSomenteClientes },
    );
    chat.iniciar();
    chatController = new ChatWhatsAppController(chat, async (uid) => {
      const usuario = (await bancoChat.doc(`usuarios/${uid}`).get()).data();
      return typeof usuario?.nome === 'string' && usuario.nome.trim() ? usuario.nome.trim() : null;
    });
    if (config.whatsappChatSomenteClientes) {
      console.warn('[Chat WhatsApp] Gravando só conversas de telefones cadastrados em clientes (WHATSAPP_CHAT_SOMENTE_CLIENTES=true).');
    }
  } else {
    console.warn('[Chat WhatsApp] Banco não configurado: o chat fica desativado.');
  }

  // 4. Cria o servidor Express e HTTP; todas as rotas e o socket exigem login no Radar
  const autenticador = new AutenticadorRadar(adminAuth, banco ? new UsuariosRepository(banco) : null);
  const app = createExpressApp(controller, whatsappWebClient, autenticador, chatController);
  const httpServer = createServer(app);

  // 5. Instancia o servidor Socket.io
  const io = createSocketServer(httpServer, whatsappWebClient, autenticador);
  // O socket só aceita master e treinador, os mesmos perfis das rotas do chat.
  chat?.aoMudar((evento) => io.emit('whatsapp-chat', evento));

  // 6. Inicia o servidor HTTP
  httpServer.listen(config.port, () => {
    console.log(`--------------------------------------------------`);
    console.log(`Servidor HTTP rodando na porta ${config.port}`);
    console.log(`WebSocket Server pronto para conexões.`);
    console.log(`--------------------------------------------------`);
  });

  // 7. Auto-inicialização automática do cliente WhatsApp para restaurar sessões existentes
  try {
    console.log('Tentando auto-inicializar sessão salva do WhatsApp...');
    await initializeClient.execute();
  } catch (error) {
    console.error('Falha na auto-inicialização inicial do WhatsApp:', error);
  }
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Anti-Crash] Rejeição de promessa não tratada em:', promise, 'razão:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Anti-Crash] Exceção não tratada capturada:', err);
});

bootstrap().catch((err) => {
  console.error('Erro crítico ao inicializar o servidor backend:', err);
  process.exit(1);
});
