export interface WhatsAppSessionState {
  status: 'disconnected' | 'qrcode' | 'authenticating' | 'connected';
  qrCode?: string;
  userInfo?: {
    name: string;
    number: string;
  };
}

const WHATSAPP_API_URL = import.meta.env.VITE_WHATSAPP_API_URL || 'http://localhost:5000';

export async function obterStatusWhatsApp(): Promise<WhatsAppSessionState> {
  const response = await fetch(`${WHATSAPP_API_URL}/api/whatsapp/status`);
  if (!response.ok) {
    throw new Error('Falha ao obter status do WhatsApp.');
  }
  const data = await response.json();
  return data.session;
}

export async function desconectarWhatsApp(): Promise<void> {
  const response = await fetch(`${WHATSAPP_API_URL}/api/whatsapp/disconnect`, {
    method: 'POST'
  });
  if (!response.ok) {
    throw new Error('Falha ao desconectar o WhatsApp.');
  }
}

export interface EnviarMensagemWhatsAppParams {
  to: string;
  message: string;
  imageBase64?: string;
  filename?: string;
}

export async function enviarMensagemWhatsApp(params: EnviarMensagemWhatsAppParams): Promise<void> {
  const response = await fetch(`${WHATSAPP_API_URL}/api/whatsapp/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params)
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Falha ao enviar mensagem pelo WhatsApp.');
  }
}

export function obterWhatsAppSocketUrl(): string {
  return WHATSAPP_API_URL;
}
