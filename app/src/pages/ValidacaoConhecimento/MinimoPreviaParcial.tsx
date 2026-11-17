import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DOC_METAS_PAINEL_TREINAMENTO, listarMetasIndicadores, salvarMetaIndicador } from '../../services/metasIndicadores';
import { CHAVE_MINIMO_PREVIA_PARCIAL, LIMITES_MINIMO_PREVIA_PARCIAL, MINIMO_PREVIA_PARCIAL_PADRAO, minimoPreviaParcial } from '../../utils/validacaoConhecimentoIndicadores';

const { minimo: MIN, maximo: MAX } = LIMITES_MINIMO_PREVIA_PARCIAL;

/**
 * Configuração (Master) do mínimo de perguntas com validação parcial marcada para uma avaliação
 * aberta entrar como prévia no card "Validação do Conhecimento" do painel de indicadores.
 * Fica nas metas do painel; as regras do Firestore já restringem a gravação ao Master.
 */
export function MinimoPreviaParcial() {
  const [salvo, setSalvo] = useState<number | null>(null);
  const [valor, setValor] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [tentativaCarga, setTentativaCarga] = useState(0);

  useEffect(() => {
    let ativo = true;
    listarMetasIndicadores(DOC_METAS_PAINEL_TREINAMENTO)
      .then(metas => { if (!ativo) return; const atual = minimoPreviaParcial(metas); setSalvo(atual); setValor(String(atual)); })
      .catch(() => { if (ativo) setErroCarga('Não foi possível carregar o mínimo atual. Verifique a conexão e tente novamente.'); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [tentativaCarga]);

  const numero = Number(valor);
  const valido = /^\d+$/.test(valor.trim()) && numero >= MIN && numero <= MAX;
  const erroCampo = valor.trim() && !valido ? `Informe um número inteiro de ${MIN} a ${MAX}.` : '';
  const alterado = valido && numero !== salvo;

  return <details className="validacao-card validacao-banco-gestao validacao-minimo-previa">
    <summary>Indicador do painel · Master <span>{salvo === null ? 'Prévia pela validação parcial' : `Prévia a partir de ${salvo} perguntas marcadas`}</span></summary>
    <p className="validacao-minimo-previa-ajuda">
      No card “Validação do Conhecimento” do painel de indicadores, uma avaliação em andamento ou pausada entra como prévia pela validação parcial
      só quando tiver ao menos este número de perguntas com marcação parcial. Com menos marcações, o cliente continua contando pelo último resultado final, se houver.
      Padrão: {MINIMO_PREVIA_PARCIAL_PADRAO}.
    </p>
    {erroCarga
      ? <p className="validacao-erro-campo" role="alert">{erroCarga} <button type="button" onClick={() => { setErroCarga(''); setCarregando(true); setTentativaCarga(n => n + 1); }}>Tentar novamente</button></p>
      : <form className="validacao-minimo-previa-form" onSubmit={async e => {
        e.preventDefault();
        if (!alterado || salvando) return;
        setSalvando(true);
        try {
          await salvarMetaIndicador(CHAVE_MINIMO_PREVIA_PARCIAL, numero, DOC_METAS_PAINEL_TREINAMENTO);
          setSalvo(numero);
          toast.success(`Mínimo da prévia salvo: ${numero} perguntas. O painel aplica na próxima atualização.`);
        } catch {
          toast.error('Não foi possível salvar o mínimo. O valor digitado foi mantido; tente novamente.');
        } finally { setSalvando(false); }
      }}>
        <label htmlFor="validacao-minimo-previa">Mínimo de perguntas com validação parcial</label>
        <div className="validacao-minimo-previa-linha">
          <input id="validacao-minimo-previa" type="number" inputMode="numeric" min={MIN} max={MAX} step={1} value={valor}
            disabled={carregando || salvando} aria-invalid={!!erroCampo} aria-describedby={erroCampo ? 'validacao-minimo-previa-erro' : undefined}
            onChange={e => setValor(e.target.value)} />
          <button type="submit" className="validacao-primario" disabled={carregando || salvando || !alterado}>{salvando ? 'Salvando…' : 'Salvar mínimo'}</button>
        </div>
        {carregando && <p className="validacao-minimo-previa-ajuda" role="status">Carregando o mínimo atual…</p>}
        {erroCampo && <p id="validacao-minimo-previa-erro" className="validacao-erro-campo" role="alert">{erroCampo}</p>}
      </form>}
  </details>;
}
