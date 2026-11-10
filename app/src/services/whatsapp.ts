import { WHATSAPP_API_URL } from './apiConfig.ts';
import { auth } from './firebase';

/** O bot exige login no Radar em todas as rotas. */
async function cabecalhosAutenticados(extras: Record<string, string> = {}): Promise<Record<string, string>> {
  if (!auth.currentUser) throw new Error('Entre novamente no Radar para usar o WhatsApp.');
  return { ...extras, Authorization: `Bearer ${await auth.currentUser.getIdToken()}` };
}

/** Token para o handshake do Socket.IO do bot (tela de WhatsApp). */
export async function obterTokenSocketWhatsApp(): Promise<string | undefined> {
  return auth.currentUser?.getIdToken();
}

export interface WhatsAppSessionState {
  status: 'disconnected' | 'qrcode' | 'authenticating' | 'connected';
  qrCode?: string;
  userInfo?: {
    name: string;
    number: string;
  };
}

export async function obterStatusWhatsApp(): Promise<WhatsAppSessionState> {
  const response = await fetch(`${WHATSAPP_API_URL}/api/whatsapp/status`, {
    headers: await cabecalhosAutenticados(),
  });
  if (!response.ok) {
    throw new Error('Falha ao obter status do WhatsApp.');
  }
  const data = await response.json();
  return data.session;
}

export async function desconectarWhatsApp(): Promise<void> {
  const response = await fetch(`${WHATSAPP_API_URL}/api/whatsapp/disconnect`, {
    method: 'POST',
    headers: await cabecalhosAutenticados(),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Falha ao desconectar o WhatsApp.');
  }
}

export interface EnviarMensagemWhatsAppParams {
  to: string;
  message: string;
  imageBase64?: string;
  filename?: string;
}

export async function enviarMensagemWhatsApp(params: EnviarMensagemWhatsAppParams): Promise<void> {
  const controller = new AbortController();
  // Inclui a resolução do número e o envio de mídia pelo WhatsApp Web.
  const timeoutId = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch(`${WHATSAPP_API_URL}/api/whatsapp/send`, {
      method: 'POST',
      headers: await cabecalhosAutenticados({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    // Aceite da solicitação não confirma que a mensagem foi enviada.
    if (response.status === 202) {
      throw new Error('Envio não confirmado: o servidor apenas recebeu a solicitação. Verifique a conversa antes de reenviar e atualize o serviço de WhatsApp para confirmar o resultado do envio.');
    }
    if (response.status !== 200 || data.success !== true) {
      throw new Error(data.error || `Envio não confirmado (HTTP ${response.status}).`);
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('O servidor não confirmou o envio no tempo limite. Verifique a conversa antes de reenviar, pois a mensagem ainda pode ser enviada.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function obterWhatsAppSocketUrl(): string {
  return WHATSAPP_API_URL;
}
