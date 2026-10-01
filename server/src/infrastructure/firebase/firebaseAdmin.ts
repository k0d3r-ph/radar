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
} catch (error: any) {
  console.error('[FirebaseAdmin] Erro ao inicializar o Firebase Admin SDK:', error.message || error);
}

export { adminAuth, adminDb, isFirebaseInitialized };
