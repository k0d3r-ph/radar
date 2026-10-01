import assert from 'node:assert/strict';
import test from 'node:test';
import { WhatsAppController } from '../dist/adapters/controllers/WhatsAppController.js';
import { WhatsAppWebClient } from '../dist/infrastructure/whatsapp/WhatsAppWebClient.js';

function response() {
  return {
    code: undefined, body: undefined,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function controller(execute, status = 'connected') {
  return new WhatsAppController({ execute }, {}, { execute: () => ({ status }) });
}

const request = { body: { to: '558681020204', message: 'Olá Márcio' } };

test('API espera a conclusão do envio antes de confirmar sucesso', async () => {
  let concluir;
  const res = response();
  const envio = controller(() => new Promise(resolve => { concluir = resolve; })).send(request, res);
  assert.equal(res.code, undefined);
  concluir(true);
  await envio;
  assert.equal(res.code, 200);
  assert.equal(res.body.success, true);
});

test('API devolve falha real e não confirma retornos falsos', async () => {
  for (const execute of [async () => { throw new Error('Falha no WhatsApp'); }, async () => false]) {
    const res = response();
    await controller(execute).send(request, res);
    assert.equal(res.code, 502);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error);
  }
});

test('sessão desconectada e entrada inválida não disparam mensagens', async () => {
  const execute = () => { assert.fail('Não deveria enviar'); };
  const res = response();
  await controller(execute, 'disconnected').send(request, res);
  assert.equal(res.code, 503);
  await controller(execute).send({ body: { to: [request.body.to], message: 'Teste' } }, res);
  assert.equal(res.code, 400);
});

function client(getNumberId, sendMessage = async () => ({ id: 'message-id' })) {
  const service = new WhatsAppWebClient();
  service.session.status = 'connected';
  service.client = { getNumberId, sendMessage };
  return service;
}

test('os dois números do Márcio usam o identificador resolvido pelo WhatsApp', async () => {
  const enviados = [];
  const service = client(async numero => ({ _serialized: `${numero}@c.us` }), async (id, text) => {
    enviados.push({ id, text });
    return { id: 'message-id' };
  });
  for (const numero of ['558681020204', '5551981174047']) {
    assert.equal(await service.sendMessage(numero, 'Olá Márcio'), true);
  }
  assert.deepEqual(enviados.map(e => e.id), ['558681020204@c.us', '5551981174047@c.us']);
});

test('número inexistente ou falha de consulta não tenta enviar para chat inventado', async () => {
  for (const resolver of [async () => null, async () => { throw new Error('Consulta falhou'); }]) {
    const service = client(resolver, () => assert.fail('Não deveria enviar'));
    await assert.rejects(service.sendMessage('558681020204', 'Teste'));
  }
});

test('lista concatenada é recusada antes de consultar o WhatsApp', async () => {
  const service = client(() => assert.fail('Não deveria consultar'));
  await assert.rejects(service.sendMessage('558681020204 / 5551981174047', 'Teste'), /apenas um telefone/);
  await assert.rejects(service.sendMessage('5586810202045551981174047', 'Teste'), /inválido/);
});

test('envio de imagem preserva legenda e usa ID resolvido', async () => {
  const service = client(async () => ({ _serialized: 'resolvido@c.us' }), async (id, media, options) => {
    assert.equal(id, 'resolvido@c.us');
    assert.equal(media.mimetype, 'image/png');
    assert.equal(media.data, 'YWJj');
    assert.equal(options.caption, 'Olá Márcio');
    assert.equal(options.waitUntilMsgSent, true);
    return { id: 'message-id' };
  });
  assert.equal(await service.sendMessage('558681020204', 'Olá Márcio', 'data:image/png;base64,YWJj'), true);
});

test('retorno vazio do envio não vira sucesso', async () => {
  const service = client(async () => ({ _serialized: 'resolvido@c.us' }), async () => undefined);
  await assert.rejects(service.sendMessage('558681020204', 'Teste'), /não confirmou/);
});

test('falha ao concluir envio de mídia chega à API sem confirmar sucesso', async () => {
  let falhar;
  const service = client(async () => ({ _serialized: 'resolvido@c.us' }), async (_id, _media, options) => {
    assert.equal(options.waitUntilMsgSent, true);
    return new Promise((_resolve, reject) => { falhar = reject; });
  });
  const res = response();
  const envio = controller(() => service.sendMessage(
    request.body.to, request.body.message, 'data:image/png;base64,YWJj',
  )).send(request, res);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(res.code, undefined);
  falhar(new Error('Falha no upload da imagem'));
  await envio;
  assert.equal(res.code, 502);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error, 'Falha no upload da imagem');
});
