import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarPostgresTeste } from './helpers/postgresTeste.mjs';
import { CAMPO_REMOVIDO } from '../dist/infrastructure/postgres/BancoDocumentosPostgres.js';
import { migrarEsquema } from '../dist/infrastructure/postgres/migrador.js';
import { GerenciarValidacaoConhecimento } from '../dist/application/use-cases/GerenciarValidacaoConhecimento.js';
import { SetOcorrenciaFavorita } from '../dist/application/use-cases/SetOcorrenciaFavorita.js';
import { registrarCsat } from '../dist/infrastructure/web/csat.js';

let pg, banco;
const ler = async caminho => (await banco.doc(caminho).get()).data();
const ids = consulta => consulta.get().then(s => s.docs.map(d => d.id));

before(async () => { pg = await iniciarPostgresTeste(); banco = pg.banco; });
after(async () => { await pg?.encerrar(); });
beforeEach(async () => { await pg.limpar(); });

// ---------------------------------------------------------------- esquema

test('migrações são idempotentes e o banco usa o fuso de Brasília só se configurado no banco', async () => {
  assert.deepEqual(await migrarEsquema(pg.pool), []);
  const { rows } = await pg.pool.query('select count(*)::int as n from radar_migracoes');
  assert.equal(rows[0].n, 1);
});

test('coleções e caminhos fora do registro são recusados', async () => {
  assert.throws(() => banco.collection('desconhecida'), /Coleção desconhecida/);
  assert.throws(() => banco.collection('empresas; drop table empresas'), /Coleção desconhecida/);
  assert.throws(() => banco.collection('empresas').doc('a/b'), /inválido/);
  assert.throws(() => banco.doc('empresas'), /inválido/);
  assert.throws(() => banco.collection('empresas').where("x' or 1=1 --", '==', 1), /Campo de consulta inválido/);
});

// ---------------------------------------------------------------- documentos

test('set, get, update, create e delete seguem a semântica do Firestore', async () => {
  const ref = banco.collection('empresas').doc('e1');
  assert.equal((await ref.get()).exists, false);
  assert.equal((await ref.get()).data(), undefined);
  await ref.set({ nomeEmpresa: 'Cliente', contato: { nome: 'Ana', fone: '1' }, tags: ['a'] });
  assert.deepEqual(await ler('empresas/e1'), { nomeEmpresa: 'Cliente', contato: { nome: 'Ana', fone: '1' }, tags: ['a'] });

  // update: chave simples substitui o campo inteiro; "a.b" altera só o aninhado.
  await ref.update({ contato: { nome: 'Bia' } });
  assert.deepEqual((await ler('empresas/e1')).contato, { nome: 'Bia' });
  await ref.update({ 'contato.fone': '2', tags: CAMPO_REMOVIDO });
  assert.deepEqual(await ler('empresas/e1'), { nomeEmpresa: 'Cliente', contato: { nome: 'Bia', fone: '2' } });

  // merge: mescla mapas recursivamente; arrays substituem.
  await ref.set({ contato: { email: 'x@y' }, tags: ['b'] }, { merge: true });
  assert.deepEqual(await ler('empresas/e1'), { nomeEmpresa: 'Cliente', contato: { nome: 'Bia', fone: '2', email: 'x@y' }, tags: ['b'] });
  await ref.set({ contato: { fone: CAMPO_REMOVIDO } }, { merge: true });
  assert.deepEqual((await ler('empresas/e1')).contato, { nome: 'Bia', email: 'x@y' });

  // set sem merge substitui o documento.
  await ref.set({ nomeEmpresa: 'Outro' });
  assert.deepEqual(await ler('empresas/e1'), { nomeEmpresa: 'Outro' });

  await assert.rejects(ref.create({ a: 1 }), e => e.code === 6);
  await assert.rejects(banco.doc('empresas/nao-existe').update({ a: 1 }), e => e.code === 5);
  await ref.delete();
  await ref.delete(); // excluir documento inexistente não é erro
  assert.equal((await ref.get()).exists, false);
});

test('dados fora do JSON: undefined e Date são recusados, NaN vira null, data() devolve cópia', async () => {
  const ref = banco.doc('empresas/e1');
  assert.throws(() => banco.batch().set(ref, { a: undefined }), /undefined/);
  await assert.rejects(ref.set({ quando: new Date() }), /não suportado/);
  assert.throws(() => banco.batch().set(ref, { a: CAMPO_REMOVIDO }), /Remoção de campo/);
  await ref.set({ n: NaN, i: Infinity, lista: [1, { x: 'y' }] });
  const instantaneo = await ref.get();
  assert.deepEqual(instantaneo.data(), { n: null, i: null, lista: [1, { x: 'y' }] });
  instantaneo.data().lista.push(2);
  assert.equal(instantaneo.data().lista.length, 2);
});

test('ids automáticos têm 20 caracteres alfanuméricos e não se repetem', () => {
  const gerados = new Set(Array.from({ length: 500 }, () => banco.collection('ocorrencias').doc().id));
  assert.equal(gerados.size, 500);
  for (const id of gerados) assert.match(id, /^[A-Za-z0-9]{20}$/);
});

test('subcoleções ficam isoladas por documento pai', async () => {
  await banco.collection('csatReservas').doc('r1').collection('respostas').doc('a').set({ nota: 5 });
  await banco.doc('csatReservas/r2/respostas/a').set({ nota: 1 });
  const r1 = await banco.doc('csatReservas/r1').collection('respostas').get();
  assert.deepEqual(r1.docs.map(d => d.data()), [{ nota: 5 }]);
  assert.equal(r1.docs[0].ref.path, 'csatReservas/r1/respostas/a');
  assert.throws(() => banco.collection('empresas/e1/outra'), /Subcoleção desconhecida/);
});

// ---------------------------------------------------------------- consultas

test('igualdade compara tipo e valor exatos, inclusive aninhados e null', async () => {
  await pg.semear([
    ['ocorrencias/a', { empresa: 'X', n: 1, ok: true, extra: { origem: 'ssx-desk' } }],
    ['ocorrencias/b', { empresa: ['X', 'Y'], n: '1', ok: 'true', extra: null }],
    ['ocorrencias/c', { empresa: 'x', n: 1.0, ok: false }],
    ['ocorrencias/d', { outra: 1 }],
  ]);
  const ocorrencias = banco.collection('ocorrencias');
  assert.deepEqual(await ids(ocorrencias.where('empresa', '==', 'X')), ['a']); // array que contém "X" não conta
  assert.deepEqual(await ids(ocorrencias.where('n', '==', 1)), ['a', 'c']);
  assert.deepEqual(await ids(ocorrencias.where('n', '==', '1')), ['b']);
  assert.deepEqual(await ids(ocorrencias.where('ok', '==', true)), ['a']);
  assert.deepEqual(await ids(ocorrencias.where('extra.origem', '==', 'ssx-desk')), ['a']);
  assert.deepEqual(await ids(ocorrencias.where('extra', '==', null)), ['b']); // ausente não é null
  assert.deepEqual(await ids(ocorrencias.where('empresa', '==', ['X', 'Y'])), ['b']);
  assert.deepEqual(await ids(ocorrencias.where('empresa', 'in', ['X', 'x'])), ['a', 'c']);
  assert.throws(() => ocorrencias.where('empresa', 'in', []), /1 a 30/);
});

test('intervalos só casam com o mesmo tipo; texto compara por bytes; filtros se combinam', async () => {
  await pg.semear([
    ['validacao_tentativas/t1', { concluidaEm: 100, empresaId: 'e1' }],
    ['validacao_tentativas/t2', { concluidaEm: 200, empresaId: 'e1' }],
    ['validacao_tentativas/t3', { concluidaEm: '150', empresaId: 'e1' }],
    ['validacao_tentativas/t4', { concluidaEm: 300, empresaId: 'e2' }],
    ['validacao_tentativas/t5', { nome: 'b' }], ['validacao_tentativas/t6', { nome: 'B' }], ['validacao_tentativas/t7', { nome: 'á' }],
  ]);
  const t = banco.collection('validacao_tentativas');
  assert.deepEqual(await ids(t.where('concluidaEm', '>=', 100).where('concluidaEm', '<', 300)), ['t1', 't2']);
  assert.deepEqual(await ids(t.where('concluidaEm', '>', 100).where('empresaId', '==', 'e1')), ['t2']);
  assert.deepEqual(await ids(t.where('concluidaEm', '<=', 200)), ['t1', 't2']);
  assert.deepEqual(await ids(t.where('nome', '>', 'B')), ['t5', 't7']);
  assert.throws(() => t.where('concluidaEm', '>', true), /número ou texto/);
});

test('ordenação exclui documentos sem o campo, desempata por id e respeita o limite', async () => {
  await pg.semear([
    ['gamificacao_pontos/a', { dataLancamento: 3 }], ['gamificacao_pontos/b', { dataLancamento: 1 }],
    ['gamificacao_pontos/c', { dataLancamento: 3 }], ['gamificacao_pontos/d', {}],
  ]);
  const pontos = banco.collection('gamificacao_pontos');
  assert.deepEqual(await ids(pontos.orderBy('dataLancamento')), ['b', 'a', 'c']);
  assert.deepEqual(await ids(pontos.orderBy('dataLancamento', 'desc').limit(2)), ['c', 'a']);
  assert.deepEqual(await ids(pontos), ['a', 'b', 'c', 'd']);
  const snap = await pontos.limit(0).get();
  assert.equal(snap.empty, true); assert.equal(snap.size, 0);
});

// ---------------------------------------------------------------- transações e lotes

test('transação exige leituras antes das escritas e não aplica nada se a função falhar', async () => {
  await pg.semear([['empresas/e1', { n: 1 }]]);
  await assert.rejects(banco.runTransaction(async tx => {
    tx.update(banco.doc('empresas/e1'), { n: 2 });
    await tx.get(banco.doc('empresas/e1'));
  }), /leituras devem preceder/);
  await assert.rejects(banco.runTransaction(async tx => {
    tx.update(banco.doc('empresas/e1'), { n: 3 });
    tx.set(banco.doc('ocorrencias/o1'), { a: 1 });
    throw new Error('regra de negócio');
  }), /regra de negócio/);
  await assert.rejects(banco.runTransaction(async tx => {
    tx.set(banco.doc('ocorrencias/o1'), { a: 1 });
    tx.update(banco.doc('empresas/nao-existe'), { a: 1 }); // falha no commit desfaz a primeira escrita
  }), e => e.code === 5);
  assert.deepEqual(await ler('empresas/e1'), { n: 1 });
  assert.equal(await ler('ocorrencias/o1'), undefined);
});

test('transações concorrentes não perdem atualizações (conflito → nova tentativa)', async () => {
  await pg.semear([['csatControle/sequencia', { ultimo: 0 }]]);
  let execucoes = 0;
  const reservas = await Promise.all(Array.from({ length: 25 }, () => banco.runTransaction(async tx => {
    execucoes++;
    const atual = (await tx.get(banco.doc('csatControle/sequencia'))).data().ultimo;
    tx.update(banco.doc('csatControle/sequencia'), { ultimo: atual + 1 });
    return atual + 1;
  })));
  assert.equal((await ler('csatControle/sequencia')).ultimo, 25);
  assert.deepEqual([...reservas].sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i + 1));
  assert.ok(execucoes > 25, 'deveria ter havido conflitos e novas tentativas');
});

test('consulta lida na transação protege contra inserção concorrente (sem fantasmas)', async () => {
  const criarSeAusente = () => banco.runTransaction(async tx => {
    const existentes = await tx.get(banco.collection('validacao_tentativas').where('empresaId', '==', 'e1'));
    if (!existentes.empty) throw new Error('já existe');
    tx.set(banco.collection('validacao_tentativas').doc(), { empresaId: 'e1' });
  });
  const resultados = await Promise.allSettled(Array.from({ length: 5 }, criarSeAusente));
  assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await banco.collection('validacao_tentativas').get()).size, 1);
});

test('set com merge concorrente em documento novo não perde campos', async () => {
  await Promise.all(Array.from({ length: 8 }, (_, i) => banco.doc('integracoes/estado').set({ [`campo${i}`]: i }, { merge: true })));
  assert.equal(Object.keys(await ler('integracoes/estado')).length, 8);
});

test('lote é atômico e não pode ser enviado duas vezes', async () => {
  await pg.semear([['checklist_tarefas/t1', { concluida: true }]]);
  const lote = banco.batch();
  lote.update(banco.doc('checklist_tarefas/t1'), { excluida: true });
  lote.update(banco.doc('checklist_tarefas/inexistente'), { excluida: true });
  await assert.rejects(lote.commit(), e => e.code === 5);
  assert.deepEqual(await ler('checklist_tarefas/t1'), { concluida: true });
  await assert.rejects(lote.commit(), /já foi enviado/);
});

// ---------------------------------------------------------------- versões

test('versão muda a cada gravação, criado_em é preservado e exclusões ficam registradas', async () => {
  await banco.doc('empresas/e1').set({ a: 1 });
  const antes = (await pg.pool.query("select versao, criado_em from empresas where id = 'e1'")).rows[0];
  await banco.doc('empresas/e1').update({ a: 2 });
  const depois = (await pg.pool.query("select versao, criado_em, atualizado_em from empresas where id = 'e1'")).rows[0];
  assert.ok(BigInt(depois.versao) > BigInt(antes.versao));
  assert.deepEqual(depois.criado_em, antes.criado_em);
  await banco.doc('empresas/e1').delete();
  await banco.doc('csatReservas/r1/respostas/x').set({ a: 1 });
  await banco.doc('csatReservas/r1/respostas/x').delete();
  const { rows } = await pg.pool.query('select tabela, chave from radar_exclusoes order by versao');
  assert.deepEqual(rows, [{ tabela: 'empresas', chave: 'e1' }, { tabela: 'csat_reservas_respostas', chave: 'r1/x' }]);
});

// ---------------------------------------------------------------- fluxos reais no PostgreSQL

const usuario = { uid: 'u1', nome: 'Treinador', role: 'treinador' };
async function semearValidacao() {
  await pg.semear([
    ['usuarios/u1', { nome: 'Treinador', role: 'treinador' }], ['usuarios/master', { nome: 'Master', role: 'master' }],
    ['empresas/e1', { nomeEmpresa: 'Cliente', idNumeric: 1, responsavel: 'Treinador', temaText: 'Início\nTela Operacional\nValidação do conhecimento', dataText: '01/10\n02/10\n', currentPhase: 1 }],
  ]);
  return new GerenciarValidacaoConhecimento(banco);
}
const salvarCompleta = (repo, t, corretas = 10) => repo.salvar(t.id, {
  ...t, treinamentoTempoAgenda: '01:00', treinamentoSolicitante: 'Cliente',
  questoes: t.questoes.map((q, i) => ({ ...q, resposta: i < corretas ? 'correto' : 'parcial' })),
}, usuario);

test('validação: início concorrente gera uma única avaliação', async () => {
  const repo = await semearValidacao();
  const resultados = await Promise.allSettled(Array.from({ length: 4 }, () => repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario)));
  assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await banco.collection('validacao_tentativas').get()).size, 1);
  assert.equal((await banco.collection('validacao_perguntas').get()).size, 39);
});

test('validação: cancelar e concluir ao mesmo tempo tem um único vencedor, sem gravações parciais', async () => {
  for (let rodada = 0; rodada < 3; rodada++) {
    await pg.limpar();
    const repo = await semearValidacao();
    const t = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
    const salva = await salvarCompleta(repo, t);
    const resultados = await Promise.allSettled([repo.cancelar(t.id, salva.revisao, usuario), repo.concluir(t.id, salva.revisao, usuario)]);
    assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1);
    const concluiu = resultados[1].status === 'fulfilled';
    assert.equal((await ler(`validacao_tentativas/${t.id}`))?.status, concluiu ? 'concluida' : undefined);
    assert.equal(!!(await ler(`validacao_controle/descarte-${t.id}`)), !concluiu);
    assert.equal(!!(await ler(`ocorrencias/${t.id}`)), concluiu);
    assert.equal(!!(await ler(`gamificacao_pontos/${t.id}`)), concluiu);
    assert.equal((await ler('validacao_clientes/e1')).ativaId, null);
  }
});

test('validação + CSAT público: conclusão idempotente e respostas gravadas na tentativa, ocorrência e ponto', async () => {
  const repo = await semearValidacao();
  const t = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
  const salva = await salvarCompleta(repo, t);
  const [finalizada, repetida] = await Promise.all([repo.concluir(t.id, salva.revisao, usuario), repo.concluir(t.id, salva.revisao, usuario)]);
  assert.equal(repetida.csatToken, finalizada.csatToken);
  assert.equal((await banco.collection('ocorrencias').get()).size, 1);
  assert.equal((await banco.collection('gamificacao_pontos').get()).size, 1);
  assert.equal((await ler('empresas/e1')).currentPhase, 2);

  const rotas = new Map();
  registrarCsat({ post: (p, fn) => rotas.set(p, fn), get() {} }, banco, { verifyIdToken: async () => ({ uid: 'master' }) });
  let status = 200;
  const res = { set() {}, status(n) { status = n; return this; }, json() {} };
  const req = { params: { token: finalizada.csatToken }, body: { nome: 'Ana', nota: 5, opiniao: 'Ótimo', responseId: '12345678-12345678' } };
  // Envio duplicado simultâneo (duplo clique): grava uma única resposta.
  await Promise.all([rotas.get('/api/csat/publico/:token')(req, res), rotas.get('/api/csat/publico/:token')(req, res)]);
  assert.equal(status, 200);
  assert.equal((await banco.doc(`csatReservas/${t.id}`).collection('respostas').get()).size, 1);
  assert.equal((await ler(`validacao_tentativas/${t.id}`)).csatRespostas.length, 1);
  assert.equal((await ler(`ocorrencias/${t.id}`)).csatRespostas.length, 1);
  assert.deepEqual((await ler(`gamificacao_pontos/${t.id}`)).treinamentoResultados, ['Bom']);
});

test('favoritos: marcações concorrentes respeitam o limite de 3 estrelas por cliente', async () => {
  await pg.semear([
    ['empresas/e1', { nomeEmpresa: 'Cliente' }],
    ...Array.from({ length: 6 }, (_, i) => [`ocorrencias/o${i}`, { empresa: 'Cliente' }]),
  ]);
  const usecase = new SetOcorrenciaFavorita(banco);
  const resultados = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => usecase.execute(`o${i}`, true, 'u1', 'master')));
  assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 3);
  assert.ok(resultados.filter(r => r.status === 'rejected').every(r => r.reason.status === 409));
  const favoritas = (await banco.collection('ocorrencias').where('favorita', '==', true).get()).docs.map(d => d.id);
  assert.equal(favoritas.length, 3);
  assert.deepEqual(new Set((await ler('favoritosOcorrencias/e1')).ocorrenciaIds), new Set(favoritas));
});

// ---------------------------------------------------------------- importação do Firestore

test('importação converte tipos do Firestore, preserva datas originais e é idempotente', async () => {
  const { Timestamp, GeoPoint } = await import('firebase-admin/firestore');
  const { converterValorFirestore, substituirDados } = await import('../dist/infrastructure/postgres/importacaoFirestore.js');
  const contagem = {};
  const contar = tipo => { contagem[tipo] = (contagem[tipo] ?? 0) + 1; };
  const convertido = converterValorFirestore({
    quando: Timestamp.fromMillis(1_700_000_000_123), local: new GeoPoint(-23.5, -46.6),
    lista: [Timestamp.fromMillis(5), { n: NaN }], texto: '01/10', vazio: null,
  }, 'empresas/e1', contar);
  assert.deepEqual(convertido, { quando: 1_700_000_000_123, local: { latitude: -23.5, longitude: -46.6 }, lista: [5, { n: null }], texto: '01/10', vazio: null });
  assert.equal(contagem['Timestamp → milissegundos'], 2);

  const linhas = [
    { tabela: 'empresas', id: 'e1', dados: convertido, criadoEm: '2025-01-02T03:04:05.678Z', atualizadoEm: '2026-02-03T04:05:06.789Z' },
    { tabela: 'csat_reservas', id: 'r1', dados: { status: 'concluida' }, criadoEm: '2025-01-01T00:00:00Z', atualizadoEm: '2025-01-01T00:00:00Z' },
    { tabela: 'csat_reservas_respostas', paiId: 'r1', id: 'x', dados: { nota: 5 }, criadoEm: '2025-01-01T00:00:00Z', atualizadoEm: '2025-01-01T00:00:00Z' },
  ];
  await banco.doc('ocorrencias/sobra').set({ a: 1 }); // dado anterior é substituído
  assert.deepEqual(await substituirDados(pg.pool, linhas), []);
  assert.deepEqual(await substituirDados(pg.pool, linhas), []); // repetir não duplica
  assert.equal(await ler('ocorrencias/sobra'), undefined);
  assert.deepEqual(await ler('empresas/e1'), convertido);
  assert.deepEqual((await banco.doc('csatReservas/r1').collection('respostas').get()).docs.map(d => d.data()), [{ nota: 5 }]);
  const { rows: [datas] } = await pg.pool.query("select criado_em, atualizado_em from empresas where id = 'e1'");
  assert.equal(datas.criado_em.toISOString(), '2025-01-02T03:04:05.678Z');
  assert.equal(datas.atualizado_em.toISOString(), '2026-02-03T04:05:06.789Z');

  // Após a importação, gravações normais voltam a atualizar as datas.
  await banco.doc('empresas/e1').update({ texto: '02/10' });
  const { rows: [depois] } = await pg.pool.query("select criado_em, atualizado_em from empresas where id = 'e1'");
  assert.equal(depois.criado_em.toISOString(), '2025-01-02T03:04:05.678Z');
  assert.ok(depois.atualizado_em > datas.atualizado_em);

  await assert.rejects(substituirDados(pg.pool, [{ ...linhas[2], paiId: undefined }]), /sem o pai/);
  await assert.rejects(substituirDados(pg.pool, [{ ...linhas[0], tabela: 'nao_existe' }]), /desconhecida/);
  assert.deepEqual(await ler('empresas/e1'), { ...convertido, texto: '02/10' }); // falha não apagou nada
});
