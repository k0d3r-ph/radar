import { auth } from './firebase';
import type { Ocorrencia } from '../types';

export interface ReservaCsat extends Ocorrencia {
  token: string;
  criadoPor: string;
  respostas: { nome: string; experiencia: 'Bom' | 'Ruim'; opiniao: string; respondidoEm: number }[];
}
export async function requisicaoCsat(path: string, body?: unknown, autenticada = false) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (autenticada) {
    if (!auth.currentUser) throw new Error('Entre novamente no Radar.');
    headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  }
  const response = await fetch(`${import.meta.env.VITE_WHATSAPP_API_URL || 'http://localhost:5000'}/api/csat/${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const dados = await response.json();
  if (!response.ok) throw new Error(dados.error || 'Não foi possível acessar o CSAT.');
  return dados;
}
export const linkCsat = (token: string) => `${window.location.origin}/csat/${token}`;
