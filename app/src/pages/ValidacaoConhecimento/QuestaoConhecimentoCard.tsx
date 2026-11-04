import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { ArrowDown, ArrowUp, Check, CheckCircle2, CircleMinus, GripVertical, PencilLine, Star, Trash2, XCircle } from 'lucide-react';
import type { QuestaoValidacao } from '../../../../server/src/domain/validacaoConhecimento';

interface Props {
  questao: QuestaoValidacao; indice: number; total: number; valor: number; editavel: boolean; ocupado: boolean;
  podeMoverCima: boolean; podeMoverBaixo: boolean;
  /** Esta pergunta é a que está sendo arrastada no momento. */
  arrastando: boolean;
  /** Se definido, esta pergunta é o alvo atual do arraste — "antes"/"depois" indica de
   * que lado a pergunta arrastada cairia, conforme a metade da linha sob o cursor. */
  alvoArraste: 'antes' | 'depois' | null;
  onAlterar: (updates: Partial<QuestaoValidacao>) => void;
  onMover: (direcao: 'cima' | 'baixo') => void;
  onMoverPara: (novaPosicao: number) => void;
  onArrastarInicio: (e: DragEvent<HTMLSpanElement>) => void;
  onArrastarSobre: (e: DragEvent<HTMLLIElement>) => void;
  onSoltar: () => void;
  onArrasteFim: () => void;
  onRemover: () => void;
}
const pontos = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const OPCOES = [
  { valor: 'correto', label: 'Correto', fator: 1, icone: CheckCircle2 },
  { valor: 'parcial', label: 'Parcial', fator: .5, icone: CircleMinus },
  { valor: 'incorreto', label: 'Incorreto', fator: 0, icone: XCircle },
] as const;

export function QuestaoConhecimentoCard({ questao: q, indice, total, valor, editavel, ocupado, podeMoverCima, podeMoverBaixo, arrastando, alvoArraste, onAlterar, onMover, onMoverPara, onArrastarInicio, onArrastarSobre, onSoltar, onArrasteFim, onRemover }: Props) {
  const [editandoTexto, setEditandoTexto] = useState(false);
  const [editandoNumero, setEditandoNumero] = useState(false);
  const [numeroRascunho, setNumeroRascunho] = useState('');
  const textoRef = useRef<HTMLTextAreaElement>(null);
  const numeroRef = useRef<HTMLInputElement>(null);
  // Evita que o blur disparado pelo Escape (ao desmontar o input) reaplique um valor que o
  // usuário já tinha cancelado.
  const canceladoRef = useRef(false);
  const obtido = q.resposta === 'correto' ? valor : q.resposta === 'parcial' ? valor / 2 : 0;

  function abrirEdicaoNumero() {
    if (!editavel || ocupado) return;
    canceladoRef.current = false;
    setNumeroRascunho(String(indice + 1));
    setEditandoNumero(true);
    requestAnimationFrame(() => numeroRef.current?.select());
  }
  function confirmarNumero() {
    if (canceladoRef.current) { canceladoRef.current = false; return; }
    setEditandoNumero(false);
    if (!numeroRascunho.trim()) return;
    const novaPosicao = Math.round(Number(numeroRascunho));
    if (Number.isFinite(novaPosicao) && novaPosicao !== indice + 1) onMoverPara(novaPosicao);
  }
  function cancelarEdicaoNumero() {
    canceladoRef.current = true;
    setEditandoNumero(false);
  }

  return <li
    className={[
      'validacao-card',
      'validacao-questao',
      `validacao-questao--${q.resposta || 'pendente'}`,
      arrastando ? 'arrastando' : '',
      alvoArraste ? `validacao-questao--alvo-${alvoArraste}` : '',
    ].filter(Boolean).join(' ')}
    onDragOver={onArrastarSobre}
    onDrop={() => onSoltar()}
    onDragEnd={() => onArrasteFim()}
  >
    <div className="validacao-questao-cabecalho">
      {editavel && <span
        className="validacao-questao-handle"
        aria-hidden="true"
        title="Arraste para reordenar"
        draggable={!ocupado}
        onDragStart={onArrastarInicio}
      >
        <GripVertical size={16} />
      </span>}
      {editavel && editandoNumero ? (
        <input
          ref={numeroRef}
          type="number"
          className="validacao-questao-numero validacao-questao-numero--edicao"
          min={1}
          max={total}
          value={numeroRascunho}
          aria-label={`Mover pergunta para a posição (1 a ${total})`}
          onChange={e => setNumeroRascunho(e.target.value)}
          onBlur={confirmarNumero}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); confirmarNumero(); }
            if (e.key === 'Escape') { e.preventDefault(); cancelarEdicaoNumero(); }
          }}
        />
      ) : (
        <button
          type="button"
          className="validacao-questao-numero"
          disabled={!editavel || ocupado}
          title={editavel ? 'Clique para mover esta pergunta para outra posição' : undefined}
          aria-label={editavel ? `Pergunta ${indice + 1} de ${total}. Clique para mover para outra posição.` : `Pergunta ${indice + 1} de ${total}`}
          onClick={abrirEdicaoNumero}
        >
          {String(indice + 1).padStart(2, '0')}
        </button>
      )}
      {editavel && <div className="validacao-questao-mover" role="group" aria-label={`Reordenar pergunta ${indice + 1}`}>
        <button type="button" disabled={ocupado || !podeMoverCima} aria-label={`Mover pergunta ${indice + 1} para cima`} onClick={() => onMover('cima')}><ArrowUp size={13} /></button>
        <button type="button" disabled={ocupado || !podeMoverBaixo} aria-label={`Mover pergunta ${indice + 1} para baixo`} onClick={() => onMover('baixo')}><ArrowDown size={13} /></button>
      </div>}
      <div><span className="validacao-questao-secao">{q.secao}</span><span className="validacao-questao-origem">{q.origem === 'mantida' ? 'Reforço da tentativa anterior' : q.origem === 'manual' ? 'Pergunta personalizada' : 'Banco de perguntas'}</span></div>
      {q.preferida && <span className="validacao-preferida"><Star size={12} />Preferida</span>}
    </div>
    {editavel && editandoTexto ? <label className="validacao-edicao-pergunta">Texto da pergunta<textarea id={`texto-${q.id}`} ref={textoRef} value={q.texto} disabled={ocupado} onChange={e => onAlterar({ texto: e.target.value })} maxLength={2000} /></label> : <p className="validacao-pergunta-texto" id={`texto-${q.id}`}>{q.texto}</p>}
    <fieldset className="validacao-respostas" disabled={!editavel || ocupado} aria-labelledby={`texto-${q.id}`}>
      <legend>Avalie a resposta do cliente</legend>
      {OPCOES.map(({ valor: resposta, label, fator, icone: Icone }) => <label key={resposta} className={`validacao-opcao validacao-opcao--${resposta}${q.resposta === resposta ? ' validacao-opcao--selecionada' : ''}`}>
        <input type="radio" name={`resposta-${q.id}`} checked={q.resposta === resposta} onChange={() => onAlterar({ resposta })} />
        <span className="validacao-opcao-linha"><Icone size={17} /><strong>{label}</strong><span className="validacao-opcao-marca">{q.resposta === resposta && <Check size={13} />}</span></span>
        <span className="validacao-opcao-pontos">{pontos(valor * fator)} {valor * fator === 1 ? 'ponto' : 'pontos'}</span>
      </label>)}
    </fieldset>
    <div className="validacao-questao-rodape"><span>{q.resposta ? <>Obtido <strong>{pontos(obtido)}</strong> de {pontos(valor)} ponto(s)</> : 'Aguardando avaliação'}</span>{editavel && <div className="validacao-questao-ferramentas"><button type="button" disabled={ocupado} onClick={() => { setEditandoTexto(!editandoTexto); if (!editandoTexto) requestAnimationFrame(() => textoRef.current?.focus()); }}><PencilLine size={13} />{editandoTexto ? 'Pronto' : 'Editar pergunta'}</button><button type="button" className="validacao-remover" disabled={ocupado} onClick={onRemover}><Trash2 size={13} />Remover</button></div>}</div>
  </li>;
}
