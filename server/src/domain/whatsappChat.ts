/**
 * Regras puras do chat de WhatsApp do Radar (ver server/WHATSAPP_CHAT.md): normalização
 * de telefones, vínculo de conversas com clientes e classificação das mensagens.
 * Sem dependência de banco ou do WhatsApp Web, para poder ser testado isoladamente.
 */

export type TipoMensagemChat = 'texto' | 'imagem' | 'video' | 'audio' | 'documento' | 'figurinha' | 'localizacao' | 'contato' | 'outro';

/** Mensagem já convertida do WhatsApp Web para o formato do Radar. */
export interface MensagemChatWhatsApp {
  /** Identificador único da mensagem no WhatsApp (`id._serialized`). */
  id: string;
  /** Identificador da conversa (`5586...@c.us` ou `...@lid`). */
  conversaId: string;
  /** Telefone com DDI (só dígitos) quando conhecido; conversas `@lid` podem não ter. */
  telefone: string | null;
  /** Nome exibido no WhatsApp pelo contato (só em mensagens recebidas). */
  nomeContato: string | null;
  deMim: boolean;
  tipo: TipoMensagemChat;
  texto: string;
  /** Milissegundos desde 1970. */
  enviadaEm: number;
}

/** Vínculo de um telefone com um contato de cliente do cadastro. */
export interface VinculoClienteChat {
  empresaId: string;
  nomeEmpresa: string;
  contatoNome: string | null;
}

/** Tipos de mensagem do WhatsApp Web que não são conversa (avisos de sistema, reações etc.). */
const TIPOS_IGNORADOS = new Set([
  'e2e_notification', 'notification', 'notification_template', 'gp2', 'group_notification',
  'protocol', 'call_log', 'ciphertext', 'debug', 'broadcast_notification', 'reaction', 'revoked',
]);

const TIPOS_CHAT: Record<string, TipoMensagemChat> = {
  chat: 'texto',
  image: 'imagem',
  album: 'imagem',
  video: 'video',
  audio: 'audio',
  ptt: 'audio',
  document: 'documento',
  sticker: 'figurinha',
  location: 'localizacao',
  vcard: 'contato',
  multi_vcard: 'contato',
};

/** `null` quando o tipo não deve virar mensagem no chat. */
export function classificarTipoMensagem(tipoWhatsApp: string | undefined): TipoMensagemChat | null {
  if (!tipoWhatsApp || TIPOS_IGNORADOS.has(tipoWhatsApp)) return null;
  return TIPOS_CHAT[tipoWhatsApp] ?? 'outro';
}

const ROTULO_MIDIA: Record<Exclude<TipoMensagemChat, 'texto'>, string> = {
  imagem: '📷 Imagem',
  video: '🎬 Vídeo',
  audio: '🎤 Áudio',
  documento: '📄 Documento',
  figurinha: '🏷️ Figurinha',
  localizacao: '📍 Localização',
  contato: '👤 Contato',
  outro: 'Mensagem não suportada',
};

/** Texto curto para a lista de conversas. */
export function previaMensagem(tipo: TipoMensagemChat, texto: string): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  if (tipo === 'texto') return limpo.slice(0, 120);
  const rotulo = ROTULO_MIDIA[tipo];
  return (limpo ? `${rotulo}: ${limpo}` : rotulo).slice(0, 120);
}

/**
 * Só conversas individuais entram no chat: grupos, status, canais e listas de transmissão
 * são sempre ignorados, em qualquer ambiente.
 */
export function ehConversaIndividual(conversaId: string | undefined): conversaId is string {
  if (!conversaId) return false;
  if (conversaId === 'status@broadcast') return false;
  return conversaId.endsWith('@c.us') || conversaId.endsWith('@lid');
}

/** Telefone (só dígitos) embutido num identificador `...@c.us`; `null` para `@lid`. */
export function telefoneDoIdConversa(conversaId: string): string | null {
  if (!conversaId.endsWith('@c.us')) return null;
  const digitos = conversaId.slice(0, -'@c.us'.length).replace(/\D/g, '');
  return digitos || null;
}

/**
 * Chave de comparação de telefones. Para números do Brasil usa DDD + 8 últimos dígitos,
 * o que torna equivalentes "86 9 8102-0204", "558681020204" e "5586981020204" (o WhatsApp
 * ainda identifica contas antigas sem o 9). Outros países usam todos os dígitos.
 */
export function chaveTelefone(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  let digitos = String(bruto).replace(/\D/g, '').replace(/^0+/, '');
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) {
    digitos = digitos.slice(2);
  }
  if (digitos.length === 10 || digitos.length === 11) {
    return `55${digitos.slice(0, 2)}${digitos.slice(-8)}`;
  }
  return digitos.length >= 8 ? `+${digitos}` : null;
}

interface EmpresaComTelefones {
  id: string;
  nomeEmpresa?: string;
  telefone?: string;
  contatos?: { nome?: string; telefone?: string; telefones?: string[] }[];
}

/** Índice telefone → clientes, montado a partir do cadastro de empresas. */
export class IndiceTelefonesClientes {
  private readonly mapa = new Map<string, VinculoClienteChat[]>();

  constructor(empresas: EmpresaComTelefones[]) {
    for (const empresa of empresas) {
      const nomeEmpresa = (empresa.nomeEmpresa || '').trim() || 'Cliente sem nome';
      const adicionar = (telefone: string | undefined, contatoNome: string | null) => {
        const chave = chaveTelefone(telefone);
        if (!chave) return;
        const lista = this.mapa.get(chave) ?? [];
        if (lista.some((v) => v.empresaId === empresa.id && v.contatoNome === contatoNome)) return;
        lista.push({ empresaId: empresa.id, nomeEmpresa, contatoNome });
        this.mapa.set(chave, lista);
      };
      for (const contato of empresa.contatos ?? []) {
        const nome = contato.nome?.trim() || null;
        const telefones = contato.telefones?.length ? contato.telefones : [contato.telefone];
        for (const telefone of telefones) adicionar(telefone, nome);
      }
      adicionar(empresa.telefone, null);
    }
    // Contato com nome vem antes do telefone genérico do cadastro.
    for (const lista of this.mapa.values()) {
      lista.sort((a, b) => Number(b.contatoNome !== null) - Number(a.contatoNome !== null));
    }
  }

  vinculos(telefone: string | null | undefined): VinculoClienteChat[] {
    const chave = chaveTelefone(telefone);
    return chave ? [...(this.mapa.get(chave) ?? [])] : [];
  }
}

/** Limite do texto enviado pelo Radar (o WhatsApp aceita bem mais, mas o chat é para respostas curtas). */
export const TAMANHO_MAXIMO_MENSAGEM_CHAT = 4096;

export function validarTextoEnvio(texto: unknown): string {
  if (typeof texto !== 'string' || !texto.trim()) {
    throw new ErroChatWhatsApp(400, 'Digite a mensagem antes de enviar.');
  }
  if (texto.length > TAMANHO_MAXIMO_MENSAGEM_CHAT) {
    throw new ErroChatWhatsApp(400, `A mensagem passou de ${TAMANHO_MAXIMO_MENSAGEM_CHAT} caracteres. Divida em partes menores.`);
  }
  return texto.replace(/\s+$/, '');
}

export class ErroChatWhatsApp extends Error {
  constructor(public readonly status: 400 | 403 | 404 | 503, message: string) { super(message); }
}
