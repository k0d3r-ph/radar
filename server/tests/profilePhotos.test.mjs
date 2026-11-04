import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';
import { ProfilePhotosController } from '../dist/adapters/controllers/ProfilePhotosController.js';

const diretorios = [];
const conteudoPng = Buffer.from('iVBORw0KGgoAAAANSUhEUg==', 'base64');

async function criarController(verificarToken = async () => ({ uid: 'user-1' })) {
  const diretorio = await mkdtemp(path.join(os.tmpdir(), 'radar-profile-photos-'));
  diretorios.push(diretorio);
  const auth = { verifyIdToken: verificarToken };
  return { controller: new ProfilePhotosController(auth, diretorio), diretorio };
}

function resposta() {
  return {
    codigo: 200,
    corpo: undefined,
    headers: {},
    status(codigo) { this.codigo = codigo; return this; },
    json(corpo) { this.corpo = corpo; return this; },
    send(corpo) { this.corpo = corpo; return this; },
    end() {},
    set(nome, valor) { this.headers[nome] = valor; return this; },
  };
}

function requisicao({ token = 'token-valido', uid = 'user-1', tipo = 'image/png', body = conteudoPng } = {}) {
  return {
    headers: { authorization: token ? `Bearer ${token}` : '', 'content-type': tipo },
    params: { uid },
    body,
  };
}

afterEach(async () => {
  await Promise.all(diretorios.splice(0).map((diretorio) => rm(diretorio, { recursive: true, force: true })));
});

test('exige usuário autenticado e limita leitura e escrita à sessão', async () => {
  const { controller } = await criarController(async () => { throw new Error('token inválido'); });
  const res = resposta();

  await controller.listar(requisicao(), res);
  assert.equal(res.codigo, 401);

  await controller.enviar(requisicao(), res);
  assert.equal(res.codigo, 401);

  const autenticado = await criarController();
  await autenticado.controller.enviar(requisicao({ uid: 'outro-usuario' }), res);
  assert.equal(res.codigo, 403);
});

test('grava, lista e serve uma foto somente após validar tipo e conteúdo', async () => {
  const { controller } = await criarController();
  const res = resposta();

  await controller.enviar(requisicao(), res);
  assert.equal(res.codigo, 204);

  await controller.listar(requisicao({ body: undefined }), res);
  assert.deepEqual(res.corpo.uids, ['user-1']);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');

  await controller.obter(requisicao({ body: undefined }), res);
  assert.equal(res.codigo, 200);
  assert.equal(res.headers['Content-Type'], 'image/png');
  assert.deepEqual(res.corpo, conteudoPng);
});

test('rejeita conteúdo incompatível, retorna ausência e remove a própria foto', async () => {
  const { controller } = await criarController();
  const res = resposta();

  await controller.enviar(requisicao({ tipo: 'image/jpeg' }), res);
  assert.equal(res.codigo, 400);

  await controller.obter(requisicao(), res);
  assert.equal(res.codigo, 404);

  await controller.enviar(requisicao(), res);
  await controller.remover(requisicao(), res);
  assert.equal(res.codigo, 204);
  await controller.obter(requisicao(), res);
  assert.equal(res.codigo, 404);
});
