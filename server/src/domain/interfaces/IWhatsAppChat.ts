import type { MensagemChatWhatsApp } from '../whatsappChat.js';

export interface ConversaRecenteWhatsApp {
  conversaId: string;
  /** Não lidas segundo o próprio WhatsApp (o que ainda não foi lido no celular). */
  naoLidas: number;
}

/** Operações do WhatsApp usadas pelo chat do Radar (implementado por WhatsAppWebClient). */
export interface IWhatsAppChat {
  /** Toda mensagem criada numa conversa: recebida ou enviada de qualquer aparelho do número. */
  onMensagem(callback: (mensagem: MensagemChatWhatsApp) => void): void;
  /** Chamado a cada vez que a sessão fica pronta (inclusive após reconectar). */
  onConectado(callback: () => void): void;
  estaConectado(): boolean;
  enviarTexto(conversaId: string, texto: string): Promise<MensagemChatWhatsApp>;
  listarConversasRecentes(limite: number): Promise<ConversaRecenteWhatsApp[]>;
  buscarMensagens(conversaId: string, limite: number): Promise<MensagemChatWhatsApp[]>;
}
