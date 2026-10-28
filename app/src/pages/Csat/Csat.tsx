import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Star } from 'lucide-react';
import { requisicaoCsat } from '../../services/csat';
import './Csat.css';

export function Csat() {
  const { token = '' } = useParams();
  const [nome, setNome] = useState('');
  const [nota, setNota] = useState(0);
  const [notaPreVisualizada, setNotaPreVisualizada] = useState(0);
  const [opiniao, setOpiniao] = useState('');
  const [erro, setErro] = useState('');
  const [pronto, setPronto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const [responseId] = useState(() => {
    try {
      const key = `csat-resposta:${token}`;
      const id = localStorage.getItem(key) || crypto.randomUUID();
      localStorage.setItem(key, id);
      return id;
    } catch { return crypto.randomUUID(); }
  });
  useEffect(() => {
    let ativo = true;
    requisicaoCsat(`publico/${encodeURIComponent(token)}`)
      .then(() => { if (ativo) setPronto(true); })
      .catch(error => { if (ativo) setErro(error.message); });
    return () => { ativo = false; };
  }, [token]);
  return <main className="csat-page"><section className="csat-card">
    <h1>Avalie seu treinamento</h1>
    {sucesso ? <p role="status">Obrigado! Sua avaliação foi registrada.</p> : <>
      <p>Conte como foi sua experiência com o treinamento.</p>
      {erro && <p role="alert">{erro}</p>}
      {!pronto && !erro && <p>Carregando...</p>}
      {pronto && <form onSubmit={async event => {
        event.preventDefault();
        if (enviando) return;
        setEnviando(true); setErro('');
        try {
          await requisicaoCsat(`publico/${encodeURIComponent(token)}`, { nome, nota, opiniao, responseId });
          setSucesso(true);
        } catch (error) { setErro(error instanceof Error ? error.message : 'Tente novamente.'); }
        finally { setEnviando(false); }
      }}>
        <label>Nome (obrigatório)<input required maxLength={120} value={nome} onChange={e => setNome(e.target.value)} autoComplete="name" /></label>
        <fieldset className="csat-estrelas-fieldset">
          <legend>Nota do treinamento, de 1 a 5 estrelas (obrigatório)</legend>
          <div className="csat-estrelas" role="radiogroup" aria-label="Nota do treinamento" onMouseLeave={() => setNotaPreVisualizada(0)}>
            {[1, 2, 3, 4, 5].map(valor => (
              <label
                key={valor}
                className={`csat-estrela${(notaPreVisualizada || nota) >= valor ? ' csat-estrela--marcada' : ''}`}
                onMouseEnter={() => setNotaPreVisualizada(valor)}
              >
                <input
                  type="radio"
                  name="nota"
                  required
                  value={valor}
                  checked={nota === valor}
                  onChange={() => setNota(valor)}
                  onFocus={() => setNotaPreVisualizada(valor)}
                  onBlur={() => setNotaPreVisualizada(0)}
                />
                <Star size={32} fill={(notaPreVisualizada || nota) >= valor ? 'currentColor' : 'none'} aria-hidden="true" />
                <span className="csat-estrela-rotulo">{valor}</span>
              </label>
            ))}
          </div>
          <p role="status" className="csat-nota-selecionada">
            {notaPreVisualizada > 0
              ? `Pré-visualização: ${notaPreVisualizada} de 5`
              : nota > 0
                ? `Nota selecionada: ${nota} de 5`
                : 'Nenhuma nota selecionada ainda'}
          </p>
        </fieldset>
        <label>Sua opinião (opcional)<textarea maxLength={100} value={opiniao} onChange={e => setOpiniao(e.target.value)} /></label>
        <small>{opiniao.length}/100 caracteres</small>
        <button disabled={enviando || !nome.trim() || nota === 0}>{enviando ? 'Enviando...' : 'Enviar avaliação'}</button>
      </form>}
    </>}
  </section></main>;
}
