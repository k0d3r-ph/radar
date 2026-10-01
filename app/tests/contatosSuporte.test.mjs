import assert from 'node:assert/strict';
import test from 'node:test';
import { obterCategoriaContatoSuporte } from '../src/utils/contatosSuporte.ts';
import { obterInfoTipoOcorrencia } from '../src/utils/empresaUtils.ts';

test('contato importado sem tipo aparece nas contagens e tem rótulo legível', () => {
  const contato = { tipo: '', departamento: 'Suporte', origem: 'ssx-desk', ssxDesk: { tags: ['Dúvida'] } };
  assert.equal(obterCategoriaContatoSuporte(contato), 'semClassificacao');
  assert.equal(obterInfoTipoOcorrencia(contato).label, 'Sem classificação');
});

test('classificar manualmente retira do grupo pendente e mantém um único contato', () => {
  const contatos = [{ tipo: '' }, { tipo: 'Dúvida' }, { tipo: 'Problema' }, { tipo: 'Solicitação' }, { tipo: 'Treinamento' }];
  const contar = () => contatos.map(obterCategoriaContatoSuporte).filter(Boolean);
  assert.equal(contar().length, 4);
  assert.equal(contar().filter(c => c === 'semClassificacao').length, 1);
  contatos[0].tipo = 'Problema';
  assert.equal(contar().length, 4);
  assert.equal(contar().filter(c => c === 'semClassificacao').length, 0);
  assert.equal(contar().filter(c => c === 'problemas').length, 2);
});
