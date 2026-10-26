import { useEffect, useState } from 'react';
import type { Empresa } from '../types';
import { vencimentoPendencia } from '../utils/pendencias';

/** Atualiza o semáforo no vencimento, inclusive quando a tela permanece aberta. */
export function usePendenciasClock(empresas: Empresa[]) {
  const [agora, setAgora] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const atualizar = () => {
      clearTimeout(timer);
      const instante = Date.now();
      setAgora(instante);
      const prazos = empresas.filter(e => e.pendencia?.ativa)
        .map(e => vencimentoPendencia(e.pendencia?.venceEm))
        .filter((p): p is number => p !== undefined && Number.isFinite(p) && p > instante);
      // A idade do TME também muda sem gravações: mantém farol e tarefas no mesmo relógio.
      const proximoPrazo = prazos.length ? Math.min(...prazos) - instante : 60_000;
      timer = setTimeout(atualizar, Math.min(proximoPrazo, 60_000));
    };
    atualizar();
    window.addEventListener('focus', atualizar);
    document.addEventListener('visibilitychange', atualizar);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', atualizar);
      document.removeEventListener('visibilitychange', atualizar);
    };
  }, [empresas]);
  return agora;
}
