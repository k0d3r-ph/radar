import { useRef, useState } from 'react';
import { Check, CheckCircle2, CircleMinus, PencilLine, Star, Trash2, XCircle } from 'lucide-react';
import type { QuestaoValidacao } from '../../../../server/src/domain/validacaoConhecimento';

interface Props {
  questao: QuestaoValidacao; indice: number; valor: number; editavel: boolean; ocupado: boolean;
  onAlterar: (updates: Partial<QuestaoValidacao>) => void;
  onRemover: () => void;
}
const pontos = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const OPCOES = [
  { valor: 'correto', label: 'Correto', fator: 1, icone: CheckCircle2 },
  { valor: 'parcial', label: 'Parcial', fator: .5, icone: CircleMinus },
  { valor: 'incorreto', label: 'Incorreto', fator: 0, icone: XCircle },
] as const;

export function QuestaoConhecimentoCard({ questao: q, indice, valor, editavel, ocupado, onAlterar, onRemover }: Props) {
  const [editandoTexto, setEditandoTexto] = useState(false);
  const textoRef = useRef<HTMLTextAreaElement>(null);
  const obtido = q.resposta === 'correto' ? valor : q.resposta === 'parcial' ? valor / 2 : 0;
  return <li className={`validacao-card validacao-questao validacao-questao--${q.resposta || 'pendente'}`}>
    <div className="validacao-questao-cabecalho"><span className="validacao-questao-numero">{String(indice + 1).padStart(2, '0')}</span><div><span className="validacao-questao-secao">{q.secao}</span><span className="validacao-questao-origem">{q.origem === 'mantida' ? 'Reforço da tentativa anterior' : q.origem === 'manual' ? 'Pergunta personalizada' : 'Banco de perguntas'}</span></div>{q.preferida && <span className="validacao-preferida"><Star size={12} />Preferida</span>}</div>
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
