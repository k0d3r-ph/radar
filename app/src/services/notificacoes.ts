import { listarUsuarios } from "./auth";
import type { UsuarioDocument } from "./auth";
import type { Empresa } from "../types";
import { normalizarTelefoneWhatsApp } from "../utils/telefone";

import { compararCS } from "../utils/cs";
import { compararComercial } from "../utils/comercial";

const BASE_URL = window.location.origin;

export function construirUrlOcorrencia(id: string): string {
  return `${BASE_URL}/historico?ocorrencia=${id}`;
}

function normalizarTexto(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// A normalização vive em utils/telefone para que cadastro, gestão e esteira
// sigam exatamente a mesma regra.

export interface DestinatarioGestao {
  nome: string;
  telefone: string;
}

export interface ResultadoDestinatariosGestao {
  destinatarios: DestinatarioGestao[];
  /** Motivos pelos quais alguém esperado ficou de fora — exibidos no modal de confirmação. */
  avisos: string[];
}

/**
 * Eventos que disparam mensagem de gestão. Os 4 primeiros têm habilitação própria no
 * cadastro do usuário; "retorno" (volta à esteira após suspensão) e "alerta_retirado"
 * encerram uma suspensão e um alerta, então seguem a habilitação do evento que encerram —
 * quem acompanha a suspensão/o alerta fica sabendo quando o cliente sai dele.
 */
export type EventoNotificacaoGestao =
  | "suspenso"
  | "alerta"
  | "cancelado"
  | "conclusao"
  | "retorno"
  | "alerta_retirado";

const ROTULO_EVENTO: Record<EventoNotificacaoGestao, string> = {
  suspenso: "Suspensão",
  alerta: "Alerta",
  cancelado: "Cancelamento",
  conclusao: "Conclusão",
  retorno: "Suspensão",
  alerta_retirado: "Alerta",
};

const CAMPO_NOTIFICACAO: Record<
  EventoNotificacaoGestao,
  keyof Pick<
    UsuarioDocument,
    | "notificarSuspenso"
    | "notificarAlerta"
    | "notificarCancelado"
    | "notificarConclusao"
  >
> = {
  suspenso: "notificarSuspenso",
  alerta: "notificarAlerta",
  cancelado: "notificarCancelado",
  conclusao: "notificarConclusao",
  retorno: "notificarSuspenso",
  alerta_retirado: "notificarAlerta",
};

/** Habilitado por padrão: só fica de fora quem desmarcou explicitamente (`false`) o tipo de mensagem. */
function notificacaoHabilitada(
  u: UsuarioDocument,
  evento: EventoNotificacaoGestao,
): boolean {
  return u[CAMPO_NOTIFICACAO[evento]] !== false;
}

export function ehSupervisorOuMaster(u: UsuarioDocument): boolean {
  return u.cargo === "supervisor" || u.role === "master";
}

export function ehCS(u: UsuarioDocument): boolean {
  return (
    u.cargo === "analista" ||
    u.role?.toLowerCase() === "cs" ||
    u.cargo?.toLowerCase() === "cs"
  );
}

export function ehComercial(u: UsuarioDocument): boolean {
  return u.role?.toLowerCase() === "comercial" || u.cargo === "comercial";
}

/** Usuário se qualifica para receber alguma notificação de gestão via WhatsApp (Supervisor/master/CS/Comercial). */
export function elegivelNotificacoesGestao(u: UsuarioDocument): boolean {
  return ehSupervisorOuMaster(u) || ehCS(u) || ehComercial(u);
}

/**
 * Monta a lista de destinatários (WhatsApp) para a notificação de gestão de um evento
 * (Suspenso, Alerta, Cancelado ou Conclusão) de um cliente, respeitando a habilitação por
 * tipo de mensagem de cada usuário:
 *
 * - Supervisor e master: recebem de todos os clientes.
 * - CS: recebe apenas quando é o CS Responsável do cliente.
 * - Comercial: recebe apenas quando é o Comercial Responsável do cliente.
 *
 * Quando o CS/Comercial Responsável do cliente não tem usuário correspondente, o usuário
 * encontrado está sem telefone, ou optou por não receber esse tipo de mensagem, ele não
 * entra na lista — e isso vira um aviso, para que a omissão não passe despercebida na
 * hora de confirmar o envio.
 */
export async function obterDestinatariosGestao(
  empresaObjeto: Empresa,
  evento: EventoNotificacaoGestao,
): Promise<ResultadoDestinatariosGestao> {
  const usuarios = await listarUsuarios();
  const destinatarios: DestinatarioGestao[] = [];
  const avisos: string[] = [];
  const telefonesAdicionados = new Set<string>();
  const rotulo = ROTULO_EVENTO[evento];

  const adicionar = (u: UsuarioDocument) => {
    if (!u.telefone || !u.telefone.trim()) return false;
    const telefone = normalizarTelefoneWhatsApp(u.telefone);
    if (!telefone) return false;
    if (telefonesAdicionados.has(telefone)) return true;
    telefonesAdicionados.add(telefone);
    destinatarios.push({ nome: u.nome || u.email, telefone });
    return true;
  };

  const supervisoresEMasters = usuarios.filter(
    (u) => ehSupervisorOuMaster(u) && notificacaoHabilitada(u, evento),
  );
  const supervisoresSemTelefone = supervisoresEMasters.filter(
    (u) => !adicionar(u),
  );
  if (supervisoresSemTelefone.length > 0) {
    avisos.push(
      `Sem telefone válido cadastrado: ${supervisoresSemTelefone
        .map((u) => u.nome || u.email)
        .join(", ")}.`,
    );
  }

  const csNome = empresaObjeto.csResponsavel;
  if (csNome) {
    const csResponsavel = usuarios.find(
      (u) =>
        ehCS(u) &&
        (compararCS(u.nome, csNome) ||
          normalizarTexto(u.nome) === normalizarTexto(csNome)),
    );
    if (!csResponsavel) {
      avisos.push(
        `O CS Responsável "${csNome}" não tem usuário com cargo Analista e nome equivalente, então não será notificado.`,
      );
    } else if (!notificacaoHabilitada(csResponsavel, evento)) {
      avisos.push(
        `O CS Responsável "${csNome}" optou por não receber mensagens de ${rotulo}.`,
      );
    } else if (!adicionar(csResponsavel)) {
      avisos.push(
        `O CS Responsável "${csNome}" está sem telefone válido cadastrado, então não será notificado.`,
      );
    }
  } else {
    avisos.push("Este cliente não tem CS Responsável definido no cadastro.");
  }

  const comercialNome = empresaObjeto.comercialResponsavel;
  if (comercialNome) {
    const comercialResponsavel = usuarios.find(
      (u) => ehComercial(u) && compararComercial(u.nome, comercialNome),
    );

    if (!comercialResponsavel) {
      avisos.push(
        `O Comercial "${comercialNome}" não tem usuário com cargo Comercial e nome equivalente, então não será notificado.`,
      );
    } else if (!notificacaoHabilitada(comercialResponsavel, evento)) {
      avisos.push(
        `O Comercial "${comercialNome}" optou por não receber mensagens de ${rotulo}.`,
      );
    } else if (!adicionar(comercialResponsavel)) {
      avisos.push(
        `O Comercial "${comercialNome}" está sem telefone válido cadastrado, então não será notificado.`,
      );
    }
  }

  return { destinatarios, avisos };
}

/**
 * Monta a lista de destinatários (WhatsApp) para a notificação de chamado aberto —
 * diferente de {@link obterDestinatariosGestao}, aqui a mensagem vai apenas para o CS
 * Responsável do cliente (nunca Supervisor/Master/Comercial).
 */
export async function obterDestinatarioCSChamado(
  empresaObjeto: Empresa,
): Promise<ResultadoDestinatariosGestao> {
  const usuarios = await listarUsuarios();
  const avisos: string[] = [];

  const csNome = empresaObjeto.csResponsavel;
  if (!csNome) {
    avisos.push("Este cliente não tem CS Responsável definido no cadastro.");
    return { destinatarios: [], avisos };
  }

  const csResponsavel = usuarios.find(
    (u) =>
      ehCS(u) &&
      (compararCS(u.nome, csNome) || normalizarTexto(u.nome) === normalizarTexto(csNome)),
  );

  if (!csResponsavel) {
    avisos.push(
      `O CS Responsável "${csNome}" não tem usuário com cargo Analista e nome equivalente, então não será notificado.`,
    );
    return { destinatarios: [], avisos };
  }

  const telefone = csResponsavel.telefone
    ? normalizarTelefoneWhatsApp(csResponsavel.telefone)
    : "";
  if (!telefone) {
    avisos.push(
      `O CS Responsável "${csNome}" está sem telefone válido cadastrado, então não será notificado.`,
    );
    return { destinatarios: [], avisos };
  }

  return {
    destinatarios: [{ nome: csResponsavel.nome || csResponsavel.email, telefone }],
    avisos,
  };
}

export function montarMensagemChamadoAbertoCS(
  empresa: Empresa,
  descricaoChamado: string,
  ocorrenciaId?: string,
  link?: string,
): string {
  const linkChamadoLinha = link ? `\nLink: ${link}` : "";
  const linkOcorrenciaLinha = ocorrenciaId
    ? `\n${construirUrlOcorrencia(ocorrenciaId)}`
    : "";
  return `🎫 Foi aberto um *chamado* para o cliente *${empresa.nomeEmpresa}*!\n\nProblema: ${descricaoChamado}${linkChamadoLinha}${linkOcorrenciaLinha}\n\nAcesse o Radar para mais detalhes.`;
}

/** Marcador substituído pelo nome de cada destinatário no momento do disparo. */
export const PLACEHOLDER_NOME = "{nome}";

/**
 * Substitui o marcador `{nome}` pelo nome do destinatário, permitindo que uma
 * única mensagem escrita pelo treinador vire uma saudação personalizada por
 * contato. Mensagens sem o marcador seguem inalteradas.
 */
export function aplicarNomeDestinatario(texto: string, nome: string): string {
  return texto.replace(/\{nome\}/gi, nome);
}

export function montarMensagemAlertaGestao(
  empresa: Empresa,
  ocorrenciaId?: string,
): string {
  const csLinha = empresa.csResponsavel
    ? `\nCS Responsável: *${empresa.csResponsavel}*`
    : "";
  const comercialLinha = empresa.comercialResponsavel
    ? `\nComercial: *${empresa.comercialResponsavel}*`
    : "";
  const linkLinha = ocorrenciaId
    ? `\n${construirUrlOcorrencia(ocorrenciaId)}`
    : "";
  return `⚠️ *ALERTA* gerado para o cliente *${empresa.nomeEmpresa}*!${csLinha}${comercialLinha}${linkLinha}\n\nAcesse o Radar para mais detalhes.`;
}

/**
 * @param ocorrenciaId - Quando a conclusão foi detectada a partir de uma ocorrência (ex: treinamento
 * que completou a esteira), inclui o link dessa ocorrência. Quando a esteira é concluída manualmente
 * (sem uma ocorrência associada), o parâmetro deve ser omitido.
 */
export function montarMensagemConclusaoEsteiraGestao(
  empresa: Empresa,
  ocorrenciaId?: string,
): string {
  const csLinha = empresa.csResponsavel
    ? `\nCS Responsável: *${empresa.csResponsavel}*`
    : "";
  const comercialLinha = empresa.comercialResponsavel
    ? `\nComercial: *${empresa.comercialResponsavel}*`
    : "";
  const linkLinha = ocorrenciaId
    ? `\n${construirUrlOcorrencia(ocorrenciaId)}`
    : "";
  return `🎉 O cliente *${empresa.nomeEmpresa}* concluiu a esteira de onboarding!${csLinha}${comercialLinha}${linkLinha}\n\nAcesse o Radar para mais detalhes.`;
}

export function montarMensagemSuspensaoGestao(
  empresa: Empresa,
  ocorrenciaId?: string,
): string {
  const csLinha = empresa.csResponsavel
    ? `\nCS Responsável: *${empresa.csResponsavel}*`
    : "";
  const comercialLinha = empresa.comercialResponsavel
    ? `\nComercial: *${empresa.comercialResponsavel}*`
    : "";
  const linkLinha = ocorrenciaId
    ? `\n${construirUrlOcorrencia(ocorrenciaId)}`
    : "";
  return `⏸️ O cliente *${empresa.nomeEmpresa}* foi *suspenso temporariamente*!${csLinha}${comercialLinha}${linkLinha}\n\nAcesse o Radar para mais detalhes.`;
}

export function montarMensagemCanceladoGestao(
  empresa: Empresa,
  ocorrenciaId?: string,
): string {
  const csLinha = empresa.csResponsavel
    ? `\nCS Responsável: *${empresa.csResponsavel}*`
    : "";
  const comercialLinha = empresa.comercialResponsavel
    ? `\nComercial: *${empresa.comercialResponsavel}*`
    : "";
  const linkLinha = ocorrenciaId
    ? `\n${construirUrlOcorrencia(ocorrenciaId)}`
    : "";
  return `🚫 O cliente *${empresa.nomeEmpresa}* foi *cancelado*!${csLinha}${comercialLinha}${linkLinha}\n\nAcesse o Radar para mais detalhes.`;
}

/**
 * @param alertaRetirado - Quando o retorno à esteira também retirou o cliente do alerta,
 * as duas informações vão numa única mensagem.
 */
export function montarMensagemRetornoEsteiraGestao(
  empresa: Empresa,
  ocorrenciaId?: string,
  alertaRetirado = false,
): string {
  const alertaLinha = alertaRetirado
    ? "\n✅ O cliente também foi *retirado do alerta*."
    : "";
  const csLinha = empresa.csResponsavel
    ? `\nCS Responsável: *${empresa.csResponsavel}*`
    : "";
  const comercialLinha = empresa.comercialResponsavel
    ? `\nComercial: *${empresa.comercialResponsavel}*`
    : "";
  const linkLinha = ocorrenciaId
    ? `\n${construirUrlOcorrencia(ocorrenciaId)}`
    : "";
  return `🔄 O cliente *${empresa.nomeEmpresa}* *retornou à esteira* após a suspensão!${alertaLinha}${csLinha}${comercialLinha}${linkLinha}\n\nAcesse o Radar para mais detalhes.`;
}

export function montarMensagemAlertaRetiradoGestao(
  empresa: Empresa,
  ocorrenciaId?: string,
): string {
  const csLinha = empresa.csResponsavel
    ? `\nCS Responsável: *${empresa.csResponsavel}*`
    : "";
  const comercialLinha = empresa.comercialResponsavel
    ? `\nComercial: *${empresa.comercialResponsavel}*`
    : "";
  const linkLinha = ocorrenciaId
    ? `\n${construirUrlOcorrencia(ocorrenciaId)}`
    : "";
  return `✅ O cliente *${empresa.nomeEmpresa}* foi *retirado do alerta*!${csLinha}${comercialLinha}${linkLinha}\n\nAcesse o Radar para mais detalhes.`;
}
