import { createServer } from 'http';
import { createApiApp } from './apiExpress.js';
import { config } from '../config/env.js';
import { adminDb } from '../firebase/firebaseAdmin.js';
import { iniciarSincronizacaoSsxDesk } from '../ssxDesk/SsxDeskSyncService.js';

/**
 * Processo leve do Radar: CSAT, ocorrências, sincronização, IA e Centrais.
 * Separado do bot do WhatsApp (index.ts) para não competir por CPU/memória
 * com o Chromium do whatsapp-web.js — ver server/SSX_DESK.md e CSAT.md.
 */
async function bootstrap() {
  console.log('Iniciando Radar API Server...');

  const app = createApiApp();
  const httpServer = createServer(app);

  httpServer.listen(config.apiPort, () => {
    console.log(`--------------------------------------------------`);
    console.log(`Servidor HTTP (API) rodando na porta ${config.apiPort}`);
    console.log(`--------------------------------------------------`);
  });

  iniciarSincronizacaoSsxDesk(adminDb, config.ssxDeskApiKey, config.ssxDeskSyncIntervalMs);
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Anti-Crash] Rejeição de promessa não tratada em:', promise, 'razão:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Anti-Crash] Exceção não tratada capturada:', err);
});

bootstrap().catch((err) => {
  console.error('Erro crítico ao inicializar o servidor da API:', err);
  process.exit(1);
});
