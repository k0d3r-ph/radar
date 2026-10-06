import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const credentials = JSON.parse(readFileSync(fileURLToPath(new URL('../../serviceAccountKey.json', import.meta.url)), 'utf8'));
if (credentials.project_id !== 'automatiza-esteira') throw new Error('Projeto Firebase inesperado.');
const db = getFirestore(initializeApp({ credential: cert(credentials) }));
const reservas = await db.collection('csatReservas').get();
const antigas = reservas.docs.filter(d => /^CSAT-\d+$/.test(d.data().idSeqFormatted || ''));
for (const doc of antigas) {
  const ocorrencia = await db.collection('ocorrencias').doc(doc.id).get();
  console.log(JSON.stringify({ id: doc.id, numero: doc.data().idSeqFormatted, empresa: doc.data().empresa,
    status: doc.data().status, respostas: doc.data().respostas?.length || 0,
    ocorrenciaExiste: ocorrencia.exists, pontoId: ocorrencia.data()?.gamificacaoPontoId || '' }));
}
console.log(`Total: ${antigas.length}`);
if (process.argv.includes('--delete')) {
  const permitidos = new Set(['1ZOmD1VO5mXHFWI2JLZO', '6dxVPS0dNkGPm6oRJV2T', 'CKIhMxDUfqMAwR22wXGX']);
  if (antigas.some(d => !permitidos.has(d.id))) throw new Error('A lista mudou. Revise os registros antes da exclusão.');
  const documentos = new Map();
  const adicionar = d => { if (d.exists) documentos.set(d.ref.path, d); };
  for (const reserva of antigas) {
    adicionar(reserva);
    const ocorrencia = await db.collection('ocorrencias').doc(reserva.id).get();
    if (ocorrencia.exists && (ocorrencia.data().csatReservaId !== reserva.id
      || ocorrencia.data().idSeqFormatted !== reserva.data().idSeqFormatted)) throw new Error('Ocorrência alterada; exclusão interrompida.');
    adicionar(ocorrencia);
    const pontoId = ocorrencia.data()?.gamificacaoPontoId || reserva.data().gamificacaoPontoId;
    if (pontoId) {
      const ponto = await db.collection('gamificacao_pontos').doc(pontoId).get();
      if (ponto.exists && (ponto.data().treinamentoEmpresa !== reserva.data().empresa || ponto.data().tipoAcao !== 'treinamento')) {
        throw new Error('Lançamento de pontos inesperado; exclusão interrompida.');
      }
      adicionar(ponto);
    }
    for (const resposta of (await reserva.ref.collection('respostas').get()).docs) adicionar(resposta);
    for (const link of (await db.collection('csatLinks').where('reservaId', '==', reserva.id).get()).docs) adicionar(link);
  }
  const pasta = fileURLToPath(new URL('../.private-backups/', import.meta.url));
  mkdirSync(pasta, { recursive: true });
  const backup = `${pasta}/csat-testes-${Date.now()}.json`;
  writeFileSync(backup, JSON.stringify([...documentos.values()].map(d => ({ path: d.ref.path, data: d.data() })), null, 2), { flag: 'wx' });
  if (documentos.size > 450) throw new Error('Quantidade inesperada de documentos.');
  const batch = db.batch();
  for (const doc of documentos.values()) batch.delete(doc.ref, { lastUpdateTime: doc.updateTime });
  await batch.commit();
  console.log(`Excluídos ${antigas.length} testes e ${documentos.size} documentos vinculados. Backup: ${backup}`);
}
