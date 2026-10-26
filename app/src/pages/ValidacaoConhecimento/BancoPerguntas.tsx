import { useState } from 'react';
import { toast } from 'sonner';
import { atualizarPerguntaConhecimento, cadastrarPerguntaConhecimento } from '../../services/validacaoConhecimento';
import { normalizarConhecimento, SECOES } from '../../../../server/src/domain/validacaoConhecimento';
import type { PerguntaConhecimento, Secao } from '../../../../server/src/domain/validacaoConhecimento';

interface Props {
  banco: PerguntaConhecimento[];
  /** Recebe a pergunta criada ou alterada, já confirmada pela API. */
  onSalvar: (pergunta: PerguntaConhecimento) => void;
}

export function BancoPerguntas({ banco, onSalvar }: Props) {
  const [secao, setSecao] = useState<Secao>('Temas iniciais');
  const [texto, setTexto] = useState('');
  const [preferida, setPreferida] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [filtroSecao, setFiltroSecao] = useState<Secao | ''>('');
  const [mostrarInativas, setMostrarInativas] = useState(false);
  const [editando, setEditando] = useState<{ id: string; texto: string; preferida: boolean } | null>(null);

  async function salvar(acao: () => Promise<PerguntaConhecimento>, sucesso: string) {
    if (salvando) return false;
    setSalvando(true); setErro('');
    try { onSalvar(await acao()); toast.success(sucesso); return true; }
    catch (error) { setErro(error instanceof Error ? error.message : 'Não foi possível salvar a pergunta.'); return false; }
    finally { setSalvando(false); }
  }

  const termo = normalizarConhecimento(busca);
  const lista = banco
    .filter(q => (mostrarInativas || q.ativa !== false) && (!filtroSecao || q.secao === filtroSecao)
      && (!termo || normalizarConhecimento(`${q.secao} ${q.texto}`).includes(termo)))
    .sort((a, b) => SECOES.indexOf(a.secao) - SECOES.indexOf(b.secao) || Number(b.preferida) - Number(a.preferida) || a.texto.localeCompare(b.texto, 'pt-BR'));
  const inativas = banco.filter(q => q.ativa === false).length;

  return <details className="validacao-card validacao-banco-gestao">
    <summary>Gerenciar banco de perguntas · Master <span>{banco.length - inativas} ativas{inativas ? ` · ${inativas} inativas` : ''}</span></summary>
    {erro && <p role="alert" className="validacao-aviso">{erro}</p>}

    <form className="validacao-banco-form" onSubmit={async e => {
      e.preventDefault();
      if (await salvar(() => cadastrarPerguntaConhecimento(secao, texto, preferida), 'Pergunta cadastrada no banco.')) { setTexto(''); setPreferida(false); }
    }}>
      <h3>Nova pergunta</h3>
      <p>Novas perguntas entram nas próximas avaliações. Avaliações já montadas não mudam.</p>
      <label>Seção<select value={secao} onChange={e => setSecao(e.target.value as Secao)} disabled={salvando}>{SECOES.map(s => <option key={s}>{s}</option>)}</select></label>
      <label>Pergunta<textarea required maxLength={2000} value={texto} onChange={e => setTexto(e.target.value)} disabled={salvando} placeholder="Use ______ para campos que o treinador preenche na agenda, como veículo ou período." /></label>
      <div className="validacao-acoes"><label className="validacao-checkbox"><input type="checkbox" checked={preferida} onChange={e => setPreferida(e.target.checked)} disabled={salvando} /> Preferida (prioridade na montagem)</label><button type="submit" disabled={salvando || !texto.trim()}>{salvando ? 'Salvando…' : 'Cadastrar pergunta'}</button></div>
    </form>

    <section className="validacao-banco-lista" aria-labelledby="validacao-banco-titulo">
      <h3 id="validacao-banco-titulo">Perguntas cadastradas</h3>
      <div className="validacao-banco-filtros">
        <label>Pesquisar<input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Texto da pergunta" /></label>
        <label>Seção<select value={filtroSecao} onChange={e => setFiltroSecao(e.target.value as Secao | '')}><option value="">Todas as seções</option>{SECOES.map(s => <option key={s}>{s}</option>)}</select></label>
        <label className="validacao-checkbox"><input type="checkbox" checked={mostrarInativas} onChange={e => setMostrarInativas(e.target.checked)} /> Mostrar inativas</label>
      </div>
      {!lista.length ? <p>Nenhuma pergunta encontrada com estes filtros.</p> : <ul>{lista.map(q => {
        const emEdicao = editando?.id === q.id ? editando : null;
        return <li key={q.id} className={q.ativa === false ? 'validacao-banco-inativa' : undefined}>
          <div className="validacao-banco-etiquetas"><span>{q.secao}</span>{q.preferida && <span className="validacao-etiqueta-preferida">Preferida</span>}{q.ativa === false && <span className="validacao-etiqueta-inativa">Inativa</span>}</div>
          {emEdicao ? <form onSubmit={async e => {
            e.preventDefault();
            if (await salvar(() => atualizarPerguntaConhecimento(q.id, { texto: emEdicao.texto, preferida: emEdicao.preferida }), 'Pergunta atualizada.')) setEditando(null);
          }}>
            <label>Texto da pergunta<textarea required maxLength={2000} value={emEdicao.texto} onChange={e => setEditando({ ...emEdicao, texto: e.target.value })} disabled={salvando} autoFocus /></label>
            <div className="validacao-acoes"><label className="validacao-checkbox"><input type="checkbox" checked={emEdicao.preferida} onChange={e => setEditando({ ...emEdicao, preferida: e.target.checked })} disabled={salvando} /> Preferida</label><button type="button" onClick={() => setEditando(null)} disabled={salvando}>Cancelar</button><button type="submit" className="validacao-primario" disabled={salvando || !emEdicao.texto.trim()}>Salvar</button></div>
          </form> : <>
            <p>{q.texto}</p>
            <div className="validacao-acoes">
              <button type="button" disabled={salvando} onClick={() => setEditando({ id: q.id, texto: q.texto, preferida: q.preferida })}>Editar</button>
              <button type="button" disabled={salvando} onClick={() => void salvar(() => atualizarPerguntaConhecimento(q.id, { ativa: q.ativa === false }), q.ativa === false ? 'Pergunta reativada.' : 'Pergunta desativada. Ela não entra em novas avaliações.')}>{q.ativa === false ? 'Reativar' : 'Desativar'}</button>
            </div>
          </>}
        </li>;
      })}</ul>}
    </section>
  </details>;
}
