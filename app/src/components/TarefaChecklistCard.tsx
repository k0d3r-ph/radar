import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Check, Clock3, PauseCircle, Settings2, Sparkles, Trash2 } from 'lucide-react';
import type { PrioridadeTarefa, TarefaChecklist } from '../types';
import { apresentarTarefa, dataInputTarefa, nivelAtencaoTarefa, prazoTarefa, PRIORIDADES_TAREFA } from '../utils/tarefasChecklist';

interface Props {
  tarefa: TarefaChecklist; agora: number; ocupado: boolean;
  nova?: boolean; onVisualizar?: () => void;
  onConcluir: () => void; onExcluir: () => void;
  onSalvar: (updates: Partial<TarefaChecklist>) => Promise<boolean>;
  onNavegar: () => void;
}
export function TarefaChecklistCard({ tarefa, agora, ocupado, nova = false, onVisualizar, onConcluir, onExcluir, onSalvar, onNavegar }: Props) {
  const opcoesRef = useRef<HTMLDetailsElement>(null);
  const cardRef = useRef<HTMLLIElement>(null);
  // Mantém o destaque durante esta abertura, mesmo depois de registrar a leitura.
  const [destacarNova] = useState(nova);
  useEffect(() => {
    const card = cardRef.current, cabecalho = card?.querySelector('.tarefa-card-topo');
    if (!nova || !onVisualizar || !card || !cabecalho || typeof IntersectionObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let visivel = false;
    const atualizar = () => {
      clearTimeout(timer);
      if (visivel && document.visibilityState === 'visible') timer = setTimeout(onVisualizar, 1000);
    };
    const observer = new IntersectionObserver(([entry]) => { visivel = entry.isIntersecting && entry.intersectionRatio >= .6; atualizar(); }, { root: card.closest('.tarefas-conteudo'), threshold: [.6] });
    observer.observe(cabecalho);
    document.addEventListener('visibilitychange', atualizar);
    return () => { clearTimeout(timer); observer.disconnect(); document.removeEventListener('visibilitychange', atualizar); };
  }, [nova, onVisualizar]);
  const { titulo, motivo, automatica, historicoUrl, esteiraUrl } = apresentarTarefa(tarefa, agora);
  const prazo = tarefa.slaEm ? prazoTarefa(tarefa.slaEm, agora) : null;
  const emAberto = !tarefa.concluida && !tarefa.pausada;
  const nivelAtencao = nivelAtencaoTarefa(tarefa, agora);
  return <li ref={cardRef} className={`tarefa-card${tarefa.concluida ? ' tarefa-card--concluida' : ''}${tarefa.pausada ? ' tarefa-card--pausada' : ''}${destacarNova && !tarefa.concluida ? ' tarefa-card--nova' : ''}${nivelAtencao ? ` tarefa-card--atencao-${nivelAtencao}` : ''}`}>
    <div className="tarefa-card-topo">
      <button type="button" className="tarefa-check" aria-pressed={tarefa.concluida} disabled={ocupado} onClick={onConcluir}
        aria-label={`${tarefa.concluida ? 'Reabrir' : 'Concluir'} tarefa: ${titulo}${tarefa.empresa ? ` de ${tarefa.empresa}` : ''}`}
        title={automatica ? 'Alterar a conclusão da tarefa não altera o cadastro nem o farol do cliente.' : undefined}>
        {tarefa.concluida && <Check size={15} />}
      </button>
      <div className="tarefa-card-identidade">{destacarNova && !tarefa.concluida && <span className="tarefa-nova"><Sparkles size={11} />Nova</span>}{tarefa.empresa && <span className="tarefa-cliente">{tarefa.empresa}</span>}<h3>{titulo}</h3></div>
      {/* Só sinaliza prioridades diferentes do padrão, para não repetir "Normal" em todos os cards. */}
      {tarefa.prioridade && tarefa.prioridade !== 'normal' && <span className={`tarefa-prioridade tarefa-prioridade--${tarefa.prioridade}`}>Prioridade {PRIORIDADES_TAREFA[tarefa.prioridade].toLowerCase()}</span>}
    </div>
    {motivo && <p className="tarefa-motivo">{motivo}</p>}
    <div className="tarefa-indicadores">
      {automatica && <span><Sparkles size={12} /> Automática</span>}
      {tarefa.pausada && !tarefa.concluida && <span><PauseCircle size={12} /> Cliente suspenso</span>}
      {prazo && <span className={emAberto && prazo.atrasado ? 'tarefa-prazo-atrasado' : emAberto && prazo.proximo ? 'tarefa-prazo-proximo' : ''}><Clock3 size={12} />{prazo.texto}</span>}
      {!automatica && <span>Por {tarefa.criadoPorNome}</span>}
    </div>
    {tarefa.empresa && !tarefa.concluida && <div className="tarefa-links"><Link className="tarefa-acao" to={historicoUrl} onClick={onNavegar}>Ver atendimentos <ArrowUpRight size={14} /></Link>{esteiraUrl && <Link to={esteiraUrl} onClick={onNavegar}>Abrir esteira</Link>}</div>}
    {automatica && !tarefa.concluida && <p className="tarefa-conclusao-info">{tarefa.pausada ? 'O acompanhamento continua quando o cliente retornar à esteira.' : 'Concluída automaticamente quando a situação for resolvida.'}</p>}
    <div className="tarefa-rodape">
    <details className="tarefa-opcoes" ref={opcoesRef}>
      <summary><Settings2 size={13} /> Prazo e prioridade</summary>
      <form key={`${tarefa.slaEm}-${tarefa.prioridade}`} onSubmit={async e => {
        e.preventDefault();
        const dados = new FormData(e.currentTarget), valor = String(dados.get('prazo') || '');
        if (await onSalvar({ slaEm: valor ? new Date(valor).getTime() : undefined, prioridade: String(dados.get('prioridade')) as PrioridadeTarefa })) {
          if (opcoesRef.current) { opcoesRef.current.open = false; opcoesRef.current.querySelector('summary')?.focus(); }
        }
      }}>
        <label>Prazo<input name="prazo" type="datetime-local" defaultValue={dataInputTarefa(tarefa.slaEm)} disabled={ocupado} /></label>
        <label>Prioridade<select name="prioridade" defaultValue={tarefa.prioridade || 'normal'} disabled={ocupado}>{Object.entries(PRIORIDADES_TAREFA).map(([valor, label]) => <option key={valor} value={valor}>{label}</option>)}</select></label>
        <div className="tarefa-opcoes-acoes"><button type="submit" disabled={ocupado}>Salvar ajustes</button></div>
      </form>
    </details>
    {(!automatica || tarefa.concluida) && <button className="tarefa-excluir" type="button" disabled={ocupado} onClick={onExcluir}><Trash2 size={13} /> Excluir tarefa</button>}
    </div>
  </li>;
}
