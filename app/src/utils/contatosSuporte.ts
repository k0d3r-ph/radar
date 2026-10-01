import type { Ocorrencia } from '../types';

export type CategoriaContatoSuporte = 'duvidas' | 'problemas' | 'solicitacoes' | 'semClassificacao';

/** A classificação atual do Radar prevalece sobre as tags originais do SSX Desk. */
export function obterCategoriaContatoSuporte(o: Pick<Ocorrencia, 'tipo'>): CategoriaContatoSuporte | null {
  const tipo = (o.tipo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  if (!tipo) return 'semClassificacao';
  if (tipo.includes('duvida')) return 'duvidas';
  if (tipo.includes('problema')) return 'problemas';
  if (tipo.includes('solicita')) return 'solicitacoes';
  return null;
}
