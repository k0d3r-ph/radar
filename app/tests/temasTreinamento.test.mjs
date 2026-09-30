import assert from "node:assert/strict";
import test from "node:test";
import {
  isTreinamentoRealizado,
  lerTemasTreinamento,
  prepararTemasTreinamento,
} from "../src/utils/temasTreinamento.ts";

const operacional = "Funções da tela operacional e Histórico de posições";
const cadastro = "Cadastro de Gateway, Debug e Cadastro de Rastreador";
const associacao = "Associação e Desassociação de rastreadores";

test("normaliza o padrão encontrado na #13008 sem duplicar temas nem prefixos", () => {
  const edicao = lerTemasTreinamento([
    `Revisão de Revisão de ${cadastro}`,
    `Revisão de Revisão de ${associacao}`,
    operacional,
    operacional,
    associacao,
  ], false);
  assert.deepEqual(edicao.temas, [cadastro, associacao, operacional]);
  // Em tags conflitantes, preserva a indicação de revisão já registrada.
  assert.deepEqual(edicao.temasRevisados, [cadastro, associacao]);
  const salvo = prepararTemasTreinamento(edicao.temas, edicao.temasRevisados, edicao.isRevisao);
  assert.deepEqual(salvo.temaOcorrencia, [
    `Revisão de ${cadastro}`, `Revisão de ${associacao}`, operacional,
  ]);
  assert.deepEqual(salvo.temasNovos, [operacional]);
  assert.equal(salvo.isRevisao, false);
});

test("desmarcar uma revisão já na primeira edição mantém apenas a tag normal", () => {
  const edicao = lerTemasTreinamento([`Revisão de Revisão de ${operacional}`, operacional]);
  const salvo = prepararTemasTreinamento(edicao.temas, [], false);
  assert.deepEqual(salvo.temaOcorrencia, [operacional]);
  assert.deepEqual(salvo.temasNovos, [operacional]);
  assert.equal(salvo.isRevisao, false);
});

test("remover um tema não o recupera a partir das revisões antigas", () => {
  const salvo = prepararTemasTreinamento([cadastro], [cadastro, operacional]);
  assert.deepEqual(salvo.temaOcorrencia, [`Revisão de ${cadastro}`]);
});

test("revisão parcial avança apenas temas novos e permite notificar o treinamento completo", () => {
  const salvo = prepararTemasTreinamento([cadastro, operacional], [cadastro]);
  assert.deepEqual(salvo.temasNovos, [operacional]);
  assert.equal(salvo.isRevisao, false);
  assert.equal(isTreinamentoRealizado({ tipo: "Treinamento", ...salvo }), true);
  assert.deepEqual(salvo.temaOcorrencia, [`Revisão de ${cadastro}`, operacional]);
});

test("revisão total permite notificar sem fornecer temas para avanço", () => {
  for (const salvo of [
    prepararTemasTreinamento([cadastro, operacional], [cadastro, operacional]),
    prepararTemasTreinamento([cadastro, operacional], [], true),
  ]) {
    assert.deepEqual(salvo.temasNovos, []);
    assert.equal(salvo.isRevisao, true);
    assert.equal(isTreinamentoRealizado({ tipo: "Treinamento", ...salvo }), true);
  }
});

test("marcações individuais de agenda mista prevalecem sobre flag geral antiga", () => {
  const edicao = lerTemasTreinamento([`Revisão de ${cadastro}`, operacional], true);
  assert.equal(edicao.isRevisao, false);
  assert.deepEqual(prepararTemasTreinamento(
    edicao.temas, edicao.temasRevisados, edicao.isRevisao,
  ).temasNovos, [operacional]);
});

test("preserva revisão legada registrada apenas na flag", () => {
  const edicao = lerTemasTreinamento([cadastro, operacional], true);
  assert.equal(edicao.isRevisao, true);
  assert.deepEqual(edicao.temasRevisados, [cadastro, operacional]);
});

test("salvar e reabrir repetidamente não acumula prefixos ou duplicatas", () => {
  let temas = [`Revisão de Revisão de ${cadastro}`, operacional, operacional];
  for (let i = 0; i < 3; i++) {
    const edicao = lerTemasTreinamento(temas);
    temas = prepararTemasTreinamento(edicao.temas, edicao.temasRevisados, edicao.isRevisao).temaOcorrencia;
    assert.deepEqual(temas, [`Revisão de ${cadastro}`, operacional]);
  }
});

test("ausência, cancelamento e seleção vazia não disparam avanço/envio", () => {
  for (const temas of [[], ["Ausente"], ["Cancelado"], ["  "]]) {
    const salvo = prepararTemasTreinamento(temas, [], true);
    assert.deepEqual(salvo.temasNovos, []);
    assert.equal(salvo.isRevisao, false);
    assert.ok(salvo.temaOcorrencia.every(t => !t.startsWith("Revisão de ")));
    assert.equal(isTreinamentoRealizado({ tipo: "Treinamento", ...salvo }), false);
  }
});

test("treinamento realizado permite primeiro envio mesmo sem status de WhatsApp", () => {
  for (const temaOcorrencia of [[operacional], [`Revisão de ${operacional}`]]) {
    assert.equal(isTreinamentoRealizado({ tipo: "Treinamento", temaOcorrencia }), true);
  }
});

test("cancelamento e ausência impedem notificar como realizado mesmo com temas selecionados", () => {
  for (const status of ["Ausente", " Cancelado ", "AUSENTE"]) {
    assert.equal(isTreinamentoRealizado({
      tipo: "Treinamento", temaOcorrencia: [operacional, status],
    }), false);
  }
  assert.equal(isTreinamentoRealizado({ tipo: "Treinamento" }), false);
  assert.equal(isTreinamentoRealizado({ tipo: "Dúvida", temaOcorrencia: [operacional] }), false);
});

test("revisões removidas ou repetidas não alteram a classificação dos temas novos", () => {
  const salvo = prepararTemasTreinamento(
    [operacional, ` ${operacional} `], [cadastro, cadastro],
  );
  assert.deepEqual(salvo.temaOcorrencia, [operacional]);
  assert.deepEqual(salvo.temasNovos, [operacional]);
});
