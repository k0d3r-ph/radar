import test from 'node:test';
import assert from 'node:assert/strict';
import { GerenciarValidacaoConhecimento } from '../dist/application/use-cases/GerenciarValidacaoConhecimento.js';
import { ValidacaoConhecimentoController } from '../dist/adapters/controllers/ValidacaoConhecimentoController.js';
import { montarQuestoes, calcularResultadoValidacao, identificarConteudoAvaliacao, SECOES } from '../dist/domain/validacaoConhecimento.js';
import { PERGUNTAS_INICIAIS } from '../dist/domain/perguntasConhecimento.js';
import { registrarCsat } from '../dist/infrastructure/web/csat.js';
import { firestoreMemoria } from './helpers/firestoreMemoria.mjs';

const usuario = { uid: 'u1', nome: 'Treinador', role: 'treinador' };
function setup() {
  const memoria = firestoreMemoria([
    ['usuarios/u1', { nome: 'Treinador', role: 'treinador' }], ['usuarios/master', { nome: 'Master', role: 'master' }],
    ['usuarios/suporte', { role: 'suporte' }], ['usuarios/inativo', { role: 'master', inativo: true }],
    ['empresas/e1', { nomeEmpresa: 'Cliente', idNumeric: 1, responsavel: 'Treinador', temaText: 'Início\nTela Operacional\nValidação do conhecimento', dataText: '01/10\n02/10\n', currentPhase: 1 }],
  ]);
  return { ...memoria, repo: new GerenciarValidacaoConhecimento(memoria.db) };
}
const concluir = async (repo, t, corretas) => {
  const salva = await repo.salvar(t.id, { ...t, treinamentoTempoAgenda: '01:00', treinamentoSolicitante: 'Cliente', questoes: t.questoes.map((q, i) => ({ ...q, resposta: i < corretas ? 'correto' : 'parcial' })) }, usuario);
  return repo.concluir(t.id, salva.revisao, usuario);
};
test('distribuição por módulos: 0, 1, 2, 4 e mais módulos; básicas priorizam preferidas', () => {
  const avancadas = SECOES.filter(s => s !== 'Temas iniciais' && !s.startsWith('Manutenção'));
  for (const modulos of [0, 1, 2, 4, 7]) {
    const secoes = ['Temas iniciais', ...avancadas.slice(0, modulos)];
    const { questoes, avisos } = montarQuestoes(PERGUNTAS_INICIAIS, secoes, [], () => .5);
    assert.equal(questoes.length, Math.max(10, 4 + 2 * modulos));
    assert.equal(questoes.filter(q => q.secao === 'Temas iniciais').length, Math.max(4, 10 - 2 * modulos));
    assert.ok(questoes.filter(q => q.secao === 'Temas iniciais').every(q => q.preferida));
    secoes.slice(1).forEach(s => assert.equal(questoes.filter(q => q.secao === s).length, 2));
    assert.equal(avisos.length, 0); assert.equal(new Set(questoes.map(q => q.id)).size, questoes.length);
  }
});
test('avaliação básica seleciona as dez preferidas antes das demais, independentemente do sorteio', () => {
  const preferidas = PERGUNTAS_INICIAIS.filter(q => q.secao === 'Temas iniciais' && q.preferida).map(q => q.id).sort();
  for (const sorteio of [0, .5, .999]) {
    const { questoes } = montarQuestoes(PERGUNTAS_INICIAIS, ['Temas iniciais'], [], () => sorteio);
    assert.deepEqual(questoes.map(q => q.id).sort(), preferidas);
  }
});
test('básico completa com não preferidas quando faltam preferidas, mantendo-as primeiro', () => {
  const banco = PERGUNTAS_INICIAIS.filter(q => q.secao === 'Temas iniciais');
  const preferidas = banco.filter(q => q.preferida).slice(0, 3);
  const disponiveis = [...banco.filter(q => !q.preferida), ...preferidas];
  const { questoes, avisos } = montarQuestoes(disponiveis, ['Temas iniciais'], [], () => .999);
  assert.equal(questoes.length, 10);
  assert.equal(avisos.length, 0);
  assert.deepEqual(questoes.slice(0, 3).map(q => q.id).sort(), preferidas.map(q => q.id).sort());
  assert.ok(questoes.slice(3).every(q => !q.preferida));
});
test('nova tentativa preserva reforços e prioriza preferidas elegíveis sem repetir acertos', () => {
  const banco = PERGUNTAS_INICIAIS.filter(q => q.secao === 'Temas iniciais');
  const preferidas = banco.filter(q => q.preferida);
  const reforco = banco.find(q => !q.preferida);
  const anterior = { questoes: [
    { ...preferidas[0], resposta: 'correto', origem: 'banco' },
    { ...reforco, resposta: 'parcial', origem: 'banco' },
  ] };
  const { questoes } = montarQuestoes(banco, ['Temas iniciais'], [anterior], () => .999);
  assert.equal(questoes.length, 10);
  assert.equal(questoes[0].id, reforco.id);
  assert.equal(questoes[0].origem, 'mantida');
  assert.equal(questoes[0].resposta, null);
  assert.ok(questoes.slice(1).every(q => q.preferida));
  assert.equal(questoes.some(q => q.id === preferidas[0].id), false);
});
test('Manutenção genérica usa nível escolhido e inclui Performance mesmo depois da fase atual', () => {
  const empresa = { temaText: 'Início\nManutenção\nPerformance\nValidação do conhecimento', currentPhase: 1 };
  assert.deepEqual(identificarConteudoAvaliacao(empresa, [], 'avancada'), { secoes: ['Temas iniciais', 'Performance', 'Manutenção avançada'], manutencaoIndefinida: true });
  assert.deepEqual(identificarConteudoAvaliacao(empresa, [], 'basica').secoes, ['Temas iniciais', 'Performance', 'Manutenção básica']);
  const selecao = montarQuestoes(PERGUNTAS_INICIAIS, ['Temas iniciais', 'Manutenção básica']);
  assert.equal(selecao.questoes.length, 10); assert.match(selecao.avisos[0], /Manutenção básica/);
  assert.equal(selecao.questoes.filter(q => q.secao === 'Temas iniciais').length, 9);
});
test('todos os módulos avançados cadastrados na esteira habilitam perguntas, independentemente da fase', () => {
  for (const secao of SECOES.filter(s => s !== 'Temas iniciais')) {
    const empresa = { temaText: `Início\n\n  ${secao.toUpperCase()}  \nValidação do conhecimento`, currentPhase: -1 };
    const conteudo = identificarConteudoAvaliacao(empresa, [], secao === 'Manutenção avançada' ? 'basica' : 'avancada');
    assert.deepEqual(conteudo, { secoes: ['Temas iniciais', secao], manutencaoIndefinida: false });
    const { questoes } = montarQuestoes(PERGUNTAS_INICIAIS, conteudo.secoes);
    assert.equal(questoes.filter(q => q.secao === secao).length, Math.min(2, PERGUNTAS_INICIAIS.filter(q => q.secao === secao).length));
    assert.equal(questoes.some(q => q.secao !== 'Temas iniciais' && q.secao !== secao), false);
  }
});
test('níveis explícitos de Manutenção são automáticos; ocorrências de Treinamento também habilitam módulos', () => {
  const empresa = { temaText: 'Início\nMANUTENCAO AVANCADA\nPerformance\nPerformance' };
  assert.deepEqual(identificarConteudoAvaliacao(empresa, [
    { tipo: 'Treinamento', temaOcorrencia: ['Abastecimento'], temasRevisados: ['Onboard'] },
    { tipo: 'Informativa', temaOcorrencia: ['Logistics'] },
  ], 'basica'), { secoes: ['Temas iniciais', 'Performance', 'Onboard', 'Abastecimento', 'Manutenção avançada'], manutencaoIndefinida: false });
  assert.deepEqual(identificarConteudoAvaliacao({ temaText: 'Manutenção básica\nManutenção avançada' }, [], 'basica'), {
    secoes: ['Temas iniciais', 'Manutenção básica', 'Manutenção avançada'], manutencaoIndefinida: false,
  });
  assert.deepEqual(identificarConteudoAvaliacao({}, [], 'avancada'), { secoes: ['Temas iniciais'], manutencaoIndefinida: false });
});
test('gerar novamente consulta a esteira atual e inclui Manutenção avançada, Performance, Abastecimento e Onboard', async () => {
  const { repo, data } = setup();
  const inicial = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
  assert.deepEqual(inicial.secoes, ['Temas iniciais']);
  await repo.cancelar(inicial.id, inicial.revisao, usuario);
  const empresa = data.get('empresas/e1');
  empresa.temaText = 'Início\nManutenção Avançada\nPerformance\nAbastecimento\nOnboard\nValidação do conhecimento';
  empresa.currentPhase = 0;
  const nova = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
  assert.deepEqual(new Set(nova.secoes), new Set(['Temas iniciais', 'Manutenção avançada', 'Performance', 'Abastecimento', 'Onboard']));
  assert.equal(nova.questoes.length, 12);
  assert.equal(nova.questoes.filter(q => q.secao === 'Temas iniciais').length, 5);
  assert.ok(nova.questoes.filter(q => q.secao === 'Temas iniciais').every(q => q.preferida));
  for (const secao of ['Performance', 'Abastecimento', 'Onboard']) assert.equal(nova.questoes.filter(q => q.secao === secao).length, 2);
  assert.equal(nova.questoes.filter(q => q.secao === 'Manutenção avançada').length, 1);
  assert.equal(nova.questoes.some(q => q.secao === 'Manutenção básica'), false);
  assert.match(nova.avisos.join(' '), /Manutenção avançada: perguntas elegíveis insuficientes/);
  assert.equal(empresa.currentPhase, 0);
  await repo.salvar(nova.id, nova, usuario);
});
test('Performance e Manutenção avançada completam dez perguntas com sete iniciais, priorizando preferidas', () => {
  const { questoes, avisos } = montarQuestoes(PERGUNTAS_INICIAIS, ['Temas iniciais', 'Performance', 'Manutenção avançada']);
  assert.equal(questoes.length, 10);
  assert.equal(questoes.filter(q => q.secao === 'Performance').length, 2);
  assert.equal(questoes.filter(q => q.secao === 'Manutenção avançada').length, 1);
  const iniciais = questoes.filter(q => q.secao === 'Temas iniciais');
  assert.equal(iniciais.length, 7);
  assert.ok(iniciais.every(q => q.preferida));
  assert.equal(new Set(questoes.map(q => q.id)).size, 10);
  assert.ok(avisos.some(a => a.includes('temas iniciais para completar')));
});
test('complementação de nova tentativa não repete acertos nem textos duplicados e preserva reforços', () => {
  const banco = PERGUNTAS_INICIAIS.filter(q => q.secao === 'Temas iniciais' || q.secao === 'Performance' || q.secao === 'Manutenção avançada');
  const corretas = banco.filter(q => q.preferida);
  const reforco = banco.find(q => q.secao === 'Manutenção avançada');
  const anterior = { questoes: [...corretas.map(q => ({ ...q, resposta: 'correto' })), { ...reforco, resposta: 'parcial' }] };
  const duplicada = { ...corretas[0], id: 'outro-id', texto: `  ${corretas[0].texto.toUpperCase()} ` };
  const { questoes } = montarQuestoes([...banco, duplicada], ['Temas iniciais', 'Performance', 'Manutenção avançada'], [anterior]);
  assert.equal(questoes.length, 10);
  assert.equal(questoes[0].id, reforco.id);
  assert.equal(questoes[0].origem, 'mantida');
  assert.equal(questoes[0].resposta, null);
  assert.equal(questoes.filter(q => q.secao === 'Temas iniciais').length, 7);
  assert.ok(questoes.filter(q => q.secao === 'Temas iniciais').every(q => !q.preferida));
  assert.equal(questoes.some(q => q.id === duplicada.id || corretas.some(c => c.id === q.id)), false);
});
test('banco insuficiente informa a quantidade real sem duplicar perguntas para completar', () => {
  const banco = PERGUNTAS_INICIAIS.filter(q => q.secao === 'Manutenção avançada');
  const { questoes, avisos } = montarQuestoes(banco, ['Temas iniciais', 'Performance', 'Manutenção avançada']);
  assert.equal(questoes.length, 1);
  assert.ok(avisos.some(a => a.includes('1 de 10 perguntas previstas')));
});
test('nota usa unidades exatas, respostas parciais e aprovação inclusiva em 80%', () => {
  for (const n of [3, 10, 12, 17]) assert.equal(calcularResultadoValidacao(Array.from({ length: n }, () => ({ resposta: 'correto' }))).nota, 10);
  const questoes = Array.from({ length: 10 }, (_, i) => ({ resposta: i < 6 ? 'correto' : 'parcial' }));
  assert.deepEqual(calcularResultadoValidacao(questoes), { nota: 8, percentual: 80, aprovada: true });
  questoes[0].resposta = 'incorreto'; assert.equal(calcularResultadoValidacao(questoes).aprovada, false);
  assert.throws(() => calcularResultadoValidacao([{ resposta: null }]));
});
test('banco inicial idempotente e cadastro restrito a Master com deduplicação', async () => {
  const { repo, data } = setup();
  const banco = await repo.perguntas(); assert.equal(banco.length, 39);
  assert.equal(banco.filter(q => q.preferida).length, 10);
  await new GerenciarValidacaoConhecimento(repo.db).perguntas(); assert.equal([...data.keys()].filter(k => k.startsWith('validacao_perguntas/')).length, 39);
  await assert.rejects(repo.adicionarPergunta({ secao: 'Temas iniciais', texto: 'Nova pergunta' }, usuario), /Somente Master/);
  const master = { ...usuario, role: 'master' };
  await repo.adicionarPergunta({ secao: 'Temas iniciais', texto: 'Nova pergunta' }, master);
  await assert.rejects(repo.adicionarPergunta({ secao: 'Temas iniciais', texto: ' NOVA  PERGUNTA ' }, master), /já existe/);
});
test('início concorrente não duplica; pausa/retomada preserva respostas e revisão evita sobrescrita', async () => {
  const { repo } = setup();
  const resultados = await Promise.allSettled([repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario), repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario)]);
  assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1);
  const t = resultados.find(r => r.status === 'fulfilled').value;
  t.questoes[0].resposta = 'parcial';
  const pausada = await repo.salvar(t.id, { ...t, status: 'pausada' }, usuario);
  assert.equal(pausada.questoes[0].resposta, 'parcial');
  await assert.rejects(repo.salvar(t.id, t, usuario), /outra aba/);
  const retomada = await repo.salvar(t.id, { ...pausada, status: 'andamento' }, usuario);
  assert.equal(retomada.questoes[0].resposta, 'parcial');
  const vazia = await repo.salvar(t.id, { ...retomada, questoes: [], status: 'pausada' }, usuario);
  assert.deepEqual(vazia.questoes, []);
  const reconstruida = await repo.salvar(t.id, { ...vazia, questoes: retomada.questoes, status: 'andamento' }, usuario);
  assert.equal(reconstruida.questoes[0].resposta, 'parcial');
});
test('reprovação não avança; nova tentativa mantém erros/parciais e exclui acertos de todo o histórico', async () => {
  const { repo, data } = setup();
  const inicial = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
  const reprovada = await concluir(repo, inicial, 4); // 4 corretas + 6 parciais = 70%
  assert.equal(reprovada.aprovada, false); assert.equal(data.get('empresas/e1').currentPhase, 1);
  assert.equal(data.get('empresas/e1').dataFinalizacao, undefined);
  const nova = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica', anteriorId: reprovada.id }, usuario);
  assert.equal(nova.questoes.length, 10); assert.equal(nova.questoes.filter(q => q.origem === 'mantida').length, 6);
  reprovada.questoes.filter(q => q.resposta === 'correto').forEach(q => assert.equal(nova.questoes.some(item => item.id === q.id), false));
  assert.deepEqual(data.get(`validacao_tentativas/${inicial.id}`), reprovada);
  const aprovada = await concluir(repo, nova, 6); // exatamente 80%
  assert.equal(aprovada.aprovada, true); assert.equal(data.get('empresas/e1').currentPhase, 2);
  assert.ok(data.get('empresas/e1').dataFinalizacao);
  assert.equal([...data.keys()].filter(k => k.startsWith('ocorrencias/')).length, 2);
  await assert.rejects(repo.iniciar({ empresaId: 'e1', manutencao: 'basica', anteriorId: aprovada.id }, usuario), /sem aprovação/);
});
test('cancelar avaliação em andamento ou pausada exclui formulário e respostas sem consumir tentativa', async () => {
  for (const status of ['andamento', 'pausada']) {
    const { repo, data } = setup();
    const inicial = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
    const questoes = inicial.questoes.map(q => ({ ...q, resposta: 'correto' }));
    const salva = await repo.salvar(inicial.id, { ...inicial, questoes, status }, usuario);
    const empresaAntes = structuredClone(data.get('empresas/e1'));
    const cancelada = await repo.cancelar(salva.id, salva.revisao, usuario);
    assert.deepEqual(cancelada, { id: salva.id });
    assert.equal(data.has(`validacao_tentativas/${salva.id}`), false);
    assert.deepEqual(await repo.listar('e1'), []);
    const descarte = data.get(`validacao_controle/descarte-${salva.id}`);
    assert.equal(descarte.treinadorId, usuario.uid);
    assert.equal(descarte.canceladaPorId, usuario.uid);
    assert.ok(descarte.canceladaEm);
    assert.deepEqual(Object.keys(descarte).sort(), ['canceladaEm', 'canceladaPorId', 'treinadorId']);
    assert.equal(data.get('validacao_clientes/e1').ativaId, null);
    assert.deepEqual(data.get('empresas/e1'), empresaAntes);
    assert.equal([...data.keys()].some(k => /^(ocorrencias|gamificacao_pontos|csatReservas|csatLinks|csatControle)\//.test(k)), false);
    await assert.rejects(repo.salvar(salva.id, salva, usuario), /não encontrada/);
    await assert.rejects(repo.concluir(salva.id, salva.revisao, usuario), /não encontrada/);
    const nova = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
    assert.equal(nova.numero, 1);
    assert.equal(nova.anteriorId, null);
    assert.ok(nova.questoes.every(q => q.resposta === null && q.origem === 'banco'));
    assert.deepEqual(new Set(nova.questoes.map(q => q.id)), new Set(salva.questoes.map(q => q.id)));
    assert.equal(data.get('validacao_clientes/e1').ativaId, nova.id);
    assert.deepEqual(await repo.cancelar(cancelada.id, salva.revisao, usuario), cancelada);
    await assert.rejects(repo.cancelar(cancelada.id, salva.revisao, { ...usuario, uid: 'outro' }), /responsável/);
    assert.equal(data.get('validacao_clientes/e1').ativaId, nova.id);
    await assert.rejects(repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario), /já possui/);
  }
});
test('cancelamento valida responsável e revisão; Master pode cancelar e avaliação concluída não pode', async () => {
  const { repo, data } = setup();
  const t = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
  await assert.rejects(repo.cancelar(t.id, t.revisao, { ...usuario, uid: 'outro' }), /responsável/);
  const salva = await repo.salvar(t.id, { ...t, status: 'pausada' }, usuario);
  await assert.rejects(repo.cancelar(t.id, t.revisao, usuario), /outra aba/);
  assert.equal(data.get('validacao_clientes/e1').ativaId, t.id);
  const cancelada = await repo.cancelar(t.id, salva.revisao, { uid: 'master', nome: 'Master', role: 'master' });
  assert.equal(data.get(`validacao_controle/descarte-${cancelada.id}`).canceladaPorId, 'master');
  assert.deepEqual(await repo.cancelar(cancelada.id, salva.revisao, usuario), cancelada);
  const nova = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
  const concluida = await concluir(repo, nova, 10);
  await assert.rejects(repo.cancelar(concluida.id, concluida.revisao, usuario), /concluída não pode/);
  assert.equal(data.get(`validacao_tentativas/${nova.id}`).status, 'concluida');
});
test('regenerar após cancelamento usa apenas avaliações concluídas para reforços e acertos anteriores', async () => {
  const { repo } = setup();
  const inicial = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
  const reprovada = await concluir(repo, inicial, 4);
  const segunda = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica', anteriorId: reprovada.id }, usuario);
  const salva = await repo.salvar(segunda.id, { ...segunda, questoes: segunda.questoes.map(q => ({ ...q, resposta: 'correto' })) }, usuario);
  await repo.cancelar(salva.id, salva.revisao, usuario);
  await assert.rejects(repo.iniciar({ empresaId: 'e1', manutencao: 'basica', anteriorId: salva.id }, usuario), /última avaliação/);
  const nova = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica', anteriorId: reprovada.id }, usuario);
  assert.equal(nova.numero, 2);
  assert.equal(nova.anteriorId, reprovada.id);
  const reforcos = reprovada.questoes.filter(q => q.resposta !== 'correto');
  assert.deepEqual(nova.questoes.filter(q => q.origem === 'mantida').map(q => q.id), reforcos.map(q => q.id));
  reprovada.questoes.filter(q => q.resposta === 'correto').forEach(q => assert.equal(nova.questoes.some(item => item.id === q.id), false));
});
test('canceladas antigas somem da listagem e não consomem numeração, sem reescrever tentativas concluídas', async () => {
  const { repo, data } = setup();
  const inicial = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
  data.set(`validacao_tentativas/${inicial.id}`, { ...inicial, status: 'cancelada' });
  data.set('validacao_clientes/e1', { ativaId: null });
  assert.deepEqual(await repo.listar('e1'), []);
  const nova = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
  assert.equal(nova.numero, 1);
  const reprovada = await concluir(repo, nova, 4);
  // Uma avaliação concluída antiga pode ter número maior por cancelamentos anteriores.
  data.set(`validacao_tentativas/${reprovada.id}`, { ...reprovada, numero: 3 });
  data.set('validacao_tentativas/legada', { ...inicial, id: 'legada', numero: 7, status: 'cancelada' });
  const seguinte = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica', anteriorId: reprovada.id }, usuario);
  assert.equal(seguinte.numero, 4);
  assert.deepEqual((await repo.listar('e1')).map(t => t.numero), [4, 3]);
  assert.equal(data.get(`validacao_tentativas/${reprovada.id}`).numero, 3);
});

test('duplo cancelamento e geração concorrente preservam a nova avaliação com o mesmo número', async () => {
  const { repo, data } = setup();
  const t = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
  const [cancelada, nova, repetida] = await Promise.all([
    repo.cancelar(t.id, t.revisao, usuario),
    repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario),
    repo.cancelar(t.id, t.revisao, usuario),
  ]);
  assert.deepEqual(cancelada, repetida);
  assert.equal(nova.numero, 1);
  assert.equal(data.get('validacao_clientes/e1').ativaId, nova.id);
  assert.deepEqual((await repo.listar('e1')).map(t => t.id), [nova.id]);
});

test('cancelamento concorrente com conclusão tem apenas um vencedor e não deixa gravações parciais', async () => {
  for (const cancelarPrimeiro of [true, false]) {
    const { repo, data } = setup();
    const t = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
    const salva = await repo.salvar(t.id, { ...t, treinamentoTempoAgenda: '01:00', questoes: t.questoes.map(q => ({ ...q, resposta: 'correto' })) }, usuario);
    const acoes = [() => repo.cancelar(t.id, salva.revisao, usuario), () => repo.concluir(t.id, salva.revisao, usuario)];
    if (!cancelarPrimeiro) acoes.reverse();
    const resultados = await Promise.allSettled(acoes.map(acao => acao()));
    assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1);
    const tentativa = data.get(`validacao_tentativas/${t.id}`);
    assert.equal(tentativa?.status, cancelarPrimeiro ? undefined : 'concluida');
    assert.equal(data.has(`validacao_controle/descarte-${t.id}`), cancelarPrimeiro);
    assert.equal(data.has(`ocorrencias/${t.id}`), !cancelarPrimeiro);
    assert.equal(data.has(`gamificacao_pontos/${t.id}`), !cancelarPrimeiro);
    assert.equal(data.get('validacao_clientes/e1').ativaId, null);
  }
});
test('conclusão é atômica/idempotente e CSAT público atualiza tentativa, ocorrência e ponto certos', async () => {
  const { repo, data, db } = setup();
  const t = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
  const finalizada = await concluir(repo, t, 10);
  const repetida = await repo.concluir(t.id, 1, usuario);
  assert.equal(repetida.csatToken, finalizada.csatToken);
  assert.equal([...data.keys()].filter(k => k.startsWith('ocorrencias/')).length, 1);
  assert.equal([...data.keys()].filter(k => k.startsWith('gamificacao_pontos/')).length, 1);
  const rotas = new Map();
  registrarCsat({ post: (p, fn) => rotas.set(p, fn), get() {} }, db, { verifyIdToken: async () => ({ uid: 'master' }) });
  let status = 200;
  const res = { set() {}, status(n) { status = n; return this; }, json() {} };
  const req = { params: { token: finalizada.csatToken }, body: { nome: 'Ana', experiencia: 'Bom', opiniao: 'Ótimo', responseId: '12345678-12345678' } };
  await rotas.get('/api/csat/publico/:token')(req, res); assert.equal(status, 200);
  await rotas.get('/api/csat/publico/:token')(req, res); assert.equal(status, 200);
  assert.equal(data.get(`validacao_tentativas/${t.id}`).csatRespostas.length, 1);
  assert.equal(data.get(`ocorrencias/${t.id}`).csatRespostas.length, 1);
  assert.deepEqual(data.get(`gamificacao_pontos/${t.id}`).treinamentoResultados, ['Bom']);
});
test('descrição registra perguntas, respostas e notas com resultado inclusivo em 80%, sem expor link CSAT', async () => {
  for (const cenario of [
    { corretas: 10, parciais: 0, nota: '10', percentual: '100', resultado: 'Aprovado — atingiu o mínimo de 80%.' },
    { corretas: 6, parciais: 4, nota: '8', percentual: '80', resultado: 'Aprovado — atingiu o mínimo de 80%.' },
    { corretas: 5, parciais: 4, nota: '7', percentual: '70', resultado: 'Não aprovado — não atingiu o mínimo de 80%. Nova tentativa disponível.' },
  ]) {
    const { repo, data } = setup();
    const t = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
    const questoes = t.questoes.map((q, i) => ({ ...q,
      texto: i === 0 ? 'Pergunta personalizada usada nesta agenda?' : q.texto,
      resposta: i < cenario.corretas ? 'correto' : i < cenario.corretas + cenario.parciais ? 'parcial' : 'incorreto',
    }));
    const salva = await repo.salvar(t.id, { ...t, questoes, treinamentoTempoAgenda: '01:00', treinamentoSolicitante: 'Cliente' }, usuario);
    const finalizada = await repo.concluir(t.id, salva.revisao, usuario);
    const ocorrencia = data.get(`ocorrencias/${t.id}`);
    const descricao = ocorrencia.descricao;
    assert.ok(descricao.startsWith('Validação do conhecimento — tentativa 1\n'));
    assert.ok(descricao.includes(`Pontuação total: ${cenario.nota}/10\nAproveitamento: ${cenario.percentual}%\nResultado: ${cenario.resultado}`));
    const rotulos = { correto: 'Correto', parcial: 'Parcial', incorreto: 'Incorreto' };
    const pontos = { correto: '1', parcial: '0,5', incorreto: '0' };
    questoes.forEach((q, i) => assert.ok(descricao.includes(`${i + 1}. ${q.texto} (${q.secao})\nResposta: ${rotulos[q.resposta]}\nPontuação: ${pontos[q.resposta]}/1`)));
    assert.equal((descricao.match(/\nResposta:/g) || []).length, questoes.length);
    assert.doesNotMatch(descricao, /CSAT|\/csat\//i);
    assert.equal(descricao.includes(finalizada.csatToken), false);
    // O token do CSAT fica só na tentativa (acessível pela API), não na ocorrência.
    assert.equal('csatLinkPath' in ocorrencia, false);
    assert.equal(data.get(`gamificacao_pontos/${t.id}`).descricao, descricao);
    await repo.concluir(t.id, salva.revisao, usuario);
    assert.equal(data.get(`ocorrencias/${t.id}`).descricao, descricao);
  }
});
test('suspensão, proprietário, campos inválidos e perguntas duplicadas são conferidos no servidor', async () => {
  const { repo, data } = setup();
  const t = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
  await assert.rejects(repo.salvar(t.id, t, { ...usuario, uid: 'outro' }), /responsável/);
  await assert.rejects(repo.salvar(t.id, { ...t, questoes: [t.questoes[0], t.questoes[0]] }, usuario), /repetir/);
  data.get('empresas/e1').isSuspended = true;
  await assert.rejects(concluir(repo, t, 10), /cliente suspenso/);
  assert.equal([...data.keys()].some(k => k.startsWith('ocorrencias/')), false);
  assert.equal(data.get('empresas/e1').currentPhase, 1);
});
test('API rejeita suporte, usuário inativo e token inválido', async () => {
  const { db, data } = setup();
  const controller = new ValidacaoConhecimentoController(db, { verifyIdToken: async token => { if (!data.has(`usuarios/${token}`)) throw Error(); return { uid: token }; } });
  for (const [uid, esperado] of [['suporte', 403], ['inativo', 403], ['desconhecido', 401]]) {
    for (const acao of ['perguntas', 'cancelar']) {
      let status = 200; const res = { set() {}, status(n) { status = n; return this; }, json() {} };
      await controller.executar(acao)({ headers: { authorization: `Bearer ${uid}` }, body: {}, params: { id: 'qualquer' } }, res);
      assert.equal(status, esperado);
    }
  }
});

test('aprovar antes dos demais temas não salta a esteira; linhas vazias preservam alinhamento das datas', async () => {
  const { repo, data } = setup();
  data.get('empresas/e1').currentPhase = 0;
  const t = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
  await concluir(repo, t, 10);
  assert.equal(data.get('empresas/e1').currentPhase, 0);
  assert.equal(data.get('empresas/e1').dataFinalizacao, undefined);
  const outro = setup();
  outro.data.get('empresas/e1').temaText = 'Início\nTela Operacional\n\nValidação do conhecimento';
  outro.data.get('empresas/e1').dataText = '01/10\n02/10\n\n';
  const b = await outro.repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
  const final = await concluir(outro.repo, b, 10);
  assert.equal(final.concluiuEsteira, true);
  assert.equal(outro.data.get('empresas/e1').temaText.split('\n').length, 3);
  assert.equal(outro.data.get('empresas/e1').dataText.split('\n')[1], '02/10');
  assert.ok(outro.data.get('empresas/e1').dataText.split('\n')[2]);
});

test('CSAT pendente impede conclusão e falha não grava parcialmente avaliação, ponto ou fase', async () => {
  const { repo, data } = setup();
  const t = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
  data.set('csatReservas/pendente', { criadoPor: usuario.uid, empresaId: 'e1', empresa: 'Cliente', idSeqFormatted: '#101', createdAt: Date.now(), status: 'reservada' });
  await assert.rejects(concluir(repo, t, 10), /Registre a ocorrência .* no Histórico antes de concluir a validação/);
  assert.equal(data.get(`validacao_tentativas/${t.id}`).status, 'andamento');
  assert.equal(data.get('empresas/e1').currentPhase, 1);
  assert.equal([...data.keys()].filter(k => k.startsWith('gamificacao_pontos/') || k.startsWith('ocorrencias/')).length, 0);
  assert.equal(data.has('csatControle/sequencia'), false);
});

test('nova tentativa preserva nível de Manutenção e seções das perguntas que precisam ser refeitas', async () => {
  const { repo, data } = setup();
  data.set('ocorrencias/manutencao', { empresa: 'Cliente', tipo: 'Treinamento', temaOcorrencia: ['Manutenção'] });
  const t = await repo.iniciar({ empresaId: 'e1', manutencao: 'avancada' }, usuario);
  const reprovada = await concluir(repo, t, 4);
  const nova = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica', anteriorId: reprovada.id }, usuario);
  assert.ok(nova.secoes.includes('Manutenção avançada'));
  assert.equal(nova.secoes.includes('Manutenção básica'), false);
  assert.ok(nova.questoes.some(q => q.secao === 'Manutenção avançada' && q.origem === 'mantida'));
  await repo.salvar(nova.id, nova, usuario);
});
test('solicitante usa as opções padrão das ocorrências de Treinamento', async () => {
  const { repo } = setup();
  const t = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
  assert.equal(t.treinamentoSolicitante, 'CS');
  await assert.rejects(repo.salvar(t.id, { ...t, treinamentoSolicitante: 'Ana' }, usuario), /Selecione quem solicitou/);
  const rascunho = await repo.salvar(t.id, { ...t, treinamentoSolicitante: '' }, usuario);
  assert.equal(rascunho.treinamentoSolicitante, '');
  const respondida = await repo.salvar(t.id, { ...rascunho, treinamentoTempoAgenda: '01:00', questoes: rascunho.questoes.map(q => ({ ...q, resposta: 'correto' })) }, usuario);
  await assert.rejects(repo.concluir(t.id, respondida.revisao, usuario), /solicitante/);
});
test('duração da agenda aceita HH:MM e rascunho vazio; rejeita texto livre, formato incompleto e minutos inválidos', async () => {
  const { repo, data } = setup();
  const t = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
  const vazia = await repo.salvar(t.id, { ...t, status: 'pausada', treinamentoTempoAgenda: '' }, usuario);
  assert.equal(vazia.treinamentoTempoAgenda, '');
  for (const valor of ['duas horas', '0200', '2:00', '02:0', '02:60', '02:000']) {
    await assert.rejects(repo.salvar(t.id, { ...vazia, treinamentoTempoAgenda: valor }, usuario), /duração da agenda em HH:MM/);
    assert.equal(data.get(`validacao_tentativas/${t.id}`).revisao, vazia.revisao);
  }
  const salva = await repo.salvar(t.id, { ...vazia, status: 'andamento', treinamentoTempoAgenda: '02:00', questoes: vazia.questoes.map(q => ({ ...q, resposta: 'correto' })) }, usuario);
  await repo.concluir(t.id, salva.revisao, usuario);
  assert.equal(data.get(`ocorrencias/${t.id}`).treinamentoTempoAgenda, '02:00');
  assert.equal(data.get(`gamificacao_pontos/${t.id}`).treinamentoTempoAgenda, '02:00');
});
test('rascunho antigo com duração inválida precisa ser corrigido antes de concluir', async () => {
  const { repo, data } = setup();
  const t = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
  data.get(`validacao_tentativas/${t.id}`).treinamentoTempoAgenda = 'duas horas';
  await assert.rejects(repo.concluir(t.id, t.revisao, usuario), /duração da agenda em HH:MM/);
  assert.equal(data.has(`ocorrencias/${t.id}`), false);
});
test('aprovação com temas pendentes registra a data da validação sem avançar a fase', async () => {
  const { repo, data } = setup();
  const cliente = data.get('empresas/e1');
  data.set('empresas/e1', { ...cliente, temaText: 'Início\nTela Operacional\nRelatórios\nValidação do conhecimento', dataText: '01/10\n02/10\n\n', currentPhase: 1 });
  const t = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
  const finalizada = await concluir(repo, t, t.questoes.length);
  assert.equal(finalizada.aprovada, true);
  assert.equal(finalizada.concluiuEsteira, false);
  const empresa = data.get('empresas/e1');
  assert.equal(empresa.currentPhase, 1);
  assert.equal(empresa.dataFinalizacao, undefined);
  const datas = empresa.dataText.split('\n');
  assert.equal(datas[2], '');
  assert.match(datas[3], /^\d{2}\/\d{2}$/);

  // Ao registrar o tema pendente pelo Histórico, a âncora final já datada conclui a esteira.
  const { reordenarTemasEnsinados } = await import('../../app/src/utils/reordenarTemasEnsinados.ts');
  const resultado = reordenarTemasEnsinados(empresa.temaText.split('\n'), datas, [2], '20/10');
  assert.equal(resultado.ultimoIndice, 3);
});
test('módulos aceitam sinônimos e consideram todos os temas da esteira', async () => {
  const { identificarConteudoAvaliacao } = await import('../dist/domain/validacaoConhecimento.js');
  const empresa = { temaText: 'Início\nCadastrar Câmeras\nLogística de entregas\nGestão de multas\nJornada do motorista\nValidação do conhecimento' };
  assert.deepEqual(identificarConteudoAvaliacao(empresa, [], 'basica').secoes,
    ['Temas iniciais', 'Logistics', 'Jornada de Trabalho', 'Gestão de Multas', 'Videotelemetria']);
  assert.deepEqual(identificarConteudoAvaliacao({ temaText: 'Início\nRelatórios' }, [], 'basica').secoes, ['Temas iniciais']);
});
test('Master edita e desativa perguntas sem alterar tentativas; perguntas inativas saem da montagem', async () => {
  const { repo } = setup();
  const master = { uid: 'master', nome: 'Master', role: 'master' };
  const [pergunta] = (await repo.perguntas()).filter(q => q.secao === 'Temas iniciais');
  await assert.rejects(repo.atualizarPergunta(pergunta.id, { ativa: false }, usuario), /Somente Master/);
  const outra = (await repo.perguntas()).find(q => q.secao === 'Temas iniciais' && q.id !== pergunta.id);
  await assert.rejects(repo.atualizarPergunta(pergunta.id, { texto: outra.texto }, master), /outra pergunta/);
  const editada = await repo.atualizarPergunta(pergunta.id, { texto: 'Texto corrigido?', preferida: true }, master);
  assert.equal(editada.id, pergunta.id);
  assert.equal(editada.texto, 'Texto corrigido?');
  // O texto original pode voltar a ser cadastrado: o ID antigo já está em uso pela pergunta editada.
  const recadastrada = await repo.adicionarPergunta({ secao: pergunta.secao, texto: pergunta.texto }, master);
  assert.notEqual(recadastrada.id, pergunta.id);

  const banco = await repo.perguntas();
  for (const q of banco.filter(q => q.secao === 'Temas iniciais')) await repo.atualizarPergunta(q.id, { ativa: false }, master);
  const t = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
  assert.equal(t.questoes.length, 0);
  assert.ok(t.avisos.some(a => /Temas iniciais/.test(a)));
});
test('indicadores consideram só tentativas concluídas no período e destacam perguntas com mais erros', async () => {
  const { repo, data } = setup();
  const t1 = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica' }, usuario);
  const reprovada = await concluir(repo, t1, 0);
  const t2 = await repo.iniciar({ empresaId: 'e1', manutencao: 'basica', anteriorId: reprovada.id }, usuario);
  await concluir(repo, t2, t2.questoes.length);
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(Date.now());
  const ind = await repo.indicadores(hoje, hoje);
  assert.equal(ind.tentativasConcluidas, 2);
  assert.equal(ind.clientesAvaliados, 1);
  assert.equal(ind.taxaAprovacao, 50);
  assert.equal(ind.aprovacaoPrimeiraTentativa, 0);
  assert.equal(ind.mediaTentativasAteAprovar, 2);
  assert.equal(ind.porTreinador[0].tentativas, 2);
  // As perguntas mantidas na 2ª tentativa foram respondidas duas vezes (parcial e correto).
  assert.ok(ind.perguntasComMaisErros.every(p => p.respostas >= 2 && p.aproveitamento < 100));
  await assert.rejects(repo.indicadores('2026-02-01', '2026-01-01'), /período válido/);
  assert.equal((await repo.indicadores('2020-01-01', '2020-01-31')).tentativasConcluidas, 0);
  assert.equal(data.size > 0, true);
});
