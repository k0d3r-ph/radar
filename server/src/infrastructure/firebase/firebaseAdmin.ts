import '../config/env.js';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { Auth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let adminAuth: Auth | null = null;
let isFirebaseInitialized = false;

try {
  // Só o Firebase Auth é usado aqui: os dados ficam no PostgreSQL (infrastructure/postgres/bancoDados.ts).
  // Ver server/EMULADOR.md — com USE_FIREBASE_EMULATOR=true os tokens são validados no Auth
  // Emulator local, sem precisar de serviceAccountKey.json.
  const usarEmulador = process.env.USE_FIREBASE_EMULATOR === 'true';

  if (usarEmulador) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

    const app = initializeApp({ projectId: 'automatiza-esteira' });
    adminAuth = getAuth(app);
    isFirebaseInitialized = true;
    console.log(`[FirebaseAdmin] Auth Emulator local ativo (${process.env.FIREBASE_AUTH_EMULATOR_HOST}).`);
  } else {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './serviceAccountKey.json';
    const resolvedPath = path.resolve(__dirname, '../../../../', serviceAccountPath);

    if (fs.existsSync(resolvedPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));

      const app = initializeApp({
        credential: cert(serviceAccount),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET
      });

      adminAuth = getAuth(app);
      isFirebaseInitialized = true;
      console.log('[FirebaseAdmin] Inicializado com sucesso a partir de', serviceAccountPath);
    } else {
      console.warn(
        `[FirebaseAdmin] Arquivo de credenciais do Firebase não encontrado em: ${resolvedPath}.\n` +
        `Para redefinir senhas diretamente no painel, coloque o arquivo serviceAccountKey.json na raiz do server.`
      );
    }
  }
} catch (error: any) {
  console.error('[FirebaseAdmin] Erro ao inicializar o Firebase Admin SDK:', error.message || error);
}

export { adminAuth, isFirebaseInitialized };
