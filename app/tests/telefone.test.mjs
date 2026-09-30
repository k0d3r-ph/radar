import assert from "node:assert/strict";
import test from "node:test";
import {
  analisarTelefoneWhatsApp,
  normalizarContatoCliente,
  obterDestinatariosCliente,
  obterTelefonesContato,
} from "../src/utils/telefone.ts";

const numeros = ["558681020204", "5551981174047"];

test("Auto Shop: Márcio recebe em dois números mantendo o mesmo nome", () => {
  const contato = normalizarContatoCliente({ nome: "Márcio", telefone: "", telefones: numeros });
  assert.equal(contato.telefone, numeros[0]);
  assert.deepEqual(contato.telefones, numeros);
  assert.deepEqual(obterDestinatariosCliente({ contatos: [contato] }), numeros.map((telefone) => ({ nome: "Márcio", telefone })));
});

test("cadastros antigos com um telefone continuam funcionando", () => {
  assert.deepEqual(obterDestinatariosCliente({ contato: "Márcio", telefone: "(51) 98117-4047" }), [
    { nome: "Márcio", telefone: numeros[1] },
  ]);
});

test("recupera listas no campo antigo sem juntar os dígitos", () => {
  for (const separador of [" / ", ";", ", ", "\n", " e "]) {
    const contato = { nome: "Márcio", telefone: numeros.join(separador) };
    assert.deepEqual(obterTelefonesContato(contato), numeros);
    assert.deepEqual(normalizarContatoCliente(contato).telefones, numeros);
    assert.equal(obterDestinatariosCliente({ contatos: [contato] }).length, 2);
    assert.equal(analisarTelefoneWhatsApp(contato.telefone).valido, false);
  }
});

test("não repete números entre contatos e ignora vazios e inválidos", () => {
  assert.deepEqual(obterDestinatariosCliente({ contatos: [
    { nome: "Márcio", telefone: "", telefones: [numeros[1], "", "123"] },
    { nome: "Outro", telefone: "(51) 98117-4047" },
  ] }), [{ nome: "Márcio", telefone: numeros[1] }]);
});

test("remoção de número não recupera o valor legado", () => {
  const contato = { nome: "Márcio", telefone: numeros[0], telefones: [numeros[1]] };
  assert.deepEqual(normalizarContatoCliente(contato).telefones, [numeros[1]]);
  assert.deepEqual(obterTelefonesContato({ ...contato, telefones: [] }), []);
});

test("normaliza DDD 55 e prefixo zero sem alterar o número", () => {
  assert.equal(analisarTelefoneWhatsApp("(55) 98117-4047").normalizado, "5555981174047");
  assert.equal(analisarTelefoneWhatsApp("051 98117-4047").normalizado, numeros[1]);
  assert.equal(analisarTelefoneWhatsApp("12345/67890").valido, false);
});
