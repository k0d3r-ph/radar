// Cliente da API de dados (src/services/dados.ts), que substituiu o SDK do Firestore.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import ts from 'typescript';

async function carregar(responder) {
  const estado = { chamadas: [], usuario: { uid: 'u1', getIdToken: async () => 'token-1' } };
  const context = createContext({
    console, AbortSignal, JSON, Promise, Error, structuredClone, crypto, setTimeout,
    fetch: async (url, opcoes = {}) => {
      const chamada = { url, metodo: opcoes.method, corpo: opcoes.body ? JSON.parse(opcoes.body) : undefined, auth: opcoes.headers?.Authorization };
      estado.chamadas.push(chamada);
      const [status, corpo] = await responder(chamada, estado.chamadas.length);
      if (status === 'rede') throw new TypeError('Failed to fetch');
      return { ok: status < 400, status, json: async () => corpo };
    },
  });
  const firebase = new SyntheticModule(['auth'], function () {
    this.setExport('auth', { get currentUser() { return estado.usuario; } });
  }, { context });
  const config = new SyntheticModule(['RADAR_API_URL'], function () { this.setExport('RADAR_API_URL', 'http://api.test'); }, { context });
  const codigo = ts.transpileModule(readFileSync(new URL('../src/services/dados.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const modulo = new SourceTextModule(codigo, { context });
  await modulo.link(nome => ({ './firebase': firebase, './apiConfig.ts': config })[nome] ?? (() => { throw Error(`Import inesperado: ${nome}`); })());
  await modulo.evaluate();
  return { d: modulo.namespace, estado, db: { tipo: 'radar' } };
}

test('referências: caminhos, id automático no formato do Firestore e banco obrigatório', async () => {
  const { d, db } = await carregar(() => [200, {}]);
  assert.equal(d.doc(db, 'empresas', 'e1').path, 'empresas/e1');
  assert.equal(d.doc(db, 'usuarios/u1').id, 'u1');
  assert.equal(d.doc(db, 'empresas', 'e1').parent.path, 'empresas');
  const automatico = d.doc(d.collection(db, 'ocorrencias'));
  assert.match(automatico.path, /^ocorrencias\/[A-Za-z0-9]{20}$/);
  assert.throws(() => d.doc(db, 'empresas', ''), e => e.code === 'invalid-argument');
  assert.throws(() => d.doc({}, 'empresas', 'e1'), e => e.code === 'invalid-argument');
});

test('setDoc, updateDoc, deleteDoc e addDoc enviam escritas com token; deleteField vira marcador', async () => {
  const { d, db, estado } = await carregar(() => [200, { ok: true }]);
  await d.setDoc(d.doc(db, 'empresas', 'e1'), { a: 1 }, { merge: true });
  await d.updateDoc(d.doc(db, 'empresas', 'e1'), { 'dias.01': d.deleteField() });
  await d.deleteDoc(d.doc(db, 'empresas', 'e1'));
  const novo = await d.addDoc(d.collection(db, 'checklist_tarefas'), { descricao: 'x' });
  assert.deepEqual(estado.chamadas.map(c => [c.url, c.metodo, c.auth]), Array(4).fill(['http://api.test/api/dados/gravar', 'POST', 'Bearer token-1']));
  assert.deepEqual(estado.chamadas.map(c => c.corpo.escritas[0]), [
    { tipo: 'set', caminho: 'empresas/e1', dados: { a: 1 }, merge: true },
    { tipo: 'update', caminho: 'empresas/e1', dados: { 'dias.01': { __radar__: 'deleteField' } }, merge: false },
    { tipo: 'delete', caminho: 'empresas/e1', merge: false },
    { tipo: 'set', caminho: novo.path, dados: { descricao: 'x' }, merge: false },
  ]);
});

test('valores que o Firestore recusava são recusados antes de chamar a API', async () => {
  const { d, db, estado } = await carregar(() => [200, {}]);
  await assert.rejects(d.setDoc(d.doc(db, 'empresas', 'e1'), { a: undefined }), e => e.code === 'invalid-argument');
  await assert.rejects(d.setDoc(d.doc(db, 'empresas', 'e1'), { quando: new Date() }), e => e.code === 'invalid-argument');
  assert.equal(estado.chamadas.length, 0);
});

test('getDoc e getDocs: snapshot no formato do Firestore, consulta com filtros, ordem e limite', async () => {
  const { d, db, estado } = await carregar(({ url }) => url.endsWith('/consultar')
    ? [200, { documentos: [{ id: 'o1', existe: true, dados: { empresa: 'X' }, versao: '7' }] }]
    : url.endsWith('/e2') ? [200, { id: 'e2', existe: false }] : [200, { id: 'e1', existe: true, dados: { nome: 'A' }, versao: '3' }]);
  const lido = await d.getDoc(d.doc(db, 'empresas', 'e1'));
  assert.equal(lido.exists(), true);
  assert.deepEqual(lido.data(), { nome: 'A' });
  lido.data().nome = 'alterado';
  assert.equal(lido.data().nome, 'A');
  const ausente = await d.getDocFromServer(d.doc(db, 'empresas', 'e2'));
  assert.equal(ausente.exists(), false);
  assert.equal(ausente.data(), undefined);
  const lista = await d.getDocs(d.query(d.collection(db, 'ocorrencias'), d.where('empresa', '==', 'X'), d.orderBy('createdAt', 'desc'), d.limit(5)));
  assert.equal(lista.size, 1);
  assert.equal(lista.docs[0].ref.path, 'ocorrencias/o1');
  assert.deepEqual(estado.chamadas.at(-1).corpo, {
    filtros: [{ campo: 'empresa', operador: '==', valor: 'X' }], ordens: [{ campo: 'createdAt', direcao: 'desc' }], limite: 5,
  });
  assert.equal(estado.chamadas[0].metodo, 'GET');
});

test('erros mantêm os códigos do Firestore; sem rede vira unavailable; sem sessão não chama a API', async () => {
  let modo = 403;
  const { d, db, estado } = await carregar(() => modo === 'rede' ? ['rede'] : [modo, { error: 'Você não tem permissão para esta ação.', code: 'permission-denied' }]);
  await assert.rejects(d.getDoc(d.doc(db, 'usuarios', 'x')), e => e.code === 'permission-denied' && /permissão/.test(e.message));
  modo = 'rede';
  await assert.rejects(d.getDoc(d.doc(db, 'usuarios', 'x')), e => e.code === 'unavailable');
  estado.usuario = null;
  const antes = estado.chamadas.length;
  await assert.rejects(d.getDoc(d.doc(db, 'usuarios', 'x')), e => e.code === 'unauthenticated');
  assert.equal(estado.chamadas.length, antes);
});

test('transação envia as versões lidas e refaz a função quando outra pessoa alterou os dados', async () => {
  let versao = 1;
  const { d, db, estado } = await carregar(({ url, corpo }) => {
    if (url.endsWith('/gravar')) {
      if (corpo.leituras[0].versao !== String(versao)) return [409, { code: 'aborted', error: 'Os dados foram alterados.' }];
      return [200, { ok: true }];
    }
    const resposta = [200, { id: 'e1', existe: true, dados: { n: versao }, versao: String(versao) }];
    if (estado.chamadas.length === 1) versao = 2; // alteração concorrente logo após a primeira leitura
    return resposta;
  });
  let execucoes = 0;
  const resultado = await d.runTransaction(db, async tx => {
    execucoes++;
    const atual = await tx.get(d.doc(db, 'empresas', 'e1'));
    tx.update(d.doc(db, 'empresas', 'e1'), { n: atual.data().n + 1 });
    return atual.data().n + 1;
  });
  assert.equal(execucoes, 2);
  assert.equal(resultado, 3);
  assert.deepEqual(estado.chamadas.at(-1).corpo, {
    leituras: [{ caminho: 'empresas/e1', versao: '2' }],
    escritas: [{ tipo: 'update', caminho: 'empresas/e1', dados: { n: 3 }, merge: false }],
  });
  await assert.rejects(d.runTransaction(db, async tx => {
    tx.delete(d.doc(db, 'empresas', 'e1'));
    await tx.get(d.doc(db, 'empresas', 'e1'));
  }), /leituras devem preceder/);
});

test('lote envia todas as escritas numa única requisição; permissão negada não é repetida', async () => {
  const { d, db, estado } = await carregar(() => [403, { code: 'permission-denied', error: 'Sem permissão' }]);
  const lote = d.writeBatch(db);
  lote.update(d.doc(db, 'gamificacao_pontos', 'p1'), { treinadorId: 'novo' });
  lote.update(d.doc(db, 'gamificacao_pontos', 'p2'), { treinadorId: 'novo' });
  await assert.rejects(lote.commit(), e => e.code === 'permission-denied');
  assert.equal(estado.chamadas.length, 1);
  assert.equal(estado.chamadas[0].corpo.escritas.length, 2);
  await assert.rejects(d.runTransaction(db, async tx => { tx.set(d.doc(db, 'configuracoes', 'm'), { a: 1 }); }), e => e.code === 'permission-denied');
  assert.equal(estado.chamadas.length, 2);
});

test('updateDoc com pares campo/valor envia caminhos literais (FieldPath) em transação e lote', async () => {
  const { d, db, estado } = await carregar(({ url }) => url.endsWith('/gravar') ? [200, { ok: true }] : [200, { id: 'e1', existe: true, dados: {}, versao: '1' }]);
  await d.updateDoc(d.doc(db, 'empresas', 'e1'), new d.FieldPath('aplicacaoTemasDias', 'Tema 1.2'), 3, 'a.b', d.deleteField());
  assert.deepEqual(estado.chamadas[0].corpo.escritas[0], { tipo: 'update', caminho: 'empresas/e1', merge: false, campos: [
    { caminho: ['aplicacaoTemasDias', 'Tema 1.2'], valor: 3 },
    { caminho: ['a', 'b'], valor: { __radar__: 'deleteField' } },
  ] });
  const lote = d.writeBatch(db);
  lote.update(d.doc(db, 'empresas', 'e1'), new d.FieldPath('x.y'), 1);
  await lote.commit();
  assert.deepEqual(estado.chamadas[1].corpo.escritas[0].campos, [{ caminho: ['x.y'], valor: 1 }]);
  await d.runTransaction(db, async tx => { await tx.get(d.doc(db, 'empresas', 'e1')); tx.update(d.doc(db, 'empresas', 'e1'), new d.FieldPath('z'), 2); });
  assert.deepEqual(estado.chamadas.at(-1).corpo.escritas[0].campos, [{ caminho: ['z'], valor: 2 }]);
  // Pares incompletos, caminho vazio e undefined são recusados antes de chamar a API.
  const antes = estado.chamadas.length;
  await assert.rejects(d.updateDoc(d.doc(db, 'empresas', 'e1'), new d.FieldPath('a')), e => e.code === 'invalid-argument');
  await assert.rejects(d.updateDoc(d.doc(db, 'empresas', 'e1'), 'a..b', 1), e => e.code === 'invalid-argument');
  await assert.rejects(d.updateDoc(d.doc(db, 'empresas', 'e1'), new d.FieldPath('a'), undefined), e => e.code === 'invalid-argument');
  assert.throws(() => new d.FieldPath('a', ''), e => e.code === 'invalid-argument');
  assert.equal(estado.chamadas.length, antes);
});
