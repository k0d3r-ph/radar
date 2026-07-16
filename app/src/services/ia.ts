import type { Ocorrencia } from "../types";

const WHATSAPP_API_URL = import.meta.env.VITE_WHATSAPP_API_URL || "http://localhost:5000";

export async function resumirOcorrencias(
  nomeCliente: string,
  ocorrencias: Ocorrencia[]
): Promise<string> {
  const response = await fetch(`${WHATSAPP_API_URL}/api/ia/resumir`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nomeCliente, ocorrencias }),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const msg = data.details
      ? `${data.error}: ${data.details}`
      : data.error || "Falha ao gerar resumo com IA.";
    throw new Error(msg);
  }

  return data.resumo as string;
}
