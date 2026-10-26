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

export function prazoTarefa(timestamp: number, agora: number) {
  const data = new Date(timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  return { texto: `${timestamp < agora ? 'Vencida' : 'Prazo'} · ${data}`, atrasado: timestamp < agora };
}

export function dataInputTarefa(timestamp?: number) {
  if (!timestamp) return '';
  const d = new Date(timestamp), pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
