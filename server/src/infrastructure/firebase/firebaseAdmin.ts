import '../config/env.js';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let adminAuth: Auth | null = null;
let adminDb: Firestore | null = null;
let isFirebaseInitialized = false;

try {
  // Ver server/EMULADOR.md — com USE_FIREBASE_EMULATOR=true o backend conversa só com o
  // Firebase Emulator Suite local, sem precisar de serviceAccountKey.json nem tocar em
  // produção (nenhuma leitura ou gravação real acontece rodando nesse modo).
  const usarEmulador = process.env.USE_FIREBASE_EMULATOR === 'true';

  if (usarEmulador) {
    process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

    const app = initializeApp({ projectId: 'automatiza-esteira' });
    adminAuth = getAuth(app);
    adminDb = getFirestore(app);
    isFirebaseInitialized = true;
    console.log(
      `[FirebaseAdmin] Emulator Suite local ativo (Firestore ${process.env.FIRESTORE_EMULATOR_HOST}, Auth ${process.env.FIREBASE_AUTH_EMULATOR_HOST}) — nenhuma leitura ou gravação vai para produção.`,
    );
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
      adminDb = getFirestore(app);
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

export { adminAuth, adminDb, isFirebaseInitialized };
