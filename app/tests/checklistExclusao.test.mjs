import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import ts from 'typescript';

async function ambiente() {
  const estado = { registros: [{ id: 't1', concluida: true, automatica: true, createdAt: 1 }], chamadas: [], exclusoesDiretas: 0, falhar: false };
  const context = createContext({ Date, AbortSignal, fetch: async (url, options) => {
    estado.chamadas.push({ url, ...options });
    if (estado.falhar) return { ok: false, json: async () => ({ error: 'A tarefa não está concluída.' }) };
    estado.registros[0].excluida = true;
    return { ok: true, json: async () => ({ sucesso: true }) };
  } });
  const definir = dados => new SyntheticModule(Object.keys(dados), function () { Object.entries(dados).forEach(([nome, valor]) => this.setExport(nome, valor)); }, { context });
  const firestore = definir({ collection() {}, addDoc() {}, deleteDoc: async () => { estado.exclusoesDiretas++; }, deleteField() {}, doc() {}, updateDoc() {} });
  const firebase = definir({ auth: { currentUser: { uid: 'u1', getIdToken: async () => 'token-teste' } }, db: {} });
  const sincronizacao = definir({ sincronizarColecao: async () => structuredClone(estado.registros) });
  const config = definir({ RADAR_API_URL: 'http://api.test' });
  const code = ts.transpileModule(readFileSync(new URL('../src/services/checklist.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const modulo = new SourceTextModule(code, { context });
  await modulo.link(nome => { const dependency = { 'firebase/firestore': firestore, './firebase': firebase, './sincronizacaoIncremental': sincronizacao, './apiConfig': config }[nome]; if (!dependency) throw Error(`Import inesperado: ${nome}`); return dependency; });
  await modulo.evaluate();
  return { estado, service: modulo.namespace };
}
test('excluir concluída usa API autenticada e desaparece do cache e após nova sincronização', async () => {
  const { estado, service } = await ambiente();
  assert.equal((await service.listarTarefasChecklist()).length, 1);
  await service.removerTarefaChecklist('t1', true);
  assert.equal((await service.listarTarefasChecklist()).length, 0);
  assert.equal((await service.listarTarefasChecklist(true)).length, 0);
  assert.equal(estado.exclusoesDiretas, 0);
  assert.equal(estado.chamadas[0].method, 'DELETE');
  assert.equal(estado.chamadas[0].headers.Authorization, 'Bearer token-teste');
});
test('erro da API preserva tarefa no cache e exclusão manual pendente mantém fluxo existente', async () => {
  const { estado, service } = await ambiente();
  await service.listarTarefasChecklist(); estado.falhar = true;
  await assert.rejects(service.removerTarefaChecklist('t1', true), /não está concluída/);
  assert.equal((await service.listarTarefasChecklist()).length, 1);
  await service.removerTarefaChecklist('manual');
  assert.equal(estado.exclusoesDiretas, 1);
});
