/**
 * Popula o Firebase Emulator Suite local com dados sintéticos (nenhum dado real) para
 * desenvolver sem consumir a cota do Firestore de produção. Ver server/EMULADOR.md.
 *
 * Pré-requisito: o emulador precisa estar rodando (`npm run emulators`, em outro
 * terminal) antes de executar este script — ele não inicia o emulador sozinho.
 *
 * Uso (a partir de server/):
 *   npx tsx scripts/seedEmulador.ts
 *
 * Apaga e recria as coleções usadas pelo Radar (usuarios, empresas, ocorrencias,
 * gamificacao_pontos) e os usuários de autenticação no Auth emulator. Seguro rodar
 * quantas vezes quiser — nunca toca no Firestore real (força os hosts do emulador
 * independentemente do que estiver em server/.env).
 */

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

const PROJECT_ID = 'automatiza-esteira';
const SENHA_PADRAO = 'senha123';

const app = initializeApp({ projectId: PROJECT_ID });
const db = getFirestore(app);
const auth = getAuth(app);

const DIA_MS = 24 * 60 * 60 * 1000;
const hoje = new Date();
hoje.setHours(9, 0, 0, 0);

function diasAtras(dias: number): Date {
  return new Date(hoje.getTime() - dias * DIA_MS);
}

function dataISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dia}`;
}

function dataBR(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${dia}/${m}/${y}`;
}

const TEMAS_ESTEIRA = [
  'Introdução ao sistema',
  'Cadastro de produtos',
  'Emissão de notas fiscais',
  'Relatórios gerenciais',
  'Integração com PDV',
];

const USUARIOS = [
  { uid: 'seed-master', email: 'master@local.test', nome: 'Admin Master', role: 'master' },
  { uid: 'seed-treinador-1', email: 'treinador1@local.test', nome: 'Clarice Pereira', role: 'treinador' },
  { uid: 'seed-treinador-2', email: 'treinador2@local.test', nome: 'Pedro Henrique', role: 'treinador' },
  { uid: 'seed-treinador-3', email: 'treinador3@local.test', nome: 'Jean Faria', role: 'treinador' },
  { uid: 'seed-cs', email: 'cs@local.test', nome: 'Ana CS', role: 'cs', cargo: 'analista' },
  { uid: 'seed-suporte', email: 'suporte@local.test', nome: 'Bruno Suporte', role: 'suporte' },
] as const;

const nomeTreinador1 = USUARIOS[1].nome;
const nomeTreinador2 = USUARIOS[2].nome;
const nomeTreinador3 = USUARIOS[3].nome;
const nomeCs = USUARIOS[4].nome;

type SeedEmpresa = {
  id: string;
  nomeEmpresa: string;
  responsavel: string;
  currentPhase: number;
  dataEntradaDiasAtras: number;
  extra?: Record<string, unknown>;
};

const EMPRESAS: SeedEmpresa[] = [
  { id: 'emp-alpha', nomeEmpresa: 'Empresa Alpha Ltda', responsavel: nomeTreinador1, currentPhase: 2, dataEntradaDiasAtras: 18 },
  {
    id: 'emp-beta',
    nomeEmpresa: 'Empresa Beta Comércio',
    responsavel: nomeTreinador2,
    currentPhase: 1,
    dataEntradaDiasAtras: 25,
    extra: { isSuspended: true, dataSuspensao: dataISO(diasAtras(4)) },
  },
  {
    id: 'emp-gama',
    nomeEmpresa: 'Empresa Gama Serviços',
    responsavel: nomeTreinador1,
    currentPhase: 4,
    dataEntradaDiasAtras: 40,
    extra: { dataFinalizacao: dataISO(diasAtras(2)) },
  },
  {
    id: 'emp-delta',
    nomeEmpresa: 'Empresa Delta Tech',
    responsavel: nomeTreinador3,
    currentPhase: 1,
    dataEntradaDiasAtras: 50,
    extra: { isCancelled: true, whatsappEnviadoEmCancelamento: diasAtras(10).getTime() },
  },
  {
    id: 'emp-epsilon',
    nomeEmpresa: 'Empresa Épsilon Varejo',
    responsavel: nomeTreinador2,
    currentPhase: 0,
    dataEntradaDiasAtras: 3,
    extra: { isOngoing: true },
  },
  {
    id: 'emp-zeta',
    nomeEmpresa: 'Empresa Zeta Indústria',
    responsavel: nomeTreinador3,
    currentPhase: 2,
    dataEntradaDiasAtras: 15,
    extra: { alerta: true },
  },
  { id: 'emp-theta', nomeEmpresa: 'Empresa Theta Logística', responsavel: nomeTreinador1, currentPhase: 3, dataEntradaDiasAtras: 22 },
  { id: 'emp-iota', nomeEmpresa: 'Empresa Iota Distribuidora', responsavel: nomeTreinador2, currentPhase: 0, dataEntradaDiasAtras: 2 },
];

type SeedOcorrencia = {
  empresa: string;
  tipo: string;
  descricao: string;
  departamento: string;
  responsavel: string;
  diasAtras: number;
  treinamentoResultados?: ('Bom' | 'Ruim')[];
  treinamentoDataSolicitacao?: string;
};

const OCORRENCIAS: SeedOcorrencia[] = [
  { empresa: 'Empresa Alpha Ltda', tipo: 'Dúvida', descricao: 'Dúvida sobre emissão de nota fiscal avulsa.', departamento: 'Suporte', responsavel: nomeTreinador1, diasAtras: 1 },
  { empresa: 'Empresa Alpha Ltda', tipo: 'Treinamento', descricao: 'Treinamento de cadastro de produtos.', departamento: 'Treinamento', responsavel: nomeTreinador1, diasAtras: 5, treinamentoResultados: ['Bom'], treinamentoDataSolicitacao: dataISO(diasAtras(8)) },
  { empresa: 'Empresa Beta Comércio', tipo: 'Problema', descricao: 'Erro ao sincronizar estoque.', departamento: 'Suporte', responsavel: nomeTreinador2, diasAtras: 3 },
  { empresa: 'Empresa Beta Comércio', tipo: 'Solicitação', descricao: 'Pedido de relatório extra de vendas.', departamento: 'Treinamento', responsavel: nomeTreinador2, diasAtras: 6 },
  { empresa: 'Empresa Gama Serviços', tipo: 'Treinamento', descricao: 'Treinamento de relatórios gerenciais.', departamento: 'Treinamento', responsavel: nomeTreinador1, diasAtras: 10, treinamentoResultados: ['Bom', 'Bom'], treinamentoDataSolicitacao: dataISO(diasAtras(14)) },
  { empresa: 'Empresa Gama Serviços', tipo: 'Checkpoint', descricao: 'Checkpoint de conclusão da esteira.', departamento: 'CS', responsavel: nomeCs, diasAtras: 2 },
  { empresa: 'Empresa Delta Tech', tipo: 'Problema', descricao: 'Reclamação recorrente de lentidão.', departamento: 'Suporte', responsavel: nomeTreinador3, diasAtras: 15 },
  { empresa: 'Empresa Épsilon Varejo', tipo: 'Informativa', descricao: 'Boas-vindas e agenda inicial definida.', departamento: 'CS', responsavel: nomeCs, diasAtras: 2 },
  { empresa: 'Empresa Zeta Indústria', tipo: 'Dúvida', descricao: 'Dúvida sobre permissões de usuário.', departamento: 'Suporte', responsavel: nomeTreinador3, diasAtras: 1 },
  { empresa: 'Empresa Zeta Indústria', tipo: 'Treinamento', descricao: 'Treinamento ausente — cliente não compareceu.', departamento: 'Treinamento', responsavel: nomeTreinador3, diasAtras: 7 },
  { empresa: 'Empresa Theta Logística', tipo: 'Solicitação', descricao: 'Solicitação de nova integração.', departamento: 'Treinamento', responsavel: nomeTreinador1, diasAtras: 4 },
  { empresa: 'Empresa Theta Logística', tipo: 'Treinamento', descricao: 'Treinamento de integração com PDV.', departamento: 'Treinamento', responsavel: nomeTreinador1, diasAtras: 9, treinamentoResultados: ['Ruim'], treinamentoDataSolicitacao: dataISO(diasAtras(13)) },
  { empresa: 'Empresa Iota Distribuidora', tipo: 'Dúvida', descricao: 'Dúvida sobre primeiro acesso.', departamento: 'Suporte', responsavel: nomeTreinador2, diasAtras: 1 },
];

type SeedLancamento = {
  treinadorNome: string;
  treinamentoEmpresa: string;
  treinamentoTema: string;
  diasAtras: number;
  dataSolicitacaoDiasAtras: number;
  resultados?: ('Bom' | 'Ruim')[];
};

const LANCAMENTOS: SeedLancamento[] = [
  { treinadorNome: nomeTreinador1, treinamentoEmpresa: 'Empresa Alpha Ltda', treinamentoTema: 'Cadastro de produtos', diasAtras: 5, dataSolicitacaoDiasAtras: 8, resultados: ['Bom'] },
  { treinadorNome: nomeTreinador1, treinamentoEmpresa: 'Empresa Gama Serviços', treinamentoTema: 'Relatórios gerenciais', diasAtras: 10, dataSolicitacaoDiasAtras: 14, resultados: ['Bom', 'Bom'] },
  { treinadorNome: nomeTreinador1, treinamentoEmpresa: 'Empresa Theta Logística', treinamentoTema: 'Integração com PDV', diasAtras: 9, dataSolicitacaoDiasAtras: 13, resultados: ['Ruim'] },
  { treinadorNome: nomeTreinador2, treinamentoEmpresa: 'Empresa Beta Comércio', treinamentoTema: 'Emissão de notas fiscais', diasAtras: 6, dataSolicitacaoDiasAtras: 9, resultados: ['Bom'] },
  { treinadorNome: nomeTreinador2, treinamentoEmpresa: 'Empresa Iota Distribuidora', treinamentoTema: 'Introdução ao sistema', diasAtras: 2, dataSolicitacaoDiasAtras: 3, resultados: ['Bom'] },
  { treinadorNome: nomeTreinador3, treinamentoEmpresa: 'Empresa Zeta Indústria', treinamentoTema: 'ausente', diasAtras: 7, dataSolicitacaoDiasAtras: 10 },
  { treinadorNome: nomeTreinador3, treinamentoEmpresa: 'Empresa Delta Tech', treinamentoTema: 'cancelado', diasAtras: 12, dataSolicitacaoDiasAtras: 15 },
  { treinadorNome: nomeTreinador3, treinamentoEmpresa: 'Empresa Zeta Indústria', treinamentoTema: 'Cadastro de produtos', diasAtras: 1, dataSolicitacaoDiasAtras: 4, resultados: ['Ruim'] },
];

async function limparColecao(nome: string) {
  const snap = await db.collection(nome).get();
  const lote = db.batch();
  snap.docs.forEach((doc) => lote.delete(doc.ref));
  if (!snap.empty) await lote.commit();
}

async function seedUsuarios() {
  for (const u of USUARIOS) {
    await auth
      .createUser({ uid: u.uid, email: u.email, password: SENHA_PADRAO, displayName: u.nome })
      .catch(async (err) => {
        if (err.code === 'auth/uid-already-exists' || err.code === 'auth/email-already-exists') {
          await auth.updateUser(u.uid, { email: u.email, password: SENHA_PADRAO, displayName: u.nome }).catch(() => {});
        } else {
          throw err;
        }
      });

    await db
      .collection('usuarios')
      .doc(u.uid)
      .set({
        email: u.email,
        nome: u.nome,
        role: u.role,
        cargo: 'cargo' in u ? u.cargo : '',
        needsPasswordChange: false,
        createdAt: Date.now(),
      });
  }
  console.log(`  usuarios: ${USUARIOS.length} (senha para todos: "${SENHA_PADRAO}")`);
}

async function seedEmpresas() {
  const lote = db.batch();
  EMPRESAS.forEach((e) => {
    const dataEntrada = diasAtras(e.dataEntradaDiasAtras);
    const temaText = TEMAS_ESTEIRA.join('\n');
    const dataText = TEMAS_ESTEIRA.map((_, idx) => (idx <= e.currentPhase ? dataBR(diasAtras(e.dataEntradaDiasAtras - idx * 3)) : '')).join('\n');

    lote.set(db.collection('empresas').doc(e.id), {
      nomeEmpresa: e.nomeEmpresa,
      responsavel: e.responsavel,
      csResponsavel: nomeCs,
      tipo: 'Fast',
      dataEntrada: dataISO(dataEntrada),
      temaText,
      dataText,
      currentPhase: e.currentPhase,
      updatedAt: Date.now(),
      valorContrato: 1500 + Math.round(Math.random() * 2000),
      ...e.extra,
    });
  });
  await lote.commit();
  console.log(`  empresas: ${EMPRESAS.length}`);
}

async function seedOcorrencias() {
  const lote = db.batch();
  OCORRENCIAS.forEach((o, idx) => {
    const data = diasAtras(o.diasAtras);
    const ref = db.collection('ocorrencias').doc(`oc-seed-${idx + 1}`);
    lote.set(ref, {
      empresa: o.empresa,
      tipo: o.tipo,
      descricao: o.descricao,
      departamento: o.departamento,
      responsavel: o.responsavel,
      dataOcorrencia: data.getTime(),
      createdAt: data.getTime(),
      updatedAt: data.getTime(),
      idSeqFormatted: `#${1000 + idx}`,
      ...(o.treinamentoResultados ? { treinamentoResultados: o.treinamentoResultados, treinamentoDataSolicitacao: o.treinamentoDataSolicitacao } : {}),
    });
  });
  await lote.commit();
  console.log(`  ocorrencias: ${OCORRENCIAS.length}`);
}

async function seedLancamentos() {
  const treinadorPorNome = new Map(USUARIOS.map((u) => [u.nome, u]));
  const lote = db.batch();
  LANCAMENTOS.forEach((l, idx) => {
    const treinador = treinadorPorNome.get(l.treinadorNome)!;
    const dataLancamento = diasAtras(l.diasAtras);
    const ref = db.collection('gamificacao_pontos').doc(`pt-seed-${idx + 1}`);
    lote.set(ref, {
      treinadorId: treinador.uid,
      treinadorNome: treinador.nome,
      tipoAcao: 'treinamento',
      pontos: 1,
      descricao: `Treinamento: ${l.treinamentoTema}`,
      dataLancamento: dataLancamento.getTime(),
      updatedAt: dataLancamento.getTime(),
      criadoPorId: treinador.uid,
      criadoPorNome: treinador.nome,
      treinamentoEmpresa: l.treinamentoEmpresa,
      treinamentoTema: l.treinamentoTema,
      treinamentoDataSolicitacao: dataISO(diasAtras(l.dataSolicitacaoDiasAtras)),
      treinamentoDataRealizacao: dataISO(dataLancamento),
      ...(l.resultados ? { treinamentoResultados: l.resultados } : {}),
    });
  });
  await lote.commit();
  console.log(`  gamificacao_pontos: ${LANCAMENTOS.length}`);
}

async function main() {
  console.log(`Conectando ao emulador (Firestore ${process.env.FIRESTORE_EMULATOR_HOST}, Auth ${process.env.FIREBASE_AUTH_EMULATOR_HOST})...`);
  console.log('Limpando coleções existentes no emulador...');
  await Promise.all(['usuarios', 'empresas', 'ocorrencias', 'gamificacao_pontos'].map(limparColecao));

  console.log('Semeando dados sintéticos...');
  await seedUsuarios();
  await seedEmpresas();
  await seedOcorrencias();
  await seedLancamentos();

  console.log('\nPronto. Faça login no app local com qualquer um dos e-mails abaixo e a senha "senha123":');
  USUARIOS.forEach((u) => console.log(`  - ${u.email}  (${u.role})`));
  process.exit(0);
}

main().catch((err) => {
  console.error('Falha ao semear o emulador:', err);
  console.error('Confira se o emulador está rodando (npm run emulators, em outro terminal).');
  process.exit(1);
});
