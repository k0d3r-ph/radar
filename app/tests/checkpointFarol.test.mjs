import assert from "node:assert/strict";
import test from "node:test";
import { calcularFarol } from "../src/utils/monitoramento/calcularFarol.ts";
import { obterProximoCheckpoint } from "../src/utils/monitoramento/obterProximoCheckpoint.ts";

const agora = new Date("2026-10-01T14:00:00-03:00").getTime();
const prazo = agora + 60 * 60 * 1000;
const checkpoint = (dataOcorrencia, extras = {}) => ({
  empresa: "Auto Shop",
  tipo: "Checkpoint",
  descricao: "Retorno agendado",
  departamento: "Treinamento",
  responsavel: "Pedro",
  dataOcorrencia,
  ...extras,
});

test("checkpoint futuro deixa o farol laranja mesmo sem treinamento anterior", () => {
  assert.equal(calcularFarol({ progresso: 0, tme: null, dataCheckpoint: prazo, agora }), "laranja");
});

test("laranja permanece até a data e hora exatas do checkpoint", () => {
  const entrada = { progresso: 50, tme: 0, dataCheckpoint: prazo };
  assert.equal(calcularFarol({ ...entrada, agora: prazo - 1 }), "laranja");
  assert.equal(calcularFarol({ ...entrada, agora: prazo }), "amarelo");
  assert.equal(calcularFarol({ ...entrada, agora: prazo + 1 }), "amarelo");
});

test("durante o checkpoint prevalece laranja; após o prazo o alerta volta a vermelho", () => {
  const entrada = { progresso: 50, tme: 2, alerta: true, dataCheckpoint: prazo };
  assert.equal(calcularFarol({ ...entrada, agora }), "laranja");
  assert.equal(calcularFarol({ ...entrada, agora: prazo }), "vermelho");
});

test("sem checkpoint ativo preserva as regras anteriores de farol", () => {
  for (const dataCheckpoint of [undefined, agora - 1, agora, NaN, Infinity]) {
    assert.equal(calcularFarol({ progresso: 50, tme: 4, dataCheckpoint, agora }), "vermelho");
    assert.equal(calcularFarol({ progresso: 50, tme: 2, dataCheckpoint, agora }), "amarelo");
    assert.equal(calcularFarol({ progresso: 50, tme: -1, dataCheckpoint, agora }), "verde");
    assert.equal(calcularFarol({ progresso: 0, tme: null, dataCheckpoint, agora }), "none");
  }
});

test("follow-up concluído volta a verde ao terminar o checkpoint", () => {
  const entrada = { progresso: 100, tme: 2, dataFollowUpFinal: "2026-09-30", dataCheckpoint: prazo };
  assert.equal(calcularFarol({ ...entrada, agora }), "laranja");
  assert.equal(calcularFarol({ ...entrada, agora: prazo }), "verde");
});

test("usa o próximo checkpoint ainda ativo sem alterar a ordem do histórico", () => {
  const historico = [checkpoint(prazo + 1000), checkpoint(agora - 1), checkpoint(prazo)];
  const original = [...historico];
  assert.equal(obterProximoCheckpoint(historico, agora), historico[2]);
  assert.equal(obterProximoCheckpoint(historico, prazo), historico[0]);
  assert.equal(obterProximoCheckpoint(historico, prazo + 1000), undefined);
  assert.deepEqual(historico, original);
});

test("treinamento futuro, checkpoint vencido e datas inválidas não ativam laranja", () => {
  assert.equal(obterProximoCheckpoint([
    checkpoint(prazo, { tipo: "Treinamento" }),
    checkpoint(prazo, { tipo: "Informativa" }),
    checkpoint(agora),
    checkpoint(NaN),
    checkpoint(Infinity),
    checkpoint(undefined),
  ], agora), undefined);
});

test("edição ou exclusão do checkpoint atualiza o próximo prazo", () => {
  assert.equal(obterProximoCheckpoint([checkpoint(prazo)], agora)?.dataOcorrencia, prazo);
  assert.equal(obterProximoCheckpoint([checkpoint(prazo + 1000)], agora)?.dataOcorrencia, prazo + 1000);
  assert.equal(obterProximoCheckpoint([], agora), undefined);
  assert.equal(obterProximoCheckpoint([checkpoint(prazo, { tipo: " checkpoint " })], agora)?.dataOcorrencia, prazo);
});
