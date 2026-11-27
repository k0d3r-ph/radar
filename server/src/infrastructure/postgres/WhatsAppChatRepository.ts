import type pg from 'pg';
import type {
  ConversaChatRegistro,
  CursorMensagemChat,
  MensagemChatRegistro,
  OpcoesRegistroMensagem,
  RepositorioChatWhatsApp,
  ResultadoRegistroMensagem,
} from '../../domain/interfaces/RepositorioChatWhatsApp.js';
import { previaMensagem, type MensagemChatWhatsApp, type TipoMensagemChat } from '../../domain/whatsappChat.js';

type LinhaConversa = {
  id: string;
  telefone: string | null;
  nome_contato: string | null;
  ultima_mensagem_em: Date | null;
  ultima_mensagem_previa: string | null;
  ultima_mensagem_de_mim: boolean | null;
  nao_lidas: number;
};

type LinhaMensagem = {
  id: string;
  conversa_id: string;
  de_mim: boolean;
  tipo: string;
  texto: string;
  enviada_em: Date;
  enviado_por_uid: string | null;
  enviado_por_nome: string | null;
};

const COLUNAS_CONVERSA = 'id, telefone, nome_contato, ultima_mensagem_em, ultima_mensagem_previa, ultima_mensagem_de_mim, nao_lidas';
const COLUNAS_MENSAGEM = 'id, conversa_id, de_mim, tipo, texto, enviada_em, enviado_por_uid, enviado_por_nome';

function paraConversa(linha: LinhaConversa): ConversaChatRegistro {
  return {
    id: linha.id,
    telefone: linha.telefone,
    nomeContato: linha.nome_contato,
    ultimaMensagemEm: linha.ultima_mensagem_em ? linha.ultima_mensagem_em.getTime() : null,
    ultimaMensagemPrevia: linha.ultima_mensagem_previa,
    ultimaMensagemDeMim: linha.ultima_mensagem_de_mim,
    naoLidas: Number(linha.nao_lidas) || 0,
  };
}

function paraMensagem(linha: LinhaMensagem): MensagemChatRegistro {
  return {
    id: linha.id,
    conversaId: linha.conversa_id,
    deMim: linha.de_mim,
    tipo: linha.tipo as TipoMensagemChat,
    texto: linha.texto,
    enviadaEm: linha.enviada_em.getTime(),
    enviadoPorUid: linha.enviado_por_uid,
    enviadoPorNome: linha.enviado_por_nome,
  };
}

/** Conversas e mensagens do chat de WhatsApp no PostgreSQL (tabelas da migração 2). */
export class WhatsAppChatRepository implements RepositorioChatWhatsApp {
  constructor(private readonly pool: pg.Pool) {}

  async registrarMensagem(mensagem: MensagemChatWhatsApp, opcoes: OpcoesRegistroMensagem): Promise<ResultadoRegistroMensagem> {
    const cliente = await this.pool.connect();
    try {
      await cliente.query('begin');
      // Garante a conversa e a trava: mensagens simultâneas da mesma conversa são gravadas em fila.
      await cliente.query(
        `insert into whatsapp_conversas (id, telefone, nome_contato) values ($1, $2, $3)
         on conflict (id) do update set
           telefone = coalesce(whatsapp_conversas.telefone, excluded.telefone),
           nome_contato = coalesce(excluded.nome_contato, whatsapp_conversas.nome_contato)`,
        [mensagem.conversaId, mensagem.telefone, mensagem.nomeContato],
      );
      await cliente.query('select 1 from whatsapp_conversas where id = $1 for update', [mensagem.conversaId]);

      const inserida = await cliente.query<LinhaMensagem>(
        `insert into whatsapp_mensagens (id, conversa_id, de_mim, tipo, texto, enviada_em, enviado_por_uid, enviado_por_nome)
         values ($1, $2, $3, $4, $5, to_timestamp($6::double precision / 1000), $7, $8)
         on conflict (id) do nothing
         returning ${COLUNAS_MENSAGEM}`,
        [
          mensagem.id, mensagem.conversaId, mensagem.deMim, mensagem.tipo, mensagem.texto,
          mensagem.enviadaEm, opcoes.autor?.uid ?? null, opcoes.autor?.nome ?? null,
        ],
      );
      const nova = inserida.rowCount === 1;

      let linhaMensagem: LinhaMensagem;
      if (nova) {
        linhaMensagem = inserida.rows[0];
        // Só a mensagem mais recente atualiza a prévia (a recuperação pode trazer antigas depois).
        await cliente.query(
          `update whatsapp_conversas set
             ultima_mensagem_em = case when ultima_mensagem_em is null or $2 >= ultima_mensagem_em then $2 else ultima_mensagem_em end,
             ultima_mensagem_previa = case when ultima_mensagem_em is null or $2 >= ultima_mensagem_em then $3 else ultima_mensagem_previa end,
             ultima_mensagem_de_mim = case when ultima_mensagem_em is null or $2 >= ultima_mensagem_em then $4 else ultima_mensagem_de_mim end,
             nao_lidas = case when $5 then nao_lidas + 1 when $4 then 0 else nao_lidas end,
             atualizado_em = now()
           where id = $1`,
          [mensagem.conversaId, linhaMensagem.enviada_em, previaMensagem(mensagem.tipo, mensagem.texto), mensagem.deMim,
            opcoes.contarNaoLida && !mensagem.deMim],
        );
      } else {
        // O evento do WhatsApp pode chegar antes da resposta do envio: completa o autor sem sobrescrever.
        const existente = await cliente.query<LinhaMensagem>(
          `update whatsapp_mensagens set
             enviado_por_uid = coalesce(enviado_por_uid, $2),
             enviado_por_nome = coalesce(enviado_por_nome, $3)
           where id = $1
           returning ${COLUNAS_MENSAGEM}`,
          [mensagem.id, opcoes.autor?.uid ?? null, opcoes.autor?.nome ?? null],
        );
        linhaMensagem = existente.rows[0];
      }

      const conversa = await cliente.query<LinhaConversa>(
        `select ${COLUNAS_CONVERSA} from whatsapp_conversas where id = $1`, [mensagem.conversaId],
      );
      await cliente.query('commit');
      return { nova, conversa: paraConversa(conversa.rows[0]), mensagem: paraMensagem(linhaMensagem) };
    } catch (erro) {
      await cliente.query('rollback').catch(() => undefined);
      throw erro;
    } finally {
      cliente.release();
    }
  }

  async listarConversas(limite: number): Promise<ConversaChatRegistro[]> {
    const { rows } = await this.pool.query<LinhaConversa>(
      `select ${COLUNAS_CONVERSA} from whatsapp_conversas
       order by ultima_mensagem_em desc nulls last, id limit $1`,
      [limite],
    );
    return rows.map(paraConversa);
  }

  async obterConversa(id: string): Promise<ConversaChatRegistro | null> {
    const { rows } = await this.pool.query<LinhaConversa>(
      `select ${COLUNAS_CONVERSA} from whatsapp_conversas where id = $1`, [id],
    );
    return rows[0] ? paraConversa(rows[0]) : null;
  }

  async listarMensagens(conversaId: string, limite: number, antes?: CursorMensagemChat): Promise<MensagemChatRegistro[]> {
    const { rows } = await this.pool.query<LinhaMensagem>(
      `select ${COLUNAS_MENSAGEM} from whatsapp_mensagens
       where conversa_id = $1
         and ($3::double precision is null or (enviada_em, id) < (to_timestamp($3::double precision / 1000), $4::text))
       order by enviada_em desc, id desc limit $2`,
      [conversaId, limite, antes?.enviadaEm ?? null, antes?.id ?? ''],
    );
    return rows.map(paraMensagem).reverse();
  }

  async marcarComoLida(conversaId: string): Promise<ConversaChatRegistro | null> {
    const { rows } = await this.pool.query<LinhaConversa>(
      `update whatsapp_conversas set nao_lidas = 0, atualizado_em = now()
       where id = $1 returning ${COLUNAS_CONVERSA}`,
      [conversaId],
    );
    return rows[0] ? paraConversa(rows[0]) : null;
  }

  async definirNaoLidas(conversaId: string, quantidade: number): Promise<void> {
    await this.pool.query(
      'update whatsapp_conversas set nao_lidas = $2, atualizado_em = now() where id = $1',
      [conversaId, Math.max(0, Math.floor(quantidade) || 0)],
    );
  }
}
