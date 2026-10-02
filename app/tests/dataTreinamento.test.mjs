import assert from "node:assert/strict";
import test from "node:test";
import { obterDataRealizacaoTreinamento } from "../src/utils/dataTreinamento.ts";

test("envio e reenvio usam a realização editada, independentemente do próximo agendamento", () => {
  const ocorrencia = {
    createdAt: new Date(2026, 8, 30, 19, 28).getTime(),
    dataOcorrencia: new Date(2026, 9, 10, 12).getTime(),
    treinamentoDataSolicitacao: "2026-09-15",
  };
  assert.equal(obterDataRealizacaoTreinamento(ocorrencia), "2026-09-30");
  const editada = { ...ocorrencia, createdAt: new Date(2026, 9, 1, 19).getTime() };
  assert.equal(obterDataRealizacaoTreinamento(editada), "2026-10-01");
});

test("registros antigos sem criação usam a data disponível e novos usam hoje", () => {
  const hoje = new Date(2026, 9, 1, 12).getTime();
  assert.equal(obterDataRealizacaoTreinamento({ dataOcorrencia: new Date(2026, 8, 30, 12).getTime() }, hoje), "2026-09-30");
  assert.equal(obterDataRealizacaoTreinamento({}, hoje), "2026-10-01");
});
