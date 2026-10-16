import { useRef, useState } from "react";
import { Award, ChevronRight, Trophy, User } from "lucide-react";
import { formatarNome } from "../../utils/formatarNome";
import { comporPontosGamificacao } from "../../utils/rankingGamificacao";
import type { DesempenhoGamificacao } from "../../utils/rankingGamificacao";
import "./PainelGamificacao.css";

interface Props {
  ranking: DesempenhoGamificacao[];
  usuarioId?: string;
  periodo: string;
  rotulosAcoes: Partial<Record<string, string>>;
  onVerAtividades: (treinadorId: string) => void;
}

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const pontos = (valor: number) => `${valor > 0 ? "+" : ""}${numero.format(valor)}`;
const nome = (t: DesempenhoGamificacao) => formatarNome(t.nome) || t.email;

function TaxaResposta({ treinador: t }: { treinador: DesempenhoGamificacao }) {
  return (
    <span className="gp-resposta">
      {t.totalTrainingsCount > 0
        ? `Resposta ao CSAT: ${Math.round(t.taxaResposta * 100)}% (${t.answeredTrainingsCount}/${t.totalTrainingsCount})`
        : "Sem treinamentos realizados no período"}
    </span>
  );
}

export function PainelGamificacao({ ranking, usuarioId, periodo, rotulosAcoes, onVerAtividades }: Props) {
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const detalheRef = useRef<HTMLHeadingElement>(null);
  const selecionado = ranking.find((t) => t.uid === (selecionadoId ?? usuarioId)) ?? ranking[0];
  const pessoal = ranking.find((t) => t.uid === usuarioId);
  const destaques = ranking.filter((t) => t.score > 0 && t.lancamentos.length > 0).slice(0, 3);
  const composicao = selecionado ? comporPontosGamificacao(selecionado) : null;

  function selecionar(t: DesempenhoGamificacao) {
    setSelecionadoId(t.uid);
    if (window.matchMedia("(max-width: 900px)").matches) {
      detalheRef.current?.focus({ preventScroll: true });
      detalheRef.current?.scrollIntoView({
        block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    }
  }

  return (
    <div className="gp-painel">
      {pessoal && (
        <section className="gp-pessoal" aria-labelledby="gp-meu-desempenho">
          <div>
            <span className="gp-eyebrow"><User size={14} aria-hidden="true" /> Seu progresso</span>
            <h2 id="gp-meu-desempenho">Meu desempenho</h2>
            <p>{pessoal.lancamentos.length > 0 ? periodo : "Você ainda não tem lançamentos neste período."}</p>
          </div>
          <dl className="gp-resumo">
            <div><dt>Posição na ordenação</dt><dd>{pessoal.lancamentos.length > 0 ? `${ranking.indexOf(pessoal) + 1}º` : "—"}</dd></div>
            <div><dt>Pontos</dt><dd key={pessoal.score} className="gp-valor-atualizado">{numero.format(pessoal.score)}</dd></div>
            <div><dt>Treinamentos realizados</dt><dd>{pessoal.totalTrainingsCount}</dd></div>
            <div><dt>Bônus por resposta</dt><dd>{pessoal.bonusPercentage}%</dd></div>
          </dl>
          <TaxaResposta treinador={pessoal} />
        </section>
      )}

      <section className="gp-podio" aria-labelledby="gp-podio-titulo">
        <div className="gp-section-heading">
          <div>
            <span className="gp-eyebrow"><Trophy size={14} aria-hidden="true" /> Destaques da equipe</span>
            <h2 id="gp-podio-titulo">Pódio do período</h2>
            <p>{periodo} · Classificação conforme os lançamentos atuais.</p>
          </div>
          <span className="gp-status">{destaques.length > 0 ? "Liderança do período" : "Aguardando pontuação"}</span>
        </div>
        {destaques.length === 0 ? (
          <p className="gp-vazio">Ainda não há pontuação positiva para formar o pódio. Consulte as atividades e os descontos no ranking abaixo.</p>
        ) : (
          <ol className="gp-podio-lista">
            {destaques.map((t, index) => (
              <li key={t.uid} className={`gp-podio-lugar gp-lugar-${index + 1}`}>
                <button type="button" onClick={() => selecionar(t)} aria-controls="gp-composicao" aria-label={`Ver composição de ${nome(t)}, ${index + 1}º na ordenação, ${numero.format(t.score)} pontos`}>
                  {index === 0 ? <Trophy size={28} aria-hidden="true" /> : <Award size={26} aria-hidden="true" />}
                  <span className="gp-iniciais" aria-hidden="true">{nome(t).split(/\s+/).filter((parte) => !/^(de|da|do|das|dos|e)$/i.test(parte)).slice(0, 2).map((parte) => parte[0]).join("").toLocaleUpperCase("pt-BR")}</span>
                  <strong className="gp-nome">{nome(t)}</strong>
                  <span className="gp-colocacao">{index + 1}º na ordenação{t.empate ? " · empate nos critérios" : ""}</span>
                  <span className="gp-podio-pontos" key={t.score}>{numero.format(t.score)} <small>pts</small></span>
                  <TaxaResposta treinador={t} />
                  <span className="gp-podio-base" aria-hidden="true">{index + 1}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
        {destaques.some((t) => t.empate) && <p className="gp-nota">Há participantes com os mesmos critérios de desempenho. Nesses casos, a ordenação atual usa o nome em ordem alfabética.</p>}
      </section>

      <div className="gp-ranking-layout">
        <section className="gp-ranking" aria-labelledby="gp-ranking-titulo">
          <div className="gp-section-heading">
            <div><h2 id="gp-ranking-titulo">Ranking da equipe</h2><p>Selecione um treinador para entender a pontuação.</p></div>
            <span className="gp-status">{ranking.length} {ranking.length === 1 ? "treinador" : "treinadores"}</span>
          </div>
          {ranking.length === 0 ? <p className="gp-vazio">Nenhum treinador cadastrado no sistema.</p> : (
            <ol className="gp-ranking-lista">
              {ranking.map((t, index) => (
                <li key={t.uid}>
                  <button type="button" className={`gp-ranking-botao${selecionado?.uid === t.uid ? " gp-selecionado" : ""}`} aria-pressed={selecionado?.uid === t.uid} aria-controls="gp-composicao" onClick={() => selecionar(t)}>
                    <span className="gp-posicao">{t.lancamentos.length > 0 ? `${index + 1}º` : "—"}</span>
                    <span className="gp-ranking-info">
                      <span className="gp-nome">{nome(t)} {t.uid === usuarioId && <span className="gp-voce">Você</span>}</span>
                      <span>{t.lancamentos.length === 0 ? "Sem lançamentos no período" : `${t.qtdAcoes} atividades${t.empate ? " · empate nos critérios" : ""}`}</span>
                      <TaxaResposta treinador={t} />
                    </span>
                    <span className={`gp-ranking-pontos${t.score < 0 ? " gp-negativo" : ""}`} key={t.score}>{numero.format(t.score)}<small>pts</small></span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section id="gp-composicao" className="gp-composicao" aria-labelledby="gp-composicao-titulo">
          <div className="gp-section-heading">
            <div><span className="gp-eyebrow">De onde vêm os pontos</span><h2 id="gp-composicao-titulo" ref={detalheRef} tabIndex={-1}>{selecionado ? nome(selecionado) : "Composição da pontuação"}</h2></div>
          </div>
          {selecionado && composicao ? (
            <div key={selecionado.uid} className="gp-detalhe-conteudo">
              <TaxaResposta treinador={selecionado} />
              <p className="gp-nota">O bônus considera a participação na pesquisa, com respostas Bom ou Ruim e notas antigas. A taxa de resposta é diferente da satisfação positiva.</p>
              {selecionado.lancamentos.length === 0 ? <p className="gp-vazio">Nenhum lançamento deste treinador no período selecionado.</p> : (
                <dl className="gp-parcelas">
                  {composicao.grupos.map((grupo) => (
                    <div key={grupo.tipo}><dt>{rotulosAcoes[grupo.tipo] ?? grupo.tipo}<small>{grupo.quantidade} {grupo.quantidade === 1 ? "lançamento" : "lançamentos"}</small></dt><dd className={grupo.pontos < 0 ? "gp-negativo" : ""}>{pontos(grupo.pontos)}</dd></div>
                  ))}
                  <div className="gp-base"><dt>Pontuação base<small>Atividades e descontos</small></dt><dd>{numero.format(selecionado.baseScore)}</dd></div>
                  <div><dt>Bônus por resposta ao CSAT<small>Percentual aplicado à base: {selecionado.bonusPercentage}%</small></dt><dd className={composicao.bonusPontos < 0 ? "gp-negativo" : ""}>{pontos(composicao.bonusPontos)}</dd></div>
                  <div className="gp-total"><dt>Total do período</dt><dd key={selecionado.score} className="gp-valor-atualizado">{numero.format(selecionado.score)} <small>pts</small></dd></div>
                </dl>
              )}
              <details className="gp-regras"><summary>Como o ranking é calculado</summary><p>A base soma os pontos de todos os lançamentos do período. A taxa de resposta considera treinamentos realizados, excluindo Cancelado e Ausente.</p><p>Resposta de pelo menos 70%: bônus de 10%; 80%: 20%; 90%: 30%. O percentual é aplicado à base, inclusive quando ela é negativa.</p><p>Ordenação: maior pontuação, maior taxa de resposta, menos falhas comprovadas e nome em ordem alfabética.</p></details>
              <button type="button" className="gp-ver-atividades" onClick={() => onVerAtividades(selecionado.uid)}>Ver atividades deste treinador <ChevronRight size={16} aria-hidden="true" /></button>
            </div>
          ) : <p className="gp-vazio">O detalhamento ficará disponível quando houver treinadores cadastrados.</p>}
        </section>
      </div>
    </div>
  );
}
