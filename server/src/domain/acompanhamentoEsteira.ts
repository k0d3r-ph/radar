export const PRAZO_FOLLOW_UP_FINAL = 20;
export const PRAZO_AGENDAR_TREINAMENTO = 4;
export const normalizarCliente = (nome: string) => nome.trim().toLowerCase();
const normalizarPessoa = (nome: string) => nome.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Treinador de `Empresa.responsavel`. A convenção é guardar só o primeiro nome, mas há
 * cadastros com o nome completo (mesma regra da Gamificação). O nome completo idêntico
 * prevalece; pelo primeiro nome, só vale quando um único treinador o possui.
 */
export function encontrarResponsavel<T extends { nome: string }>(responsavel: string | undefined, treinadores: T[]):
  { treinador: T; ambiguo: false } | { treinador: null; ambiguo: boolean } {
  const alvo = normalizarPessoa(responsavel || '');
  if (!alvo) return { treinador: null, ambiguo: false };
  const exato = treinadores.filter(t => normalizarPessoa(t.nome) === alvo);
  if (exato.length === 1) return { treinador: exato[0], ambiguo: false };
  const primeiro = alvo.split(' ')[0];
  const candidatos = treinadores.filter(t => normalizarPessoa(t.nome).split(' ')[0] === primeiro);
  if (candidatos.length === 1) return { treinador: candidatos[0], ambiguo: false };
  return { treinador: null, ambiguo: candidatos.length > 1 || exato.length > 1 };
}
export interface ClienteAcompanhamento {
  nomeEmpresa: string; temaText: string; currentPhase: number; responsavel?: string;
  dataFinalizacao?: string; dataFollowUpFinal?: string; conclusaoUnilateralCapacitacao?: boolean; isSuspended?: boolean; isCancelled?: boolean; isOngoing?: boolean;
}
export interface ContatoAcompanhamento { empresa: string; tipo?: string; dataOcorrencia?: number; createdAt?: number }
export function timestampBrasilia(data?: string): number | undefined {
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return undefined;
  const valor = Date.parse(`${data}T00:00:00-03:00`);
  return Number.isFinite(valor) && new Date(valor - 3 * 3_600_000).toISOString().slice(0, 10) === data ? valor : undefined;
}
export function baseAcompanhamento(progresso: number, dataFinalizacao?: string, ultimaAtividade?: number) {
  return progresso >= 100 ? timestampBrasilia(dataFinalizacao) : ultimaAtividade;
}
export function calcularSituacaoAcompanhamento(empresa: ClienteAcompanhamento, ocorrencias: ContatoAcompanhamento[], agora: number) {
  const total = (empresa.temaText || '').split('\n').map(t => t.trim()).filter(Boolean).length;
  const progresso = total ? Math.round(((empresa.currentPhase + 1) / total) * 100) : 0;
  const contatos = ocorrencias.filter(o => normalizarCliente(o.empresa) === normalizarCliente(empresa.nomeEmpresa) &&
    ((o.tipo || '').toLowerCase().includes('treinamento') || ['informativa', 'checkpoint'].includes((o.tipo || '').toLowerCase())));
  const ultima = contatos.reduce((maior, o) => Math.max(maior, o.dataOcorrencia || o.createdAt || 0), 0);
  const base = baseAcompanhamento(progresso, empresa.dataFinalizacao, ultima || undefined);
  const dias = base ? Math.floor((agora - base) / 86_400_000) : null;
  const tipo = empresa.isCancelled || empresa.isOngoing || empresa.conclusaoUnilateralCapacitacao || empresa.dataFollowUpFinal?.trim() || dias === null || normalizarCliente(empresa.nomeEmpresa) === 'systemsat' ? null
    : progresso >= 100 && dias >= PRAZO_FOLLOW_UP_FINAL ? 'follow_up_final'
    : progresso < 100 && dias >= PRAZO_AGENDAR_TREINAMENTO ? 'agendar_treinamento' : null;
  return { progresso, dias, base, tipo, suspensa: !!empresa.isSuspended };
}
