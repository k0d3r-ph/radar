export interface WhatsAppSessionState {
  status: 'disconnected' | 'qrcode' | 'authenticating' | 'connected';
  qrCode?: string;
  userInfo?: {
    name: string;
    number: string;
  };
}

const WHATSAPP_API_URL = import.meta.env?.VITE_WHATSAPP_API_URL || 'http://localhost:5000';

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
  const controller = new AbortController();
  // Inclui a resolução do número e o envio de mídia pelo WhatsApp Web.
  const timeoutId = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch(`${WHATSAPP_API_URL}/api/whatsapp/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    // Compatibilidade com o backend anterior enquanto a VM é atualizada.
    // O 202 confirma apenas o aceite, mantendo o comportamento anterior do site.
    // O backend novo responde 200 somente após concluir o envio.
    if (![200, 202].includes(response.status) || data.success !== true) {
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
