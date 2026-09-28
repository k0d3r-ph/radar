/**
 * Vinculação em lote (one-off): lê a planilha de controle do CS e grava o
 * `idCentral` de cada cliente já cadastrado no Radar, casando pelo nome da
 * central. Roda uma vez para colocar a base atual em dia — cadastros novos
 * já são resolvidos automaticamente pela Esteira (ver
 * app/src/services/centrais.ts).
 *
 * Uso (a partir de server/):
 *   npx tsx scripts/vincularIdCentral.ts           # confere e grava
 *   npx tsx scripts/vincularIdCentral.ts --dry-run  # só mostra o que faria, não grava nada
 *
 * Pré-requisitos:
 *   - serviceAccountKey.json na raiz do repositório (já usado pelo server).
 *   - PLANILHA_CENTRAIS_CSV_URL configurada no .env do server (URL do CSV
 *     publicado da aba "Controle de Implantação" — Arquivo → Compartilhar →
 *     Publicar na web → escolher a aba → formato CSV).
 */

import { adminDb, isFirebaseInitialized } from '../src/infrastructure/firebase/firebaseAdmin.js';
import {
  listarCentraisDaPlanilha,
  normalizarNomeCentral,
} from '../src/infrastructure/planilha/PlanilhaCentraisService.js';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  if (!isFirebaseInitialized || !adminDb) {
    console.error(
      'Firebase Admin não inicializado — confira se server/../serviceAccountKey.json existe.',
    );
    process.exit(1);
  }

  console.log('Lendo planilha de centrais...');
  const centrais = await listarCentraisDaPlanilha(true);
  if (centrais.length === 0) {
    console.error('A planilha voltou vazia (ou as colunas não foram encontradas). Abortando.');
    process.exit(1);
  }
  console.log(`${centrais.length} centrais lidas da planilha.`);

  const porNomeNormalizado = new Map(
    centrais.map((c) => [normalizarNomeCentral(c.nomeCentral), c.idCentral]),
  );

  const snapshot = await adminDb.collection('empresas').get();
  console.log(`${snapshot.size} clientes cadastrados no Radar.`);

  const vinculados: string[] = [];
  const jaTinhamId: string[] = [];
  const semCorrespondencia: string[] = [];

  for (const doc of snapshot.docs) {
    const dados = doc.data();
    const nomeEmpresa: string = dados.nomeEmpresa || '';
    if (dados.idCentral) {
      jaTinhamId.push(nomeEmpresa);
      continue;
    }

    const idCentral = porNomeNormalizado.get(normalizarNomeCentral(nomeEmpresa));
    if (!idCentral) {
      semCorrespondencia.push(nomeEmpresa);
      continue;
    }

    vinculados.push(`${nomeEmpresa} → ${idCentral}`);
    if (!dryRun) {
      await doc.ref.update({ idCentral, updatedAt: Date.now() });
    }
  }

  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Vinculados agora: ${vinculados.length}`);
  vinculados.forEach((l) => console.log(`  ✅ ${l}`));

  console.log(`\nJá tinham idCentral: ${jaTinhamId.length}`);

  console.log(`\nSem correspondência na planilha (revisar manualmente): ${semCorrespondencia.length}`);
  semCorrespondencia.forEach((n) => console.log(`  ⚠️  ${n}`));

  if (dryRun) {
    console.log('\nNenhuma gravação foi feita (--dry-run). Rode sem essa flag para aplicar.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((erro) => {
    console.error('Erro ao vincular idCentral:', erro);
    process.exit(1);
  });
