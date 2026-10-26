import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmacaoModal } from '../components/ConfirmacaoModal';
import type { OpcoesConfirmacao } from '../components/ConfirmacaoModal';

export function useConfirmacao() {
  const [opcoes, setOpcoes] = useState<OpcoesConfirmacao | null>(null);
  const resposta = useRef<((confirmada: boolean) => void) | null>(null);

  useEffect(() => () => { resposta.current?.(false); resposta.current = null; }, []);

  const confirmar = useCallback((dados: OpcoesConfirmacao): Promise<boolean> => {
    if (resposta.current) return Promise.resolve(false);
    return new Promise(resolve => { resposta.current = resolve; setOpcoes(dados); });
  }, []);

  function resolver(confirmada: boolean) {
    const pendente = resposta.current;
    resposta.current = null;
    setOpcoes(null);
    pendente?.(confirmada);
  }

  const modalConfirmacao = opcoes && <ConfirmacaoModal {...opcoes} onConfirmar={() => resolver(true)} onCancelar={() => resolver(false)} />;
  return { confirmar, modalConfirmacao };
}
