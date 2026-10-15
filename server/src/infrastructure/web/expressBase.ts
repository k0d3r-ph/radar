import express from 'express';
import cors from 'cors';
import { config } from '../config/env.js';

/** CORS + parsers compartilhados pelos dois processos (API leve e bot do WhatsApp). */
export function criarAppBase(): express.Express {
  const app = express();

  const allowedOrigins = config.corsOrigin
    ? config.corsOrigin.split(',').map(o => o.trim())
    : ['*'];

  app.use(cors({
    origin: (origin, callback) => {
      // Permitir requisições sem origin (como mobile apps, curl, etc.)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true
  }));

  // Aumenta o limite para aceitar imagens grandes em base64 da esteira
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: Date.now() });
  });

  return app;
}
