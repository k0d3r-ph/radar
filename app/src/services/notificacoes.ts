import { listarUsuarios } from "./auth";
import type { UsuarioDocument } from "./auth";
import type { Empresa } from "../types";

const BASE_URL = window.location.origin;

export function construirUrlOcorrencia(id: string): string {
  return `${BASE_URL}/historico?ocorrencia=${id}`;
}

function normalizarTexto(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function formatarTelefone(telefone: string): string {
  const limpo = telefone.replace(/\D/g, "");
  return limpo.length === 10 || limpo.length === 11 ? `55${limpo}` : limpo;
}

export interface DestinatarioGestao {
  nome: string;
  telefone: string;
}

/**
 * Monta a lista de destinatários (WhatsApp) para notificações de gestão de um cliente:
 * todos os usuários com cargo "supervisor" + o CS Responsável (cargo "analista") do cliente.
 */
export async function obterDestinatariosGestao(empresaObjeto: Empresa): Promise<DestinatarioGestao[]> {
  const usuarios = await listarUsuarios();
  const destinatarios: DestinatarioGestao[] = [];
  const telefonesAdicionados = new Set<string>();

  const adicionar = (u: UsuarioDocument) => {
    if (!u.telefone || !u.telefone.trim()) return;
    const telefone = formatarTelefone(u.telefone);
    if (!telefone || telefonesAdicionados.has(telefone)) return;
    telefonesAdicionados.add(telefone);
    destinatarios.push({ nome: u.nome || u.email, telefone });
  };

  usuarios.filter((u) => u.cargo === "supervisor").forEach(adicionar);

  if (empresaObjeto.csResponsavel) {
    const csResponsavel = usuarios.find(
      (u) => u.cargo === "analista" && normalizarTexto(u.nome) === normalizarTexto(empresaObjeto.csResponsavel!)
    );
    if (csResponsavel) adicionar(csResponsavel);
  }

  return destinatarios;
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
