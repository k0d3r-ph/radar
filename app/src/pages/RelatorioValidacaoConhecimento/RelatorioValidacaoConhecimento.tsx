import { useEffect, useState } from "react";
import { indicadoresConhecimento } from "../../services/validacaoConhecimento";
import type { IndicadoresValidacao } from "../../../../server/src/domain/validacaoConhecimento";
import "../Relatorios/Relatorios.css";
import "./RelatorioValidacaoConhecimento.css";

const DIA = 86_400_000;
const hojeBrasilia = (deslocamentoDias = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(Date.now() + deslocamentoDias * DIA);
const percentual = (valor: number | null) =>
  valor === null ? "—" : `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const decimal = (valor: number | null) =>
  valor === null ? "—" : valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** Aba "Validação do conhecimento" dos Relatórios (Master e treinadores). */
export function RelatorioValidacaoConhecimento() {
  const [inicio, setInicio] = useState(() => hojeBrasilia(-29));
  const [fim, setFim] = useState(() => hojeBrasilia());
  const [tentativa, setTentativa] = useState(0);
  // Resultado da última consulta concluída; está carregando enquanto a chave atual não chegou.
  const [resposta, setResposta] = useState<{ chave: string; dados: IndicadoresValidacao | null; erro: string } | null>(null);
  const periodoValido = !!inicio && !!fim && inicio <= fim;
  const chave = `${inicio}:${fim}:${tentativa}`;
  const carregando = periodoValido && resposta?.chave !== chave;
  const dados = resposta?.chave === chave ? resposta.dados : null;
  const erro = resposta?.chave === chave ? resposta.erro : "";

  useEffect(() => {
    if (!periodoValido) return;
    let cancelado = false;
    indicadoresConhecimento(inicio, fim)
      .then((resultado) => { if (!cancelado) setResposta({ chave, dados: resultado, erro: "" }); })
      .catch((e) => { if (!cancelado) setResposta({ chave, dados: null, erro: e instanceof Error ? e.message : "Não foi possível carregar os indicadores." }); });
    return () => { cancelado = true; };
  }, [inicio, fim, periodoValido, chave]);

  const cards = dados ? [
    { titulo: "Tentativas concluídas", valor: String(dados.tentativasConcluidas), desc: `${dados.clientesAvaliados} ${dados.clientesAvaliados === 1 ? "cliente avaliado" : "clientes avaliados"} no período.` },
    { titulo: "Taxa de aprovação", valor: percentual(dados.taxaAprovacao), desc: `${dados.aprovadas} de ${dados.tentativasConcluidas} tentativas atingiram 80% ou mais.` },
    { titulo: "Aprovação na 1ª tentativa", valor: percentual(dados.aprovacaoPrimeiraTentativa), desc: "Clientes aprovados já na primeira avaliação." },
    { titulo: "Aproveitamento médio", valor: percentual(dados.mediaAproveitamento), desc: "Média do percentual de todas as tentativas concluídas." },
    { titulo: "Tentativas até aprovar", valor: decimal(dados.mediaTentativasAteAprovar), desc: "Número médio da tentativa em que o cliente foi aprovado." },
  ] : [];

  return (
    <div className="validacao-relatorio">
      <div className="relatorios-filtros">
        <div className="validacao-relatorio-periodo">
          <label htmlFor="validacao-relatorio-inicio">De:</label>
          <input id="validacao-relatorio-inicio" type="date" value={inicio} max={fim} onChange={(e) => setInicio(e.target.value)} />
          <label htmlFor="validacao-relatorio-fim">Até:</label>
          <input id="validacao-relatorio-fim" type="date" value={fim} min={inicio} max={hojeBrasilia()} onChange={(e) => setFim(e.target.value)} />
        </div>
        <p className="validacao-relatorio-nota">Considera as tentativas concluídas no período. Aproveitamento: correto vale 1 e parcial vale 0,5.</p>
      </div>

      {!periodoValido ? (
        <div className="relatorio-empty"><p>Informe datas válidas, com a data inicial anterior ou igual à final.</p></div>
      ) : carregando ? (
        <div className="relatorio-loader" role="status"><div className="spinner"></div><p>Carregando indicadores da validação…</p></div>
      ) : erro ? (
        <div className="relatorio-empty" role="alert">
          <p>{erro}</p>
          <button type="button" className="btn-secondary" onClick={() => setTentativa((n) => n + 1)}>Tentar novamente</button>
        </div>
      ) : !dados || dados.tentativasConcluidas === 0 ? (
        <div className="relatorio-empty"><p>Nenhuma tentativa concluída neste período. Ajuste as datas para ver outros resultados.</p></div>
      ) : (
        <>
          <div className="relatorios-grid">
            {cards.map((card) => (
              <div key={card.titulo} className="relatorio-kpi-card">
                <span className="kpi-label">{card.titulo}</span>
                <div className="kpi-value-row"><span className="kpi-value">{card.valor}</span></div>
                <span className="kpi-desc">{card.desc}</span>
              </div>
            ))}
          </div>

          <div className="validacao-relatorio-tabelas">
            <section aria-labelledby="validacao-relatorio-secoes">
              <h2 id="validacao-relatorio-secoes">Aproveitamento por seção</h2>
              <p>Seções com menor aproveitamento primeiro: bons candidatos a reforço nos treinamentos.</p>
              <div className="relatorios-table-wrapper">
                <table className="relatorios-table">
                  <thead><tr><th>Seção</th><th style={{ textAlign: "right" }}>Respostas</th><th style={{ textAlign: "right" }}>Aproveitamento</th></tr></thead>
                  <tbody>{dados.porSecao.map((s) => (
                    <tr key={s.secao}><td>{s.secao}</td><td style={{ textAlign: "right" }}>{s.respostas}</td><td style={{ textAlign: "right" }}>{percentual(s.aproveitamento)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </section>

            <section aria-labelledby="validacao-relatorio-perguntas">
              <h2 id="validacao-relatorio-perguntas">Perguntas com mais erros</h2>
              <p>Perguntas respondidas ao menos duas vezes, com respostas parciais ou incorretas.</p>
              {dados.perguntasComMaisErros.length ? (
                <div className="relatorios-table-wrapper">
                  <table className="relatorios-table">
                    <thead><tr><th>Pergunta</th><th>Seção</th><th style={{ textAlign: "right" }}>Respostas</th><th style={{ textAlign: "right" }}>Aproveitamento</th></tr></thead>
                    <tbody>{dados.perguntasComMaisErros.map((p) => (
                      <tr key={`${p.secao}:${p.texto}`}><td className="validacao-relatorio-pergunta">{p.texto}</td><td>{p.secao}</td><td style={{ textAlign: "right" }}>{p.respostas}</td><td style={{ textAlign: "right" }}>{percentual(p.aproveitamento)}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className="validacao-relatorio-vazio">Ainda não há perguntas com erros repetidos no período.</p>}
            </section>

            <section aria-labelledby="validacao-relatorio-treinadores">
              <h2 id="validacao-relatorio-treinadores">Por treinador</h2>
              <div className="relatorios-table-wrapper">
                <table className="relatorios-table">
                  <thead><tr><th>Treinador</th><th style={{ textAlign: "right" }}>Tentativas</th><th style={{ textAlign: "right" }}>Aprovadas</th><th style={{ textAlign: "right" }}>Aproveitamento médio</th></tr></thead>
                  <tbody>{dados.porTreinador.map((t) => (
                    <tr key={t.treinadorNome}><td>{t.treinadorNome}</td><td style={{ textAlign: "right" }}>{t.tentativas}</td><td style={{ textAlign: "right" }}>{t.aprovadas}</td><td style={{ textAlign: "right" }}>{percentual(t.mediaAproveitamento)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
