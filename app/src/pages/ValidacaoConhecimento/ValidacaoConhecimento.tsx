import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Pause, Play } from 'lucide-react';
import { SelectCustomizado } from '../../components/SelectCustomizado';
import { InputDuracaoAgenda } from '../../components/InputDuracaoAgenda';
import { AvaliacaoCsat } from '../../components/AvaliacaoCsat';
import { useAuth } from '../../context/AuthContext';
import { useConfirmacao } from '../../hooks/useConfirmacao';
import { useAutoScrollDuringDrag } from '../../hooks/useAutoScrollDuringDrag';
import { listarEmpresas, salvarEmpresas } from '../../services/empresas';
import { listarOcorrencias } from '../../services/ocorrencias';
import { linkCsat, requisicaoCsat } from '../../services/csat';
import type { ReservaCsat } from '../../services/csat';
import { copiarTexto } from '../../utils/clipboard';
import { cancelarTentativaConhecimento, concluirTentativaConhecimento, iniciarTentativaConhecimento, listarPerguntasConhecimento, listarTentativasConhecimento, salvarTentativaConhecimento } from '../../services/validacaoConhecimento';
import { calcularResultadoValidacao, identificarConteudoAvaliacao, isSolicitanteTreinamento, normalizarConhecimento, SOLICITANTES_TREINAMENTO } from '../../../../server/src/domain/validacaoConhecimento';
import { duracaoAgendaValida } from '../../../../server/src/domain/duracaoAgenda';
import { converterDuracaoAgendaParaMs, formatarDuracaoCronometro, formatarTempoCronometro } from '../../utils/cronometroAgenda';
import { BancoPerguntas } from './BancoPerguntas';
import { GestaoNotificacaoModal } from '../../components/GestaoNotificacaoModal';
import { NotificacaoProgressoEsteiraModal } from '../../components/NotificacaoProgressoEsteiraModal';
import { obterDestinatariosGestao, montarMensagemConclusaoEsteiraGestao } from '../../services/notificacoes';
import type { ResultadoDestinatariosGestao } from '../../services/notificacoes';
import { camposResultadoConclusao } from '../../utils/notificacaoConclusao';
import type { PerguntaConhecimento, QuestaoValidacao, TentativaValidacao } from '../../../../server/src/domain/validacaoConhecimento';
import type { Empresa, Ocorrencia } from '../../types';
import { salvarOcorrencia } from '../../services/ocorrencias';
import './ValidacaoConhecimento.css';
import { QuestaoConhecimentoCard } from './QuestaoConhecimentoCard';
import { ImpressaoValidacaoModal } from '../../components/ImpressaoValidacaoModal';

const numero = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const rotuloStatus = { andamento: 'Em andamento', pausada: 'Pausada', concluida: 'Concluída', cancelada: 'Cancelada' };
export function ValidacaoConhecimento() {
  const { user, role } = useAuth();
  const { confirmar, modalConfirmacao } = useConfirmacao();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [banco, setBanco] = useState<PerguntaConhecimento[]>([]);
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([]);
  const [empresaId, setEmpresaId] = useState('');
  const [tentativas, setTentativas] = useState<TentativaValidacao[]>([]);
  const [atual, setAtual] = useState<TentativaValidacao | null>(null);
  const [manutencao, setManutencao] = useState<'basica' | 'avancada'>('basica');
  const [gestao, setGestao] = useState<(ResultadoDestinatariosGestao & { cliente: Empresa; mensagem: string }) | null>(null);
  const [notificacaoProgresso, setNotificacaoProgresso] = useState<{
    cliente: Empresa;
    tentativa: TentativaValidacao;
    ocorridoEm: number;
  } | null>(null);
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [alterada, setAlterada] = useState(false);
  const [erro, setErro] = useState('');
  const [conclusaoAberta, setConclusaoAberta] = useState(false);
  const [reservasPendentes, setReservasPendentes] = useState<ReservaCsat[]>([]);
  const [cronometroIniciadoEm, setCronometroIniciadoEm] = useState<number | null>(null);
  const [cronometroAcumuladoMs, setCronometroAcumuladoMs] = useState(0);
  const [agoraCronometro, setAgoraCronometro] = useState(Date.now);
  const [searchParams, setSearchParams] = useSearchParams();
  const bloqueio = useRef(false);
  const clienteDoLink = useRef(searchParams.get('empresa') || '');
  const gerarRef = useRef<HTMLButtonElement>(null);
  const questoesRef = useRef<HTMLOListElement>(null);
  const cronometroTentativaId = useRef<string | null>(null);
  const cliente = empresas.find(e => e.id === empresaId);
  const ativa = tentativas.find(t => t.status === 'andamento' || t.status === 'pausada');
  const ultima = tentativas.find(t => t.status !== 'cancelada');
  const editavel = !!atual && atual.status === 'andamento' && (atual.treinadorId === user?.uid || role === 'master');
  const cronometroAtivo = cronometroIniciadoEm !== null;
  const tempoCronometroMs = cronometroAcumuladoMs + (cronometroIniciadoEm === null ? 0 : agoraCronometro - cronometroIniciadoEm);
  const cancelavel = !!atual && (atual.status === 'andamento' || atual.status === 'pausada') && (atual.treinadorId === user?.uid || role === 'master');
  const duracaoInvalida = !!atual?.treinamentoTempoAgenda && !duracaoAgendaValida(atual.treinamentoTempoAgenda);
  // Só pede o nível quando o cadastro diz apenas "Manutenção", sem básica/avançada.
  const escolherManutencao = !!cliente && identificarConteudoAvaliacao(
    cliente, ocorrencias.filter(o => o.empresa === cliente.nomeEmpresa), manutencao,
  ).manutencaoIndefinida;

  useEffect(() => {
    let cancelado = false;
    // Reservas CSAT comuns pendentes do próprio usuário bloqueiam a conclusão no servidor;
    // a lista só antecipa o aviso. Uma falha aqui não impede o uso da tela.
    requisicaoCsat('reservas', undefined, true).then(lista => { if (!cancelado) setReservasPendentes(lista as ReservaCsat[]); }).catch(() => {});
    Promise.all([listarEmpresas(), listarPerguntasConhecimento(), listarOcorrencias()]).then(([lista, perguntas, historico]) => {
      if (!cancelado) {
        setEmpresas(lista); setBanco(perguntas); setOcorrencias(historico);
        // Atalhos de outras telas abrem com o cliente já selecionado (?empresa=<id>).
        const doLink = clienteDoLink.current;
        if (doLink && lista.some(e => e.id === doLink)) { setCarregando(true); setEmpresaId(doLink); }
      }
    }).catch(e => { if (!cancelado) setErro(e instanceof Error ? e.message : 'Não foi possível carregar os dados.'); })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, []);
  useEffect(() => {
    if (!empresaId) return;
    let cancelado = false;
    listarTentativasConhecimento(empresaId).then(lista => { if (!cancelado) { setTentativas(lista); setAtual(lista.find(t => t.status === 'andamento' || t.status === 'pausada') || lista[0] || null); setManutencao(lista.find(t => t.status !== 'cancelada')?.secoes.includes('Manutenção avançada') ? 'avancada' : 'basica'); } })
      .catch(e => { if (!cancelado) setErro(e instanceof Error ? e.message : 'Não foi possível carregar as avaliações.'); })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [empresaId]);
  useEffect(() => {
    if (cronometroIniciadoEm === null) return;
    const intervalo = window.setInterval(() => setAgoraCronometro(Date.now()), 1000);
    return () => window.clearInterval(intervalo);
  }, [cronometroIniciadoEm]);
  useEffect(() => {
    if (!alterada && !cronometroAtivo) return;
    const proteger = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', proteger);
    return () => window.removeEventListener('beforeunload', proteger);
  }, [alterada, cronometroAtivo]);

  function guardar(t: TentativaValidacao) {
    setAtual(t); setAlterada(false);
    setTentativas(lista => [t, ...lista.filter(a => a.id !== t.id)].sort((a, b) => b.numero - a.numero));
  }
  async function executar(acao: () => Promise<void>): Promise<boolean> {
    if (bloqueio.current) return false;
    bloqueio.current = true; setOcupado(true); setErro('');
    try { await acao(); return true; } catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível realizar a operação.'); return false; }
    finally { bloqueio.current = false; setOcupado(false); }
  }
  async function concluirAvaliacao(impressoesAgenda: string): Promise<boolean> {
    const tentativa = atual;
    if (!tentativa) return false;
    return executar(async () => {
      const salva = await salvarTentativaConhecimento(tentativa, 'andamento'); guardar(salva);
      const concluida = await concluirTentativaConhecimento(salva, impressoesAgenda); guardar(concluida);
      const copiado = !!concluida.csatToken && await copiarTexto(linkCsat(concluida.csatToken));
      toast.success(copiado ? 'Tentativa concluída. Link do CSAT copiado.' : 'Tentativa concluída. Treinamento e CSAT registrados.');
      if (concluida.csatToken && !copiado) toast.warning('O navegador não permitiu copiar automaticamente. Use “Copiar link” ou selecione o endereço no campo do CSAT.');
      if (concluida.aprovada) {
        try {
          const lista = await listarEmpresas(true);
          setEmpresas(lista);
          const clienteAtualizado = lista.find(e => e.id === concluida.empresaId);
          if (!clienteAtualizado) throw new Error('Validação concluída, mas o cliente não foi localizado para preparar o envio do progresso.');
          setNotificacaoProgresso({
            cliente: clienteAtualizado,
            tentativa: concluida,
            ocorridoEm: concluida.concluidaEm || Date.now(),
          });
        } catch (error) {
          setErro(error instanceof Error ? error.message : 'Validação concluída, mas não foi possível preparar o envio do progresso.');
          if (concluida.concluiuEsteira) await prepararAvisoConclusao(concluida);
        }
      } else if (concluida.concluiuEsteira) {
        await prepararAvisoConclusao(concluida);
      }
    });
  }
  function alterar(updates: Partial<TentativaValidacao>) { if (atual) { setAtual({ ...atual, ...updates }); setAlterada(true); } }
  function resetarCronometro(tentativaId: string | null) {
    setCronometroIniciadoEm(null);
    setCronometroAcumuladoMs(0);
    cronometroTentativaId.current = tentativaId;
  }
  function iniciarCronometro(agora: number) {
    if (!atual) return;
    setErro('');
    cronometroTentativaId.current = atual.id;
    if (cronometroAcumuladoMs === 0) setCronometroAcumuladoMs(converterDuracaoAgendaParaMs(atual.treinamentoTempoAgenda));
    setAgoraCronometro(agora);
    setCronometroIniciadoEm(agora);
  }
  function pausarCronometro(agora: number) {
    if (!atual || cronometroIniciadoEm === null || cronometroTentativaId.current !== atual.id) return;
    const total = cronometroAcumuladoMs + agora - cronometroIniciadoEm;
    setCronometroIniciadoEm(null);
    setCronometroAcumuladoMs(total);
    setAgoraCronometro(agora);
    try {
      alterar({ treinamentoTempoAgenda: formatarDuracaoCronometro(total) });
    } catch (e) {
      setCronometroAcumuladoMs(0);
      setErro(e instanceof Error ? e.message : 'Não foi possível converter o tempo do cronômetro.');
    }
  }
  async function prepararAvisoConclusao(t: TentativaValidacao) {
    const lista = await listarEmpresas(true); setEmpresas(lista);
    const clienteAtualizado = lista.find(e => e.id === t.empresaId);
    if (!clienteAtualizado) throw new Error('Avaliação salva, mas o cliente não foi localizado para preparar o aviso à gestão.');
    const destinatarios = await obterDestinatariosGestao(clienteAtualizado, 'conclusao');
    setGestao({ ...destinatarios, cliente: clienteAtualizado, mensagem: montarMensagemConclusaoEsteiraGestao(clienteAtualizado, t.ocorrenciaId) });
  }
  function atualizarQuestao(id: string, updates: Partial<QuestaoValidacao>) { if (atual) alterar({ questoes: atual.questoes.map(q => q.id === id ? { ...q, ...updates } : q) }); }
  function moverQuestao(indice: number, direcao: 'cima' | 'baixo') {
    if (!atual) return;
    const alvo = direcao === 'cima' ? indice - 1 : indice + 1;
    if (alvo < 0 || alvo >= atual.questoes.length) return;
    const questoes = [...atual.questoes];
    [questoes[indice], questoes[alvo]] = [questoes[alvo], questoes[indice]];
    alterar({ questoes });
  }
  function moverQuestaoParaPosicao(indice: number, novaPosicao: number) {
    if (!atual) return;
    const total = atual.questoes.length;
    const alvo = Math.min(Math.max(novaPosicao, 1), total) - 1;
    if (alvo === indice) return;
    const questoes = [...atual.questoes];
    const [item] = questoes.splice(indice, 1);
    questoes.splice(alvo, 0, item);
    alterar({ questoes });
  }
  // Clicar e segurar numa pergunta pra arrastar — mesmo mecanismo do editor de temas da
  // Esteira: a linha arrastada (arrastandoIndex) sobrevoa as outras, e o alvo guarda sobre
  // qual pergunta ela está e se cairia antes ou depois (metade de cima/baixo da linha).
  const [arrastandoIndex, setArrastandoIndex] = useState<number | null>(null);
  useAutoScrollDuringDrag(arrastandoIndex !== null);
  const [alvoArraste, setAlvoArraste] = useState<{ indice: number; posicao: 'antes' | 'depois' } | null>(null);
  function indiceDeInsercaoArraste(origem: number, indiceAlvo: number, posicao: 'antes' | 'depois') {
    if (posicao === 'antes') return origem < indiceAlvo ? indiceAlvo - 1 : indiceAlvo;
    return origem < indiceAlvo ? indiceAlvo : indiceAlvo + 1;
  }
  function aoArrastarQuestaoSobre(indice: number) {
    return (e: DragEvent<HTMLLIElement>) => {
      e.preventDefault();
      if (arrastandoIndex === null || arrastandoIndex === indice) { setAlvoArraste(null); return; }
      const limite = e.currentTarget.getBoundingClientRect();
      const posicao = e.clientY - limite.top < limite.height / 2 ? 'antes' : 'depois';
      setAlvoArraste(anterior => anterior?.indice === indice && anterior.posicao === posicao ? anterior : { indice, posicao });
    };
  }
  function aoSoltarQuestao() {
    if (arrastandoIndex !== null && alvoArraste) {
      moverQuestaoParaPosicao(arrastandoIndex, indiceDeInsercaoArraste(arrastandoIndex, alvoArraste.indice, alvoArraste.posicao) + 1);
    }
    setArrastandoIndex(null);
    setAlvoArraste(null);
  }
  function aoFinalizarArrasteQuestao() {
    setArrastandoIndex(null);
    setAlvoArraste(null);
  }
  async function selecionarTentativa(t: TentativaValidacao) {
    if (cronometroAtivo) { toast.error('Encerre o cronômetro antes de trocar de tentativa.'); return; }
    if (!alterada || await confirmar({ titulo: 'Trocar de tentativa?', descricao: 'As alterações não salvas da avaliação atual serão descartadas.', textoConfirmar: 'Descartar e trocar', textoCancelar: 'Continuar editando', destrutivo: true })) { resetarCronometro(t.id); setAtual(t); setAlterada(false); }
  }
  async function selecionarCliente(id: string) {
    if (cronometroAtivo) { toast.error('Encerre o cronômetro antes de trocar de cliente.'); return; }
    if (id === empresaId) return;
    if (!alterada || await confirmar({ titulo: 'Trocar de cliente?', descricao: 'As alterações não salvas da avaliação atual serão descartadas.', textoConfirmar: 'Descartar e trocar', textoCancelar: 'Continuar editando', destrutivo: true })) {
      resetarCronometro(null); setCarregando(!!id); setErro(''); setAtual(null); setTentativas([]); setAlterada(false); setEmpresaId(id);
      setSearchParams(id ? { empresa: id } : {}, { replace: true });
    }
  }
  async function recarregarDados() {
    if (alterada && !await confirmar({ titulo: 'Recarregar a avaliação?', descricao: 'As alterações não salvas serão descartadas e os dados salvos serão carregados novamente.', textoConfirmar: 'Descartar e recarregar', textoCancelar: 'Continuar editando', destrutivo: true })) return;
    await executar(async () => {
      const [lista, perguntas, historico] = await Promise.all([listarEmpresas(true), listarPerguntasConhecimento(), listarOcorrencias(true)]); setEmpresas(lista); setBanco(perguntas); setOcorrencias(historico);
      if (empresaId) { const ts = await listarTentativasConhecimento(empresaId); const tentativa = ts.find(t => t.status === 'andamento' || t.status === 'pausada') || ts[0] || null; resetarCronometro(tentativa?.id || null); setTentativas(ts); setAtual(tentativa); setAlterada(false); }
    });
  }
  function adicionar(q: PerguntaConhecimento) {
    if (!atual || !editavel) return;
    if (atual.questoes.some(item => item.id === q.id || normalizarConhecimento(item.texto) === normalizarConhecimento(q.texto))) { toast.error('Esta pergunta já está na avaliação.'); return; }
    if (tentativas.some(t => t.status === 'concluida' && t.questoes.some(item => item.resposta === 'correto' && (item.id === q.id || normalizarConhecimento(item.texto) === normalizarConhecimento(q.texto))))) { toast.error('Esta pergunta já foi respondida corretamente.'); return; }
    alterar({ questoes: [...atual.questoes, { ...q, resposta: null, origem: 'banco' }] });
  }
  const respondidas = atual?.questoes.filter(q => q.resposta !== null).length || 0;
  const previa = atual?.questoes.length ? calcularResultadoValidacao(atual.questoes.map(q => ({ resposta: q.resposta || 'incorreto' }))) : null;
  const corretas = new Set(tentativas.filter(t => t.status === 'concluida').flatMap(t => t.questoes.filter(q => q.resposta === 'correto').map(q => q.id)));
  // Reservas de clientes suspensos não bloqueiam no servidor; as demais sim.
  const reservaBloqueante = !!atual && atual.treinadorId === user?.uid
    ? reservasPendentes.find(r => !empresas.find(e => e.id === r.empresaId)?.isSuspended) : undefined;
  function irParaProximaSemResposta() {
    const indice = atual?.questoes.findIndex(q => !q.resposta) ?? -1;
    const item = indice >= 0 ? questoesRef.current?.children[indice] as HTMLElement | undefined : undefined;
    if (!item) return;
    item.scrollIntoView({ block: 'center', behavior: 'smooth' });
    item.querySelector<HTMLInputElement>('input[type=radio]:not(:disabled)')?.focus({ preventScroll: true });
  }
  const disponiveis = banco.filter(q => q.ativa !== false && (!atual || atual.secoes.includes(q.secao)) && !corretas.has(q.id) && !atual?.questoes.some(item => item.id === q.id) && normalizarConhecimento(`${q.secao} ${q.texto}`).includes(normalizarConhecimento(busca)))
    .sort((a, b) => Number(b.preferida) - Number(a.preferida) || a.secao.localeCompare(b.secao, 'pt-BR'));

  return <main className="validacao-page" aria-busy={carregando || ocupado}>
    <header><h1>Validação do conhecimento</h1><p>Avalie o aprendizado, acompanhe tentativas e registre o treinamento com CSAT.</p></header>
    {role === 'master' && <BancoPerguntas banco={banco} onSalvar={q => setBanco(lista => [...lista.filter(item => item.id !== q.id), q])} />}
    {erro && <div role="alert" className="validacao-aviso">{erro} <button type="button" disabled={ocupado || cronometroAtivo} onClick={() => void recarregarDados()}>Recarregar dados</button></div>}
    <section className="validacao-card validacao-selecao">
      <div><label htmlFor="validacao-cliente">Cliente</label><SelectCustomizado id="validacao-cliente" value={empresaId} disabled={ocupado || carregando || cronometroAtivo} ariaLabel="Cliente da validação" placeholder="Selecione um cliente" opcoes={empresas.filter(e => e.id).map(e => ({ value: e.id!, label: `${e.nomeEmpresa}${e.isSuspended ? ' (suspenso)' : e.isCancelled ? ' (cancelado)' : ''}` }))} onChange={id => void selecionarCliente(id)} /></div>
      {escolherManutencao && <label>Conteúdo de Manutenção<select value={manutencao} onChange={e => setManutencao(e.target.value as 'basica' | 'avancada')} disabled={ocupado || !!ativa || !!ultima?.secoes.some(s => s.startsWith('Manutenção'))}><option value="basica">Manutenção básica</option><option value="avancada">Manutenção avançada</option></select></label>}
      {empresaId && !ativa && (!ultima || ultima.aprovada === false) && <button ref={gerarRef} type="button" disabled={ocupado || carregando || !!erro || !!cliente?.isSuspended || !!cliente?.isCancelled} onClick={() => executar(async () => guardar(await iniciarTentativaConhecimento(empresaId, manutencao, ultima?.id)))}>{ultima ? 'Iniciar nova tentativa' : tentativas.length ? 'Gerar nova avaliação' : 'Montar avaliação'}</button>}
    </section>
    {carregando ? <p role="status">Carregando dados da avaliação…</p> : !empresaId ? <p>Selecione um cliente para montar ou retomar uma avaliação.</p> : <>
      {(cliente?.isSuspended || cliente?.isCancelled) && <p className="validacao-aviso">O cliente está {cliente.isSuspended ? 'suspenso' : 'cancelado'}. A avaliação permanece preservada; retorne o cliente à esteira para concluir.</p>}
      <div className="validacao-historico" aria-label="Histórico de tentativas">{tentativas.map(t => <button type="button" key={t.id} disabled={ocupado || cronometroAtivo} aria-pressed={t.id === atual?.id} onClick={() => selecionarTentativa(t)}>Tentativa {t.numero} · {rotuloStatus[t.status]}{t.percentual !== undefined ? ` · ${numero(t.percentual)}%` : ''}</button>)}</div>
      {!atual && !erro && <p>Nenhuma avaliação cadastrada para este cliente. Use “Montar avaliação” para selecionar automaticamente as perguntas dos temas da esteira.</p>}
      {atual && <>
        <section className="validacao-card">
          <div className="validacao-sessao-cabecalho"><div><span className="validacao-eyebrow">Tentativa {atual.numero}</span><h2>{atual.empresa}</h2><p>Conduzida por {atual.treinadorNome}{alterada ? ' · Alterações não salvas' : ' · Salva'}</p></div><span className={`validacao-status validacao-status--${atual.status}`}>{rotuloStatus[atual.status]}</span></div>
          <p>Seções da avaliação: {atual.secoes.join(', ')}.</p>
          {atual.status === 'concluida' && <div><h3>Respostas do CSAT</h3>{atual.csatRespostas?.length ? atual.csatRespostas.map((r, i) => <p key={i}>{r.nome}: <AvaliacaoCsat nota={r.nota} experiencia={r.experiencia} />{r.opiniao ? ` — ${r.opiniao}` : ''}</p>) : <p>Aguardando respostas do cliente.</p>}<button type="button" disabled={ocupado} onClick={() => executar(async () => { const lista = await listarTentativasConhecimento(empresaId); setTentativas(lista); const t = lista.find(item => item.id === atual.id); if (t) guardar(t); })}>Atualizar respostas do CSAT</button></div>}
          <div className="validacao-resumo" aria-live="polite"><div><span>Andamento</span><strong>{respondidas}<small> / {atual.questoes.length} respostas</small></strong><progress value={respondidas} max={atual.questoes.length || 1} aria-label="Perguntas respondidas" /></div><div><span>Pontuação</span><strong>{numero(previa?.nota || 0)}<small> / 10 pontos</small></strong><span>{atual.questoes.length ? `${numero(10 / atual.questoes.length)} por pergunta` : 'Adicione perguntas para avaliar'}</span></div><div><span>Aproveitamento</span><strong>{numero(previa?.percentual || 0)}<small>%</small></strong><span>Aprovação a partir de 80%</span></div></div>
          {atual.status === 'concluida' && <div className={`validacao-resultado validacao-resultado--${atual.aprovada ? 'aprovado' : 'reprovado'}`}><strong>{atual.aprovada ? 'Aprovado — atingiu pelo menos 80%.' : 'Não atingiu 80% — nova tentativa disponível.'}</strong><p>Pontuação: {numero(atual.nota || 0)}/10 · Aproveitamento: {numero(atual.percentual || 0)}%.</p>
            {atual.aprovada && <p>{atual.concluiuEsteira ? 'A esteira do cliente foi concluída com esta aprovação.' : 'A data foi registrada no tema “Validação do conhecimento”. Se ainda houver temas pendentes na esteira, ela será concluída quando o último deles for registrado no Histórico.'}</p>}
            {atual.csatToken && <div className="validacao-csat-link"><label>Link do CSAT<input readOnly value={linkCsat(atual.csatToken)} onFocus={event => event.target.select()} /></label><div className="validacao-acoes"><a href={linkCsat(atual.csatToken)} target="_blank" rel="noreferrer">Abrir CSAT desta tentativa</a><button type="button" onClick={async () => { if (await copiarTexto(linkCsat(atual.csatToken!))) toast.success('Link do CSAT copiado.'); else toast.warning('Selecione o endereço no campo Link do CSAT e copie com Ctrl+C.'); }}>Copiar link</button></div></div>}
            <Link to={`/historico?empresa=${encodeURIComponent(atual.empresa)}`}>Ver ocorrências do cliente</Link>
            {atual.concluiuEsteira && <p><button type="button" disabled={ocupado} onClick={() => executar(() => prepararAvisoConclusao(atual))}>Avisar gestão da conclusão</button></p>}
          </div>}
          <div className="validacao-agenda"><label>Solicitação da agenda<input type="date" value={atual.treinamentoDataSolicitacao} disabled={!editavel || ocupado} onChange={e => alterar({ treinamentoDataSolicitacao: e.target.value })} /></label><label>Duração da agenda (HH:MM)<div className="validacao-cronometro-controle"><InputDuracaoAgenda value={atual.treinamentoTempoAgenda} disabled={!editavel || ocupado || cronometroAtivo} onChange={valor => alterar({ treinamentoTempoAgenda: valor })} erroId={editavel && duracaoInvalida ? 'validacao-duracao-erro' : undefined} />{editavel && <button type="button" className="validacao-cronometro-botao" disabled={ocupado} aria-label={cronometroAtivo ? 'Pausar cronômetro e salvar o tempo parcial' : cronometroAcumuladoMs > 0 ? 'Retomar cronômetro' : 'Iniciar cronômetro'} aria-pressed={cronometroAtivo} onClick={() => cronometroAtivo ? pausarCronometro(Date.now()) : iniciarCronometro(Date.now())}>{cronometroAtivo ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}{cronometroAtivo ? 'Pausar' : cronometroAcumuladoMs > 0 ? 'Retomar' : 'Iniciar'}</button>}</div>{(cronometroAtivo || cronometroAcumuladoMs > 0) && <output className="validacao-cronometro-tempo" role="timer" aria-label="Tempo decorrido da agenda">{formatarTempoCronometro(tempoCronometroMs)}</output>}{editavel && <small className="validacao-ajuda-campo">Pause para salvar o tempo parcial e continuar em outra agenda. A duração é arredondada para o minuto mais próximo.</small>}{editavel && duracaoInvalida && <small id="validacao-duracao-erro" className="validacao-erro-campo" role="status">Informe HH:MM, com minutos entre 00 e 59. Ex.: 02:00.</small>}</label><label>Quem solicitou<select value={isSolicitanteTreinamento(atual.treinamentoSolicitante) ? atual.treinamentoSolicitante : ''} disabled={!editavel || ocupado} required onChange={e => alterar({ treinamentoSolicitante: e.target.value })}><option value="" disabled>Selecione</option>{SOLICITANTES_TREINAMENTO.map(s => <option key={s} value={s}>{s}</option>)}</select></label></div>
        </section>
        {editavel && reservaBloqueante && <div className="validacao-aviso" role="status">Você tem o CSAT {reservaBloqueante.idSeqFormatted} de {reservaBloqueante.empresa} pendente. Registre essa ocorrência no <Link to={`/historico?empresa=${encodeURIComponent(reservaBloqueante.empresa)}`}>Histórico</Link> antes de concluir esta avaliação, porque a conclusão gera um novo link do CSAT. Você pode salvar e pausar normalmente.</div>}
        <div className="validacao-acoes validacao-card validacao-acoes--principal"><span className="validacao-acoes-contexto">{respondidas} de {atual.questoes.length} respondidas</span>{editavel && respondidas < atual.questoes.length && <button type="button" className="validacao-proxima" onClick={irParaProximaSemResposta}>Próxima sem resposta</button>}{editavel && <><button type="button" disabled={ocupado || duracaoInvalida || cronometroAtivo} onClick={() => executar(async () => { guardar(await salvarTentativaConhecimento(atual, 'andamento')); toast.success('Avaliação salva.'); })}>Salvar alterações</button><button type="button" disabled={ocupado || duracaoInvalida || cronometroAtivo} onClick={() => executar(async () => { guardar(await salvarTentativaConhecimento(atual, 'pausada')); toast.success('Avaliação pausada. Você pode retomá-la em outra agenda.'); })}>Salvar e pausar</button><button className="validacao-primario" type="button" disabled={ocupado || cronometroAtivo || !duracaoAgendaValida(atual.treinamentoTempoAgenda) || !atual.questoes.length || respondidas !== atual.questoes.length || !!reservaBloqueante || !!cliente?.isSuspended || !!cliente?.isCancelled} onClick={() => setConclusaoAberta(true)}>Concluir avaliação</button></>}{atual.status === 'pausada' && (role === 'master' || atual.treinadorId === user?.uid) && <button type="button" disabled={ocupado} onClick={() => executar(async () => guardar(await salvarTentativaConhecimento(atual, 'andamento')))}>Retomar avaliação</button>}{cancelavel && <button className="validacao-cancelar" type="button" disabled={ocupado || cronometroAtivo} onClick={async () => {
          if (!await confirmar({ titulo: 'Cancelar a avaliação?', descricao: `${atual.empresa} · Tentativa ${atual.numero}\n\nO formulário e suas respostas serão excluídos, sem contar como tentativa. Nenhum treinamento será registrado, e você poderá gerar outra avaliação com o mesmo número.`, textoConfirmar: 'Cancelar avaliação', textoCancelar: 'Manter avaliação', destrutivo: true })) return;
          void executar(async () => {
            await cancelarTentativaConhecimento(atual);
            const restantes = tentativas.filter(t => t.id !== atual.id);
            resetarCronometro(restantes[0]?.id || null); setTentativas(restantes); setAtual(restantes[0] || null); setAlterada(false);
            toast.success('Avaliação descartada. Ela não contará como tentativa.');
            requestAnimationFrame(() => { gerarRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); gerarRef.current?.focus({ preventScroll: true }); });
          });
        }}>Cancelar avaliação</button>}{ocupado && <span role="status">Processando…</span>}</div>
        <ol
          ref={questoesRef}
          className="validacao-questoes"
          tabIndex={-1}
          aria-label="Perguntas da avaliação, em ordem"
          onDragLeave={e => {
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setAlvoArraste(null);
          }}
        >{atual.questoes.map((q, i) => <QuestaoConhecimentoCard key={q.id} questao={q} indice={i} total={atual.questoes.length} valor={10 / atual.questoes.length} editavel={editavel} ocupado={ocupado} podeMoverCima={i > 0} podeMoverBaixo={i < atual.questoes.length - 1} arrastando={arrastandoIndex === i} alvoArraste={alvoArraste?.indice === i ? alvoArraste.posicao : null} onAlterar={updates => atualizarQuestao(q.id, updates)} onMover={direcao => moverQuestao(i, direcao)} onMoverPara={posicao => moverQuestaoParaPosicao(i, posicao)} onArrastarInicio={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); setArrastandoIndex(i); }} onArrastarSobre={aoArrastarQuestaoSobre(i)} onSoltar={aoSoltarQuestao} onArrasteFim={aoFinalizarArrasteQuestao} onRemover={async () => {
          if (await confirmar({ titulo: 'Remover esta pergunta?', descricao: `${q.texto}\n\nA pontuação será redistribuída entre as perguntas restantes.`, textoConfirmar: 'Remover pergunta', textoCancelar: 'Manter pergunta', destrutivo: true })) {
            alterar({ questoes: atual.questoes.filter(item => item.id !== q.id) });
            requestAnimationFrame(() => {
              const botoes = questoesRef.current?.querySelectorAll<HTMLButtonElement>('.validacao-remover');
              const foco = botoes?.[Math.min(i, botoes.length - 1)] || questoesRef.current;
              foco?.focus({ preventScroll: true });
            });
          }
        }} />)}</ol>
        {editavel && <details className="validacao-card validacao-personalizar"><summary>Adicionar perguntas do banco</summary><label>Pesquisar no banco<input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Seção ou texto da pergunta" /></label><div className="validacao-banco">{disponiveis.map(q => <div key={q.id}><span><strong>{q.secao}{q.preferida ? ' · Preferida' : ''}</strong> — {q.texto}</span><button type="button" disabled={ocupado || atual.questoes.length >= 100} onClick={() => adicionar(q)}>Adicionar</button></div>)}{!disponiveis.length && <p>Nenhuma pergunta elegível para esta busca. Revise a busca ou solicite ao Master novas perguntas no banco.</p>}</div></details>}
      </>}
    </>}
    {modalConfirmacao}
    {conclusaoAberta && atual && <ImpressaoValidacaoModal
      tentativa={atual.numero}
      empresa={atual.empresa}
      ocupado={ocupado}
      erro={erro}
      onCancelar={() => setConclusaoAberta(false)}
      onConfirmar={concluirAvaliacao}
    />}
    {notificacaoProgresso && <NotificacaoProgressoEsteiraModal
      open
      empresa={notificacaoProgresso.cliente}
      ocorridoEm={notificacaoProgresso.ocorridoEm}
      onClose={() => {
        const tentativa = notificacaoProgresso.tentativa;
        setNotificacaoProgresso(null);
        if (tentativa.concluiuEsteira) void executar(() => prepararAvisoConclusao(tentativa));
      }}
      onResultado={async resultado => {
        const tentativa = notificacaoProgresso.tentativa;
        if (!tentativa.ocorrenciaId) throw new Error('Não foi possível localizar a ocorrência da validação.');
        await salvarOcorrencia({
          id: tentativa.ocorrenciaId,
          whatsappStatus: resultado.status,
          whatsappEnviadoEm: resultado.enviadoEm,
          whatsappDestinatarios: resultado.destinatarios,
        } as Ocorrencia);
      }}
    />}
    <GestaoNotificacaoModal open={!!gestao} titulo="Avisar gestão da conclusão da esteira" destinatarios={gestao?.destinatarios || []} avisos={gestao?.avisos} mensagem={gestao?.mensagem || ''} onChangeMensagem={mensagem => setGestao(g => g ? { ...g, mensagem } : null)} onClose={() => setGestao(null)} onResultado={async resultado => {
      if (!gestao?.cliente.id) return;
      await salvarEmpresas({ id: gestao.cliente.id, ...camposResultadoConclusao(resultado) });
    }} />
  </main>;
}
