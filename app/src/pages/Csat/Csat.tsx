import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { requisicaoCsat } from '../../services/csat';
import './Csat.css';

export function Csat() {
  const { token = '' } = useParams();
  const [nome, setNome] = useState('');
  const [experiencia, setExperiencia] = useState('');
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
          await requisicaoCsat(`publico/${encodeURIComponent(token)}`, { nome, experiencia, opiniao, responseId });
          setSucesso(true);
        } catch (error) { setErro(error instanceof Error ? error.message : 'Tente novamente.'); }
        finally { setEnviando(false); }
      }}>
        <label>Nome (obrigatório)<input required maxLength={120} value={nome} onChange={e => setNome(e.target.value)} autoComplete="name" /></label>
        <fieldset><legend>Experiência do treinamento (obrigatório)</legend>
          {['Bom', 'Ruim'].map(valor => <label key={valor} className="csat-option"><input type="radio" name="experiencia" required value={valor} checked={experiencia === valor} onChange={e => setExperiencia(e.target.value)} />{valor}</label>)}
        </fieldset>
        <label>Sua opinião (opcional)<textarea maxLength={100} value={opiniao} onChange={e => setOpiniao(e.target.value)} /></label>
        <small>{opiniao.length}/100 caracteres</small>
        <button disabled={enviando || !nome.trim()}>{enviando ? 'Enviando...' : 'Enviar avaliação'}</button>
      </form>}
    </>}
  </section></main>;
}
