import assert from "node:assert/strict";
import test from "node:test";
import {
  descontoSuporteJaProcessado,
  deveRemoverDescontoSuporte,
} from "../src/utils/gamificacaoSuporte.ts";

test("reverte desconto ao alterar o tipo mesmo quando o novo tipo também se qualifica", () => {
  const ocorrencia = {
    tipo: "Dúvida",
    gamificacaoDescontoPontoId: "ponto-1",
  };

  assert.equal(deveRemoverDescontoSuporte(ocorrencia, "Problema", true), true);
});

test("mantém o desconto quando o tipo e a qualificação continuam iguais", () => {
  const ocorrencia = {
    tipo: "Dúvida",
    gamificacaoDescontoPontoId: "ponto-1",
  };

  assert.equal(deveRemoverDescontoSuporte(ocorrencia, "Dúvida", true), false);
});

test("reverte desconto quando a ocorrência deixa de se qualificar", () => {
  const ocorrencia = {
    tipo: "Dúvida",
    gamificacaoDescontoPontoId: "ponto-1",
  };

  assert.equal(deveRemoverDescontoSuporte(ocorrencia, "Dúvida", false), true);
});

test("não reaplica desconto marcado como já processado após a reversão", () => {
  assert.equal(descontoSuporteJaProcessado(null), false);
  assert.equal(
    descontoSuporteJaProcessado({
      tipo: "Problema",
      gamificacaoDescontoPontoId: "",
    }),
    true,
  );
  assert.equal(descontoSuporteJaProcessado({ tipo: "Problema" }), false);
});
