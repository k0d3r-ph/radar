import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useAuth } from '../context/AuthContext';
import type { Empresa } from '../types';
import { buscarDadosCentral, preencherDadosCentral } from '../services/centrais';

/** Consulta no cadastro e na edição; respostas antigas não mudam outro formulário. */
export function useCentralPlanilha(aberto: boolean, cliente: Empresa, setCliente: Dispatch<SetStateAction<Empresa>>) {
  const { user } = useAuth();
  const nome = cliente.nomeEmpresa.trim();
  const idCentral = cliente.idCentral?.trim() || '';
  const chave = JSON.stringify([user?.uid, nome, idCentral]);
  const [estado, setEstado] = useState({ chave: '', buscando: false, aviso: '' });
  const preenchimento = useRef<{
    usuario: string; clienteId?: string; nome: string; id: string;
    idAutomatico?: string; valorAutomatico?: number;
  } | null>(null);

  useEffect(() => {
    if (!aberto || !user) { preenchimento.current = null; return; }
    const anterior = preenchimento.current;
    if (anterior && (anterior.usuario !== user.uid || anterior.clienteId !== cliente.id)) {
      preenchimento.current = null;
    } else if (anterior && (anterior.nome !== nome || anterior.id !== idCentral)) {
      // Mudou a identificação: descarta apenas sugestões anteriores que não
      // foram corrigidas manualmente, para não carregar o contrato de outro cliente.
      preenchimento.current = null;
      setCliente(atual => atual.nomeEmpresa.trim() !== nome || (atual.idCentral?.trim() || '') !== idCentral ? atual : ({ ...atual,
        idCentral: anterior.idAutomatico && atual.idCentral === anterior.idAutomatico ? undefined : atual.idCentral,
        valorContrato: anterior.valorAutomatico !== undefined && atual.valorContrato === anterior.valorAutomatico
          ? undefined : atual.valorContrato,
      }));
    }
    if (!nome) return;
    let cancelado = false;
    const timer = setTimeout(async () => {
      setEstado({ chave, buscando: true, aviso: '' });
      try {
        const central = await buscarDadosCentral(nome, idCentral);
        if (cancelado) return;
        if (central) {
          setCliente(atual => {
            if (atual.nomeEmpresa.trim() !== nome || (atual.idCentral?.trim() || '') !== idCentral) return atual;
            const preenchido = preencherDadosCentral(atual, central);
            if (preenchido.idCentral !== atual.idCentral || preenchido.valorContrato !== atual.valorContrato) {
              const origem = preenchimento.current;
              preenchimento.current = { usuario: user.uid, clienteId: atual.id, nome, id: preenchido.idCentral || '',
                idAutomatico: !atual.idCentral?.trim() ? preenchido.idCentral : origem?.idAutomatico,
                valorAutomatico: atual.valorContrato == null ? preenchido.valorContrato : origem?.valorAutomatico };
            }
            return preenchido;
          });
        }
        setEstado({ chave, buscando: false, aviso: central ? ''
          : 'Não foi possível identificar uma única central na planilha do CS. Confira o nome e o ID ou preencha manualmente.' });
      } catch (erro) {
        if (!cancelado) setEstado({ chave, buscando: false, aviso: erro instanceof Error ? erro.message : 'Não foi possível consultar a planilha do CS.' });
      }
    }, 500);
    return () => { cancelado = true; clearTimeout(timer); };
  }, [aberto, chave, nome, idCentral, cliente.id, user, setCliente]);

  return { buscando: aberto && estado.chave === chave && estado.buscando,
    aviso: aberto && estado.chave === chave ? estado.aviso : '' };
}
