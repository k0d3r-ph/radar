import assert from 'node:assert/strict';
import test from 'node:test';
import { GerenciarUsuarios, GestaoUsuariosError } from '../dist/application/use-cases/GerenciarUsuarios.js';
import { UsuariosController } from '../dist/adapters/controllers/UsuariosController.js';

const MASTER = { uid: 'master1', role: 'master' };
const TREINADOR = { uid: 'treinador1', role: 'treinador' };
const AGORA = 1_762_790_400_000;

function cenario(iniciais = {}) {
  const docs = new Map(Object.entries(iniciais).map(([uid, dados]) => [`usuarios/${uid}`, structuredClone(dados)]));
  const contas = new Set(Object.keys(iniciais));
  const log = [];
  let falharGravacao = false;
  const db = {
    collection: (nome) => ({
      doc: (id) => {
        const caminho = `${nome}/${id}`;
        return {
          get: async () => ({ data: () => (docs.has(caminho) ? structuredClone(docs.get(caminho)) : undefined) }),
          set: async (dados) => { if (falharGravacao) throw new Error('Firestore indisponível'); docs.set(caminho, structuredClone(dados)); },
          update: async (dados) => { assert.ok(docs.has(caminho)); docs.set(caminho, { ...docs.get(caminho), ...dados }); },
          delete: async () => { docs.delete(caminho); },
        };
      },
    }),
  };
  const auth = {
    async createUser({ email, password }) {
      log.push(['createUser', email, password]);
      if ([...docs.values()].some(d => d.email === email)) throw Object.assign(new Error('existe'), { code: 'auth/email-already-exists' });
      contas.add('novo1');
      return { uid: 'novo1' };
    },
    async updateUser(uid, dados) {
      log.push(['updateUser', uid, dados.password]);
      if (!contas.has(uid)) throw Object.assign(new Error('não existe'), { code: 'auth/user-not-found' });
    },
    async deleteUser(uid) {
      log.push(['deleteUser', uid]);
      if (!contas.delete(uid)) throw Object.assign(new Error('não existe'), { code: 'auth/user-not-found' });
    },
  };
  const gerenciar = new GerenciarUsuarios(auth, db, () => AGORA);
  return { gerenciar, docs, contas, log, falharGravacao: () => { falharGravacao = true; } };
}

const usuarios = () => ({
  master2: { role: 'master', nome: 'Outro Master', email: 'master2@radar.test' },
  suporte1: { role: 'suporte', nome: 'Suporte', email: 'suporte1@radar.test' },
});

async function erroCom(promessa, status, mensagem) {
  await assert.rejects(promessa, (erro) => erro instanceof GestaoUsuariosError && erro.status === status && (!mensagem || mensagem.test(erro.message)));
}

test('treinador cadastra usuário comum: conta criada e cadastro com troca de senha obrigatória', async () => {
  const { gerenciar, docs, log } = cenario(usuarios());
  const { uid } = await gerenciar.criar(TREINADOR, { email: ' novo@radar.test ', senhaTemporaria: 'temp123', role: 'cs', nome: ' Novo Usuário ' });
  assert.equal(uid, 'novo1');
  assert.deepEqual(log, [['createUser', 'novo@radar.test', 'temp123']]);
  assert.deepEqual(docs.get('usuarios/novo1'), {
    email: 'novo@radar.test', role: 'cs', nome: 'Novo Usuário', needsPasswordChange: true, createdAt: AGORA, updatedAt: AGORA,
  });
});

test('só Master cadastra Master', async () => {
  const { gerenciar, log } = cenario(usuarios());
  await erroCom(gerenciar.criar(TREINADOR, { email: 'm@radar.test', senhaTemporaria: 'temp123', role: 'master', nome: 'M' }), 403, /Master/);
  assert.equal(log.length, 0);
  assert.equal((await gerenciar.criar(MASTER, { email: 'm@radar.test', senhaTemporaria: 'temp123', role: 'master', nome: 'M' })).uid, 'novo1');
});

test('dados inválidos são recusados antes de criar a conta', async () => {
  const { gerenciar, log } = cenario(usuarios());
  const base = { email: 'ok@radar.test', senhaTemporaria: 'temp123', role: 'suporte', nome: 'Ok' };
  await erroCom(gerenciar.criar(MASTER, { ...base, email: 'sem-arroba' }), 400, /e-mail/);
  await erroCom(gerenciar.criar(MASTER, { ...base, senhaTemporaria: '12345' }), 400, /6 caracteres/);
  await erroCom(gerenciar.criar(MASTER, { ...base, role: 'crc' }), 400, /perfil/);
  await erroCom(gerenciar.criar(MASTER, { ...base, role: 'admin' }), 400, /perfil/);
  await erroCom(gerenciar.criar(MASTER, { ...base, nome: '   ' }), 400, /nome/);
  assert.equal(log.length, 0);
});

test('e-mail já usado vira 409; falha ao gravar o cadastro desfaz a conta criada', async () => {
  const primeiro = cenario(usuarios());
  await erroCom(primeiro.gerenciar.criar(MASTER, { email: 'suporte1@radar.test', senhaTemporaria: 'temp123', role: 'suporte', nome: 'Dup' }), 409, /já está sendo utilizado/);

  const segundo = cenario(usuarios());
  segundo.falharGravacao();
  await assert.rejects(segundo.gerenciar.criar(MASTER, { email: 'novo@radar.test', senhaTemporaria: 'temp123', role: 'suporte', nome: 'Novo' }), /indisponível/);
  assert.deepEqual(segundo.log.at(-1), ['deleteUser', 'novo1']);
  assert.equal(segundo.contas.has('novo1'), false);
});

test('redefinir senha: treinador não altera Master; usuário comum passa a trocar a senha no próximo acesso', async () => {
  const { gerenciar, docs, log } = cenario(usuarios());
  await erroCom(gerenciar.redefinirSenha(TREINADOR, 'master2', 'nova123'), 403, /Master/);
  assert.equal(log.length, 0);
  await gerenciar.redefinirSenha(TREINADOR, 'suporte1', 'nova123');
  assert.deepEqual(log, [['updateUser', 'suporte1', 'nova123']]);
  assert.equal(docs.get('usuarios/suporte1').needsPasswordChange, true);
  assert.equal(docs.get('usuarios/suporte1').updatedAt, AGORA);
  await gerenciar.redefinirSenha(MASTER, 'master2', 'nova123');
  await erroCom(gerenciar.redefinirSenha(MASTER, 'inexistente', 'nova123'), 404);
  await erroCom(gerenciar.redefinirSenha(MASTER, 'suporte1', '123'), 400);
  await erroCom(gerenciar.redefinirSenha(MASTER, '../suporte1', 'nova123'), 400);
});

test('excluir: treinador não exclui Master; conta já ausente no Auth não impede remover o cadastro', async () => {
  const { gerenciar, docs, contas } = cenario(usuarios());
  await erroCom(gerenciar.excluir(TREINADOR, 'master2'), 403, /Master/);
  assert.ok(docs.has('usuarios/master2'));
  await gerenciar.excluir(TREINADOR, 'suporte1');
  assert.equal(docs.has('usuarios/suporte1'), false);
  assert.equal(contas.has('suporte1'), false);
  docs.set('usuarios/orfao', { role: 'suporte' });
  await gerenciar.excluir(TREINADOR, 'orfao');
  assert.equal(docs.has('usuarios/orfao'), false);
  await gerenciar.excluir(MASTER, 'master2');
  assert.equal(docs.has('usuarios/master2'), false);
});

function resposta(usuarioRadar) {
  return {
    code: 200, body: undefined, locals: { usuarioRadar },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    set() { return this; },
  };
}

test('controller: 201 com uid, erros de negócio com a mensagem e erro inesperado sem detalhes', async () => {
  const { gerenciar } = cenario(usuarios());
  const controller = new UsuariosController(gerenciar);
  const criado = resposta(MASTER);
  await controller.criar({ body: { email: 'novo@radar.test', senhaTemporaria: 'temp123', role: 'suporte', nome: 'Novo' } }, criado);
  assert.equal(criado.code, 201);
  assert.deepEqual(criado.body, { success: true, uid: 'novo1' });

  const negado = resposta(TREINADOR);
  await controller.excluir({ params: { uid: 'master2' } }, negado);
  assert.equal(negado.code, 403);
  assert.equal(negado.body.success, false);

  const quebrado = new UsuariosController({ excluir: async () => { throw new Error('detalhe interno'); } });
  const falha = resposta(MASTER);
  await quebrado.excluir({ params: { uid: 'x' } }, falha);
  assert.equal(falha.code, 500);
  assert.doesNotMatch(falha.body.error, /detalhe interno/);

  const indisponivel = resposta(MASTER);
  await new UsuariosController(null).criar({ body: {} }, indisponivel);
  assert.equal(indisponivel.code, 503);
});
