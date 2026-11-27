import express from 'express';
import { criarAppBase } from './expressBase.js';
import { WhatsAppController } from '../../adapters/controllers/WhatsAppController.js';
import type { ChatWhatsAppController } from '../../adapters/controllers/ChatWhatsAppController.js';
import { WhatsAppWebClient } from '../whatsapp/WhatsAppWebClient.js';
import { AutenticadorRadar, PERFIS_GESTORES, PERFIS_RADAR } from '../../adapters/middlewares/autenticacaoRadar.js';

/**
 * Processo do bot do WhatsApp: só as rotas que dependem do cliente Puppeteer/
 * Chromium. CSAT, ocorrências, sincronização, IA, Centrais e gestão de usuários
 * ficam no processo leve (ver apiExpress.ts) para não competir por CPU/memória
 * com o Chromium.
 */
export function createExpressApp(
  controller: WhatsAppController,
  whatsappService: WhatsAppWebClient,
  autenticador: AutenticadorRadar,
  chat?: ChatWhatsAppController,
): express.Express {
  const app = criarAppBase();

  // Chat (ver server/WHATSAPP_CHAT.md): só master e treinador, os mesmos perfis do socket.
  if (chat) {
    const gestores = autenticador.exigir(PERFIS_GESTORES);
    app.get('/api/whatsapp/conversas', gestores, (req, res) => chat.conversas(req, res));
    app.get('/api/whatsapp/conversas/:id/mensagens', gestores, (req, res) => chat.mensagens(req, res));
    app.post('/api/whatsapp/conversas/:id/mensagens', gestores, (req, res) => chat.enviar(req, res));
    app.post('/api/whatsapp/conversas/:id/lida', gestores, (req, res) => chat.marcarLida(req, res));
  }

  // Status e desconexão: mesmos perfis da tela /whatsapp. O status traz o número conectado e o QR Code.
  app.get('/api/whatsapp/status', autenticador.exigir(PERFIS_GESTORES), (req, res) => controller.status(req, res));
  app.post('/api/whatsapp/send', autenticador.exigir(PERFIS_RADAR), (req, res) => controller.send(req, res));
  app.post('/api/whatsapp/disconnect', autenticador.exigir(PERFIS_GESTORES), (req, res) => controller.disconnect(req, res));

  // Depuração do Puppeteer: a imagem mostra as conversas abertas no WhatsApp Web.
  app.get('/api/whatsapp/screenshot', autenticador.exigir(['master']), async (req, res) => {
    try {
      const screenshot = await whatsappService.takeScreenshot();
      if (screenshot) {
        const img = Buffer.from(screenshot, 'base64');
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': img.length,
          'Cache-Control': 'no-store',
        });
        res.end(img);
      } else {
        res.status(404).json({ error: 'Nenhum screenshot disponível. Cliente pode não estar inicializado.' });
      }
    } catch (err: any) {
      res.status(500).json({ error: 'Erro ao obter screenshot', details: err.message });
    }
  });

  return app;
}
