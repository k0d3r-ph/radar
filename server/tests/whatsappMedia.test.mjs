import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { patchWhatsAppMedia } from '../scripts/patchWhatsAppMedia.mjs';

const require = createRequire(import.meta.url);
const source = fs.readFileSync(path.join(path.dirname(require.resolve('whatsapp-web.js')), 'src/util/Injected/Utils.js'), 'utf8');

test('patch é idempotente e rejeita uma biblioteca incompatível', () => {
  assert.equal(patchWhatsAppMedia(patchWhatsAppMedia(source)), patchWhatsAppMedia(source));
  assert.throws(() => patchWhatsAppMedia('outro formato'), /revise/);
});

// Executa a função real injetada pela biblioteca; simula apenas os módulos do WhatsApp.
async function enviar(source, media, lid, formatoAlternativo = false) {
  let enviada;
  class MsgKey {
    static async newId() { return 'nova-mensagem'; }
    constructor(fields) { Object.assign(this, fields); if (formatoAlternativo) this.$1 = 'msg-id'; else this._serialized = 'msg-id'; }
  }
  const modules = {
    WAWebChatGetters: { getIsNewsletter: () => false, getIsBroadcast: () => false },
    WALinkify: { findLink: () => null },
    WAWebUserPrefsMeUser: { getMaybeMeLidUser: () => 'remetente@lid', getMaybeMePnUser: () => 'remetente@c.us' },
    WAWebMsgKey: MsgKey,
    WAWebGetEphemeralFieldsMsgActionsUtils: { getEphemeralFields: () => ({}) },
    WAWebSendMsgChatAction: { addAndSendMsgToChat: (_chat, message) => {
      // O modelo Msg dá prioridade ao atributo interno, mesmo quando undefined.
      const id = Object.hasOwn(message, '__x_id') ? message.__x_id : message.id;
      assert.ok(id?.id, 'Data passed to getter must include an id property');
      enviada = message;
      return [Promise.resolve(), Promise.resolve()];
    } },
    WAWebCollections: { Msg: { get: id => id === 'msg-id' ? enviada : undefined } },
  };
  const window = { WWebJS: { processMediaData: async () => media }, require: name => {
    assert.ok(modules[name], `Módulo inesperado: ${name}`);
    return modules[name];
  } };
  const start = source.indexOf('    window.WWebJS.sendMessage =');
  const end = source.indexOf('    window.WWebJS.editMessage =', start);
  vm.runInNewContext(source.slice(start, end), { window });
  const chat = { id: { isLid: () => lid } };
  return window.WWebJS.sendMessage(chat, 'Mensagem', media ? { media: {}, caption: 'Legenda', waitUntilMsgSent: true } : {});
}

test('reproduz colisão da mídia e preserva MsgKey, legenda e campos do upload após patch', async () => {
  const original = source.replace(/        \/\/ Radar: preservar o MsgKey ao enviar mídia\.\r?\n        delete message\.__x_id;\r?\n\r?\n/, '');
  for (const internalId of [undefined, 'id-da-midia']) {
    const media = { __x_id: internalId, preview: 'preview', clientUrl: 'upload', mediaKey: 'chave', toJSON: () => ({ type: 'image' }) };
    await assert.rejects(enviar(original, media, true), /include an id/);
    for (const lid of [true, false]) {
      const sent = await enviar(patchWhatsAppMedia(original), media, lid);
      assert.equal(sent.id.id, 'nova-mensagem');
      assert.equal(Object.hasOwn(sent, '__x_id'), false);
      assert.equal(sent.caption, 'Legenda');
      assert.equal(sent.clientUrl, 'upload');
      assert.equal(sent.mediaKey, 'chave');
      assert.equal(sent.from, lid ? 'remetente@lid' : 'remetente@c.us');
    }
  }
});

test('envio de texto continua com identificador válido', async () => {
  const sent = await enviar(patchWhatsAppMedia(source), null, true);
  assert.equal(sent.id.id, 'nova-mensagem');
  assert.equal(sent.body, 'Mensagem');
});

test('imagem enviada retorna confirmação com MsgKey no formato $1', async () => {
  const semFallback = source.replaceAll('newMsgKey._serialized || newMsgKey.$1', 'newMsgKey._serialized');
  const media = { preview: 'preview', toJSON: () => ({ type: 'image' }) };
  assert.equal(await enviar(semFallback, media, true, true), undefined);
  const sent = await enviar(patchWhatsAppMedia(semFallback), media, true, true);
  assert.equal(sent.id.$1, 'msg-id');
  assert.equal(sent.caption, 'Legenda');
});
