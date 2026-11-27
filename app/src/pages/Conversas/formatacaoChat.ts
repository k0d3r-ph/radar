import type { ConversaChat, TipoMensagemChat } from "../../services/conversasWhatsApp";
import { formatarTelefoneExibicao } from "../../utils/telefone";

const FUSO = "America/Sao_Paulo";

const formatoDia = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" });
const formatoHora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });
const formatoDiaSemana = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "long" });

/** "dd/mm/aaaa" no horário de Brasília. */
export function diaBrasilia(ms: number): string {
  return formatoDia.format(ms);
}

export function horaBrasilia(ms: number): string {
  return formatoHora.format(ms);
}

const UM_DIA = 24 * 60 * 60 * 1000;

/** Horário curto da lista: hora se hoje, "Ontem", dia da semana na última semana, senão a data. */
export function horarioLista(ms: number | null, agora = Date.now()): string {
  if (!ms) return "";
  const dia = diaBrasilia(ms);
  if (dia === diaBrasilia(agora)) return horaBrasilia(ms);
  if (dia === diaBrasilia(agora - UM_DIA)) return "Ontem";
  if (agora - ms < 6 * UM_DIA) {
    const semana = formatoDiaSemana.format(ms);
    return semana.charAt(0).toUpperCase() + semana.slice(1);
  }
  return dia;
}

/** Rótulo do separador de dia dentro da conversa. */
export function rotuloDia(ms: number, agora = Date.now()): string {
  const dia = diaBrasilia(ms);
  if (dia === diaBrasilia(agora)) return "Hoje";
  if (dia === diaBrasilia(agora - UM_DIA)) return "Ontem";
  return dia;
}

/** Nome principal da conversa: contato do cadastro, nome no WhatsApp ou o telefone. */
export function tituloConversa(conversa: ConversaChat): string {
  const vinculo = conversa.vinculos[0];
  return (
    vinculo?.contatoNome ||
    conversa.nomeContato ||
    telefoneConversa(conversa) ||
    "Contato sem telefone"
  );
}

/** Linha secundária: empresa vinculada (com "+N" se o telefone estiver em mais de um cliente). */
export function subtituloConversa(conversa: ConversaChat): string | null {
  const empresas = Array.from(new Set(conversa.vinculos.map((v) => v.nomeEmpresa)));
  if (empresas.length === 0) return null;
  return empresas.length === 1 ? empresas[0] : `${empresas[0]} +${empresas.length - 1}`;
}

export function telefoneConversa(conversa: Pick<ConversaChat, "telefone">): string {
  if (!conversa.telefone) return "";
  return formatarTelefoneExibicao(conversa.telefone) || `+${conversa.telefone}`;
}

export const ROTULO_TIPO_MENSAGEM: Record<Exclude<TipoMensagemChat, "texto">, string> = {
  imagem: "📷 Imagem",
  video: "🎬 Vídeo",
  audio: "🎤 Áudio",
  documento: "📄 Documento",
  figurinha: "🏷️ Figurinha",
  localizacao: "📍 Localização",
  contato: "👤 Contato compartilhado",
  outro: "Mensagem não suportada pelo Radar",
};

/** Busca sem acentos nem caixa. */
export function normalizarBusca(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
