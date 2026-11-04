import { config } from '../src/infrastructure/config/env.js';
// Carregar o .env antes de inicializar o Firebase.
const { adminDb } = await import('../src/infrastructure/firebase/firebaseAdmin.js');
const { ManagerOpsSyncService } = await import('../src/infrastructure/managerOps/ManagerOpsSyncService.js');

try {
  if (!adminDb || !config.managerOpsApiKey) throw new Error('Configure Firebase Admin e MANAGER_OPS_API_KEY no backend.');
  const resultado = await new ManagerOpsSyncService(adminDb, config.managerOpsApiKey).sincronizar();
  console.log('[SINCRONIZAÇÃO MANAGER OPS]', JSON.stringify(resultado, null, 2));
  await adminDb.terminate();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falha na sincronização');
  process.exit(1);
}
