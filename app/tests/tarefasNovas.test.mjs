import assert from 'node:assert/strict';
import test from 'node:test';
import { identificarTarefasNovas } from '../src/utils/tarefasChecklist.ts';
import { assinarTarefasVistas, interpretarTarefasVistas, lerTarefasVistas, marcarTarefasVistas } from '../src/services/tarefasVistas.ts';

const tarefa = (id, campos = {}) => ({ id, treinadorId: 'u1', criadoPorId: 'master', concluida: false, ...campos });

test('avisa sobre tarefas do Radar e de outro usuário, sem alertar tarefas próprias, pausadas, concluídas ou excluídas', () => {
  const lista = [tarefa('master'), tarefa('radar', { automatica: true }), tarefa('propria', { criadoPorId: 'u1' }),
    tarefa('outro', { treinadorId: 'u2' }), tarefa('concluida', { concluida: true }), tarefa('suspensa', { pausada: true }), tarefa('excluida', { excluida: true }), tarefa(undefined)];
  assert.deepEqual([...identificarTarefasNovas(lista, 'u1', new Set())], ['master', 'radar']);
  assert.deepEqual([...identificarTarefasNovas(lista, 'u1', new Set(['master']))], ['radar']);
});

test('novos ciclos de uma tarefa automática voltam a avisar; ajustes de prioridade não geram alerta novamente', () => {
  const vistas = new Set(['ciclo1']);
  const lista = [tarefa('ciclo1', { automatica: true, prioridade: 'urgente', updatedAt: 999 }), tarefa('ciclo2', { automatica: true })];
  assert.deepEqual([...identificarTarefasNovas(lista, 'u1', vistas)], ['ciclo2']);
  assert.deepEqual([...identificarTarefasNovas(lista, 'master', vistas)], []);
});

test('registro inválido não quebra a leitura nem aceita itens que não são identificadores', () => {
  for (const valor of ['', 'invalido', '{}', 'null']) assert.equal(interpretarTarefasVistas(valor).size, 0);
  assert.deepEqual([...interpretarTarefasVistas('["a",123,null,"a",""]')], ['a']);
});

function ambiente({ bloquearLeitura = false, bloquearEscrita = false } = {}) {
  const dados = new Map(), alvo = new EventTarget();
  globalThis.window = Object.assign(alvo, { localStorage: {
    getItem: chave => { if (bloquearLeitura) throw Error('Bloqueado'); return dados.get(chave) || null; },
    setItem: (chave, valor) => { if (bloquearEscrita) throw Error('Sem espaço'); dados.set(chave, valor); },
  } });
  return dados;
}

test('leitura persiste por usuário sem alterar o estado de outro responsável e notifica só o assinante correto', () => {
  const dados = ambiente();
  let avisos = 0;
  const cancelar = assinarTarefasVistas('persistencia-u1', () => avisos++);
  marcarTarefasVistas('persistencia-u2', ['outra']);
  assert.equal(avisos, 0);
  marcarTarefasVistas('persistencia-u1', ['master', 'radar']);
  marcarTarefasVistas('persistencia-u1', ['radar']);
  assert.equal(avisos, 1);
  assert.deepEqual([...interpretarTarefasVistas(lerTarefasVistas('persistencia-u1'))], ['master', 'radar']);
  assert.equal(dados.get('radar:tarefas-vistas:v1:persistencia-u1'), '["master","radar"]');
  assert.deepEqual([...interpretarTarefasVistas(lerTarefasVistas('persistencia-u2'))], ['outra']);
  cancelar();
  marcarTarefasVistas('persistencia-u1', ['nova']);
  assert.equal(avisos, 1);
});

test('mudança em outra aba atualiza a leitura e a remoção do listener é efetiva', () => {
  const dados = ambiente();
  let avisos = 0;
  const usuario = 'outra-aba', chave = `radar:tarefas-vistas:v1:${usuario}`;
  const cancelar = assinarTarefasVistas(usuario, () => avisos++);
  assert.equal(lerTarefasVistas(usuario), '');
  dados.set(chave, '["externa"]');
  window.dispatchEvent(Object.assign(new Event('storage'), { key: chave }));
  assert.equal(avisos, 1);
  assert.equal(lerTarefasVistas(usuario), '["externa"]');
  cancelar();
  window.dispatchEvent(Object.assign(new Event('storage'), { key: chave }));
  assert.equal(avisos, 1);
});

test('armazenamento bloqueado ou cheio mantém leitura durante a sessão', () => {
  for (const opcoes of [{ bloquearLeitura: true, bloquearEscrita: true }, { bloquearEscrita: true }]) {
    ambiente(opcoes);
    const usuario = `bloqueado-${opcoes.bloquearLeitura || false}`;
    marcarTarefasVistas(usuario, ['t1']);
    assert.deepEqual([...interpretarTarefasVistas(lerTarefasVistas(usuario))], ['t1']);
  }
});
