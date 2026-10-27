import type { PrioridadeTarefa, TarefaChecklist } from '../types';

export function identificarTarefasNovas(tarefas: TarefaChecklist[], usuarioId: string, vistas: ReadonlySet<string>): Set<string> {
  return new Set(tarefas.filter(t => t.id && t.treinadorId === usuarioId && !t.concluida && !t.pausada && !t.excluida
    && (t.automatica || (t.criadoPorId && t.criadoPorId !== usuarioId)) && !vistas.has(t.id)).map(t => t.id!));
}

export const PRIORIDADES_TAREFA: Record<PrioridadeTarefa, string> = { baixa: 'Baixa', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' };

export function apresentarTarefa(tarefa: TarefaChecklist, agora = Date.now()) {
  const automatica = tarefa.automatica === true;
  const conhecida = tarefa.origemAutomatica === 'follow_up_final' || tarefa.origemAutomatica === 'agendar_treinamento';
  const dias = tarefa.baseAutomatica ? Math.max(0, Math.floor((agora - tarefa.baseAutomatica) / 86_400_000)) : null;
  const followUp = tarefa.origemAutomatica === 'follow_up_final';
  const titulo = automatica && conhecida ? followUp ? 'Realizar follow-up final' : 'Entrar em contato e agendar treinamento' : tarefa.descricao;
  const motivo = !automatica || !conhecida ? '' : followUp
    ? `Esteira finalizada${dias !== null ? ` há ${dias} dias` : ''}, sem follow-up final registrado.`
    : `${dias !== null ? `${dias} dias` : 'Cliente'} sem atividade registrada. Combine a próxima agenda com o cliente.`;
  const parametros = new URLSearchParams({ empresa: tarefa.empresa || '' });
  return { titulo, motivo, automatica, historicoUrl: `/historico?${parametros}`, esteiraUrl: tarefa.empresaId ? `/esteira/${encodeURIComponent(tarefa.empresaId)}` : null };
}

const BONUS_PRIORIDADE = { baixa: -12, normal: 0, alta: 24, urgente: 72 };
export function urgenciaTarefa(tarefa: TarefaChecklist, agora: number) {
  return (tarefa.slaEm != null ? (tarefa.slaEm - agora) / 3_600_000 : 240) - BONUS_PRIORIDADE[tarefa.prioridade || 'normal'];
}

/** Janela antes do prazo em que a tarefa já é sinalizada como "quase vencendo". */
const JANELA_PRAZO_PROXIMO_MS = 24 * 3_600_000;

export function prazoTarefa(timestamp: number, agora: number) {
  const data = new Date(timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  const atrasado = timestamp < agora;
  return {
    texto: `${atrasado ? 'Vencida' : 'Prazo'} · ${data}`,
    atrasado,
    // Dentro das próximas 24h, mas ainda não vencida.
    proximo: !atrasado && timestamp - agora <= JANELA_PRAZO_PROXIMO_MS,
  };
}

export type NivelAtencaoTarefa = 'atrasada' | 'urgente' | 'proxima';
const ORDEM_ATENCAO: NivelAtencaoTarefa[] = ['atrasada', 'urgente', 'proxima'];

/**
 * Nível de destaque visual de uma tarefa pendente (aberta, não pausada): vencida é
 * sempre o mais crítico, mesmo com prioridade urgente — depois prioridade urgente
 * (ainda no prazo), depois prestes a vencer. `null` quando não precisa de destaque.
 * Usada tanto no cartão da tarefa quanto no indicador do botão flutuante, para os
 * dois nunca ficarem incoerentes entre si.
 */
export function nivelAtencaoTarefa(tarefa: TarefaChecklist, agora: number): NivelAtencaoTarefa | null {
  if (tarefa.concluida || tarefa.pausada) return null;
  const prazo = tarefa.slaEm != null ? prazoTarefa(tarefa.slaEm, agora) : null;
  if (prazo?.atrasado) return 'atrasada';
  if (tarefa.prioridade === 'urgente') return 'urgente';
  if (prazo?.proximo) return 'proxima';
  return null;
}

/** O nível mais crítico entre uma lista de tarefas, ou `null` se nenhuma precisar de destaque. */
export function nivelAtencaoMaisCritico(tarefas: TarefaChecklist[], agora: number): NivelAtencaoTarefa | null {
  const niveis = new Set(tarefas.map(t => nivelAtencaoTarefa(t, agora)));
  return ORDEM_ATENCAO.find(n => niveis.has(n)) ?? null;
}

export function dataInputTarefa(timestamp?: number) {
  if (!timestamp) return '';
  const d = new Date(timestamp), pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
