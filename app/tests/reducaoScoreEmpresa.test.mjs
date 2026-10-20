import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import ts from 'typescript';

async function criarServico(empresa) {
  let dados = structuredClone(empresa);
  let fila = Promise.resolve();
  let gravacoes = 0;
  const nomes = ['collection', 'addDoc', 'deleteDoc', 'updateDoc', 'runTransaction', 'doc', 'getDocs', 'query', 'limit'];
  const firestore = new SyntheticModule(nomes, function () {
    for (const nome of nomes) this.setExport(nome, () => { throw Error(`Chamada inesperada: ${nome}`); });
    this.setExport('doc', (_db, colecao, id) => ({ colecao, id }));
    // Serializa as transações como o commit/retry do Firestore faria com um mesmo documento.
    this.setExport('runTransaction', (_db, executar) => {
      const atual = fila.then(() => executar({
        get: async () => ({ exists: () => dados !== null, data: () => structuredClone(dados) }),
        update: (_ref, novos) => { dados = { ...dados, ...novos }; gravacoes++; },
      }));
      fila = atual.catch(() => {});
      return atual;
    });
  });
  const fake = (nomes, valores) => new SyntheticModule(nomes, function () { nomes.forEach((n, i) => this.setExport(n, valores[i])); });
  const dependencias = {
    'firebase/firestore': firestore,
    './firebase': fake(['auth', 'db'], [{ currentUser: { uid: 'fixture' } }, {}]),
    './sincronizacaoIncremental': fake(['sincronizarColecao'], [async () => []]),
    '../utils/telefone': fake(['normalizarTelefoneWhatsApp'], [v => v]),
  };
  const transpilar = (caminho) => ts.transpileModule(readFileSync(new URL(caminho, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const score = new SourceTextModule(transpilar('../src/utils/score.ts'));
  await score.link(() => { throw Error('Import inesperado no score'); });
  dependencias['../utils/score'] = score;
  const modulo = new SourceTextModule(transpilar('../src/services/empresas.ts'));
  await modulo.link(nome => {
    assert.ok(dependencias[nome], `Dependência conhecida: ${nome}`);
    return dependencias[nome];
  });
  await modulo.evaluate();
  return { aplicar: modulo.namespace.aplicarReducaoScoreEmpresa, ler: () => dados, gravacoes: () => gravacoes };
}

const ajuste = id => ({ ocorrenciaId: id, motivo: 'Contato com o Suporte (dúvida)', valor: 1, criadoEm: Date.now(), expiraEm: Date.now() + 15 * 86_400_000 });

test('redução lê o score persistido, atualiza Safety e updatedAt sem recalcular questionário', async () => {
  const servico = await criarServico({ score: 6, tipo: 'Fast', updatedAt: 1 });
  const descricao = await servico.aplicar('cliente', ajuste('contato'), 'Contato com o suporte.');
  assert.match(descricao, /Mudança automática de Fast para Safety/);
  assert.equal(servico.ler().score, 6);
  assert.equal(servico.ler().tipo, 'Safety');
  assert.ok(servico.ler().updatedAt > 1);
});

test('duas gravações preservam as reduções anteriores e repetição do contato não duplica desconto', async () => {
  const servico = await criarServico({ score: 7, tipo: 'Fast' });
  const a = ajuste('contato-a');
  const b = ajuste('contato-b');
  const resultados = await Promise.all([servico.aplicar('cliente', a, 'A'), servico.aplicar('cliente', b, 'B')]);
  assert.equal(resultados[0], null);
  assert.match(resultados[1], /Safety/);
  assert.equal(servico.ler().scoreAjustesTemporarios.length, 2);
  await servico.aplicar('cliente', b, 'B');
  assert.equal(servico.ler().scoreAjustesTemporarios.length, 2);
  assert.equal(servico.gravacoes(), 2);
});

test('cliente sem score não ganha uma classificação inventada; cliente inexistente não é criado', async () => {
  const semScore = await criarServico({ tipo: '' });
  assert.equal(await semScore.aplicar('cliente', ajuste('contato'), 'Contato'), null);
  assert.equal(semScore.ler().tipo, '');
  const inexistente = await criarServico(null);
  await assert.rejects(inexistente.aplicar('cliente', ajuste('contato'), 'Contato'), /não encontrado/);
  assert.equal(inexistente.gravacoes(), 0);
});
