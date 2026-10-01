import { createServer } from 'http';
import { createExpressApp } from './express.js';
import { createSocketServer } from './socket.js';
import { WhatsAppWebClient } from '../whatsapp/WhatsAppWebClient.js';
import { WhatsAppController } from '../../adapters/controllers/WhatsAppController.js';
import { InitializeClient } from '../../application/use-cases/InitializeClient.js';
import { GetConnectionStatus } from '../../application/use-cases/GetConnectionStatus.js';
import { DisconnectClient } from '../../application/use-cases/DisconnectClient.js';
import { SendMediaMessage } from '../../application/use-cases/SendMediaMessage.js';
import { config } from '../config/env.js';
import { adminDb } from '../firebase/firebaseAdmin.js';
import { iniciarSincronizacaoSsxDesk } from '../ssxDesk/SsxDeskSyncService.js';

async function bootstrap() {
  console.log('Iniciando Radar WhatsApp Server...');

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
    getConnectionStatus
  );

  // 4. Cria o servidor Express e HTTP
  const app = createExpressApp(controller, whatsappWebClient);
  const httpServer = createServer(app);

  // 5. Instancia o servidor Socket.io
  const io = createSocketServer(httpServer, whatsappWebClient);

  // 6. Inicia o servidor HTTP
  httpServer.listen(config.port, () => {
    console.log(`--------------------------------------------------`);
    console.log(`Servidor HTTP rodando na porta ${config.port}`);
    console.log(`WebSocket Server pronto para conexões.`);
    console.log(`--------------------------------------------------`);
  });

  iniciarSincronizacaoSsxDesk(adminDb, config.ssxDeskApiKey, config.ssxDeskSyncIntervalMs);

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
