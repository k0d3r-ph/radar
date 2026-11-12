import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import ts from 'typescript';

const transpilar = (caminho) => ts.transpileModule(readFileSync(new URL(caminho, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

/** salvarOcorrencia com Firestore em memória: transações aplicam as escritas só no fim. */
async function criarServico(empresas) {
  const colecoes = { ocorrencias: new Map(), empresas: new Map(Object.entries(empresas)) };
  let invalidacoesEmpresas = 0;
  let sequencia = 0;
  const snapshot = (ref) => {
    const dados = colecoes[ref.colecao].get(ref.id);
    return { exists: () => dados !== undefined, data: () => dados, ref };
  };
  const firestore = new SyntheticModule(
    ['collection', 'doc', 'addDoc', 'runTransaction', 'getDocsFromServer', 'getDocFromServer', 'query', 'where', 'orderBy', 'limit'],
    function () {
      this.setExport('collection', (_db, colecao) => ({ colecao }));
      this.setExport('doc', (base, colecao, id) =>
        colecao === undefined ? { colecao: base.colecao, id: `nova-${++sequencia}` } : { colecao, id });
      this.setExport('addDoc', async (ref, dados) => {
        const id = `nova-${++sequencia}`;
        colecoes[ref.colecao].set(id, dados);
        return { id };
      });
      this.setExport('runTransaction', async (_db, executar) => {
        const escritas = [];
        await executar({
          get: async (ref) => snapshot(ref),
          update: (ref, dados) => escritas.push(() => colecoes[ref.colecao].set(ref.id, { ...colecoes[ref.colecao].get(ref.id), ...dados })),
          set: (ref, dados) => escritas.push(() => colecoes[ref.colecao].set(ref.id, dados)),
          delete: (ref) => escritas.push(() => colecoes[ref.colecao].delete(ref.id)),
        });
        escritas.forEach((escrever) => escrever());
      });
      for (const nome of ['getDocsFromServer', 'getDocFromServer', 'query', 'where', 'orderBy', 'limit']) {
        this.setExport(nome, () => { throw Error(`Chamada inesperada: ${nome}`); });
      }
    },
  );
  const modulos = {
    'firebase/firestore': firestore,
    './firebase': new SyntheticModule(['auth', 'db'], function () { this.setExport('auth', {}); this.setExport('db', {}); }),
    './sincronizacaoIncremental': new SyntheticModule(['sincronizarColecao'], function () { this.setExport('sincronizarColecao', async () => []); }),
    './apiConfig.ts': new SyntheticModule(['RADAR_API_URL'], function () { this.setExport('RADAR_API_URL', ''); }),
    './gamificacao': new SyntheticModule(['invalidarCacheGamificacao'], function () { this.setExport('invalidarCacheGamificacao', () => {}); }),
    './empresas': new SyntheticModule(['invalidarCacheEmpresas'], function () { this.setExport('invalidarCacheEmpresas', () => { invalidacoesEmpresas++; }); }),
    '../utils/registroTreinamento': new SourceTextModule(transpilar('../src/utils/registroTreinamento.ts')),
  };
  await modulos['../utils/registroTreinamento'].link(() => { throw Error('Import inesperado na regra de suspensão'); });
  const servico = new SourceTextModule(transpilar('../src/services/ocorrencias.ts'));
  await servico.link((nome) => {
    if (!modulos[nome]) throw Error(`Import inesperado: ${nome}`);
    return modulos[nome];
  });
  await servico.evaluate();
  return { colecoes, servico: servico.namespace, invalidacoes: () => invalidacoesEmpresas };
}

const informativa = { tipo: 'Informativa', empresa: 'Altotrak', descricao: 'Cliente cancelou o contrato', departamento: 'Treinamento', responsavel: 'Pedro' };

test('cancelar pela Informativa grava ocorrência e cliente cancelado juntos, encerrando a suspensão', async () => {
  const { colecoes, servico, invalidacoes } = await criarServico({
    altotrak: { nomeEmpresa: 'Altotrak', isSuspended: true, dataSuspensao: '2026-10-01', diasSuspensoAcumulado: 2 },
  });
  const resultado = await servico.salvarOcorrencia({ ...informativa, cancelarCliente: true }, {
    empresaId: 'altotrak',
    cancelamentoCliente: {
      empresaId: 'altotrak',
      encerrarSuspensao: { diasSuspensoAcumulado: 12, suspensaoEncerradaEm: 1_000 },
    },
  });

  assert.equal(resultado.cancelamentoAplicado, true);
  assert.equal(colecoes.ocorrencias.get(resultado.id).cancelarCliente, true);
  const cliente = colecoes.empresas.get('altotrak');
  assert.equal(cliente.isCancelled, true);
  assert.equal(cliente.isSuspended, false);
  assert.equal(cliente.dataSuspensao, '');
  assert.equal(cliente.diasSuspensoAcumulado, 12);
  assert.equal(cliente.suspensaoEncerradaEm, 1_000);
  assert.equal(invalidacoes(), 1);
});

test('cliente já cancelado não é regravado e continua cancelado', async () => {
  const { colecoes, servico } = await criarServico({
    altotrak: { nomeEmpresa: 'Altotrak', isCancelled: true, updatedAt: 5 },
  });
  const repetido = await servico.salvarOcorrencia({ ...informativa, cancelarCliente: true }, {
    cancelamentoCliente: { empresaId: 'altotrak' },
  });
  assert.equal(repetido.cancelamentoAplicado, false);
  assert.equal(colecoes.empresas.get('altotrak').updatedAt, 5);
  assert.equal(colecoes.empresas.get('altotrak').isCancelled, true);
});

test('cadastro de outro cliente ou tipo diferente de Informativa não grava nada', async () => {
  const { colecoes, servico } = await criarServico({ outro: { nomeEmpresa: 'Outro cliente' } });
  await assert.rejects(
    servico.salvarOcorrencia({ ...informativa, cancelarCliente: true }, {
      cancelamentoCliente: { empresaId: 'outro' },
    }),
    /não corresponde ao cadastro/,
  );
  await assert.rejects(
    servico.salvarOcorrencia({ ...informativa, tipo: 'Dúvida' }, {
      cancelamentoCliente: { empresaId: 'outro' },
    }),
    /exige uma ocorrência Informativa/,
  );
  assert.equal(colecoes.ocorrencias.size, 0);
  assert.equal(colecoes.empresas.get('outro').isCancelled, undefined);
});

test('conclusão unilateral também tira o cliente dos Suspensos na mesma transação', async () => {
  const { colecoes, servico } = await criarServico({
    altotrak: { nomeEmpresa: 'Altotrak', temaText: 'Início\nRotas\nRelatórios', currentPhase: 1, isSuspended: true, dataSuspensao: '2026-10-01' },
  });
  await servico.salvarOcorrencia({ ...informativa, conclusaoUnilateralCapacitacao: true }, {
    concluirEsteiraUnilateralmente: {
      empresaId: 'altotrak', dataFinalizacao: '2026-11-12',
      encerrarSuspensao: { diasSuspensoAcumulado: 42, suspensaoEncerradaEm: 2_000 },
    },
  });
  const cliente = colecoes.empresas.get('altotrak');
  assert.equal(cliente.conclusaoUnilateralCapacitacao, true);
  assert.equal(cliente.isSuspended, false);
  assert.equal(cliente.diasSuspensoAcumulado, 42);
  assert.equal(cliente.suspensaoEncerradaEm, 2_000);
});
