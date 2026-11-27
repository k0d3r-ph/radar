import { io, type Socket } from "socket.io-client";
import { WHATSAPP_API_URL } from "./apiConfig.ts";
import { cabecalhosAutenticados, obterTokenSocketWhatsApp } from "./whatsapp.ts";

/**
 * Chat de WhatsApp do Radar (rotas do processo do bot; ver server/WHATSAPP_CHAT.md).
 * Só master e treinador têm acesso.
 */

export type TipoMensagemChat =
  | "texto"
  | "imagem"
  | "video"
  | "audio"
  | "documento"
  | "figurinha"
  | "localizacao"
  | "contato"
  | "outro";

export interface VinculoClienteChat {
  empresaId: string;
  nomeEmpresa: string;
  contatoNome: string | null;
}

export interface ConversaChat {
  id: string;
  telefone: string | null;
  nomeContato: string | null;
  ultimaMensagemEm: number | null;
  ultimaMensagemPrevia: string | null;
  ultimaMensagemDeMim: boolean | null;
  naoLidas: number;
  vinculos: VinculoClienteChat[];
}

export interface MensagemChat {
  id: string;
  conversaId: string;
  deMim: boolean;
  tipo: TipoMensagemChat;
  texto: string;
  enviadaEm: number;
  enviadoPorUid: string | null;
  enviadoPorNome: string | null;
}

export type EventoChat =
  | { tipo: "mensagem"; conversa: ConversaChat; mensagem: MensagemChat }
  | { tipo: "conversa"; conversa: ConversaChat };

async function requisitar<T>(caminho: string, init: RequestInit = {}, padraoErro: string): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(`${WHATSAPP_API_URL}${caminho}`, {
      ...init,
      headers: await cabecalhosAutenticados(
        init.body ? { "Content-Type": "application/json" } : {},
      ),
    });
  } catch (erro) {
    throw new Error("Sem conexão com o serviço de WhatsApp. Verifique a internet e tente de novo.", { cause: erro });
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok || dados.success !== true) {
    if (resposta.status === 403) throw new Error("Seu perfil não tem acesso às conversas do WhatsApp.");
    throw new Error(dados.error || padraoErro);
  }
  return dados as T;
}

const caminhoConversa = (id: string) => `/api/whatsapp/conversas/${encodeURIComponent(id)}`;

export async function listarConversasChat(opcoes: { recarregarVinculos?: boolean } = {}): Promise<ConversaChat[]> {
  const query = opcoes.recarregarVinculos ? "?recarregar=1" : "";
  const dados = await requisitar<{ conversas: ConversaChat[] }>(
    `/api/whatsapp/conversas${query}`, {}, "Não foi possível carregar as conversas.",
  );
  return dados.conversas;
}

/** Mensagens em ordem cronológica; `antes` é a mais antiga já exibida (para carregar anteriores). */
export async function listarMensagensChat(
  conversaId: string,
  antes?: Pick<MensagemChat, "enviadaEm" | "id">,
): Promise<MensagemChat[]> {
  const query = antes
    ? `?antesEm=${antes.enviadaEm}&antesId=${encodeURIComponent(antes.id)}`
    : "";
  const dados = await requisitar<{ mensagens: MensagemChat[] }>(
    `${caminhoConversa(conversaId)}/mensagens${query}`, {}, "Não foi possível carregar as mensagens.",
  );
  return dados.mensagens;
}

export async function enviarMensagemChat(conversaId: string, texto: string): Promise<MensagemChat> {
  const dados = await requisitar<{ mensagem: MensagemChat }>(
    `${caminhoConversa(conversaId)}/mensagens`,
    { method: "POST", body: JSON.stringify({ texto }) },
    "Não foi possível enviar a mensagem pelo WhatsApp.",
  );
  return dados.mensagem;
}

export async function marcarConversaChatComoLida(conversaId: string): Promise<ConversaChat> {
  const dados = await requisitar<{ conversa: ConversaChat }>(
    `${caminhoConversa(conversaId)}/lida`,
    { method: "POST" },
    "Não foi possível marcar a conversa como lida.",
  );
  return dados.conversa;
}

/** Socket do bot (status da sessão e eventos do chat), com o token renovado a cada conexão. */
export function conectarSocketWhatsApp(): Socket {
  return io(WHATSAPP_API_URL, {
    auth: (callback) => {
      obterTokenSocketWhatsApp().then(
        (token) => callback({ token }),
        () => callback({}),
      );
    },
  });
}
