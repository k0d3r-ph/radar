import type { Empresa } from '../types';

export type PendenciaCliente = NonNullable<Empresa['pendencia']>;

/** Data inclusiva em Brasília: vence na meia-noite seguinte, independentemente do navegador. */
export function vencimentoPendencia(venceEm?: string): number | undefined {
  if (!venceEm) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(venceEm)) return NaN;
  const inicio = Date.parse(`${venceEm}T00:00:00-03:00`);
  if (!Number.isFinite(inicio) || new Date(inicio - 3 * 60 * 60 * 1000).toISOString().slice(0, 10) !== venceEm) return NaN;
  return inicio + 24 * 60 * 60 * 1000;
}

export function pendenciaAtiva(pendencia?: PendenciaCliente, agora = Date.now()): boolean {
  if (!pendencia?.ativa || !pendencia.tipoId || !pendencia.tipoNome.trim()) return false;
  const fim = vencimentoPendencia(pendencia.venceEm);
  return fim === undefined || (Number.isFinite(fim) && agora < fim);
}
