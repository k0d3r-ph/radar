// Consulta o server (que lê a planilha de controle do CS publicada como CSV) para
// resolver o idCentral (SSX) de um cliente a partir do nome. Ver
// server/src/infrastructure/planilha/PlanilhaCentraisService.ts.

import { RADAR_API_URL } from './apiConfig.ts';
import { auth } from './firebase';

export type DadosCentral = { nomeCentral: string; idCentral: string; valorContrato?: number };
type EntradaCache = { expiraEm: number; consulta: Promise<DadosCentral | null> };
const consultas = new Map<string, EntradaCache>();

/** Consulta autenticada, compartilhada entre preenchimento automático e salvar. */
export async function buscarDadosCentral(nomeEmpresa: string, idCentral = ''): Promise<DadosCentral | null> {
  const nome = nomeEmpresa.trim();
  if (!nome) return null;
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Entre novamente no Radar para consultar a planilha do CS.');
  const chave = JSON.stringify([usuario.uid, nome, idCentral.trim()]);
  for (const [key, entrada] of consultas) {
    if (entrada.expiraEm < Date.now()) consultas.delete(key);
  }
  const existente = consultas.get(chave);
  if (existente) return existente.consulta;
  const consulta = (async () => {
    const token = await usuario.getIdToken();
    const parametros = new URLSearchParams({ nome, idCentral: idCentral.trim() });
    const resposta = await fetch(`${RADAR_API_URL}/api/centrais/dados?${parametros}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(35_000),
    });
    if (!resposta.ok) throw new Error('Não foi possível consultar a planilha do CS. Tente novamente ou preencha os dados manualmente.');
    const dados: unknown = await resposta.json();
    if (!dados || typeof dados !== 'object' || !('central' in dados)) throw new Error('Resposta inválida da planilha do CS.');
    if (auth.currentUser?.uid !== usuario.uid) throw new Error('A sessão mudou durante a consulta. Entre novamente.');
    const central = dados.central;
    if (central === null) return null;
    if (!central || typeof central !== 'object' || !('nomeCentral' in central) || typeof central.nomeCentral !== 'string'
      || !('idCentral' in central) || typeof central.idCentral !== 'string'
      || ('valorContrato' in central && (typeof central.valorContrato !== 'number'
        || !Number.isFinite(central.valorContrato) || central.valorContrato < 0))) {
      throw new Error('Resposta inválida da planilha do CS.');
    }
    return { nomeCentral: central.nomeCentral, idCentral: central.idCentral,
      ...('valorContrato' in central ? { valorContrato: central.valorContrato as number } : {}) };
  })();
  consultas.set(chave, { consulta, expiraEm: Date.now() + 5 * 60_000 });
  try { return await consulta; }
  catch (erro) { consultas.delete(chave); throw erro; }
}

/** Mantém os campos preenchidos manualmente, incluindo contrato de valor zero. */
export function preencherDadosCentral<T extends { idCentral?: string; valorContrato?: number }>(cliente: T, central: DadosCentral): T {
  return { ...cliente, idCentral: cliente.idCentral?.trim() || central.idCentral || undefined,
    valorContrato: cliente.valorContrato ?? central.valorContrato };
}

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
      `${RADAR_API_URL}/api/centrais/id-central?nome=${encodeURIComponent(nome)}`,
    );
    if (!resposta.ok) return null;

    const dados = await resposta.json();
    return dados?.idCentral || null;
  } catch {
    return null;
  }
}
