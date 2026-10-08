import assert from 'node:assert/strict';
import test from 'node:test';
import {
  conversaElegivel, criarOcorrencia, idOcorrencia, listarConversas, resolverEmpresa, RESUMO_PENDENTE,
} from '../dist/infrastructure/ssxDesk/trainingConversations.js';
import { SsxDeskSyncService } from '../dist/infrastructure/ssxDesk/SsxDeskSyncService.js';

const empresa = { id: 'radar-1', nomeEmpresa: 'Cliente Á', idCentral: '1077', dataEntrada: '2026-09-01' };
const conversa = {
  id: 'conversation-1', sessionId: 'session-1', date: '2026-10-01',
  startedAt: '2026-10-01T12:18:06.335Z', finishedAt: '2026-10-01T12:53:41.464Z',
  company: { id: 'desk-1', name: 'Cliente A', idCentral: '1077', isInTraining: true },
  customerName: 'Contato', summary: 'Resumo do atendimento', summaryGeneratedAt: '2026-10-01T13:00:00Z',
  tags: [{ id: 'tag-1', label: 'Dúvida' }],
};

test('três conversas de uma sessão criam uma ocorrência e combinam tags e resumo recente', async () => {
  const db = database();
  const conversas = [conversa, { ...conversa, id: 'c-2', summary: 'Resumo recente', summaryGeneratedAt: '2026-10-01T14:00:00Z', tags: [] }, { ...conversa, id: 'c-3', tags: [] }];
  const service = new SsxDeskSyncService(db, 'teste', async () => conversas);
  const stats = await service.sincronizar();
  assert.equal(stats.criadas, 1);
  assert.equal(stats.agrupadas, 2);
  const docs = [...db.docs.entries()].filter(([k]) => k.startsWith('ocorrencias/'));
  assert.equal(docs.length, 1);
  assert.equal(docs[0][1].descricao, 'Resumo recente');
  assert.equal(docs[0][1].tipo, 'Dúvida');
  assert.equal(docs[0][1].ssxDesk.conversationIds.length, 3);
  assert.equal((await service.sincronizar()).criadas, 0);
});

test('sessão mantém ocorrência antiga editada mesmo quando API troca o conversationId', async () => {
  const db = database();
  await new SsxDeskSyncService(db, 'teste', async () => [conversa]).sincronizar();
  const id = idOcorrencia(conversa.id);
  const oc = db.docs.get(`ocorrencias/${id}`);
  oc.descricao = 'Texto manual';
  oc.tipo = 'Problema';
  const alterada = { ...conversa, id: 'outro-id', summary: 'Novo resumo' };
  const service = new SsxDeskSyncService(db, 'teste', async () => [alterada]);
  assert.equal((await service.sincronizar()).criadas, 0);
  assert.equal(oc.descricao, 'Texto manual');
  assert.equal(oc.tipo, 'Problema');
  db.docs.delete(`ocorrencias/${id}`);
  assert.equal((await new SsxDeskSyncService(db, 'teste', async () => [alterada]).sincronizar()).criadas, 0);
});

test('instâncias com conversationIds distintos disputam a mesma sessão sem duplicar', async () => {
  const db = database();
  const resultados = await Promise.all([
    new SsxDeskSyncService(db, 'teste', async () => [conversa]).sincronizar(),
    new SsxDeskSyncService(db, 'teste', async () => [{ ...conversa, id: 'outro-id' }]).sincronizar(),
  ]);
  assert.equal(resultados.reduce((n, r) => n + r.criadas, 0), 1);
  assert.equal([...db.docs.keys()].filter(k => k.startsWith('ocorrencias/')).length, 1);
});

test('três duplicatas legadas são preservadas e a sessão reutiliza a primeira sem criar uma quarta', async () => {
  const db = database();
  const grupo = [conversa, { ...conversa, id: 'c-2' }, { ...conversa, id: 'c-3' }];
  for (const [index, c] of grupo.entries()) {
    const id = idOcorrencia(c.id);
    const oc = criarOcorrencia(c, empresa, index + 1);
    db.docs.set(`ocorrencias/${id}`, oc);
    db.docs.set(`ssxDeskImportacoes/${id}`, { conversationId: c.id, ocorrenciaId: id, empresaId: empresa.id, descricaoImportada: oc.descricao });
  }
  db.docs.get(`ocorrencias/${idOcorrencia(conversa.id)}`).descricao = 'Edição preservada';
  const service = new SsxDeskSyncService(db, 'teste', async () => [...grupo].reverse());
  assert.equal((await service.sincronizar()).criadas, 0);
  assert.equal([...db.docs.keys()].filter(k => k.startsWith('ocorrencias/')).length, 3);
  assert.equal(db.docs.get(`ocorrencias/${idOcorrencia(conversa.id)}`).descricao, 'Edição preservada');
  assert.equal([...db.docs.entries()].find(([k]) => k.startsWith('ssxDeskSessoes/'))[1].ocorrenciaId, idOcorrencia(conversa.id));
});

test('tipos do Desk são normalizados sem inferir assuntos ou escolher conflitos', () => {
  for (const [label, tipo] of [[' DÚVIDA ', 'Dúvida'], ['solicitacao', 'Solicitação'], ['Problema', 'Problema']]) {
    const nova = criarOcorrencia({ ...conversa, tags: [{ id: 't', label }] }, empresa, 123);
    assert.equal(nova.tipo, tipo);
    assert.deepEqual(nova.temaOcorrencia, []);
  }
  for (const labels of [[], ['Outro'], ['Dúvida', 'Problema']]) {
    assert.equal(criarOcorrencia({ ...conversa, tags: labels.map(label => ({ id: label, label })) }, empresa, 123).tipo, '');
  }
});

test('importações antigas recebem tipo sem alterar assunto ou classificação manual', async () => {
  for (const tipoAnterior of ['', 'Solicitação']) {
    const db = database();
    await new SsxDeskSyncService(db, 'teste', async () => [conversa]).sincronizar();
    const id = idOcorrencia(conversa.id);
    const oc = db.docs.get(`ocorrencias/${id}`);
    oc.tipo = tipoAnterior;
    oc.temaOcorrencia = ['Assunto manual'];
    delete db.docs.get(`ssxDeskImportacoes/${id}`).tipoProcessado;
    const service = new SsxDeskSyncService(db, 'teste', async () => [conversa]);
    await service.sincronizar(true);
    assert.equal(oc.tipo, tipoAnterior);
    assert.equal((await service.sincronizar()).atualizadas, 1);
    assert.equal(oc.tipo, tipoAnterior || 'Dúvida');
    assert.deepEqual(oc.temaOcorrencia, ['Assunto manual']);
    assert.equal((await service.sincronizar()).atualizadas, 0);
  }
});

test('vínculo único por Central; ID compartilhado exige nome exato e único', () => {
  assert.equal(resolverEmpresa(conversa.company, [empresa], [conversa.company]), empresa);
  const outroDesk = { ...conversa.company, id: 'desk-2', name: 'Outra empresa' };
  assert.equal(resolverEmpresa(outroDesk, [empresa], [conversa.company, outroDesk]), undefined);
  assert.equal(resolverEmpresa(conversa.company, [empresa], [conversa.company, outroDesk]), empresa);
  assert.equal(resolverEmpresa(conversa.company, [empresa, { ...empresa, id: 'radar-2' }], [conversa.company]), undefined);
  assert.equal(resolverEmpresa(conversa.company, [empresa], [conversa.company, { ...conversa.company, id: 'desk-2' }]), undefined);
});

test('sem Central aceita nome exato normalizado; rejeita IDs conflitantes e nomes ambíguos', () => {
  const semCentral = { ...conversa.company, idCentral: null };
  assert.equal(resolverEmpresa(semCentral, [empresa], [semCentral]), empresa);
  assert.equal(resolverEmpresa(conversa.company, [{ ...empresa, idCentral: '999' }], [conversa.company]), undefined);
  assert.equal(resolverEmpresa(semCentral, [empresa], [semCentral, { ...semCentral, id: 'desk-2' }]), undefined);
  assert.equal(resolverEmpresa({ ...semCentral, name: 'Cliente' }, [empresa], [semCentral]), undefined);
});

test('somente treinamento ativo, conversa encerrada e iniciada desde a entrada no Radar', () => {
  assert.equal(conversaElegivel(conversa, empresa), true);
  assert.equal(conversaElegivel(conversa, { ...empresa, isSuspended: true }), true);
  assert.equal(conversaElegivel(conversa, { ...empresa, dataFinalizacao: '2026-07-03' }), true);
  for (const changes of [{ isOngoing: true }, { isCancelled: true },
    { nomeEmpresa: 'Systemsat' }, { dataEntrada: '2026-10-02' }, { dataEntrada: '' }]) {
    assert.equal(conversaElegivel(conversa, { ...empresa, ...changes }), false);
  }
  assert.equal(conversaElegivel({ ...conversa, company: { ...conversa.company, isInTraining: false } }, empresa), false);
  assert.equal(conversaElegivel({ ...conversa, finishedAt: '' }, empresa), false);
  assert.equal(conversaElegivel({ ...conversa, finishedAt: '2026-09-30T12:00:00Z' }, empresa), false);
});

test('sincroniza clientes inclusive suspensos e com finalização preenchida, exceto ongoing e cancelados', async () => {
  for (const status of [{}, { isOngoing: true }, { isSuspended: true }, { isCancelled: true }]) {
    const db = database();
    db.docs.set('empresas/radar-1', { ...empresa, dataFinalizacao: '2026-07-03', ...status });
    const service = new SsxDeskSyncService(db, 'teste', async () => [conversa]);
    const bloqueada = !!(status.isOngoing || status.isCancelled);
    assert.equal((await service.sincronizar()).criadas, bloqueada ? 0 : 1);
    assert.equal(db.docs.has(`ocorrencias/${idOcorrencia(conversa.id)}`), !bloqueada);
    assert.equal((await service.sincronizar()).criadas, 0);
  }
});

test('ocorrência conserva instante do atendimento, resumo, origem e tipo opcional', () => {
  const nova = criarOcorrencia(conversa, empresa, 123);
  assert.equal(nova.dataOcorrencia, Date.parse(conversa.startedAt));
  assert.equal(nova.tipo, 'Dúvida');
  assert.deepEqual(nova.temaOcorrencia, []);
  assert.equal(nova.departamento, 'Suporte');
  assert.equal(nova.descricao, conversa.summary);
  assert.equal(nova.ssxDesk.finishedAt, conversa.finishedAt);
  assert.equal(nova.createdAt, 123);
  assert.equal(criarOcorrencia({ ...conversa, summary: null }, empresa, 123).descricao, RESUMO_PENDENTE);
});

test('paginação percorre todas as páginas sem filtro de data e respeita intervalo', async () => {
  const chamadas = [], esperas = [];
  const resultado = await listarConversas('chave-de-teste', async (url, options) => {
    chamadas.push(url);
    assert.equal(options.headers.Authorization, 'Bearer chave-de-teste');
    assert.equal(options.redirect, 'error');
    const offset = Number(url.searchParams.get('offset'));
    return Response.json({ data: [{ ...conversa, id: `c-${offset}` }], meta: { offset, total: 2, hasMore: offset === 0 } });
  }, async ms => { esperas.push(ms); });
  assert.equal(resultado.length, 2);
  assert.equal(chamadas[0].searchParams.has('from'), false);
  assert.equal(chamadas[1].searchParams.get('offset'), '1');
  assert.deepEqual(esperas, [600]);
});

test('falhas HTTP e respostas inválidas são rejeitadas sem expor a chave', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(listarConversas('segredo', async () => new Response('segredo', { status })),
      error => error.message.includes(String(status)) && !error.message.includes('segredo'));
  }
  await assert.rejects(listarConversas('segredo', async () => Response.json({ data: [{}], meta: { offset: 0, total: 1, hasMore: false } })), /formato/);
  await assert.rejects(listarConversas('segredo', async () => Response.json({ data: [], meta: { offset: 0, total: 1, hasMore: true } })), /não avançou/);
});

// Pequeno armazenamento transacional: exercita o fluxo completo sem acessar produção.
function database() {
  const docs = new Map([['empresas/radar-1', structuredClone(empresa)]]);
  const doc = path => ({ path, id: path.split('/').at(-1) });
  const snap = ref => ({ id: ref.id, exists: docs.has(ref.path), data: () => structuredClone(docs.get(ref.path)) });
  let queue = Promise.resolve();
  return {
    docs, doc: path => ({ ...doc(path), set: async value => { docs.set(path, { ...docs.get(path), ...value }); } }),
    collection: name => {
      const query = { get: async () => ({ docs: [...docs.keys()].filter(p => p.startsWith(`${name}/`)).map(p => snap(doc(p))) }) };
      return { ...query, where: () => query };
    },
    runTransaction(callback) {
      const pending = queue.then(async () => {
        const writes = [];
        const result = await callback({
          get: async ref => snap(ref),
          create: (ref, value) => {
            assert.equal(docs.has(ref.path), false);
            writes.push(() => docs.set(ref.path, structuredClone(value)));
          },
          update: (ref, value) => writes.push(() => {
            const current = docs.get(ref.path);
            for (const [key, field] of Object.entries(value)) {
              const parts = key.split('.');
              if (parts.length === 2) current[parts[0]][parts[1]] = field;
              else current[key] = field;
            }
          }),
        });
        writes.forEach(write => write());
        return result;
      });
      queue = pending.catch(() => {});
      return pending;
    },
  };
}

test('repetições e duas instâncias concorrentes criam uma única ocorrência', async () => {
  const db = database();
  const service = () => new SsxDeskSyncService(db, 'teste', async () => [conversa]);
  const results = await Promise.all([service().sincronizar(), service().sincronizar()]);
  assert.equal(results.reduce((n, r) => n + r.criadas, 0), 1);
  assert.equal((await service().sincronizar()).existentes, 1);
  assert.equal([...db.docs.keys()].filter(k => k.startsWith('ocorrencias/')).length, 1);
});

test('resumo tardio é preenchido; classificação e descrição manuais são preservadas', async () => {
  const db = database();
  let atual = { ...conversa, summary: null, summaryGeneratedAt: null };
  const service = new SsxDeskSyncService(db, 'teste', async () => [atual]);
  await service.sincronizar();
  const oc = db.docs.get(`ocorrencias/${idOcorrencia(conversa.id)}`);
  assert.equal(oc.descricao, RESUMO_PENDENTE);
  oc.tipo = 'Problema';
  atual = conversa;
  assert.equal((await service.sincronizar()).atualizadas, 1);
  assert.equal(oc.tipo, 'Problema');
  assert.equal(oc.descricao, conversa.summary);
  oc.descricao = 'Descrição revisada';
  atual = { ...conversa, summary: 'Resumo reprocessado' };
  await service.sincronizar();
  assert.equal(oc.descricao, 'Descrição revisada');
});

test('exclusão manual não é desfeita e simulação não grava documentos', async () => {
  const db = database();
  const service = new SsxDeskSyncService(db, 'teste', async () => [conversa]);
  const before = structuredClone([...db.docs]);
  assert.equal((await service.sincronizar(true)).criadas, 1);
  assert.deepEqual([...db.docs], before);
  await service.sincronizar();
  const path = `ocorrencias/${idOcorrencia(conversa.id)}`;
  db.docs.delete(path);
  await service.sincronizar();
  assert.equal(db.docs.has(path), false);
});

test('mudança de status no Radar é revalidada dentro da transação', async () => {
  const db = database();
  const run = db.runTransaction;
  db.runTransaction = callback => {
    db.docs.get('empresas/radar-1').isOngoing = true;
    return run(callback);
  };
  const resultado = await new SsxDeskSyncService(db, 'teste', async () => [conversa]).sincronizar();
  assert.equal(resultado.ignoradas, 1);
  assert.equal(resultado.criadas, 0);
});

test('falha na segunda página não inicia nenhuma gravação', async () => {
  const db = database();
  const before = structuredClone([...db.docs]);
  const consultar = key => listarConversas(key, async url => {
    if (url.searchParams.get('offset') !== '0') throw new Error('Indisponível');
    return Response.json({ data: [conversa], meta: { offset: 0, total: 2, hasMore: true } });
  }, async () => {});
  await assert.rejects(new SsxDeskSyncService(db, 'teste', consultar).sincronizar(), /Indisponível/);
  assert.deepEqual([...db.docs], before);
});

test('ciclos seguintes não releem ocorrências sem mudança nem clientes fora de treinamento', async () => {
  const db = database();
  const inativa = { ...empresa, id: 'radar-2', nomeEmpresa: 'Cliente encerrado', idCentral: '999', isOngoing: true };
  db.docs.set('empresas/radar-2', inativa);
  const historico = [conversa, { ...conversa, id: 'c-2', company: { ...conversa.company, id: 'desk-2', idCentral: '999', name: inativa.nomeEmpresa } }];
  let transactions = 0;
  const run = db.runTransaction;
  db.runTransaction = callback => { transactions++; return run(callback); };
  const service = new SsxDeskSyncService(db, 'teste', async () => historico);
  await service.sincronizar();
  assert.equal(transactions, 1);
  transactions = 0;
  const stats = await service.sincronizar();
  assert.equal(transactions, 0);
  assert.equal(stats.existentes, 1);
  assert.equal(stats.foraTreinamentoOuPeriodo, 1);
});
