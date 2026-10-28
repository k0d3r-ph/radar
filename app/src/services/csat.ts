import { auth } from './firebase';
import { RADAR_API_URL } from './apiConfig.ts';
import type { Ocorrencia } from '../types';

export interface ReservaCsat extends Ocorrencia {
  empresaId?: string;
  token: string;
  criadoPor: string;
  respostas: { nome: string; nota?: number; experiencia: 'Bom' | 'Ruim'; opiniao: string; respondidoEm: number }[];
}
/** Edita uma resposta no modelo atual (1 a 5 estrelas). */
export async function editarRespostaCsatNota(ocorrenciaId: string, index: number, nota: number, opiniao: string) {
  return requisicaoCsat(`ocorrencias/${encodeURIComponent(ocorrenciaId)}/respostas/${index}/editar`, { nota, opiniao }, true);
}
/** Edita uma resposta no modelo antigo (Bom/Ruim), para registros anteriores à reintrodução das estrelas. */
export async function editarRespostaCsat(ocorrenciaId: string, index: number, experiencia: 'Bom' | 'Ruim', opiniao: string) {
  return requisicaoCsat(`ocorrencias/${encodeURIComponent(ocorrenciaId)}/respostas/${index}/editar`, { experiencia, opiniao }, true);
}
/** Busca o token do link do CSAT já gerado para a ocorrência, se houver. */
export async function buscarLinkCsatDaOcorrencia(ocorrenciaId: string): Promise<{ token: string | null; reservaId?: string }> {
  return requisicaoCsat(`ocorrencias/${encodeURIComponent(ocorrenciaId)}/link`, undefined, true);
}
/** Gera (ou retorna, se já existir) o link do CSAT a partir de uma ocorrência de treinamento já registrada. */
export async function gerarLinkCsatDaOcorrencia(ocorrenciaId: string): Promise<{ token: string; reservaId: string }> {
  return requisicaoCsat(`ocorrencias/${encodeURIComponent(ocorrenciaId)}/gerar-link`, {}, true);
}
export async function requisicaoCsat(path: string, body?: unknown, autenticada = false) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (autenticada) {
    if (!auth.currentUser) throw new Error('Entre novamente no Radar.');
    headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20000);
  try {
  const response = await fetch(`${RADAR_API_URL}/api/csat/${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers,
    signal: controller.signal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const dados = await response.json().catch(() => {
    throw new Error(`A API do CSAT retornou uma resposta inválida (HTTP ${response.status}). Confira a publicação do backend e VITE_RADAR_API_URL.`);
  });
  if (!response.ok) throw new Error(dados.error || 'Não foi possível acessar o CSAT.');
  return dados;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('A API do CSAT demorou a responder. Confira se o servidor está disponível e tente novamente.');
    if (error instanceof TypeError) throw new Error('Não foi possível conectar à API do CSAT. Confira o endereço HTTPS e CORS_ORIGIN no servidor.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
export const linkCsat = (token: string) => `${window.location.origin}/csat/${token}`;
