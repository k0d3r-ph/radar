import assert from "node:assert/strict";
import test from "node:test";
import { enviarMensagemWhatsApp } from "../src/services/whatsapp.ts";

const params = { to: "558681020204", message: "Olá Márcio" };

test("só confirma envio após resposta positiva do servidor", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: true }));
  await enviarMensagemWhatsApp(params);
});

test("aceite antecipado 202 não é tratado como envio concluído", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: true }, { status: 202 }));
  await assert.rejects(enviarMensagemWhatsApp(params), /não confirmou o resultado/);
});

test("erro do WhatsApp chega à tela e ao histórico", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: false, error: "Número não cadastrado" }, { status: 502 }));
  await assert.rejects(enviarMensagemWhatsApp(params), /Número não cadastrado/);
});

test("resposta 200 sem confirmação também falha", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: false }));
  await assert.rejects(enviarMensagemWhatsApp(params), /Envio não confirmado/);
});
