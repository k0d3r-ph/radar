import { abrirBancoLocal } from './bancoLocal.js';
import { GerenciarValidacaoConhecimento } from '../src/application/use-cases/GerenciarValidacaoConhecimento.js';
import type { QuestaoValidacao, RespostaValidacao, TentativaValidacao } from '../src/domain/validacaoConhecimento.js';
import { calcularValidacaoPorCliente, minimoPreviaParcial } from '../../app/src/utils/validacaoConhecimentoIndicadores.js';

/**
 * Exemplos para o card "Validação do Conhecimento" do painel de indicadores, mostrando a
 * validação parcial entrando como prévia. Pelo fluxo real (iniciar → salvar → concluir):
 * - A e B: concluídas e aprovadas; C: concluída e reprovada.
 * - D: reprovada na 1ª tentativa e, na 2ª (aberta), validação parcial ≥ 80% → prévia aprovada.
 * - E (andamento) e F (pausada): parcial ≥ 80% → prévias aprovadas.
 * - G: parcial abaixo de 80% → prévia reprovada.
 * - H: avaliação aberta sem parcial → não entra no card.
 * - I: só 3 perguntas com parcial (todas corretas) → abaixo do mínimo padrão de 5, não entra.
 * Só concluídas (regra antiga): 2/4 = 50%. Com as prévias: 5/7 ≈ 71%, 4 pela parcial.
 * Repetir o comando apaga e recria só estes registros (IDs `demo-indicador-validacao-`).
 * Requer `npm run seed:emulador` antes (usa os treinadores seed).
 */

// Banco local fixo (scripts/bancoLocal.ts): nunca grava em produção.
process.env.METADATA_SERVER_DETECTION = 'none';

const ESTEIRA = ['Início', 'Tela Operacional', 'Relatório', 'Performance', 'Validação do conhecimento'];
const PREFIXO = 'demo-indicador-validacao-';
type Cenario = { letra: string; descricao: string; treinador: string };
const CENARIOS: Cenario[] = [
  { letra: 'a', descricao: 'Concluída aprovada', treinador: 'seed-treinador-1' },
  { letra: 'b', descricao: 'Concluída aprovada', treinador: 'seed-treinador-2' },
  { letra: 'c', descricao: 'Concluída reprovada', treinador: 'seed-treinador-3' },
  { letra: 'd', descricao: 'Reprovou e refaz (prévia aprovada)', treinador: 'seed-treinador-1' },
  { letra: 'e', descricao: 'Em andamento (prévia aprovada)', treinador: 'seed-treinador-2' },
  { letra: 'f', descricao: 'Pausada (prévia aprovada)', treinador: 'seed-treinador-3' },
  { letra: 'g', descricao: 'Em andamento (prévia reprovada)', treinador: 'seed-treinador-1' },
  { letra: 'h', descricao: 'Em andamento sem parcial', treinador: 'seed-treinador-2' },
  { letra: 'i', descricao: 'Só 3 perguntas com parcial', treinador: 'seed-treinador-3' },
];

const db = await abrirBancoLocal();
const repo = new GerenciarValidacaoConhecimento(db);

const usuarios = new Map<string, { uid: string; nome: string; role: string }>();
for (const uid of new Set(CENARIOS.map(c => c.treinador))) {
  const doc = await db.doc(`usuarios/${uid}`).get();
  if (!doc.exists) throw new Error(`Usuário ${uid} não encontrado. Rode \`npm run seed:emulador\` antes.`);
  usuarios.set(uid, { uid, nome: String(doc.data()!.nome), role: 'treinador' });
}

// Limpa execuções anteriores destes clientes (tentativas e o que a conclusão grava com o mesmo ID).
for (const { letra } of CENARIOS) {
  const id = PREFIXO + letra;
  const tentativas = await db.collection('validacao_tentativas').where('empresaId', '==', id).get();
  const batch = db.batch();
  for (const t of tentativas.docs) {
    for (const colecao of ['ocorrencias', 'gamificacao_pontos', 'csatReservas']) batch.delete(db.collection(colecao).doc(t.id));
    batch.delete(db.doc(`validacao_controle/descarte-${t.id}`));
    batch.delete(t.ref);
  }
  batch.delete(db.doc(`validacao_clientes/${id}`));
  await batch.commit();
}

const agora = Date.now();
for (const [i, c] of CENARIOS.entries()) {
  await db.doc(`empresas/${PREFIXO}${c.letra}`).set({
    nomeEmpresa: `[Demo Indicador] ${c.letra.toUpperCase()} — ${c.descricao}`, responsavel: usuarios.get(c.treinador)!.nome, tipo: '',
    idNumeric: 910_000 + i, temaText: ESTEIRA.join('\n'), dataText: ['01/10', '08/10', '15/10', '22/10', ''].join('\n'),
    currentPhase: ESTEIRA.length - 2, isSuspended: false, isCancelled: false, isOngoing: false, createdAt: agora, updatedAt: agora,
  });
}

/** `n` primeiras corretas e as demais com `resto`. */
const marcar = (n: number, resto: RespostaValidacao) => (_: unknown, i: number): RespostaValidacao => (i < n ? 'correto' : resto);
const aplicar = (questoes: QuestaoValidacao[], final: ((q: unknown, i: number) => RespostaValidacao) | null, parcial: ((q: unknown, i: number) => RespostaValidacao) | null, parciaisMarcadas = 5) =>
  questoes.map((q, i) => ({ ...q, resposta: final ? final(q, i) : null, respostaParcial: parcial && i < parciaisMarcadas ? parcial(q, i) : null }));

async function concluir(empresaId: string, uid: string, final: (q: unknown, i: number) => RespostaValidacao, anteriorId?: string) {
  const usuario = usuarios.get(uid)!;
  const inicio = await repo.iniciar({ empresaId, manutencao: 'basica', anteriorId }, usuario);
  // A parcial dos concluídos fica abaixo de 80%: na regra nova a conclusão vale, não a parcial.
  const salva = await repo.salvar(inicio.id, { ...inicio, status: 'andamento', questoes: aplicar(inicio.questoes, final, marcar(1, 'incorreto')), treinamentoTempoAgenda: '01:00', treinamentoSolicitante: 'CS' }, usuario);
  return repo.concluir(salva.id, salva.revisao, usuario, 'Exemplo gerado para o indicador do painel.');
}
async function abrir(empresaId: string, uid: string, status: 'andamento' | 'pausada', parcial: ((q: unknown, i: number) => RespostaValidacao) | null, anteriorId?: string, parciaisMarcadas = 5) {
  const usuario = usuarios.get(uid)!;
  const inicio = await repo.iniciar({ empresaId, manutencao: 'basica', anteriorId }, usuario);
  return repo.salvar(inicio.id, { ...inicio, status, questoes: aplicar(inicio.questoes, null, parcial, parciaisMarcadas) }, usuario);
}

const id = (letra: string) => PREFIXO + letra;
await concluir(id('a'), 'seed-treinador-1', marcar(9, 'parcial'));            // 95%
await concluir(id('b'), 'seed-treinador-2', marcar(8, 'parcial'));            // 90%
await concluir(id('c'), 'seed-treinador-3', marcar(4, 'incorreto'));          // 40%
const reprovadaD = await concluir(id('d'), 'seed-treinador-1', marcar(5, 'incorreto')); // 50%
await abrir(id('d'), 'seed-treinador-1', 'andamento', marcar(5, 'correto'), reprovadaD.id); // parcial 100%
await abrir(id('e'), 'seed-treinador-2', 'andamento', marcar(4, 'parcial'));  // parcial 4C+1P = 90%
await abrir(id('f'), 'seed-treinador-3', 'pausada', marcar(3, 'parcial'));    // parcial 3C+2P = 80% (limite)
await abrir(id('g'), 'seed-treinador-1', 'andamento', marcar(2, 'incorreto')); // parcial 40%
await abrir(id('h'), 'seed-treinador-2', 'andamento', null);                   // sem parcial
await abrir(id('i'), 'seed-treinador-3', 'andamento', marcar(3, 'correto'), undefined, 3); // 3 marcadas (100%)

// Resumo com o mesmo cálculo do card, só sobre os clientes deste exemplo.
const tentativas = (await db.collection('validacao_tentativas').where('empresaId', 'in', CENARIOS.map(c => id(c.letra))).get())
  .docs.map(d => ({ ...d.data(), id: d.id }) as TentativaValidacao);
const metas = (await db.doc('configuracoes/metasPainelTreinamento').get()).data()?.metas as Record<string, number> | undefined;
const minimo = minimoPreviaParcial(metas);
const linhas = calcularValidacaoPorCliente(tentativas, minimo);
// Regra antiga: só tentativas concluídas, a mais recente de cada cliente.
const finais = calcularValidacaoPorCliente(tentativas.filter(t => t.status === 'concluida'));
const pct = (p: number, t: number) => (t ? `${Math.round(100 * p / t)}%` : '—');
console.log('Clientes "[Demo Indicador]" criados (filtre por "Demo Indicador" no Radar).');
console.log(`Regra antiga (só concluídas): ${finais.filter(l => l.aprovada).length}/${finais.length} = ${pct(finais.filter(l => l.aprovada).length, finais.length)}`);
console.log(`Mínimo de perguntas com parcial para a prévia: ${minimo}`);
console.log(`Regra nova (com prévias):     ${linhas.filter(l => l.aprovada).length}/${linhas.length} = ${pct(linhas.filter(l => l.aprovada).length, linhas.length)}, ${linhas.filter(l => l.previa).length} pela validação parcial`);
console.log('O card soma também os demais clientes do banco local avaliados neste mês (ex.: seed:validacao-parcial).');
console.log('Painel: Relatórios › Indicadores de Treinamento (login master@local.test / senha123).');
process.exit(0);
