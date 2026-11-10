import type { Ocorrencia } from "../types";
import { RADAR_API_URL } from './apiConfig.ts';
import { auth } from './firebase';

const STREAM_ERROR_MARKER = "[[ERRO_IA]]";

export async function resumirOcorrencias(
  nomeCliente: string,
  ocorrencias: Ocorrencia[],
  onChunk?: (textoAcumulado: string) => void
): Promise<string> {
  if (!auth.currentUser) throw new Error("Entre novamente no Radar para gerar o resumo.");
  const response = await fetch(`${RADAR_API_URL}/api/ia/resumir`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
    },
    body: JSON.stringify({ nomeCliente, ocorrencias }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const msg = data.details
      ? `${data.error}: ${data.details}`
      : data.error || "Falha ao gerar resumo com IA.";
    throw new Error(msg);
  }

  if (!response.body) {
    return response.text();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let acumulado = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    acumulado += decoder.decode(value, { stream: true });
    onChunk?.(acumulado.replace(STREAM_ERROR_MARKER, "").trimEnd());
  }

  const teveErroNoMeio = acumulado.includes(STREAM_ERROR_MARKER);
  const textoFinal = acumulado.replace(STREAM_ERROR_MARKER, "").trimEnd();

  if (teveErroNoMeio && !textoFinal) {
    throw new Error("Erro ao gerar resumo com IA (conexão interrompida).");
  }

  return textoFinal;
}
