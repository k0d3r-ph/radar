// Testa firestore.rules.producao no Firestore Emulator. Rodar com `npm run test:regras-firestore`
// em app/ (sobe o emulador, carrega estas regras por REST e derruba no final).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  connectFirestoreEmulator, deleteDoc, doc, getDoc, getFirestore, setDoc, updateDoc,
} from 'firebase/firestore';

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJETO = process.env.GCLOUD_PROJECT || 'demo-radar-regras';
const BASE = `http://${HOST}`;
const DOCUMENTOS = `${BASE}/v1/projects/${PROJETO}/databases/(default)/documents`;

if (!HOST) throw new Error('Rode pelo script test:regras-firestore (FIRESTORE_EMULATOR_HOST ausente).');

function paraCampo(valor) {
  if (typeof valor === 'string') return { stringValue: valor };
  if (typeof valor === 'boolean') return { booleanValue: valor };
  if (typeof valor === 'number') return Number.isInteger(valor) ? { integerValue: String(valor) } : { doubleValue: valor };
  throw new Error(`Tipo não suportado no seed: ${typeof valor}`);
}

/** Grava como administrador (ignora as regras). */
async function semear(caminho, dados) {
  const fields = Object.fromEntries(Object.entries(dados).map(([k, v]) => [k, paraCampo(v)]));
  const resposta = await fetch(`${DOCUMENTOS}/${caminho}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  assert.ok(resposta.ok, `seed ${caminho}: HTTP ${resposta.status}`);
}

async function limpar() {
  const resposta = await fetch(`${BASE}/emulator/v1/projects/${PROJETO}/databases/(default)/documents`, { method: 'DELETE' });
  assert.ok(resposta.ok, `limpar: HTTP ${resposta.status}`);
}

const apps = [];
let seq = 0;
/** Cliente do Firestore como um usuário do Firebase Auth (ou anônimo, sem uid). */
function clienteComo(uid) {
  const app = initializeApp({ projectId: PROJETO }, `teste-${++seq}`);
  apps.push(app);
  const db = getFirestore(app);
  const [host, porta] = HOST.split(':');
  connectFirestoreEmulator(db, host, Number(porta), uid ? { mockUserToken: { user_id: uid, email: `${uid}@radar.test` } } : undefined);
  return db;
}

async function permitido(promessa) {
  await promessa;
}

async function negado(promessa) {
  await assert.rejects(promessa, (erro) => erro?.code === 'permission-denied');
}

test.before(async () => {
  const regras = await readFile(new URL('../../firestore.rules.producao', import.meta.url), 'utf8');
  const resposta = await fetch(`${BASE}/emulator/v1/projects/${PROJETO}:securityRules`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: regras }] } }),
  });
  assert.ok(resposta.ok, `carregar regras: HTTP ${resposta.status} ${await resposta.text()}`);
});

test.beforeEach(async () => {
  await limpar();
  await semear('usuarios/master1', { role: 'master', nome: 'Master', email: 'master1@radar.test' });
  await semear('usuarios/master2', { role: 'master', nome: 'Outro Master', email: 'master2@radar.test' });
  await semear('usuarios/treinador1', { role: 'treinador', nome: 'Treinador', email: 'treinador1@radar.test' });
  await semear('usuarios/suporte1', { role: 'suporte', nome: 'Suporte', email: 'suporte1@radar.test', cargo: 'analista' });
  await semear('usuarios/painel1', { role: 'painel', nome: 'Painel', email: 'painel1@radar.test' });
  await semear('usuarios/crc1', { role: 'crc', nome: 'CRC', email: 'crc1@radar.test' });
  await semear('usuarios/inativo1', { role: 'suporte', nome: 'Inativo', email: 'inativo1@radar.test', inativo: true });
  await semear('empresas/e1', { nomeEmpresa: 'Cliente' });
  await semear('checklist_tarefas/t1', { descricao: 'Tarefa' });
  await semear('ocorrencias/o1', { empresa: 'Cliente' });
  await semear('ocorrencias/v1', { empresa: 'Cliente', validacaoTentativaId: 'tent1' });
  await semear('gamificacao_pontos/p1', { pontos: 10, tipoAcao: 'treinamento' });
  await semear('gamificacao_pontos/p2', { pontos: -5, tipoAcao: 'desconto_suporte' });
  await semear('configuracoes/metas', { meta: 80 });
  await semear('temasOcorrencia/tema1', { nome: 'Tema' });
  await semear('csatReservas/r1', { status: 'pendente' });
});

test.after(async () => {
  await Promise.all(apps.map((app) => deleteApp(app)));
});

test('falha 1: uma conta nova não cria o próprio cadastro nem vira master', async () => {
  const intruso = clienteComo('intruso');
  await negado(setDoc(doc(intruso, 'usuarios/intruso'), { role: 'master', nome: 'X', email: 'intruso@radar.test' }));
});

test('falha 1: usuário não altera o próprio perfil, inativo nem cargo', async () => {
  const suporte = clienteComo('suporte1');
  await negado(updateDoc(doc(suporte, 'usuarios/suporte1'), { role: 'master' }));
  await negado(updateDoc(doc(suporte, 'usuarios/suporte1'), { cargo: 'supervisor' }));
  await negado(updateDoc(doc(suporte, 'usuarios/suporte1'), { email: 'outro@radar.test' }));
  const inativo = clienteComo('inativo1');
  await negado(updateDoc(doc(inativo, 'usuarios/inativo1'), { inativo: false }));
});

test('fluxos atuais do próprio usuário continuam: definir senha, migrar crc → cs e ler o próprio cadastro inativo', async () => {
  const suporte = clienteComo('suporte1');
  await permitido(setDoc(doc(suporte, 'usuarios/suporte1'), {
    email: 'suporte1@radar.test', role: 'suporte', nome: 'Suporte Formatado', needsPasswordChange: false, updatedAt: 1,
  }, { merge: true }));
  const crc = clienteComo('crc1');
  await permitido(setDoc(doc(crc, 'usuarios/crc1'), { role: 'cs', updatedAt: 1 }, { merge: true }));
  await negado(setDoc(doc(crc, 'usuarios/crc1'), { role: 'treinador', updatedAt: 2 }, { merge: true }));
  const inativo = clienteComo('inativo1');
  assert.equal((await getDoc(doc(inativo, 'usuarios/inativo1'))).data().inativo, true);
});

test('falha 2: conta sem cadastro ou inativada não lê nem grava os dados do Radar', async () => {
  for (const uid of ['intruso', 'inativo1']) {
    const db = clienteComo(uid);
    await negado(getDoc(doc(db, 'empresas/e1')));
    await negado(setDoc(doc(db, 'empresas/e1'), { nomeEmpresa: 'Alterada' }));
    await negado(getDoc(doc(db, 'checklist_tarefas/t1')));
    await negado(getDoc(doc(db, 'ocorrencias/o1')));
    await negado(setDoc(doc(db, 'ocorrencias/nova'), { empresa: 'Cliente' }));
  }
});

test('falha 3: gamificação não é legível sem login; usuário do Radar continua lendo', async () => {
  await negado(getDoc(doc(clienteComo(null), 'gamificacao_pontos/p1')));
  await negado(getDoc(doc(clienteComo('intruso'), 'gamificacao_pontos/p1')));
  await permitido(getDoc(doc(clienteComo('suporte1'), 'gamificacao_pontos/p1')));
});

test('falha 4: treinador gerencia usuários comuns, mas não promove, edita nem exclui Master', async () => {
  const treinador = clienteComo('treinador1');
  await permitido(getDoc(doc(treinador, 'usuarios/master1')));
  await permitido(setDoc(doc(treinador, 'usuarios/suporte1'), { telefone: '5586999999999', updatedAt: 1 }, { merge: true }));
  await permitido(setDoc(doc(treinador, 'usuarios/suporte1'), { role: 'cs', updatedAt: 2 }, { merge: true }));
  await permitido(setDoc(doc(treinador, 'usuarios/suporte1'), { inativo: true, updatedAt: 3 }, { merge: true }));
  await negado(setDoc(doc(treinador, 'usuarios/suporte1'), { role: 'master' }, { merge: true }));
  await negado(setDoc(doc(treinador, 'usuarios/treinador1'), { role: 'master' }, { merge: true }));
  await negado(setDoc(doc(treinador, 'usuarios/master1'), { telefone: '1' }, { merge: true }));
  await negado(setDoc(doc(treinador, 'usuarios/master1'), { inativo: true }, { merge: true }));
  await negado(deleteDoc(doc(treinador, 'usuarios/master1')));
  await permitido(deleteDoc(doc(treinador, 'usuarios/painel1')));
});

test('master continua gerenciando qualquer usuário; ninguém cria cadastro pelo navegador', async () => {
  const master = clienteComo('master1');
  await permitido(setDoc(doc(master, 'usuarios/treinador1'), { role: 'master' }, { merge: true }));
  await permitido(setDoc(doc(master, 'usuarios/master2'), { inativo: true }, { merge: true }));
  await permitido(deleteDoc(doc(master, 'usuarios/master2')));
  await negado(setDoc(doc(master, 'usuarios/novo'), { role: 'suporte', nome: 'Novo' }));
});

test('demais perfis não leem a lista de usuários, como antes', async () => {
  await negado(getDoc(doc(clienteComo('suporte1'), 'usuarios/master1')));
  await negado(getDoc(doc(clienteComo('painel1'), 'usuarios/suporte1')));
});

test('permissões de negócio preservadas: painel e demais perfis gravam empresas, checklist e ocorrências', async () => {
  for (const uid of ['painel1', 'suporte1']) {
    const db = clienteComo(uid);
    await permitido(setDoc(doc(db, 'empresas/e1'), { nomeEmpresa: `Cliente ${uid}` }, { merge: true }));
    await permitido(setDoc(doc(db, 'checklist_tarefas/t1'), { descricao: `Tarefa ${uid}` }, { merge: true }));
    await permitido(setDoc(doc(db, 'ocorrencias/o1'), { empresa: `Cliente ${uid}` }, { merge: true }));
    await negado(deleteDoc(doc(db, 'ocorrencias/o1')));
    await negado(setDoc(doc(db, 'ocorrencias/v1'), { empresa: 'Alterada' }, { merge: true }));
    await negado(setDoc(doc(db, 'ocorrencias/v2'), { empresa: 'Cliente', validacaoTentativaId: 't2' }));
  }
  await permitido(deleteDoc(doc(clienteComo('master1'), 'ocorrencias/o1')));
});

test('cliente cancelado não sai dos Cancelados, nem pelo Master', async () => {
  await semear('empresas/cancelado', { nomeEmpresa: 'Cancelado', isCancelled: true });
  for (const uid of ['master1', 'treinador1']) {
    const db = clienteComo(uid);
    await negado(setDoc(doc(db, 'empresas/cancelado'), { isCancelled: false }, { merge: true }));
    await negado(setDoc(doc(db, 'empresas/cancelado'), { nomeEmpresa: 'Sem o campo' }));
    await permitido(setDoc(doc(db, 'empresas/cancelado'), { nomeEmpresa: `Cancelado ${uid}` }, { merge: true }));
  }
  await permitido(setDoc(doc(clienteComo('treinador1'), 'empresas/e1'), { isCancelled: true }, { merge: true }));
});

test('gamificação, configurações, temas e coleções da API mantêm as regras anteriores', async () => {
  const treinador = clienteComo('treinador1');
  const suporte = clienteComo('suporte1');
  const master = clienteComo('master1');
  await permitido(setDoc(doc(treinador, 'gamificacao_pontos/p3'), { pontos: 5, tipoAcao: 'treinamento' }));
  await negado(setDoc(doc(suporte, 'gamificacao_pontos/p4'), { pontos: 5, tipoAcao: 'treinamento' }));
  await permitido(deleteDoc(doc(treinador, 'gamificacao_pontos/p1')));
  await negado(deleteDoc(doc(treinador, 'gamificacao_pontos/p2')));
  await permitido(deleteDoc(doc(master, 'gamificacao_pontos/p2')));
  await permitido(getDoc(doc(suporte, 'configuracoes/metas')));
  await negado(setDoc(doc(treinador, 'configuracoes/metas'), { meta: 90 }));
  await permitido(setDoc(doc(master, 'configuracoes/metas'), { meta: 90 }));
  await negado(setDoc(doc(treinador, 'temasOcorrencia/tema2'), { nome: 'Novo' }));
  await permitido(setDoc(doc(master, 'temasOcorrencia/tema2'), { nome: 'Novo' }));
  await negado(updateDoc(doc(master, 'temasOcorrencia/tema1'), { nome: 'Alterado' }));
  await negado(getDoc(doc(master, 'csatReservas/r1')));
});
