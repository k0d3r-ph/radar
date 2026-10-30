import type { Empresa, Ocorrencia } from '../types';

/** Recebe a carteira sem empresas internas; mantém Esteira atual e Suspensos, conforme a Home. */
export function filtrarEmpresasContatosSuporte<T extends Pick<Empresa, 'isOngoing' | 'isCancelled' | 'isSuspended' | 'dataFinalizacao' | 'dataFollowUpFinal' | 'conclusaoUnilateralCapacitacao'>>(empresas: T[]): T[] {
  return empresas.filter((empresa) => {
    if (empresa.isCancelled) return false;
    if (empresa.isSuspended) return true;
    const concluida = empresa.conclusaoUnilateralCapacitacao === true ||
      (!!empresa.dataFinalizacao?.trim() && !!empresa.dataFollowUpFinal?.trim());
    return !empresa.isOngoing && !concluida;
  });
}

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
