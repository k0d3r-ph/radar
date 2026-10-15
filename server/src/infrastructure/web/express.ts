import express from 'express';
import { criarAppBase } from './expressBase.js';
import { WhatsAppController } from '../../adapters/controllers/WhatsAppController.js';
import { WhatsAppWebClient } from '../whatsapp/WhatsAppWebClient.js';
import { adminAuth, adminDb, isFirebaseInitialized } from '../firebase/firebaseAdmin.js';

/**
 * Processo do bot do WhatsApp: só as rotas que dependem do cliente Puppeteer/
 * Chromium. CSAT, ocorrências, sincronização, IA e Centrais ficam no processo
 * leve (ver apiExpress.ts) para não competir por CPU/memória com o Chromium.
 */
export function createExpressApp(
  controller: WhatsAppController,
  whatsappService: WhatsAppWebClient
): express.Express {
  const app = criarAppBase();

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

  return app;
}
