import assert from 'node:assert/strict';
import test from 'node:test';
import { filtrarEmpresasContatosSuporte, obterCategoriaContatoSuporte } from '../src/utils/contatosSuporte.ts';
import { obterInfoTipoOcorrencia } from '../src/utils/empresaUtils.ts';

test('carteira dos contatos inclui apenas esteira atual e suspensos, conforme as tabelas da Home', () => {
  const empresas = [
    { nomeEmpresa: 'Implantação', isOngoing: false, isCancelled: false },
    { nomeEmpresa: 'Suspensa', isSuspended: true },
    { nomeEmpresa: 'Concluída', dataFinalizacao: '2026-10-20', dataFollowUpFinal: '2026-10-25' },
    { nomeEmpresa: 'Aguardando follow-up', dataFinalizacao: '2026-10-20' },
    { nomeEmpresa: 'Conclusão unilateral', conclusaoUnilateralCapacitacao: true },
    { nomeEmpresa: 'Datas vazias', dataFinalizacao: ' ', dataFollowUpFinal: ' ' },
    { nomeEmpresa: 'Suspensa após conclusão', isSuspended: true, dataFinalizacao: '2026-10-20', dataFollowUpFinal: '2026-10-25' },
    { nomeEmpresa: 'Ongoing suspensa', isOngoing: true, isSuspended: true },
    { nomeEmpresa: 'Suspensa cancelada', isSuspended: true, isCancelled: true },
    { nomeEmpresa: 'Cadastro antigo' },
    { nomeEmpresa: 'Ongoing', isOngoing: true },
    { nomeEmpresa: 'Cancelada', isCancelled: true },
    { nomeEmpresa: 'Ongoing cancelada', isOngoing: true, isCancelled: true },
  ];
  assert.deepEqual(
    filtrarEmpresasContatosSuporte(empresas).map((empresa) => empresa.nomeEmpresa),
    ['Implantação', 'Suspensa', 'Aguardando follow-up', 'Datas vazias', 'Suspensa após conclusão', 'Ongoing suspensa', 'Cadastro antigo'],
  );
});

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
