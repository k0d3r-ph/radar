import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizarConhecimento } from '../../../../server/src/domain/validacaoConhecimento';
import type { PerguntaConhecimento, QuestaoValidacao, Secao } from '../../../../server/src/domain/validacaoConhecimento';

interface Props {
  questao: QuestaoValidacao;
  posicao: number;
  /** Perguntas do banco elegíveis para esta avaliação (já sem as do formulário e sem acertos anteriores). */
  opcoes: PerguntaConhecimento[];
  onCancelar: () => void;
  onSelecionar: (nova: PerguntaConhecimento) => void;
}

/** Troca uma pergunta do formulário por outra do banco, mantendo a mesma posição. */
export function SubstituirPerguntaModal({ questao, posicao, opcoes, onCancelar, onSelecionar }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buscaRef = useRef<HTMLInputElement>(null);
  const [busca, setBusca] = useState('');
  // Começa pela mesma seção, que é a troca mais comum; "todas" amplia a busca.
  const [secao, setSecao] = useState<Secao | ''>(opcoes.some(q => q.secao === questao.secao) ? questao.secao : '');
  const secoes = useMemo(() => [...new Set(opcoes.map(q => q.secao))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [opcoes]);
  const filtradas = opcoes.filter(q => (!secao || q.secao === secao) && normalizarConhecimento(`${q.secao} ${q.texto}`).includes(normalizarConhecimento(busca)));
  const temRespostas = !!questao.resposta || !!questao.respostaParcial;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    // showModal() move o foco para o primeiro controle; a pesquisa é o ponto de partida.
    buscaRef.current?.focus();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  return <dialog
    ref={dialogRef}
    className="validacao-impressao-dialog validacao-substituir-dialog"
    aria-labelledby="validacao-substituir-titulo"
    onCancel={e => { e.preventDefault(); onCancelar(); }}
  >
    <div className="validacao-substituir-conteudo">
      <h2 id="validacao-substituir-titulo">Substituir pergunta {posicao}</h2>
      <div className="validacao-substituir-atual">
        <span className="validacao-questao-secao">{questao.secao} · pergunta atual</span>
        <p>{questao.texto}</p>
      </div>
      {temRespostas && <p className="validacao-substituir-aviso" role="note">As marcações desta pergunta (validação final e parcial) serão descartadas. A nova pergunta entra na mesma posição, sem resposta.</p>}
      <div className="validacao-substituir-filtros">
        <label>Seção
          <select value={secao} onChange={e => setSecao(e.target.value as Secao | '')}>
            <option value="">Todas as seções</option>
            {secoes.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>Pesquisar no banco
          <input ref={buscaRef} type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Texto da pergunta" />
        </label>
      </div>
      <p className="validacao-substituir-contagem" aria-live="polite">{filtradas.length === 1 ? '1 pergunta disponível' : `${filtradas.length} perguntas disponíveis`}</p>
      <ul className="validacao-substituir-lista">
        {filtradas.map(q => <li key={q.id}>
          <span><strong>{q.secao}{q.preferida ? ' · Preferida' : ''}</strong>{q.texto}</span>
          <button type="button" onClick={() => onSelecionar(q)}>Usar esta pergunta</button>
        </li>)}
      </ul>
      {!filtradas.length && <p>{opcoes.length
        ? 'Nenhuma pergunta encontrada com esta busca. Tente outra seção ou outro termo.'
        : 'Não há perguntas elegíveis no banco para as seções desta avaliação. Solicite ao Master novas perguntas.'}</p>}
      <div className="validacao-impressao-acoes"><button type="button" onClick={onCancelar}>Cancelar</button></div>
    </div>
  </dialog>;
}
