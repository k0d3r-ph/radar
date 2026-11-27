import type { MensagemChatWhatsApp, TipoMensagemChat } from '../whatsappChat.js';

export interface ConversaChatRegistro {
  id: string;
  telefone: string | null;
  nomeContato: string | null;
  ultimaMensagemEm: number | null;
  ultimaMensagemPrevia: string | null;
  ultimaMensagemDeMim: boolean | null;
  naoLidas: number;
}

export interface MensagemChatRegistro {
  id: string;
  conversaId: string;
  deMim: boolean;
  tipo: TipoMensagemChat;
  texto: string;
  enviadaEm: number;
  enviadoPorUid: string | null;
  enviadoPorNome: string | null;
}

/** Posição na conversa: o WhatsApp registra o horário em segundos, então o id desempata. */
export interface CursorMensagemChat {
  enviadaEm: number;
  id: string;
}

export interface AutorEnvioChat {
  uid: string;
  nome: string | null;
}

export interface OpcoesRegistroMensagem {
  /** Quem enviou pelo Radar (mensagens enviadas pelo celular ou outro aparelho não têm). */
  autor?: AutorEnvioChat;
  /** Mensagem recebida em tempo real conta como não lida; a recuperação após queda não conta. */
  contarNaoLida: boolean;
}

export interface ResultadoRegistroMensagem {
  /** `false` quando a mensagem já estava gravada (reenvio do WhatsApp ou recuperação). */
  nova: boolean;
  conversa: ConversaChatRegistro;
  mensagem: MensagemChatRegistro;
}

export interface RepositorioChatWhatsApp {
  registrarMensagem(mensagem: MensagemChatWhatsApp, opcoes: OpcoesRegistroMensagem): Promise<ResultadoRegistroMensagem>;
  listarConversas(limite: number): Promise<ConversaChatRegistro[]>;
  obterConversa(id: string): Promise<ConversaChatRegistro | null>;
  /** Mensagens em ordem cronológica; `antes` (a mais antiga já exibida) pagina para trás. */
  listarMensagens(conversaId: string, limite: number, antes?: CursorMensagemChat): Promise<MensagemChatRegistro[]>;
  marcarComoLida(conversaId: string): Promise<ConversaChatRegistro | null>;
  definirNaoLidas(conversaId: string, quantidade: number): Promise<void>;
}
