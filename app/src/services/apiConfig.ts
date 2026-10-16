/** Endereços dos dois processos do backend, sem barra final. */
function normalizarUrl(valor?: string): string | undefined {
  return valor?.trim().replace(/\/+$/, '');
}

const enderecoLegado = normalizarUrl(import.meta.env?.VITE_WHATSAPP_API_URL);

// O endereço antigo pode representar um domínio único com proxy para os dois
// processos. Mantê-lo como fallback evita quebrar essas publicações existentes.
export const RADAR_API_URL = normalizarUrl(import.meta.env?.VITE_RADAR_API_URL)
  || enderecoLegado
  || 'http://localhost:5001';

export const WHATSAPP_API_URL = enderecoLegado || 'http://localhost:5000';
