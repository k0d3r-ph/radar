import type { IWhatsAppChat } from '../../domain/interfaces/IWhatsAppChat.js';
import type {
  AutorEnvioChat,
  ConversaChatRegistro,
  CursorMensagemChat,
  MensagemChatRegistro,
  RepositorioChatWhatsApp,
} from '../../domain/interfaces/RepositorioChatWhatsApp.js';
import {
  ErroChatWhatsApp,
  ehConversaIndividual,
  validarTextoEnvio,
  type IndiceTelefonesClientes,
  type MensagemChatWhatsApp,
  type VinculoClienteChat,
} from '../../domain/whatsappChat.js';

/** Conversa como a tela recebe: com os clientes vinculados pelo telefone. */
export interface ConversaChat extends ConversaChatRegistro {
  vinculos: VinculoClienteChat[];
}

export type EventoChat =
  | { tipo: 'mensagem'; conversa: ConversaChat; mensagem: MensagemChatRegistro }
  | { tipo: 'conversa'; conversa: ConversaChat };

export interface ProvedorIndiceClientes {
  obter(opcoes?: { recarregar?: boolean }): Promise<IndiceTelefonesClientes>;
}

export interface OpcoesChatWhatsApp {
  /**
   * Grava só conversas com telefones cadastrados em clientes. Usado no ambiente local
   * conectado a um número pessoal, para não guardar conversas particulares.
   */
  somenteClientes: boolean;
}

export const LIMITE_CONVERSAS_LISTA = 300;
export const LIMITE_MENSAGENS_PAGINA = 50;
/** Espera antes de cada tentativa de recuperação após conectar (multiplicada pela tentativa). */
const ESPERA_RECUPERACAO_MS = 20_000;
const TENTATIVAS_RECUPERACAO = 3;

/**
 * Chat de WhatsApp do Radar: grava o que chega e sai pelo número conectado, lista as
 * conversas com o cliente vinculado e envia respostas registrando quem enviou.
 */
export class ChatWhatsApp {
  private readonly ouvintes: ((evento: EventoChat) => void)[] = [];

  constructor(
    private readonly repositorio: RepositorioChatWhatsApp,
    private readonly whatsapp: IWhatsAppChat,
    private readonly indice: ProvedorIndiceClientes,
    private readonly opcoes: OpcoesChatWhatsApp,
  ) {}

  /** Liga o chat aos eventos do WhatsApp. Chamar uma vez, na inicialização do processo. */
  iniciar(): void {
    this.whatsapp.onMensagem((mensagem) => {
      this.registrar(mensagem, { contarNaoLida: true }).catch((erro) => {
        console.error('[Chat WhatsApp] Falha ao gravar mensagem:', erro);
      });
    });
    // Logo após conectar o WhatsApp Web ainda sincroniza as conversas: espera e tenta de novo se falhar.
    this.whatsapp.onConectado(() => {
      const tentar = (tentativa: number) => {
        setTimeout(() => {
          this.recuperarRecentes().catch((erro) => {
            if (tentativa < TENTATIVAS_RECUPERACAO) {
              tentar(tentativa + 1);
            } else {
              console.error('[Chat WhatsApp] Falha ao recuperar mensagens recentes:', erro);
            }
          });
        }, ESPERA_RECUPERACAO_MS * tentativa);
      };
      tentar(1);
    });
  }

  aoMudar(ouvinte: (evento: EventoChat) => void): void {
    this.ouvintes.push(ouvinte);
  }

  private emitir(evento: EventoChat): void {
    for (const ouvinte of this.ouvintes) {
      try { ouvinte(evento); } catch (erro) { console.error('[Chat WhatsApp] Erro ao avisar a tela:', erro); }
    }
  }

  private decorar(conversa: ConversaChatRegistro, indice: IndiceTelefonesClientes): ConversaChat {
    return { ...conversa, vinculos: indice.vinculos(conversa.telefone) };
  }

  /** Grava a mensagem e avisa as telas. */
  async registrar(
    mensagem: MensagemChatWhatsApp,
    opcoes: { contarNaoLida: boolean; autor?: AutorEnvioChat; avisar?: boolean },
  ): Promise<'ignorada' | 'nova' | 'existente'> {
    if (!ehConversaIndividual(mensagem.conversaId)) return 'ignorada';
    const indice = await this.indice.obter();
    if (this.opcoes.somenteClientes && indice.vinculos(mensagem.telefone).length === 0) {
      console.warn('[DIAGNOSTICO TEMPORARIO] ignorada por não ser de cliente:', mensagem.conversaId.replace(/\d(?=\d{4})/g, '*'), 'telefone:', mensagem.telefone ? mensagem.telefone.replace(/\d(?=\d{4})/g, '*') : 'desconhecido');
      return 'ignorada';
    }

    const resultado = await this.repositorio.registrarMensagem(mensagem, opcoes);
    // Reenvio já gravado só é avisado quando completa o autor (resposta do envio pelo Radar).
    if ((resultado.nova || opcoes.autor) && opcoes.avisar !== false) {
      this.emitir({ tipo: 'mensagem', conversa: this.decorar(resultado.conversa, indice), mensagem: resultado.mensagem });
    }
    return resultado.nova ? 'nova' : 'existente';
  }

  async listarConversas(opcoes: { recarregarVinculos?: boolean } = {}): Promise<ConversaChat[]> {
    const [indice, conversas] = await Promise.all([
      this.indice.obter({ recarregar: opcoes.recarregarVinculos }),
      this.repositorio.listarConversas(LIMITE_CONVERSAS_LISTA),
    ]);
    const lista = conversas.map((c) => this.decorar(c, indice));
    return this.opcoes.somenteClientes ? lista.filter((c) => c.vinculos.length > 0) : lista;
  }

  private async conversaExistente(id: string): Promise<ConversaChat> {
    const [conversa, indice] = await Promise.all([this.repositorio.obterConversa(id), this.indice.obter()]);
    if (!conversa) throw new ErroChatWhatsApp(404, 'Conversa não encontrada. Atualize a lista de conversas.');
    const decorada = this.decorar(conversa, indice);
    if (this.opcoes.somenteClientes && decorada.vinculos.length === 0) {
      throw new ErroChatWhatsApp(404, 'Conversa não encontrada. Atualize a lista de conversas.');
    }
    return decorada;
  }

  async listarMensagens(conversaId: string, antes?: CursorMensagemChat): Promise<MensagemChatRegistro[]> {
    await this.conversaExistente(conversaId);
    return this.repositorio.listarMensagens(conversaId, LIMITE_MENSAGENS_PAGINA, antes);
  }

  async enviar(conversaId: string, texto: unknown, autor: AutorEnvioChat): Promise<MensagemChatRegistro> {
    const conteudo = validarTextoEnvio(texto);
    await this.conversaExistente(conversaId);
    if (!this.whatsapp.estaConectado()) {
      throw new ErroChatWhatsApp(503, 'O WhatsApp está desconectado. Conecte o número na tela WhatsApp e tente de novo.');
    }
    const enviada = await this.whatsapp.enviarTexto(conversaId, conteudo);
    const resultado = await this.repositorio.registrarMensagem(enviada, { contarNaoLida: false, autor });
    const indice = await this.indice.obter();
    this.emitir({ tipo: 'mensagem', conversa: this.decorar(resultado.conversa, indice), mensagem: resultado.mensagem });
    return resultado.mensagem;
  }

  async marcarComoLida(conversaId: string): Promise<ConversaChat> {
    await this.conversaExistente(conversaId);
    const conversa = await this.repositorio.marcarComoLida(conversaId);
    if (!conversa) throw new ErroChatWhatsApp(404, 'Conversa não encontrada. Atualize a lista de conversas.');
    const decorada = this.decorar(conversa, await this.indice.obter());
    this.emitir({ tipo: 'conversa', conversa: decorada });
    return decorada;
  }

  /**
   * Depois de conectar (ou reconectar), traz as últimas mensagens das conversas mais
   * recentes, para cobrir o período em que o processo ficou fora. O que já estava gravado
   * é ignorado; as não lidas passam a refletir o que o WhatsApp indica.
   */
  async recuperarRecentes(limiteConversas = 30, limiteMensagens = 30): Promise<number> {
    const recentes = await this.whatsapp.listarConversasRecentes(limiteConversas);
    let gravadas = 0;
    for (const conversa of recentes) {
      if (!ehConversaIndividual(conversa.conversaId)) continue;
      try {
        const mensagens = await this.whatsapp.buscarMensagens(conversa.conversaId, limiteMensagens);
        let novas = 0;
        let novaRecebida = false;
        for (const mensagem of mensagens) {
          if (await this.registrar(mensagem, { contarNaoLida: false, avisar: false }) === 'nova') {
            novas++;
            if (!mensagem.deMim) novaRecebida = true;
          }
        }
        // Só chegou algo enquanto o processo estava fora: vale o que o WhatsApp indica como não lido.
        if (novaRecebida) await this.repositorio.definirNaoLidas(conversa.conversaId, conversa.naoLidas);
        if (novas > 0) gravadas++;
      } catch (erro) {
        console.warn(`[Chat WhatsApp] Não foi possível recuperar a conversa ${conversa.conversaId}:`, erro);
      }
    }
    if (gravadas > 0) {
      const indice = await this.indice.obter();
      for (const conversa of await this.repositorio.listarConversas(limiteConversas)) {
        this.emitir({ tipo: 'conversa', conversa: this.decorar(conversa, indice) });
      }
    }
    console.log(`[Chat WhatsApp] Recuperação concluída: ${gravadas} conversa(s) atualizadas.`);
    return gravadas;
  }
}
