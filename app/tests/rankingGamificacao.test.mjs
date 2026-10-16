import assert from "node:assert/strict";
import test from "node:test";
import { calcularRankingGamificacao, comporPontosGamificacao } from "../src/utils/rankingGamificacao.ts";

const treinador = { uid: "a", nome: "Ana", email: "ana@example.test" };
const lancamento = (campos = {}) => ({
  treinadorId: "a", treinadorNome: "Ana", tipoAcao: "treinamento", pontos: 1,
  treinamentoTema: "Visão Geral", descricao: "", dataLancamento: 1,
  criadoPorId: "a", criadoPorNome: "Ana", ...campos,
});

test("bônus conserva os limites de 70%, 80% e 90% e conta Bom e Ruim", () => {
  for (const [respondidos, percentual, total] of [[6, 0, 10], [7, 10, 11], [8, 20, 12], [9, 30, 13]]) {
    const entries = Array.from({ length: 10 }, (_, i) => lancamento({
      treinamentoResultados: i < respondidos ? [i % 2 ? "Bom" : "Ruim"] : [],
    }));
    const [t] = calcularRankingGamificacao([treinador], entries);
    assert.equal(t.bonusPercentage, percentual);
    assert.equal(t.score, total);
    assert.equal(t.answeredTrainingsCount, respondidos);
  }
});

test("CSAT antigo continua contando uma vez por treinamento, mesmo com vários participantes", () => {
  const [t] = calcularRankingGamificacao([treinador], [lancamento({
    treinamentoNotas: [1, 5, 4], treinamentoResultados: ["Bom", "Ruim"],
  })]);
  assert.equal(t.answeredTrainingsCount, 1);
  assert.equal(t.taxaResposta, 1);
  assert.equal(t.score, 1.3);
});

test("Cancelado e Ausente ficam fora da taxa de resposta e das atividades realizadas", () => {
  const [t] = calcularRankingGamificacao([treinador], [
    lancamento({ treinamentoResultados: ["Bom"] }),
    lancamento({ treinamentoTema: " Visão Geral, CANCELADO ", pontos: 0 }),
    lancamento({ treinamentoTema: "ausente", pontos: 0 }),
  ]);
  assert.equal(t.totalTrainingsCount, 1);
  assert.equal(t.qtdAcoes, 1);
  assert.equal(t.bonusPercentage, 30);
});

test("descontos compõem a base e não contam como atividades positivas", () => {
  const [t] = calcularRankingGamificacao([treinador], [
    lancamento({ tipoAcao: "ferramenta_aut", pontos: 5 }),
    lancamento({ tipoAcao: "nova_doc", pontos: 3 }),
    lancamento({ tipoAcao: "chamado_falha", pontos: -1 }),
    lancamento({ tipoAcao: "desconto_suporte", pontos: -2 }),
  ]);
  assert.equal(t.baseScore, 5);
  assert.equal(t.score, 5);
  assert.equal(t.qtdAcoes, 2);
  assert.equal(t.qtdFalhas, 1);
  const composicao = comporPontosGamificacao(t);
  assert.equal(composicao.grupos.reduce((soma, grupo) => soma + grupo.pontos, 0) + composicao.bonusPontos, t.score);
});

test("composição explicita o efeito do percentual sobre uma base negativa", () => {
  const [t] = calcularRankingGamificacao([treinador], [
    lancamento({ treinamentoResultados: ["Ruim"] }),
    lancamento({ tipoAcao: "desconto_suporte", pontos: -6 }),
  ]);
  assert.equal(t.baseScore, -5);
  assert.equal(t.score, -6.5);
  assert.equal(comporPontosGamificacao(t).bonusPontos, -1.5);
});

test("treinador sem lançamentos tem resumo zero e não cria empate de desempenho", () => {
  const [t] = calcularRankingGamificacao([treinador], []);
  assert.equal(t.score, 0);
  assert.equal(t.totalTrainingsCount, 0);
  assert.equal(t.bonusPercentage, 0);
  assert.equal(t.empate, false);
  assert.deepEqual(comporPontosGamificacao(t), { grupos: [], bonusPontos: 0 });
  const misto = calcularRankingGamificacao([treinador, { ...treinador, uid: "b", nome: "Bia" }], [lancamento({ pontos: 0 })]);
  assert.equal(misto.some((item) => item.empate), false);
});

test("ordenação preserva pontuação, taxa de resposta, falhas e nome; empate é explícito", () => {
  const trainers = [
    { uid: "b", nome: "Bia", email: "bia@example.test" }, treinador,
    { uid: "c", nome: "Caio", email: "caio@example.test" },
  ];
  const ranking = calcularRankingGamificacao(trainers, [
    lancamento({ tipoAcao: "nova_doc", pontos: 3 }),
    lancamento({ treinadorId: "b", tipoAcao: "nova_doc", pontos: 3 }),
    lancamento({ treinadorId: "c", tipoAcao: "nova_doc", pontos: 4 }),
    lancamento({ treinadorId: "c", tipoAcao: "chamado_falha", pontos: -1 }),
  ]);
  assert.deepEqual(ranking.map((t) => t.uid), ["a", "b", "c"]);
  assert.deepEqual(ranking.map((t) => t.empate), [true, true, false]);
  const porResposta = calcularRankingGamificacao(trainers.slice(0, 2), [
    lancamento({ pontos: 10 }),
    lancamento({ treinadorId: "b", pontos: 10 / 1.3, treinamentoResultados: ["Ruim"] }),
  ]);
  assert.equal(porResposta[0].uid, "b");
});

test("apuração usa apenas os lançamentos recebidos do período e mantém dados de outros treinadores isolados", () => {
  const periodo = [lancamento({ tipoAcao: "nova_doc", pontos: 3 })];
  const [t] = calcularRankingGamificacao([treinador], [...periodo, lancamento({ treinadorId: "outro", pontos: 500 })]);
  assert.equal(t.score, 3);
  assert.deepEqual(t.lancamentos, periodo);
});
