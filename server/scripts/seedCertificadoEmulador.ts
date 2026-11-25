import { abrirBancoLocal } from './bancoLocal.js';
import { GerenciarValidacaoConhecimento } from '../src/application/use-cases/GerenciarValidacaoConhecimento.js';
import type { RespostaValidacao } from '../src/domain/validacaoConhecimento.js';

/**
 * Exemplo para os certificados da Validação do conhecimento:
 * "[Demo Certificado] Central Exemplo" com quatro treinamentos anteriores (com
 * duração de agenda, uma revisão e uma ausência que não soma), contatos de
 * WhatsApp fictícios e uma validação aprovada com 90%, concluída pelo fluxo real
 * da API, com três participantes no CSAT.
 * Repetir o comando apaga e recria só estes registros (IDs `demo-certificado-`).
 * Requer `npm run seed:emulador` antes (usa o treinador `treinador2@local.test`).
 */

// Banco local fixo (scripts/bancoLocal.ts): nunca grava em produção.
process.env.METADATA_SERVER_DETECTION = 'none';

const TREINADOR_UID = 'seed-treinador-2';
const EMPRESA_ID = 'demo-certificado-central';
const NOME = '[Demo Certificado] Central Exemplo';
const ESTEIRA = ['Início', 'Tela Operacional', 'Relatório', 'Performance', 'Validação do conhecimento'];
const TREINAMENTOS = [
  { dias: -34, temas: ['Início'], tempo: '01:15' },
  { dias: -27, temas: ['Tela Operacional'], tempo: '02:05' },
  { dias: -20, temas: ['Ausente'], tempo: '' }, // não conta na carga horária
  { dias: -13, temas: ['Relatório', 'Performance'], tempo: '01:50' },
  { dias: -6, temas: ['Revisão de Relatório'], tempo: '00:40' },
];
const TEMPO_VALIDACAO = '01:17';
// 8 corretas + 2 parciais em 10 perguntas = 90% de aproveitamento.
const FINAIS: RespostaValidacao[] = ['correto', 'correto', 'parcial', 'correto', 'correto', 'correto', 'parcial', 'correto', 'correto', 'correto'];
const PARTICIPANTES = ['Robson Ramos', 'Maria Aparecida dos Santos Oliveira', 'João Ávila'];

const db = await abrirBancoLocal();
const repo = new GerenciarValidacaoConhecimento(db);

function diaRelativo(dias: number): Date {
  const data = new Date();
  data.setHours(10, 0, 0, 0);
  data.setDate(data.getDate() + dias);
  return data;
}
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ddmm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

const treinadorDoc = await db.doc(`usuarios/${TREINADOR_UID}`).get();
if (!treinadorDoc.exists) throw new Error('Usuário seed-treinador-2 não encontrado. Rode `npm run seed:emulador` antes.');
const usuario = { uid: TREINADOR_UID, nome: String(treinadorDoc.data()!.nome), role: 'treinador' };

// Limpa execuções anteriores (tentativas, o que a conclusão grava com o mesmo ID e os treinamentos).
const tentativasAntigas = await db.collection('validacao_tentativas').where('empresaId', '==', EMPRESA_ID).get();
const limpeza = db.batch();
for (const t of tentativasAntigas.docs) {
  for (const colecao of ['ocorrencias', 'gamificacao_pontos', 'csatReservas']) limpeza.delete(db.collection(colecao).doc(t.id));
  limpeza.delete(t.ref);
}
limpeza.delete(db.doc(`validacao_clientes/${EMPRESA_ID}`));
TREINAMENTOS.forEach((_, i) => limpeza.delete(db.doc(`ocorrencias/demo-certificado-treino-${i + 1}`)));
await limpeza.commit();

const agora = Date.now();
const datas = ESTEIRA.map((tema) => {
  const t = TREINAMENTOS.find((x) => x.temas.includes(tema));
  return t ? ddmm(diaRelativo(t.dias)) : '';
});
const lote = db.batch();
lote.set(db.doc(`empresas/${EMPRESA_ID}`), {
  nomeEmpresa: NOME, responsavel: usuario.nome, tipo: '', idNumeric: 900_100,
  dataEntrada: iso(diaRelativo(-36)),
  temaText: ESTEIRA.join('\n'), dataText: datas.join('\n'),
  currentPhase: ESTEIRA.length - 1, isSuspended: false, isCancelled: false, isOngoing: false,
  // Telefones fictícios (faixa 0000) só para listar destinatários no envio.
  contatos: [
    { nome: 'Robson', telefone: '5511900000001', telefones: ['5511900000001'] },
    { nome: 'Maria', telefone: '5511900000002', telefones: ['5511900000002'] },
  ],
  createdAt: agora, updatedAt: agora,
});
TREINAMENTOS.forEach((t, i) => {
  lote.set(db.doc(`ocorrencias/demo-certificado-treino-${i + 1}`), {
    empresa: NOME, tipo: 'Treinamento', departamento: 'Treinamento', responsavel: usuario.nome,
    descricao: `Treinamento: ${t.temas.join(', ')}.`, temaOcorrencia: t.temas,
    treinamentoTempoAgenda: t.tempo, treinamentoSolicitante: 'CS',
    createdAt: diaRelativo(t.dias).getTime(), dataOcorrencia: 0, updatedAt: agora,
  });
});
await lote.commit();

const inicio = await repo.iniciar({ empresaId: EMPRESA_ID, manutencao: 'basica' }, usuario);
const salva = await repo.salvar(inicio.id, {
  ...inicio, status: 'andamento',
  questoes: inicio.questoes.map((q, i) => ({ ...q, resposta: FINAIS[i % FINAIS.length] })),
  treinamentoTempoAgenda: TEMPO_VALIDACAO, treinamentoSolicitante: 'CS',
}, usuario);
const concluida = await repo.concluir(salva.id, salva.revisao, usuario, 'Equipe segura nos relatórios e na tela operacional.');

// Respostas do CSAT (normalmente enviadas pelo cliente no link público).
const respostas = PARTICIPANTES.map((nome, i) => ({ nome, nota: 5, experiencia: 'Bom', opiniao: '', respondidoEm: agora + i }));
await db.doc(`validacao_tentativas/${concluida.id}`).update({ csatRespostas: respostas, updatedAt: Date.now() });
if (concluida.ocorrenciaId) await db.doc(`ocorrencias/${concluida.ocorrenciaId}`).update({ csatRespostas: respostas, updatedAt: Date.now() });

const minutos = [...TREINAMENTOS.filter((t) => t.temas[0] !== 'Ausente').map((t) => t.tempo), TEMPO_VALIDACAO]
  .reduce((acc, t) => acc + Number(t.slice(0, 2)) * 60 + Number(t.slice(3)), 0);
console.log(`${NOME}: validação ${concluida.percentual}% (${concluida.aprovada ? 'aprovada' : 'reprovada'}), ${concluida.questoes.length} perguntas.`);
console.log(`Carga esperada: ${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, '0')}min exatos (5 agendas, sem a ausência).`);
console.log(`Período esperado: ${diaRelativo(TREINAMENTOS[0].dias).toLocaleDateString('pt-BR')} a hoje.`);
console.log('Login: treinador2@local.test / senha123 → Validação do conhecimento → selecione o cliente.');
process.exit(0);
