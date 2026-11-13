import { Check, CheckCircle2, CircleMinus, XCircle } from 'lucide-react';
import type { QuestaoValidacao, RespostaValidacao } from '../../../../server/src/domain/validacaoConhecimento';

interface Props {
  questao: QuestaoValidacao;
  indice: number;
  editavel: boolean;
  ocupado: boolean;
  /** Explica por que a marcação está bloqueada (pausada, outro treinador). */
  motivoBloqueio?: string;
  onAlterar: (respostaParcial: RespostaValidacao | null) => void;
}
const OPCOES = [
  { valor: 'correto', label: 'Correto', icone: CheckCircle2 },
  { valor: 'parcial', label: 'Parcial', icone: CircleMinus },
  { valor: 'incorreto', label: 'Incorreto', icone: XCircle },
] as const;

/**
 * Validação parcial de uma pergunta, feita no início de uma agenda sobre os temas do último
 * treinamento. É opcional e não entra na nota; na conclusão, a ocorrência mostra a marcação
 * parcial e a final.
 */
export function ValidacaoParcialSecao({ questao: q, indice, editavel, ocupado, motivoBloqueio, onAlterar }: Props) {
  const tituloId = `parcial-titulo-${q.id}`;
  return <section className="validacao-parcial" aria-labelledby={tituloId}>
    <div className="validacao-parcial-cabecalho">
      <h3 id={tituloId}>Validação parcial do conhecimento <span>(opcional, não altera a pontuação{editavel ? ' · clique de novo para desmarcar' : ''})</span></h3>
    </div>
    {!editavel && motivoBloqueio && <p className="validacao-parcial-bloqueio">{motivoBloqueio}</p>}
    <fieldset className="validacao-respostas validacao-respostas--parcial" disabled={!editavel || ocupado} aria-labelledby={`${tituloId} texto-${q.id}`}>
      <legend className="validacao-sr-only">Validação parcial da pergunta {indice + 1}</legend>
      {OPCOES.map(({ valor, label, icone: Icone }) => <label key={valor} className={`validacao-opcao validacao-opcao--${valor}${q.respostaParcial === valor ? ' validacao-opcao--selecionada' : ''}`}>
        <input type="radio" name={`parcial-${q.id}`} checked={q.respostaParcial === valor} onChange={() => onAlterar(valor)} onClick={() => { if (q.respostaParcial === valor) onAlterar(null); }} onKeyDown={e => { if (e.key === ' ' && q.respostaParcial === valor) { e.preventDefault(); onAlterar(null); } }} />
        <span className="validacao-opcao-linha"><Icone size={17} /><strong>{label}</strong><span className="validacao-opcao-marca">{q.respostaParcial === valor && <Check size={13} />}</span></span>
      </label>)}
    </fieldset>
  </section>;
}
