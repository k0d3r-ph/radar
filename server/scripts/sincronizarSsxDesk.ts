import { config } from '../src/infrastructure/config/env.js';
// Carregar o .env antes de inicializar o Firebase.
const { adminDb } = await import('../src/infrastructure/firebase/firebaseAdmin.js');
const { SsxDeskSyncService } = await import('../src/infrastructure/ssxDesk/SsxDeskSyncService.js');

try {
  if (!adminDb || !config.ssxDeskApiKey) throw new Error('Configure Firebase Admin e SSX_DESK_API_KEY no backend.');
  const dryRun = process.argv.includes('--dry-run');
  const resultado = await new SsxDeskSyncService(adminDb, config.ssxDeskApiKey).sincronizar(dryRun);
  console.log(dryRun ? '[SIMULAÇÃO — sem gravações]' : '[IMPORTAÇÃO]', JSON.stringify(resultado, null, 2));
  await adminDb.terminate();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falha na sincronização');
  process.exit(1);
}
