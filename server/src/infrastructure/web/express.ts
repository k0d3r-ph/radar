import express from 'express';
import { registrarCsat } from './csat.js';
import cors from 'cors';
import { WhatsAppController } from '../../adapters/controllers/WhatsAppController.js';
import { IaController } from '../../adapters/controllers/IaController.js';
import { CentraisController } from '../../adapters/controllers/CentraisController.js';
import { OcorrenciasController } from '../../adapters/controllers/OcorrenciasController.js';
import { WhatsAppWebClient } from '../whatsapp/WhatsAppWebClient.js';
import { config } from '../config/env.js';
import { adminAuth, adminDb, isFirebaseInitialized } from '../firebase/firebaseAdmin.js';

export function createExpressApp(
  controller: WhatsAppController,
  whatsappService: WhatsAppWebClient
): express.Express {
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
  registrarCsat(app, adminDb, adminAuth);
  const ocorrenciasController = new OcorrenciasController(adminDb, adminAuth);
  app.patch('/api/ocorrencias/:id/favorito', (req, res) => ocorrenciasController.definirFavorita(req, res));

  // Rotas HTTP — WhatsApp
  app.get('/api/whatsapp/status', (req, res) => controller.status(req, res));
  app.post('/api/whatsapp/send', (req, res) => controller.send(req, res));
  app.post('/api/whatsapp/disconnect', (req, res) => controller.disconnect(req, res));

  // Rota para resetar senha de usuário diretamente no Firebase Auth e Firestore
  app.post('/api/whatsapp/users/:uid/reset-password', async (req, res) => {
    try {
      const { uid } = req.params;
      const { novaSenha } = req.body;

      if (!isFirebaseInitialized || !adminAuth || !adminDb) {
        res.status(503).json({
          success: false,
          error: 'Firebase Admin SDK não foi inicializado (arquivo de credenciais ausente no servidor).'
        });
        return;
      }

      if (!novaSenha || novaSenha.length < 6) {
        res.status(400).json({
          success: false,
          error: 'A nova senha deve ter pelo menos 6 caracteres.'
        });
        return;
      }

      console.log(`[FirebaseAdmin] Redefinindo senha para o usuário ${uid}...`);
      
      // 1. Atualiza a senha no Auth do Firebase
      await adminAuth.updateUser(uid, {
        password: novaSenha
      });

      // 2. Atualiza o Firestore marcando que precisa trocar de senha no próximo acesso
      const userRef = adminDb.collection('usuarios').doc(uid);
      await userRef.update({
        needsPasswordChange: true,
        updatedAt: Date.now()
      });

      console.log(`[FirebaseAdmin] Senha do usuário ${uid} redefinida com sucesso!`);
      res.status(200).json({
        success: true,
        message: 'Senha redefinida com sucesso e primeiro acesso ativado.'
      });
    } catch (err: any) {
      console.error('[FirebaseAdmin] Erro ao redefinir senha do usuário:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Erro interno ao redefinir a senha.'
      });
    }
  });

  // Rota para excluir usuário por completo (Firebase Auth + Firestore)
  app.delete('/api/whatsapp/users/:uid', async (req, res) => {
    try {
      const { uid } = req.params;

      if (!isFirebaseInitialized || !adminAuth || !adminDb) {
        res.status(503).json({
          success: false,
          error: 'Firebase Admin SDK não foi inicializado (arquivo de credenciais ausente no servidor).'
        });
        return;
      }

      console.log(`[FirebaseAdmin] Excluindo usuário ${uid} do Firebase Auth e Firestore...`);

      // 1. Exclui o usuário do Firebase Auth
      try {
        await adminAuth.deleteUser(uid);
      } catch (authErr: any) {
        if (authErr.code !== 'auth/user-not-found') {
          throw authErr;
        }
        console.log(`[FirebaseAdmin] Usuário ${uid} não encontrado no Firebase Auth. Prosseguindo com deleção do Firestore.`);
      }

      // 2. Exclui o documento do usuário no Firestore
      const userRef = adminDb.collection('usuarios').doc(uid);
      await userRef.delete();

      console.log(`[FirebaseAdmin] Usuário ${uid} excluído de todas as bases com sucesso!`);
      res.status(200).json({
        success: true,
        message: 'Usuário excluído de todas as bases com sucesso.'
      });
    } catch (err: any) {
      console.error('[FirebaseAdmin] Erro ao excluir usuário:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Erro interno ao excluir o usuário.'
      });
    }
  });

  // Rotas HTTP — IA
  const iaController = new IaController();
  app.post('/api/ia/resumir', (req, res) => iaController.resumir(req, res));

  // Rotas HTTP — Centrais (vínculo idCentral/SSX via planilha do CS)
  const centraisController = new CentraisController();
  app.get('/api/centrais/id-central', (req, res) => centraisController.buscarIdCentral(req, res));


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
