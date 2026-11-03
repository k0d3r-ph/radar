import type { Empresa, Ocorrencia } from '../types';

/**
 * Recebe a carteira sem empresas internas; mantém Esteira atual e Suspensos, conforme a Home.
 * `incluirConcluidos` amplia a carteira para também manter os clientes já concluídos (usado
 * no filtro por esteira do relatório de Contato com Suporte); por padrão fica desligado para
 * não alterar o indicador por treinador em `indicadoresTreinamento.ts`.
 */
export function filtrarEmpresasContatosSuporte<T extends Pick<Empresa, 'isOngoing' | 'isCancelled' | 'isSuspended' | 'dataFinalizacao' | 'dataFollowUpFinal' | 'conclusaoUnilateralCapacitacao'>>(
  empresas: T[],
  opcoes?: { incluirConcluidos?: boolean },
): T[] {
  return empresas.filter((empresa) => {
    if (empresa.isCancelled) return false;
    if (empresa.isSuspended) return true;
    const concluida = empresa.conclusaoUnilateralCapacitacao === true ||
      (!!empresa.dataFinalizacao?.trim() && !!empresa.dataFollowUpFinal?.trim());
    if (concluida) return !!opcoes?.incluirConcluidos;
    return !empresa.isOngoing;
  });
}

export type EsteiraContatoSuporte = 'ativa' | 'suspenso' | 'concluido';

/** Esteira de uma empresa já filtrada por `filtrarEmpresasContatosSuporte`, para o filtro
 * por esteira da lista de detalhamento de Contato com Suporte. */
export function obterEsteiraContatoSuporte(empresa: Pick<Empresa, 'isSuspended' | 'dataFinalizacao' | 'dataFollowUpFinal' | 'conclusaoUnilateralCapacitacao'>): EsteiraContatoSuporte {
  if (empresa.isSuspended) return 'suspenso';
  const concluida = empresa.conclusaoUnilateralCapacitacao === true ||
    (!!empresa.dataFinalizacao?.trim() && !!empresa.dataFollowUpFinal?.trim());
  return concluida ? 'concluido' : 'ativa';
}

export function filtrarEmpresasPorEsteiraContatoSuporte<T extends Pick<Empresa, 'isSuspended' | 'dataFinalizacao' | 'dataFollowUpFinal' | 'conclusaoUnilateralCapacitacao'>>(
  empresas: T[],
  esteiras: EsteiraContatoSuporte[],
): T[] {
  if (esteiras.length === 0) return empresas;
  return empresas.filter((empresa) => esteiras.includes(obterEsteiraContatoSuporte(empresa)));
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
