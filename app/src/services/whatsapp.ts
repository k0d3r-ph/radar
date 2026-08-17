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
  const controller = new AbortController();
  // Timeout de segurança: se o servidor não responder em 8s, aborta.
  // (O backend agora responde imediatamente com 202, então na prática isso
  //  só é acionado se a VM estiver fora do ar ou com rede travada.)
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${WHATSAPP_API_URL}/api/whatsapp/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // 200 (legado) ou 202 Accepted (fire-and-forget) são ambos sucesso
    if (response.status !== 200 && response.status !== 202) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as any).error || `Erro HTTP ${response.status}`);
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Tempo limite atingido ao contatar o servidor WhatsApp. Verifique se a VM está online.');
    }
    throw err;
  }
}

export function obterWhatsAppSocketUrl(): string {
  return WHATSAPP_API_URL;
}
