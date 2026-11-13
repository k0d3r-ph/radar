import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GerenciarValidacaoConhecimento } from '../src/application/use-cases/GerenciarValidacaoConhecimento.js';
import type { RespostaValidacao } from '../src/domain/validacaoConhecimento.js';

/**
 * Exemplos da "Validação parcial do conhecimento", gerados pelo fluxo real
 * (iniciar → salvar → concluir), para conferir a tela e o texto da ocorrência:
 * - "[Demo Validação] Concluída": parcial e final marcadas; avaliação concluída e
 *   ocorrência de Treinamento registrada no Histórico.
 * - "[Demo Validação] Em andamento": parcial marcada em parte das perguntas e final
 *   ainda sem resposta, para ver a seção editável.
 * Repetir o comando apaga e recria só estes registros (IDs `demo-validacao-`).
 * Requer `npm run seed:emulador` antes (usa o treinador `treinador2@local.test`).
 */

// Hosts literais locais: este script não carrega .env nem credenciais de produção.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.METADATA_SERVER_DETECTION = 'none';

const TREINADOR_UID = 'seed-treinador-2';
const ESTEIRA = ['Início', 'Tela Operacional', 'Relatório', 'Performance', 'Validação do conhecimento'];
const CLIENTES = [
  { id: 'demo-validacao-concluida', nome: '[Demo Validação] Concluída' },
  { id: 'demo-validacao-andamento', nome: '[Demo Validação] Em andamento' },
];
// Antes (parcial) → depois (final): evoluções, manutenções e uma regressão.
const PARCIAIS: (RespostaValidacao | null)[] = ['incorreto', 'parcial', 'correto', 'parcial', 'incorreto', null, 'correto', null, 'parcial', null];
const FINAIS: RespostaValidacao[] = ['correto', 'correto', 'correto', 'parcial', 'correto', 'correto', 'parcial', 'correto', 'correto', 'correto'];

const app = initializeApp({ projectId: 'automatiza-esteira' });
const db = getFirestore(app);
const repo = new GerenciarValidacaoConhecimento(db);

await fetch('http://127.0.0.1:8080/', { signal: AbortSignal.timeout(3_000) });
const treinadorDoc = await db.doc(`usuarios/${TREINADOR_UID}`).get();
if (!treinadorDoc.exists) throw new Error('Usuário seed-treinador-2 não encontrado. Rode `npm run seed:emulador` antes.');
const usuario = { uid: TREINADOR_UID, nome: String(treinadorDoc.data()!.nome), role: 'treinador' };

// Limpa execuções anteriores destes clientes (tentativas e o que a conclusão grava com o mesmo ID).
for (const { id } of CLIENTES) {
  const tentativas = await db.collection('validacao_tentativas').where('empresaId', '==', id).get();
  const batch = db.batch();
  for (const t of tentativas.docs) {
    for (const colecao of ['ocorrencias', 'gamificacao_pontos', 'csatReservas']) batch.delete(db.collection(colecao).doc(t.id));
    batch.delete(t.ref);
  }
  batch.delete(db.doc(`validacao_clientes/${id}`));
  await batch.commit();
}

const agora = Date.now();
for (const { id, nome } of CLIENTES) {
  await db.doc(`empresas/${id}`).set({
    nomeEmpresa: nome, responsavel: usuario.nome, tipo: '', idNumeric: 900_000 + CLIENTES.findIndex(c => c.id === id),
    temaText: ESTEIRA.join('\n'), dataText: ['01/10', '08/10', '15/10', '22/10', ''].join('\n'),
    currentPhase: ESTEIRA.length - 2, isSuspended: false, isCancelled: false, isOngoing: false, createdAt: agora, updatedAt: agora,
  });
}

const preencher = (questoes: Awaited<ReturnType<typeof repo.iniciar>>['questoes'], comFinal: boolean) =>
  questoes.map((q, i) => ({ ...q, respostaParcial: PARCIAIS[i % PARCIAIS.length], resposta: comFinal ? FINAIS[i % FINAIS.length] : null }));

const concluidaInicio = await repo.iniciar({ empresaId: CLIENTES[0].id, manutencao: 'basica' }, usuario);
const concluidaSalva = await repo.salvar(concluidaInicio.id, {
  ...concluidaInicio, status: 'andamento', questoes: preencher(concluidaInicio.questoes, true),
  treinamentoTempoAgenda: '01:30', treinamentoSolicitante: 'CS',
}, usuario);
const concluida = await repo.concluir(concluidaSalva.id, concluidaSalva.revisao, usuario, 'Cliente evoluiu nos temas de relatório desde a validação parcial.');

const andamentoInicio = await repo.iniciar({ empresaId: CLIENTES[1].id, manutencao: 'basica' }, usuario);
await repo.salvar(andamentoInicio.id, {
  ...andamentoInicio, status: 'andamento', questoes: preencher(andamentoInicio.questoes, false).map((q, i) => i < 4 ? q : { ...q, respostaParcial: null }),
}, usuario);

console.log(`Concluída: ${CLIENTES[0].nome} — ${concluida.percentual}% (${concluida.aprovada ? 'aprovada' : 'reprovada'}), ocorrência ${concluida.ocorrenciaId}`);
console.log(`Em andamento: ${CLIENTES[1].nome}`);
console.log('Login: treinador2@local.test / senha123');
console.log('\nTexto da ocorrência:\n');
console.log((await db.doc(`ocorrencias/${concluida.ocorrenciaId}`).get()).data()?.descricao);
process.exit(0);
