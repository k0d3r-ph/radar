import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import ts from 'typescript';

async function criarServico() {
  const documentos = new Map();
  const firestore = new SyntheticModule(['collection', 'doc', 'addDoc', 'runTransaction', 'deleteDoc', 'getDocsFromServer', 'query', 'orderBy', 'limit'], function () {
    this.setExport('collection', () => 'ocorrencias');
    this.setExport('doc', (_db, _colecao, id) => ({ id }));
    this.setExport('addDoc', async (_colecao, dados) => { documentos.set('nova', dados); return { id: 'nova' }; });
    this.setExport('runTransaction', async (_db, executar) => executar({
      get: async ref => ({ exists: () => documentos.has(ref.id), data: () => documentos.get(ref.id) }),
      update: (ref, dados) => documentos.set(ref.id, { ...documentos.get(ref.id), ...dados }),
    }));
    for (const nome of ['deleteDoc', 'getDocsFromServer', 'query', 'orderBy', 'limit']) this.setExport(nome, () => { throw Error(`Chamada inesperada: ${nome}`); });
  });
  const firebase = new SyntheticModule(['auth', 'db'], function () {
    this.setExport('auth', { currentUser: { uid: 'treinador' } }); this.setExport('db', {});
  });
  const sincronizacao = new SyntheticModule(['sincronizarColecao'], function () { this.setExport('sincronizarColecao', async () => []); });
  const config = new SyntheticModule(['RADAR_API_URL'], function () { this.setExport('RADAR_API_URL', ''); });
  const codigo = ts.transpileModule(readFileSync(new URL('../src/services/ocorrencias.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const modulo = new SourceTextModule(codigo);
  await modulo.link(nome => {
    const dependencias = { 'firebase/firestore': firestore, './firebase': firebase, './sincronizacaoIncremental': sincronizacao, './apiConfig.ts': config };
    if (!dependencias[nome]) throw Error(`Import inesperado: ${nome}`);
    return dependencias[nome];
  });
  await modulo.evaluate();
  return { documentos, servico: modulo.namespace };
}

test('ocorrência persiste o motivo e limpa classificação com null ao mudar as datas', async () => {
  const { documentos, servico } = await criarServico();
  const dados = { tipo: 'Treinamento', empresa: 'Cliente', descricao: 'Treinamento', treinamentoMotivoEspera: 'cliente' };
  const id = await servico.salvarOcorrencia(dados);
  assert.equal(documentos.get(id).treinamentoMotivoEspera, 'cliente');
  assert.ok(documentos.get(id).updatedAt > 0);
  await servico.salvarOcorrencia({ ...dados, id, treinamentoMotivoEspera: 'agenda_treinador' });
  assert.equal(documentos.get(id).treinamentoMotivoEspera, 'agenda_treinador');
  await servico.salvarOcorrencia({ ...dados, id, treinamentoMotivoEspera: null });
  assert.equal(documentos.get(id).treinamentoMotivoEspera, null);
});

test('atualizações de outros campos e preservação do CSAT não descartam motivo salvo', async () => {
  const { documentos, servico } = await criarServico();
  documentos.set('antiga', { tipo: 'Treinamento', empresa: 'Cliente', treinamentoMotivoEspera: 'cliente', csatReservaId: 'reserva', treinamentoResultados: ['Bom'] });
  await servico.salvarOcorrencia({ id: 'antiga', empresa: 'Cliente', descricao: 'Atualizada' });
  assert.equal(documentos.get('antiga').treinamentoMotivoEspera, 'cliente');
  assert.deepEqual(documentos.get('antiga').treinamentoResultados, ['Bom']);
});
