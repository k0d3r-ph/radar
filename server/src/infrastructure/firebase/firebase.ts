import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || 'automatiza-esteira.firebasestorage.app';

if (!admin.apps.length) {
  let serviceAccount: any = null;

  if (serviceAccountKey) {
    try {
      serviceAccount = JSON.parse(serviceAccountKey);
      console.log('Carregando Service Account do Firebase via FIREBASE_SERVICE_ACCOUNT_KEY.');
    } catch (err: any) {
      console.error('Erro ao fazer parse da FIREBASE_SERVICE_ACCOUNT_KEY. Detalhe:', err.message);
    }
  }

  if (!serviceAccount && serviceAccountPath) {
    try {
      const resolvedPath = path.resolve(process.cwd(), serviceAccountPath);
      if (fs.existsSync(resolvedPath)) {
        const fileContent = fs.readFileSync(resolvedPath, 'utf8');
        serviceAccount = JSON.parse(fileContent);
        console.log(`Carregando Service Account do Firebase via arquivo: ${resolvedPath}`);
      } else {
        console.warn(`Arquivo de Service Account não encontrado no caminho: ${resolvedPath}`);
      }
    } catch (err: any) {
      console.error('Erro ao carregar Service Account do arquivo:', err.message);
    }
  }

  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: storageBucket
    });
    console.log('Firebase Admin SDK inicializado com sucesso.');
  } else {
    console.log('Nenhuma credencial configurada. Tentando inicialização padrão do ambiente...');
    admin.initializeApp({
      storageBucket: storageBucket
    });
  }
}

export const db = admin.firestore();
export const storage = admin.storage();
export { admin };

// Limpa e padroniza números de telefone
export function cleanPhoneNumber(num: string): string {
  let clean = num.replace(/\D/g, '');
  // Remove sufixo do whatsapp se presente
  if (clean.includes('@')) {
    clean = clean.split('@')[0];
  }
  if (clean.length === 10 || clean.length === 11) {
    clean = '55' + clean;
  }
  return clean;
}

// Salva ou atualiza uma mensagem e atualiza o estado do chat
export async function saveMessage(
  chatId: string,
  messageId: string,
  data: {
    text: string;
    sender: 'client' | 'agent' | 'system';
    timestamp: number;
    status: 'pending' | 'sent' | 'delivered' | 'read' | 'pending_connection' | 'failed_expired';
    media?: {
      url: string;
      type: 'image' | 'video' | 'sticker' | 'audio';
      mimeType: string;
      filename?: string;
      expiresAt: number;
    }
  }
) {
  const chatRef = db.collection('whatsapp_chats').doc(chatId);
  const msgRef = chatRef.collection('messages').doc(messageId);

  // Salva a mensagem
  await msgRef.set(data, { merge: true });

  // Busca ou cria o chat correspondente
  const chatSnap = await chatRef.get();
  const unreadIncrement = data.sender === 'client' ? 1 : 0;
  
  const chatData: any = {
    lastMessageText: data.text || (data.media ? `[${data.media.type}]` : '[Mídia]'),
    lastMessageTimestamp: data.timestamp,
    updatedAt: Date.now()
  };

  if (!chatSnap.exists) {
    chatData.id = chatId;
    chatData.contactName = chatId; // Inicialmente o próprio número
    chatData.unreadCount = unreadIncrement;
  } else {
    if (unreadIncrement > 0) {
      chatData.unreadCount = admin.firestore.FieldValue.increment(unreadIncrement);
    }
  }

  await chatRef.set(chatData, { merge: true });
}

// Atualiza o status de uma mensagem existente
export async function updateMessageStatus(chatId: string, messageId: string, status: string, error?: string) {
  const msgRef = db.collection('whatsapp_chats').doc(chatId).collection('messages').doc(messageId);
  const updateData: any = { status };
  if (error !== undefined) {
    updateData.error = error;
  }
  await msgRef.update(updateData);
}

// Recupera a configuração do expediente comercial
export async function getWorkingHoursConfig() {
  const configRef = db.collection('whatsapp_config').doc('whatsapp');
  const docSnap = await configRef.get();
  if (docSnap.exists) {
    return docSnap.data();
  }
  return null;
}

// Sincroniza o status da conexão do WhatsApp Web com o Firestore
export async function updateConnectionStatus(status: string, qrCode?: string, userInfo?: any) {
  const configRef = db.collection('whatsapp_config').doc('whatsapp');
  const updateData: any = {
    status,
    updatedAt: Date.now()
  };
  if (qrCode !== undefined) {
    updateData.qrCode = qrCode || '';
  }
  if (userInfo !== undefined) {
    updateData.userInfo = userInfo || null;
  }
  await configRef.set(updateData, { merge: true });
}

// Faz o upload de buffer de mídia para o Firebase Storage e gera uma URL assinada por 7 dias
export async function uploadMediaToStorage(
  chatId: string,
  messageId: string,
  buffer: Buffer,
  mimeType: string,
  filename?: string
): Promise<{ url: string, expiresAt: number }> {
  const bucket = storage.bucket();
  
  // Determina extensão
  let ext = 'bin';
  if (mimeType.includes('/')) {
    ext = mimeType.split('/')[1].split(';')[0];
  }
  
  const destination = `whatsapp_media/${chatId}/${messageId}.${ext}`;
  const file = bucket.file(destination);
  
  await file.save(buffer, {
    metadata: {
      contentType: mimeType
    }
  });
  
  // Define expiração de 7 dias
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: expiresAt
  });
  
  return { url, expiresAt };
}
