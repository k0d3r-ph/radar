const PREFIXO = 'radar:tarefas-vistas:v1:';
const EVENTO = 'radar:tarefas-vistas';
const memoria = new Map<string, string>();

export function lerTarefasVistas(usuarioId: string): string {
  if (!usuarioId) return '';
  const atual = memoria.get(usuarioId);
  if (atual !== undefined) return atual;
  let valor = '';
  try { valor = window.localStorage.getItem(`${PREFIXO}${usuarioId}`) || ''; } catch { /* Usa memória quando o armazenamento está bloqueado. */ }
  memoria.set(usuarioId, valor);
  return valor;
}

export function interpretarTarefasVistas(valor: string): Set<string> {
  try {
    const ids: unknown = JSON.parse(valor);
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && id.length > 0) : []);
  } catch { return new Set(); }
}

export function marcarTarefasVistas(usuarioId: string, ids: string[]): void {
  if (!usuarioId || !ids.length) return;
  const vistas = interpretarTarefasVistas(lerTarefasVistas(usuarioId));
  const anteriores = vistas.size;
  ids.filter(Boolean).forEach(id => vistas.add(id));
  if (vistas.size === anteriores) return;
  const valor = JSON.stringify([...vistas].slice(-5000));
  memoria.set(usuarioId, valor);
  try { window.localStorage.setItem(`${PREFIXO}${usuarioId}`, valor); } catch { /* Mantém a leitura durante esta sessão. */ }
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: usuarioId }));
}

export function assinarTarefasVistas(usuarioId: string, atualizar: () => void): () => void {
  const local = (evento: Event) => { if ((evento as CustomEvent<string>).detail === usuarioId) atualizar(); };
  const outraAba = (evento: StorageEvent) => {
    if (evento.key === `${PREFIXO}${usuarioId}` || evento.key === null) { memoria.delete(usuarioId); atualizar(); }
  };
  window.addEventListener(EVENTO, local);
  window.addEventListener('storage', outraAba);
  return () => { window.removeEventListener(EVENTO, local); window.removeEventListener('storage', outraAba); };
}
