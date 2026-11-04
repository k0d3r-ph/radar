import { useEffect, useRef, useState } from 'react';
import { Check, ListChecks, LoaderCircle, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useConfirmacao } from '../hooks/useConfirmacao';
import { useTarefasNovas } from '../hooks/useTarefasNovas';
import { listarTarefasChecklist, criarTarefaChecklist, atualizarTarefaChecklist, removerTarefaChecklist } from '../services/checklist';
import { listarUsuarios, type UsuarioDocument } from '../services/auth';
import { SelectCustomizado } from './SelectCustomizado';
import { TarefaChecklistCard } from './TarefaChecklistCard';
import { apresentarTarefa, nivelAtencaoMaisCritico, PRIORIDADES_TAREFA, urgenciaTarefa } from '../utils/tarefasChecklist';
import type { PrioridadeTarefa, TarefaChecklist } from '../types';
import './ChecklistTarefas.css';

type Aba = 'pendentes' | 'concluidas';
export default function ChecklistTarefas() {
  const { user, role, userName } = useAuth();
  const { confirmar, modalConfirmacao } = useConfirmacao();
  const [aberto, setAberto] = useState(false);
  const [tarefas, setTarefas] = useState<TarefaChecklist[]>([]);
  const { novas, marcarVista } = useTarefasNovas(tarefas, user?.uid || '');
  const [trainers, setTrainers] = useState<UsuarioDocument[]>([]);
  const [blocoAtivo, setBlocoAtivo] = useState('');
  const [aba, setAba] = useState<Aba>('pendentes');
  const [novoAberto, setNovoAberto] = useState(false);
  const [novaDescricao, setNovaDescricao] = useState('');
  const [novaSla, setNovaSla] = useState('');
  const [novaPrioridade, setNovaPrioridade] = useState<PrioridadeTarefa>('normal');
  const [agora, setAgora] = useState(Date.now);
  const [carregando, setCarregando] = useState(true);
  const [operacao, setOperacao] = useState(false);
  const [erro, setErro] = useState('');
  const raizRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const painelRef = useRef<HTMLElement>(null);
  const novaRef = useRef<HTMLTextAreaElement>(null);
  const ocupadoRef = useRef(false);
  const isMaster = role === 'master';
  const dono = isMaster && blocoAtivo ? blocoAtivo : user?.uid || '';

  useEffect(() => {
    if (!user?.uid) return;
    let cancelado = false;
    const carregar = async () => {
      try { const lista = await listarTarefasChecklist(); if (!cancelado && !ocupadoRef.current) { setTarefas(lista); setErro(''); } }
      catch { if (!cancelado) setErro('Não foi possível atualizar as tarefas. Tente novamente.'); }
      finally { if (!cancelado) setCarregando(false); }
    };
    void carregar();
    const timer = setInterval(() => { setAgora(Date.now()); void carregar(); }, 60_000);
    return () => { cancelado = true; clearInterval(timer); };
  }, [user?.uid, aberto]);
  useEffect(() => {
    if (!aberto || !isMaster) return;
    let cancelado = false;
    listarUsuarios().then(lista => { if (!cancelado) setTrainers(lista.filter(u => u.role === 'treinador' || u.role === 'master')); })
      .catch(() => { if (!cancelado) setErro('Não foi possível carregar os treinadores. Suas tarefas continuam disponíveis.'); });
    return () => { cancelado = true; };
  }, [aberto, isMaster]);
  useEffect(() => {
    if (!aberto) return;
    painelRef.current?.focus();
    const fecharPorFora = (e: PointerEvent) => { if (e.target instanceof Node && !raizRef.current?.contains(e.target)) setAberto(false); };
    const escapar = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { setAberto(false); botaoRef.current?.focus(); } };
    document.addEventListener('pointerdown', fecharPorFora); document.addEventListener('keydown', escapar);
    return () => { document.removeEventListener('pointerdown', fecharPorFora); document.removeEventListener('keydown', escapar); };
  }, [aberto]);

  async function executar(acao: () => Promise<void>): Promise<boolean> {
    if (ocupadoRef.current) return false;
    ocupadoRef.current = true; setOperacao(true); setErro('');
    try { await acao(); return true; }
    catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível salvar a tarefa. Tente novamente.'); return false; }
    finally { ocupadoRef.current = false; setOperacao(false); }
  }
  function fechar() { setAberto(false); botaoRef.current?.focus(); }
  function abrirNovas() { setBlocoAtivo(''); setAba('pendentes'); setAberto(true); setAgora(Date.now()); }
  async function atualizar(t: TarefaChecklist, updates: Partial<TarefaChecklist>) {
    if (!t.id) return false;
    return executar(async () => { await atualizarTarefaChecklist(t.id!, updates); setTarefas(lista => lista.map(item => item.id === t.id ? { ...item, ...updates } : item)); });
  }
  async function excluir(t: TarefaChecklist) {
    if (!t.id || (t.automatica && !t.concluida)) return;
    const { titulo } = apresentarTarefa(t, agora);
    if (!await confirmar({ titulo: 'Excluir a tarefa?', descricao: `${t.empresa ? `${t.empresa}\n` : ''}${titulo}\n\n${t.concluida ? 'A tarefa será removida da lista de concluídas. Os atendimentos do cliente serão mantidos.' : 'Esta ação não pode ser desfeita.'}`, textoConfirmar: 'Excluir tarefa', textoCancelar: 'Manter tarefa', destrutivo: true })) return;
    if (await executar(async () => { await removerTarefaChecklist(t.id!, t.concluida); setTarefas(items => items.filter(item => item.id !== t.id)); })) painelRef.current?.focus();
  }
  async function limparConcluidas(itens: TarefaChecklist[]) {
    if (!itens.length) return;
    if (!await confirmar({ titulo: `Limpar ${itens.length} tarefa${itens.length > 1 ? 's' : ''} concluída${itens.length > 1 ? 's' : ''}?`, descricao: 'As tarefas serão removidas da lista de concluídas. Os atendimentos do cliente serão mantidos.', textoConfirmar: 'Limpar concluídas', textoCancelar: 'Cancelar', destrutivo: true })) return;
    await executar(async () => {
      const falhas: string[] = [];
      for (const t of itens) {
        if (!t.id) continue;
        try { await removerTarefaChecklist(t.id, true); setTarefas(items => items.filter(item => item.id !== t.id)); }
        catch { falhas.push(t.id); }
      }
      if (falhas.length) throw new Error(`${falhas.length} de ${itens.length} tarefas não foram removidas. Tente novamente.`);
    });
  }
  if (!user) return null;
  const nomeDono = dono === user.uid ? userName : trainers.find(t => t.uid === dono)?.nome || 'Treinador';
  const doBloco = tarefas.filter(t => t.treinadorId === dono && !t.excluida);
  const grupos = { pendentes: doBloco.filter(t => !t.concluida && !t.pausada), concluidas: doBloco.filter(t => t.concluida) };
  // Tarefas de clientes suspensos ficam visíveis em "A fazer", separadas e fora da contagem.
  const pausadas = doBloco.filter(t => !t.concluida && t.pausada).sort((a, b) => a.createdAt - b.createdAt);
  const lista = [...grupos[aba]].sort((a, b) => aba === 'concluidas'
    ? (b.concluidaEm || b.updatedAt || b.createdAt) - (a.concluidaEm || a.updatedAt || a.createdAt)
    : urgenciaTarefa(a, agora) - urgenciaTarefa(b, agora));
  const abertas = grupos.pendentes.length, automaticas = grupos.pendentes.filter(t => t.automatica).length;
  const minhasAbertas = tarefas.filter(t => t.treinadorId === user.uid && !t.excluida && !t.pausada && !t.concluida).length;
  const nivelAlerta = nivelAtencaoMaisCritico(tarefas.filter(t => t.treinadorId === user.uid && !t.excluida), agora);
  const textoNovas = `${novas.size} ${novas.size === 1 ? 'nova tarefa' : 'novas tarefas'}`;
  return <div className="checklist-flutuante" ref={raizRef}>
    {aberto && <section id="painel-tarefas" role="dialog" aria-modal="false" aria-labelledby="titulo-tarefas" tabIndex={-1} className="tarefas-painel" ref={painelRef}>
      <header className="tarefas-cabecalho"><div className="tarefas-titulo"><span className="tarefas-icone"><ListChecks size={20} /></span><div><h2 id="titulo-tarefas">{dono === user.uid ? 'Minhas tarefas' : 'Tarefas da equipe'}</h2><p aria-live="polite">{abertas} para fazer{automaticas ? ` · ${automaticas} automáticas` : ''}</p></div></div><button type="button" className="tarefas-botao-icone" onClick={fechar} aria-label="Fechar tarefas"><X size={18} /></button></header>
      {isMaster && <div className="tarefas-responsavel"><label htmlFor="tarefas-treinador">Responsável</label><SelectCustomizado id="tarefas-treinador" value={dono} disabled={operacao} ariaLabel="Filtrar tarefas por responsável" opcoes={[{ value: user.uid, label: `${userName} (você)` }, ...trainers.filter(t => t.uid !== user.uid).map(t => ({ value: t.uid, label: t.nome || t.email }))]} onChange={id => { setBlocoAtivo(id); setAba('pendentes'); }} /></div>}
      <div className="tarefas-abas" aria-label="Filtrar tarefas por situação">{([['pendentes', 'A fazer', ListChecks], ['concluidas', 'Concluídas', Check]] as const).map(([chave, label, Icone]) => <button type="button" key={chave} aria-pressed={aba === chave} onClick={() => setAba(chave)}><Icone size={14} />{label}<span>{grupos[chave].length}</span></button>)}</div>
      {aba === 'concluidas' && grupos.concluidas.length > 0 && <div className="tarefas-limpar"><button type="button" disabled={operacao} onClick={() => void limparConcluidas(grupos.concluidas)}><Trash2 size={13} />Limpar concluídas</button></div>}
      {erro && <div className="tarefas-erro" role="alert"><p>{erro}</p><button type="button" disabled={operacao} onClick={() => executar(async () => setTarefas(await listarTarefasChecklist(true)))}><RefreshCw size={13} />Tentar novamente</button></div>}
      <div className="tarefas-conteudo">
        {carregando ? <p className="tarefas-vazio" role="status"><LoaderCircle size={20} className="tarefas-carregando" />Carregando suas tarefas…</p> : lista.length || (aba === 'pendentes' && pausadas.length) ? <>
          {lista.length > 0 && <ul className="tarefas-lista">{lista.map(t => <TarefaChecklistCard key={t.id} tarefa={t} agora={agora} ocupado={operacao} nova={novas.has(t.id!)} onVisualizar={() => marcarVista(t.id!)}
          onConcluir={async () => { if (await atualizar(t, { concluida: !t.concluida, concluidaEm: t.concluida ? undefined : Date.now() })) painelRef.current?.focus(); }} onSalvar={updates => atualizar(t, updates)} onNavegar={() => setAberto(false)}
          onExcluir={() => void excluir(t)} />)}</ul>}
          {aba === 'pendentes' && pausadas.length > 0 && <section className="tarefas-secao-pausadas" aria-labelledby="tarefas-pausadas-titulo">
            <h3 id="tarefas-pausadas-titulo">Pausadas · cliente suspenso <span>{pausadas.length}</span></h3>
            <p>Voltam para a lista quando o cliente retornar à esteira.</p>
            <ul className="tarefas-lista">{pausadas.map(t => <TarefaChecklistCard key={t.id} tarefa={t} agora={agora} ocupado={operacao} nova={novas.has(t.id!)} onVisualizar={() => marcarVista(t.id!)}
          onConcluir={async () => { if (await atualizar(t, { concluida: !t.concluida, concluidaEm: t.concluida ? undefined : Date.now() })) painelRef.current?.focus(); }} onSalvar={updates => atualizar(t, updates)} onNavegar={() => setAberto(false)}
          onExcluir={() => void excluir(t)} />)}</ul>
          </section>}
        </> : <div className="tarefas-vazio"><span className="tarefas-vazio-icone"><Check size={26} /></span><strong>{erro && !doBloco.length ? 'Tarefas indisponíveis' : aba === 'pendentes' ? 'Tudo em dia por aqui' : 'Ainda não há tarefas concluídas'}</strong><p>{erro && !doBloco.length ? 'Use Tentar novamente para atualizar a lista.' : aba === 'pendentes' ? 'Novos acompanhamentos aparecem aqui quando precisarem da sua atenção.' : 'As tarefas finalizadas ficam guardadas aqui.'}</p></div>}
      </div>
      <footer className="tarefas-rodape"><button type="button" className="tarefas-nova" aria-expanded={novoAberto} aria-controls="nova-tarefa-form" onClick={() => { setNovoAberto(!novoAberto); if (!novoAberto) requestAnimationFrame(() => novaRef.current?.focus()); }}><Plus size={16} /> Nova tarefa manual</button>
        {novoAberto && <form id="nova-tarefa-form" className="tarefas-form" onSubmit={async e => {
          e.preventDefault(); if (!novaDescricao.trim()) return;
          await executar(async () => {
            const dados: Omit<TarefaChecklist, 'id'> = { treinadorId: dono, treinadorNome: nomeDono, descricao: novaDescricao.trim(), concluida: false, criadoPorId: user.uid, criadoPorNome: userName, createdAt: Date.now(), prioridade: novaPrioridade, ...(novaSla ? { slaEm: new Date(novaSla).getTime() } : {}) };
            const id = await criarTarefaChecklist(dados); setTarefas(items => [{ ...dados, id }, ...items]); setNovaDescricao(''); setNovaSla(''); setNovaPrioridade('normal'); setNovoAberto(false); setAba('pendentes');
          });
        }}><label>O que precisa ser feito?<textarea ref={novaRef} required rows={2} value={novaDescricao} onChange={e => setNovaDescricao(e.target.value)} disabled={operacao} maxLength={2000} placeholder="Descreva a ação que você precisa realizar" /></label><div className="tarefas-form-campos"><label>Prazo (opcional)<input type="datetime-local" value={novaSla} onChange={e => setNovaSla(e.target.value)} disabled={operacao} /></label><label>Prioridade<select value={novaPrioridade} onChange={e => setNovaPrioridade(e.target.value as PrioridadeTarefa)} disabled={operacao}>{Object.entries(PRIORIDADES_TAREFA).map(([valor, label]) => <option key={valor} value={valor}>{label}</option>)}</select></label></div><button type="submit" className="tarefas-salvar" disabled={operacao || !novaDescricao.trim()}>{operacao ? 'Salvando…' : 'Criar tarefa'}</button></form>}
      </footer>
    </section>}
    {modalConfirmacao}
    <span className="tarefas-sr-only" role="status">{novas.size > 0 ? `Você tem ${textoNovas}.` : ''}</span>
    <div className="checklist-atalho">
      {!aberto && novas.size > 0 && <button className="checklist-novas" type="button" onClick={abrirNovas} aria-label={`Ver ${textoNovas}`}><span aria-hidden="true" />{textoNovas}</button>}
      <button ref={botaoRef} type="button" className={`checklist-flutuante-botao${novas.size > 0 && !aberto ? ' checklist-flutuante-botao--novas' : ''}${nivelAlerta ? ` checklist-flutuante-botao--alerta-${nivelAlerta}` : ''}`} onClick={() => { if (!aberto && novas.size > 0) abrirNovas(); else { setAberto(!aberto); setAgora(Date.now()); } }} aria-label={`Minhas tarefas${minhasAbertas ? `, ${minhasAbertas} pendentes` : ''}${novas.size ? `, ${textoNovas}` : ''}${nivelAlerta === 'atrasada' ? ', há tarefas vencidas' : nivelAlerta ? ', há tarefas prestes a vencer' : ''}`} aria-expanded={aberto} aria-controls="painel-tarefas"><ListChecks size={23} />{minhasAbertas > 0 && <span className="checklist-flutuante-badge">{minhasAbertas}</span>}{nivelAlerta && <span className={`checklist-flutuante-alerta checklist-flutuante-alerta--${nivelAlerta}`} aria-hidden="true" />}</button>
    </div>
  </div>;
}
