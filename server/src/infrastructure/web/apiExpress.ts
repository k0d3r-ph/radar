import express from 'express';
import { criarAppBase } from './expressBase.js';
import { registrarCsat } from './csat.js';
import { IaController } from '../../adapters/controllers/IaController.js';
import { CentraisController } from '../../adapters/controllers/CentraisController.js';
import { OcorrenciasController } from '../../adapters/controllers/OcorrenciasController.js';
import { SincronizacaoController } from '../../adapters/controllers/SincronizacaoController.js';
import { adminAuth, adminDb } from '../firebase/firebaseAdmin.js';

/**
 * Processo leve: CSAT, ocorrências, sincronização, IA e Centrais. Não inicializa
 * o cliente do WhatsApp (Puppeteer/Chromium) — fica isolado no processo do bot
 * (ver index.ts) para não disputar CPU/memória com estas rotas.
 */
export function createApiApp(): express.Express {
  const app = criarAppBase();

  registrarCsat(app, adminDb, adminAuth);
  const ocorrenciasController = new OcorrenciasController(adminDb, adminAuth);
  app.patch('/api/ocorrencias/:id/favorito', (req, res) => ocorrenciasController.definirFavorita(req, res));
  const sincronizacaoController = new SincronizacaoController(adminDb, adminAuth);
  app.get('/api/sincronizacao/:colecao', (req, res) => sincronizacaoController.listar(req, res));

  const iaController = new IaController();
  app.post('/api/ia/resumir', (req, res) => iaController.resumir(req, res));

  const centraisController = new CentraisController(adminDb, adminAuth);
  app.get('/api/centrais/id-central', (req, res) => centraisController.buscarIdCentral(req, res));
  app.get('/api/centrais/dados', (req, res) => centraisController.buscarDados(req, res));

  return app;
}
