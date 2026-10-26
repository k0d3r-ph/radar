import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { TarefaChecklist } from '../types';
import { assinarTarefasVistas, interpretarTarefasVistas, lerTarefasVistas, marcarTarefasVistas } from '../services/tarefasVistas';
import { identificarTarefasNovas } from '../utils/tarefasChecklist';

export function useTarefasNovas(tarefas: TarefaChecklist[], usuarioId: string) {
  const assinar = useCallback((atualizar: () => void) => assinarTarefasVistas(usuarioId, atualizar), [usuarioId]);
  const ler = useCallback(() => lerTarefasVistas(usuarioId), [usuarioId]);
  const registro = useSyncExternalStore(assinar, ler, () => '');
  const novas = useMemo(() => identificarTarefasNovas(tarefas, usuarioId, interpretarTarefasVistas(registro)), [tarefas, usuarioId, registro]);
  const marcarVista = useCallback((id: string) => marcarTarefasVistas(usuarioId, [id]), [usuarioId]);
  return { novas, marcarVista };
}
