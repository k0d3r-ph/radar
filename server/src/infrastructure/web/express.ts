import express from 'express';
import cors from 'cors';
import { WhatsAppController } from '../../adapters/controllers/WhatsAppController.js';
import { WhatsAppWebClient } from '../whatsapp/WhatsAppWebClient.js';
import { config } from '../config/env.js';

export function createExpressApp(
  controller: WhatsAppController,
  whatsappService: WhatsAppWebClient
): express.Express {
  const app = express();

  app.use(cors({
    origin: config.corsOrigin,
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true
  }));

  // Aumenta o limite para aceitar imagens grandes em base64 da esteira
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Rotas HTTP
  app.get('/api/whatsapp/status', (req, res) => controller.status(req, res));
  app.post('/api/whatsapp/send', (req, res) => controller.send(req, res));
  app.post('/api/whatsapp/disconnect', (req, res) => controller.disconnect(req, res));

  // Rota de depuração do Puppeteer
  app.get('/api/whatsapp/screenshot', async (req, res) => {
    try {
      const screenshot = await whatsappService.takeScreenshot();
      if (screenshot) {
        const img = Buffer.from(screenshot, 'base64');
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': img.length
        });
        res.end(img);
      } else {
        res.status(404).json({ error: 'Nenhum screenshot disponível. Cliente pode não estar inicializado.' });
      }
    } catch (err: any) {
      res.status(500).json({ error: 'Erro ao obter screenshot', details: err.message });
    }
  });

  // Rota de Health Check
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: Date.now() });
  });

  return app;
}
