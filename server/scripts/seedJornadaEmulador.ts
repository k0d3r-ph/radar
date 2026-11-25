import { initializeApp, deleteApp } from 'firebase-admin/app';
import { abrirBancoLocal } from './bancoLocal.js';
import { criarExemplosJornada } from './fixturesJornada.js';

// Hosts literais locais (Postgres local e Auth Emulator): nunca grava em produção.
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.METADATA_SERVER_DETECTION = 'none';
const app = initializeApp({ projectId: 'automatiza-esteira' });
const db = await abrirBancoLocal();
try {
  const usuarios = await db.collection('usuarios').where('role', '==', 'treinador').limit(1).get();
  const treinador = usuarios.docs[0]?.data().nome as string | undefined;
  const { empresas, ocorrencias } = criarExemplosJornada(Date.now(), treinador);
  const batch = db.batch();
  for (const [colecao, registros] of [['empresas', empresas], ['ocorrencias', ocorrencias]] as const) {
    for (const registro of registros) {
      const { id, ...dados } = registro;
      if (!id?.startsWith('demo-jornada-')) throw new Error('ID fora do conjunto de exemplos.');
      batch.set(db.collection(colecao).doc(id), dados);
    }
  }
  await batch.commit();
  console.log(`Exemplos gravados somente no banco local: ${empresas.length} clientes e ${ocorrencias.length} ocorrências.`);
  console.log('Em Relatórios > Jornada do cliente, busque por "Demo Jornada". Use "Todos" para ver também a jornada concluída.');
} catch (erro) {
  console.error('Não foi possível criar os exemplos locais:', erro instanceof Error ? erro.message : 'Falha desconhecida');
  process.exitCode = 1;
} finally {
  await db.encerrar();
  await deleteApp(app);
}
