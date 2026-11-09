/**
 * Diagnóstico SOMENTE LEITURA (nenhuma gravação) da sincronização de trilha de
 * treinamento com o SSX Desk (training-stages) para um cliente específico — usado pra
 * investigar casos como "a esteira terminou no Radar mas a última fase ainda aparece
 * como Em andamento no Desk" ou "o cliente não aparece no Desk". Ver
 * server/SSX_DESK_TRAINING_STAGES.md.
 *
 * Mostra, lado a lado: o estado salvo no Radar (temaText, currentPhase, dataFinalizacao,
 * idCentral, ssxDeskTrainingStageIds), o status que o Radar CALCULARIA pra cada fase
 * agora mesmo, o estado da última sincronização (cursor, erro, empresas com falha) e,
 * se a chave de escrita estiver configurada, o estado ATUAL das etapas no próprio Desk.
 *
 * Uso (a partir de server/):
 *   npx tsx scripts/diagnosticarTrainingStages.ts "Nome ou parte do nome da empresa"
 *
 * Pré-requisitos:
 *   - serviceAccountKey.json na raiz do repositório (já usado pelo server) e
 *     USE_FIREBASE_EMULATOR=false (ou ausente) no .env para consultar produção.
 *   - SSX_DESK_TRAINING_STAGES_API_KEY no .env para também conferir o lado do Desk
 *     (opcional — sem ela, mostra só o que o Radar sabe).
 */

import { adminDb, isFirebaseInitialized } from '../src/infrastructure/firebase/firebaseAdmin.js';
import { config } from '../src/infrastructure/config/env.js';
import { linhasEtapaTreinamento, resolverCompanyDesk } from '../src/infrastructure/ssxDesk/TrainingStagesSyncService.js';
import { listarEmpresasDesk } from '../src/infrastructure/ssxDesk/trainingStages.js';

const termoBusca = process.argv[2];

async function main() {
  if (!termoBusca) {
    console.error('Uso: npx tsx scripts/diagnosticarTrainingStages.ts "Nome da empresa"');
    process.exit(1);
  }
  if (!isFirebaseInitialized || !adminDb) {
    console.error('Firebase Admin não inicializado — confira serviceAccountKey.json e USE_FIREBASE_EMULATOR no .env.');
    process.exit(1);
  }

  const snapshot = await adminDb.collection('empresas').get();
  const termo = termoBusca.trim().toLowerCase();
  const candidatas = snapshot.docs.filter((d) => String(d.data().nomeEmpresa || '').toLowerCase().includes(termo));

  if (candidatas.length === 0) {
    console.log(`Nenhuma empresa encontrada contendo "${termoBusca}".`);
    process.exit(0);
  }

  let companiesDesk: Awaited<ReturnType<typeof listarEmpresasDesk>> | null = null;
  if (config.ssxDeskTrainingStagesApiKey) {
    console.log('Consultando GET /companies no SSX Desk...');
    try {
      companiesDesk = await listarEmpresasDesk(config.ssxDeskTrainingStagesApiKey);
    } catch (erro) {
      console.error('Falha ao consultar o Desk:', erro instanceof Error ? erro.message : erro);
    }
  } else {
    console.log('SSX_DESK_TRAINING_STAGES_API_KEY não configurada — mostrando só o lado do Radar.');
  }

  for (const doc of candidatas) {
    const empresa = { id: doc.id, ...(doc.data() as any) };
    console.log(`\n${'='.repeat(70)}`);
    console.log(`${empresa.nomeEmpresa}  (doc: ${empresa.id})`);
    console.log(`${'='.repeat(70)}`);
    console.log(`idCentral: ${JSON.stringify(empresa.idCentral)}`);
    console.log(`currentPhase: ${empresa.currentPhase}`);
    console.log(`dataFinalizacao: ${JSON.stringify(empresa.dataFinalizacao)}`);
    console.log(`dataFollowUpFinal: ${JSON.stringify(empresa.dataFollowUpFinal)}`);
    console.log(`updatedAt:                     ${empresa.updatedAt} — ${empresa.updatedAt ? new Date(empresa.updatedAt).toISOString() : '-'}`);
    console.log(`ssxDeskTrainingStagesSyncedAt: ${empresa.ssxDeskTrainingStagesSyncedAt} — ${empresa.ssxDeskTrainingStagesSyncedAt ? new Date(empresa.ssxDeskTrainingStagesSyncedAt).toISOString() : '-'}`);
    const precisaReenviar = (empresa.ssxDeskTrainingStagesSyncedAt ?? 0) < empresa.updatedAt;
    console.log(`=> precisaReenviar (syncedAt < updatedAt): ${precisaReenviar}${precisaReenviar ? '' : '  <-- se TRUE era esperado, a próxima sincronização não vai reenviar nada pra essa empresa'}`);
    console.log(`ssxDeskTrainingStageIds: ${JSON.stringify(empresa.ssxDeskTrainingStageIds)}`);

    console.log('\nStatus que o Radar calcularia AGORA para cada fase:');
    const linhas = linhasEtapaTreinamento(empresa);
    linhas.forEach((l) => {
      if (!l.tema) return;
      console.log(`  [${l.indice}] "${l.tema}" -> ${l.status}  (idDesk salvo: ${l.idDesk || '-'})`);
    });

    if (companiesDesk) {
      const companyDesk = resolverCompanyDesk(empresa, companiesDesk);
      if (!companyDesk) {
        console.log('\nSEM VÍNCULO com nenhuma empresa do Desk (idCentral/nome não resolveram).');
      } else {
        console.log(`\nVinculada ao Desk: ${companyDesk.name} (id: ${companyDesk.id}, idCentral: ${companyDesk.idCentral})`);
        const etapas = companyDesk.trainingStages?.items ?? [];
        if (etapas.length === 0) {
          console.log('  O Desk não devolveu trainingStages embutido pra essa empresa (campo ausente/vazio).');
        } else {
          etapas
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .forEach((e) => console.log(`  [${e.sortOrder}] "${e.name}" -> ${e.status}  (id: ${e.id}, atualizado em: ${e.updatedAt})`));
        }
      }
    }
  }

  const estado = (await adminDb.doc('integracoes/ssxDeskTrainingStages').get()).data();
  console.log(`\n${'='.repeat(70)}`);
  console.log('Estado da última sincronização (integracoes/ssxDeskTrainingStages):');
  console.log(JSON.stringify(estado, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((erro) => {
    console.error('Erro no diagnóstico:', erro);
    process.exit(1);
  });
