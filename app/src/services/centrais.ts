// Consulta o server (que lê a planilha de controle do CS publicada como CSV) para
// resolver o idCentral (SSX) de um cliente a partir do nome. Ver
// server/src/infrastructure/planilha/PlanilhaCentraisService.ts.

const WHATSAPP_API_URL = import.meta.env.VITE_WHATSAPP_API_URL || "http://localhost:5000";

/**
 * Retorna o idCentral encontrado para o nome informado, ou `null` se a planilha
 * não tiver nenhuma central com esse nome (ou em caso de falha de rede/servidor —
 * uma consulta que falha não deve impedir o cadastro do cliente).
 */
export async function buscarIdCentralPorNome(nomeEmpresa: string): Promise<string | null> {
  const nome = nomeEmpresa.trim();
  if (!nome) return null;

  try {
    const resposta = await fetch(
      `${WHATSAPP_API_URL}/api/centrais/id-central?nome=${encodeURIComponent(nome)}`,
    );
    if (!resposta.ok) return null;

    const dados = await resposta.json();
    return dados?.idCentral || null;
  } catch {
    return null;
  }
}
