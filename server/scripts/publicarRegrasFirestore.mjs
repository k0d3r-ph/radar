// Publica (ou restaura) as regras de produção do Firestore pela API do Firebase Rules, com a
// credencial de serviço do servidor. Usado na virada para o PostgreSQL (ver MIGRACAO_POSTGRES.md).
//
//   node scripts/publicarRegrasFirestore.mjs mostrar              # ruleset publicado agora
//   node scripts/publicarRegrasFirestore.mjs publicar <arquivo>   # cria e publica um ruleset novo
//   node scripts/publicarRegrasFirestore.mjs restaurar <ruleset>  # volta a publicar um ruleset anterior
//
// Credencial: FIREBASE_SERVICE_ACCOUNT_PATH (caminho absoluto, como no container da API).
import { cert } from 'firebase-admin/app';
import fs from 'node:fs';

const [modo, argumento] = process.argv.slice(2);
const caminhoCredencial = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!caminhoCredencial || !fs.existsSync(caminhoCredencial)) throw new Error('Credencial do Firebase não encontrada (FIREBASE_SERVICE_ACCOUNT_PATH).');
const credencial = JSON.parse(fs.readFileSync(caminhoCredencial, 'utf8'));
const projeto = credencial.project_id;
if (projeto !== 'automatiza-esteira') throw new Error(`Projeto Firebase inesperado: ${projeto}.`);

const { access_token: token } = await cert(credencial).getAccessToken();
const release = `projects/${projeto}/releases/cloud.firestore`;

async function api(caminho, opcoes = {}) {
  const resposta = await fetch(`https://firebaserules.googleapis.com/v1/projects/${projeto}${caminho}`, {
    ...opcoes,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(`Firebase Rules respondeu ${resposta.status}: ${corpo.error?.message || 'sem detalhes'}`);
  return corpo;
}

const publicar = rulesetName => api('/releases/cloud.firestore', {
  method: 'PATCH',
  body: JSON.stringify({ release: { name: release, rulesetName } }),
});

if (modo === 'mostrar') {
  console.log((await api('/releases/cloud.firestore')).rulesetName);
} else if (modo === 'publicar') {
  if (!argumento || !fs.existsSync(argumento)) throw new Error('Informe o arquivo de regras.');
  const ruleset = await api('/rulesets', {
    method: 'POST',
    body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: fs.readFileSync(argumento, 'utf8') }] } }),
  });
  await publicar(ruleset.name);
  console.log(ruleset.name);
} else if (modo === 'restaurar') {
  if (!/^projects\/[^/]+\/rulesets\/[\w-]+$/.test(argumento || '')) throw new Error('Informe o nome completo do ruleset.');
  await publicar(argumento);
  console.log(`Restaurado: ${argumento}`);
} else {
  throw new Error('Uso: mostrar | publicar <arquivo> | restaurar <ruleset>');
}
