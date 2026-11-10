import assert from 'node:assert/strict';
import test from 'node:test';
import { AutenticadorRadar, PERFIS_GESTORES, PERFIS_RADAR } from '../dist/adapters/middlewares/autenticacaoRadar.js';
import { createExpressApp } from '../dist/infrastructure/web/express.js';
import { createSocketServer } from '../dist/infrastructure/web/socket.js';
import { createServer } from 'node:http';

const TOKENS = { 'tk-master': 'master1', 'tk-treinador': 'treinador1', 'tk-suporte': 'suporte1', 'tk-inativo': 'inativo1', 'tk-pendente': 'pendente1', 'tk-sem-cadastro': 'fantasma' };
const CADASTROS = {
  master1: { role: 'master' },
  treinador1: { role: 'treinador' },
  suporte1: { role: 'suporte' },
  inativo1: { role: 'treinador', inativo: true },
  pendente1: { role: 'treinador', needsPasswordChange: true },
};

function fakes() {
  const chamadas = { verify: [], leituras: 0 };
  const auth = {
    async verifyIdToken(token, checarRevogado) {
      chamadas.verify.push(checarRevogado);
      if (!TOKENS[token]) throw new Error('token inválido');
      return { uid: TOKENS[token] };
    },
  };
  const usuarios = { async buscarPorUid(uid) { chamadas.leituras++; return CADASTROS[uid] && { ...CADASTROS[uid] }; } };
  return { auth, usuarios, chamadas };
}

function resposta() {
  return {
    code: 200, body: undefined, headers: {}, locals: {},
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    set(nome, valor) { this.headers[nome] = valor; return this; },
  };
}

async function executar(middleware, authorization) {
  const res = resposta();
  let chamouNext = false;
  await middleware({ headers: authorization ? { authorization } : {} }, res, () => { chamouNext = true; });
  return { res, chamouNext };
}

test('sem token, token inválido, sem cadastro, inativo ou com senha pendente não passam', async () => {
  const { auth, usuarios, chamadas } = fakes();
  const exigir = new AutenticadorRadar(auth, usuarios).exigir(PERFIS_RADAR);
  for (const [authorization, status] of [[undefined, 401], ['Bearer x', 401], ['tk-master', 401], ['Bearer tk-sem-cadastro', 403], ['Bearer tk-inativo', 403], ['Bearer tk-pendente', 403]]) {
    const { res, chamouNext } = await executar(exigir, authorization);
    assert.equal(chamouNext, false, String(authorization));
    assert.equal(res.code, status, String(authorization));
    assert.equal(res.body.success, false);
    assert.ok(res.body.error);
  }
  assert.ok(chamadas.verify.every(checarRevogado => checarRevogado === true), 'deve conferir token revogado');
});

test('perfil fora da lista recebe 403; perfil permitido segue com o usuário em res.locals', async () => {
  const { auth, usuarios } = fakes();
  const autenticador = new AutenticadorRadar(auth, usuarios);
  const negado = await executar(autenticador.exigir(PERFIS_GESTORES), 'Bearer tk-suporte');
  assert.equal(negado.res.code, 403);
  assert.equal(negado.chamouNext, false);
  const liberado = await executar(autenticador.exigir(PERFIS_GESTORES), 'Bearer tk-treinador');
  assert.equal(liberado.chamouNext, true);
  assert.deepEqual(liberado.res.locals.usuarioRadar, { uid: 'treinador1', role: 'treinador' });
});

test('cadastro fica em cache por 60 s; depois relê e passa a valer a inativação', async () => {
  const { auth, usuarios, chamadas } = fakes();
  let agora = 1_000_000;
  const autenticador = new AutenticadorRadar(auth, usuarios, () => agora);
  await autenticador.autenticar('tk-treinador', PERFIS_GESTORES);
  await autenticador.autenticar('tk-treinador', PERFIS_GESTORES);
  assert.equal(chamadas.leituras, 1);
  CADASTROS.treinador1.inativo = true;
  try {
    agora += 60_001;
    await assert.rejects(autenticador.autenticar('tk-treinador', PERFIS_GESTORES), (erro) => erro.status === 403);
    assert.equal(chamadas.leituras, 2);
  } finally {
    delete CADASTROS.treinador1.inativo;
  }
});

test('sem Firebase Admin responde 503; falha ao ler o cadastro responde 503 sem detalhes', async () => {
  const semAdmin = await executar(new AutenticadorRadar(null, null).exigir(PERFIS_RADAR), 'Bearer tk-master');
  assert.equal(semAdmin.res.code, 503);
  const { auth } = fakes();
  const quebrado = { async buscarPorUid() { throw new Error('RESOURCE_EXHAUSTED: quota'); } };
  const falha = await executar(new AutenticadorRadar(auth, quebrado).exigir(PERFIS_RADAR), 'Bearer tk-master');
  assert.equal(falha.res.code, 503);
  assert.doesNotMatch(falha.res.body.error, /quota/);
});

test('rotas do bot exigem login e perfil; rotas antigas de usuários não existem mais no bot', async (t) => {
  const { auth, usuarios } = fakes();
  const enviados = [];
  const controller = {
    status: (req, res) => res.json({ success: true, session: { status: 'connected' } }),
    send: (req, res) => { enviados.push(req.body); res.json({ success: true }); },
    disconnect: (req, res) => res.json({ success: true }),
  };
  const whatsapp = { takeScreenshot: async () => null };
  const app = createExpressApp(controller, whatsapp, new AutenticadorRadar(auth, usuarios));
  const servidor = app.listen(0);
  t.after(() => servidor.close());
  await new Promise(resolve => servidor.once('listening', resolve));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const chamar = (metodo, caminho, token, corpo) => fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

  for (const [metodo, caminho] of [['GET', '/api/whatsapp/status'], ['POST', '/api/whatsapp/send'], ['POST', '/api/whatsapp/disconnect'], ['GET', '/api/whatsapp/screenshot']]) {
    assert.equal((await chamar(metodo, caminho)).status, 401, `${metodo} ${caminho} sem token`);
  }
  assert.equal(enviados.length, 0);

  assert.equal((await chamar('POST', '/api/whatsapp/send', 'tk-suporte', { to: '5586999999999', message: 'Oi' })).status, 200);
  assert.equal(enviados.length, 1);
  assert.equal((await chamar('POST', '/api/whatsapp/disconnect', 'tk-suporte')).status, 403);
  assert.equal((await chamar('GET', '/api/whatsapp/status', 'tk-suporte')).status, 403);
  assert.equal((await chamar('POST', '/api/whatsapp/disconnect', 'tk-treinador')).status, 200);
  assert.equal((await chamar('GET', '/api/whatsapp/screenshot', 'tk-treinador')).status, 403);
  assert.equal((await chamar('GET', '/api/whatsapp/screenshot', 'tk-master')).status, 404);

  assert.equal((await chamar('POST', '/api/whatsapp/users/suporte1/reset-password', 'tk-master', { novaSenha: '123456' })).status, 404);
  assert.equal((await chamar('DELETE', '/api/whatsapp/users/suporte1', 'tk-master')).status, 404);
});

test('Socket.IO do bot só entrega o status (com QR Code) para treinador ou master', async (t) => {
  const { auth, usuarios } = fakes();
  const httpServer = createServer();
  const whatsapp = { getStatus: () => ({ status: 'qrcode', qrCode: 'QR-SECRETO' }), onStatusChange() {}, initialize: async () => {} };
  const io = createSocketServer(httpServer, whatsapp, new AutenticadorRadar(auth, usuarios));
  httpServer.listen(0);
  t.after(() => { io.close(); httpServer.close(); });
  await new Promise(resolve => httpServer.once('listening', resolve));
  const base = `http://127.0.0.1:${httpServer.address().port}/socket.io/?EIO=4&transport=polling`;

  // Handshake do Engine.IO por polling + pacote CONNECT do Socket.IO com { token }.
  async function conectar(authPayload) {
    const aberto = await (await fetch(base)).text();
    const { sid } = JSON.parse(aberto.slice(1));
    await fetch(`${base}&sid=${sid}`, { method: 'POST', body: `40${JSON.stringify(authPayload)}` });
    let recebido = '';
    for (let i = 0; i < 3 && !/whatsapp-status|"message"/.test(recebido); i++) {
      recebido += await (await fetch(`${base}&sid=${sid}`)).text();
    }
    return recebido;
  }

  for (const payload of [{}, { token: 'invalido' }, { token: 'tk-suporte' }, { token: 'tk-inativo' }]) {
    const recebido = await conectar(payload);
    assert.match(recebido, /44\{"message":"nao_autorizado"\}/, JSON.stringify(payload));
    assert.doesNotMatch(recebido, /QR-SECRETO/);
  }
  const liberado = await conectar({ token: 'tk-treinador' });
  assert.match(liberado, /whatsapp-status/);
  assert.match(liberado, /QR-SECRETO/);
});
