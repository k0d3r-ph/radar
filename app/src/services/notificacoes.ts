import { listarUsuarios } from "./auth";
import type { UsuarioDocument } from "./auth";
import { enviarMensagemWhatsApp } from "./whatsapp";
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

/**
 * Notifica todos os usuários com cargo "supervisor" sobre um evento,
 * enviando mensagem via WhatsApp para cada um que tenha telefone cadastrado.
 * Erros são tratados silenciosamente (best-effort) para não bloquear o fluxo.
 */
async function notificarSupervisores(mensagem: string): Promise<void> {
  try {
    const usuarios = await listarUsuarios();
    const supervisores = usuarios.filter(
      (u) => u.cargo === "supervisor" && u.telefone && u.telefone.trim() !== ""
    );

    if (supervisores.length === 0) return;

    await Promise.allSettled(
      supervisores.map((supervisor) => {
        const tel = supervisor.telefone!.replace(/\D/g, "");
        const telFormatado = tel.length === 10 || tel.length === 11 ? `55${tel}` : tel;
        return enviarMensagemWhatsApp({ to: telFormatado, message: mensagem });
      })
    );
  } catch (error) {
    console.error("[notificacoes] Erro ao notificar supervisores:", error);
  }
}

/**
 * Dispara notificação de treinamento para supervisores.
 * @param nomeCliente - Nome da empresa do cliente
 * @param ocorrenciaId - ID da ocorrência de treinamento salva no Firestore
 */
export async function notificarTreinamento(nomeCliente: string, ocorrenciaId: string): Promise<void> {
  const url = construirUrlOcorrencia(ocorrenciaId);
  const mensagem = `📚 Um treinamento foi realizado para o cliente *${nomeCliente}*!\n${url}`;
  await notificarSupervisores(mensagem);
}
