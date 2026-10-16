import { adminDb } from '../src/infrastructure/firebase/firebaseAdmin.js';
import { listarCentraisDaPlanilha } from '../src/infrastructure/planilha/PlanilhaCentraisService.js';
import { AtualizarValoresContrato } from '../src/application/use-cases/AtualizarValoresContrato.js';

const argumentos = process.argv.slice(2);
const permitidos = ['--aplicar', '--dry-run', '--sobrescrever'];

try {
  if (argumentos.some(arg => !permitidos.includes(arg)) || (argumentos.includes('--aplicar') && argumentos.includes('--dry-run'))) {
    throw new Error('Use --dry-run para conferir, --aplicar para gravar e --sobrescrever para atualizar também valores já preenchidos.');
  }
  if (!adminDb) throw new Error('Firebase Admin não inicializado. Confira as credenciais configuradas no server.');
  const aplicar = argumentos.includes('--aplicar');
  console.log(aplicar ? 'Modo: aplicar alterações.' : 'Modo: simulação sem gravações.',
    argumentos.includes('--sobrescrever') ? 'Contratos existentes serão comparados com a planilha.' : 'Somente contratos ausentes serão preenchidos.');
  const linhas = await listarCentraisDaPlanilha(true);
  const resultado = await new AtualizarValoresContrato(adminDb).execute(linhas, {
    aplicar, sobrescrever: argumentos.includes('--sobrescrever'),
  });
  console.log(aplicar ? '[APLICADO]' : '[SIMULAÇÃO — sem gravações]', JSON.stringify(resultado, null, 2));
  if (resultado.falhas.length) process.exitCode = 1;
} catch (erro) {
  console.error('Não foi possível atualizar os contratos:', erro instanceof Error ? erro.message : 'Erro desconhecido.');
  process.exitCode = 1;
} finally {
  await adminDb?.terminate();
}
