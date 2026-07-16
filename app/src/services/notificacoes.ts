import { listarUsuarios } from "./auth";
import { enviarMensagemWhatsApp } from "./whatsapp";

const BASE_URL = window.location.origin;

function construirUrlOcorrencia(id: string): string {
  return `${BASE_URL}/historico?ocorrencia=${id}`;
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
 * Dispara notificação de alerta para supervisores.
 * @param nomeCliente - Nome da empresa do cliente
 * @param ocorrenciaId - ID da ocorrência de alerta salva no Firestore
 */
export async function notificarAlerta(nomeCliente: string, ocorrenciaId: string): Promise<void> {
  const url = construirUrlOcorrencia(ocorrenciaId);
  const mensagem = `⚠️ *ALERTA* gerado para o cliente *${nomeCliente}*!\n${url}`;
  await notificarSupervisores(mensagem);
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
