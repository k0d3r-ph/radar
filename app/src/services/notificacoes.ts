import { listarUsuarios } from "./auth";
import type { UsuarioDocument } from "./auth";
import type { Empresa } from "../types";
import { normalizarTelefoneWhatsApp } from "../utils/telefone";

import { compararCS } from "../utils/cs";

const BASE_URL = window.location.origin;

export function construirUrlOcorrencia(id: string): string {
  return `${BASE_URL}/historico?ocorrencia=${id}`;
}

function normalizarTexto(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
 * Monta a lista de destinatários (WhatsApp) para notificações de gestão de um cliente:
 * todos os usuários com cargo "supervisor" + o CS Responsável (cargo "analista") do cliente.
 *
 * Quando o CS Responsável do cliente não tem usuário correspondente, ou o usuário
 * encontrado está sem telefone, ele não entra na lista — e isso vira um aviso, para
 * que a omissão não passe despercebida na hora de confirmar o envio.
 */
export async function obterDestinatariosGestao(
  empresaObjeto: Empresa
): Promise<ResultadoDestinatariosGestao> {
  const usuarios = await listarUsuarios();
  const destinatarios: DestinatarioGestao[] = [];
  const avisos: string[] = [];
  const telefonesAdicionados = new Set<string>();

  const adicionar = (u: UsuarioDocument) => {
    if (!u.telefone || !u.telefone.trim()) return false;
    const telefone = normalizarTelefoneWhatsApp(u.telefone);
    if (!telefone) return false;
    if (telefonesAdicionados.has(telefone)) return true;
    telefonesAdicionados.add(telefone);
    destinatarios.push({ nome: u.nome || u.email, telefone });
    return true;
  };

  const supervisores = usuarios.filter((u) => u.cargo === "supervisor");
  const supervisoresSemTelefone = supervisores.filter((u) => !adicionar(u));
  if (supervisoresSemTelefone.length > 0) {
    avisos.push(
      `Sem telefone válido cadastrado: ${supervisoresSemTelefone
        .map((u) => u.nome || u.email)
        .join(", ")}.`
    );
  }

  const csNome = empresaObjeto.csResponsavel;
  if (csNome) {
    const csResponsavel = usuarios.find(
      (u) =>
        (u.cargo === "analista" || u.role?.toLowerCase() === "cs" || u.cargo?.toLowerCase() === "cs") &&
        (compararCS(u.nome, csNome) || normalizarTexto(u.nome) === normalizarTexto(csNome))
    );
    if (!csResponsavel) {
      avisos.push(
        `O CS Responsável "${csNome}" não tem usuário com cargo Analista e nome equivalente, então não será notificado.`
      );
    } else if (!adicionar(csResponsavel)) {
      avisos.push(
        `O CS Responsável "${csNome}" está sem telefone válido cadastrado, então não será notificado.`
      );
    }
  } else {
    avisos.push("Este cliente não tem CS Responsável definido no cadastro.");
  }

  return { destinatarios, avisos };
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

export function montarMensagemAlertaGestao(empresa: Empresa, ocorrenciaId?: string): string {
  const csLinha = empresa.csResponsavel ? `\nCS Responsável: *${empresa.csResponsavel}*` : "";
  const linkLinha = ocorrenciaId ? `\n${construirUrlOcorrencia(ocorrenciaId)}` : "";
  return `⚠️ *ALERTA* gerado para o cliente *${empresa.nomeEmpresa}*!${csLinha}${linkLinha}\n\nAcesse o sistema para mais detalhes.`;
}

/**
 * @param ocorrenciaId - Quando a conclusão foi detectada a partir de uma ocorrência (ex: treinamento
 * que completou a esteira), inclui o link dessa ocorrência. Quando a esteira é concluída manualmente
 * (sem uma ocorrência associada), o parâmetro deve ser omitido.
 */
export function montarMensagemConclusaoEsteiraGestao(empresa: Empresa, ocorrenciaId?: string): string {
  const csLinha = empresa.csResponsavel ? `\nCS Responsável: *${empresa.csResponsavel}*` : "";
  const linkLinha = ocorrenciaId ? `\n${construirUrlOcorrencia(ocorrenciaId)}` : "";
  return `🎉 O cliente *${empresa.nomeEmpresa}* concluiu a esteira de onboarding!${csLinha}${linkLinha}\n\nAcesse o sistema para mais detalhes.`;
}

export function montarMensagemSuspensaoGestao(empresa: Empresa): string {
  const csLinha = empresa.csResponsavel ? `\nCS Responsável: *${empresa.csResponsavel}*` : "";
  return `⏸️ O cliente *${empresa.nomeEmpresa}* foi *suspenso temporariamente*!${csLinha}\n\nAcesse o sistema para mais detalhes.`;
}
