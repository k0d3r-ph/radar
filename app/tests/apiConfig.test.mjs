import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import ts from 'typescript';

async function ambiente(env = {}) {
  const chamadas = [];
  const estado = { usuario: { uid: 'usuario-teste', getIdToken: async () => 'token-de-teste' } };
  const storage = new Map();
  const context = createContext({
    console, AbortSignal, AbortController, setTimeout, clearTimeout, TextDecoder,
    window: { setTimeout, clearTimeout },
    localStorage: {
      getItem: chave => storage.get(chave) ?? null,
      setItem: (chave, valor) => storage.set(chave, valor),
      removeItem: chave => storage.delete(chave),
    },
    fetch: async (url, options = {}) => {
      chamadas.push({ url, ...options });
      return {
        ok: true, status: 200,
        json: async () => ({ documentos: [], favorita: true, idCentral: 'central-teste', session: { status: 'connected' }, success: true }),
        text: async () => 'Resumo de teste',
      };
    },
  });
  const firebase = new SyntheticModule(['auth', 'db'], function () {
    this.setExport('auth', { get currentUser() { return estado.usuario; } });
    this.setExport('db', {});
  }, { context });
  const nomesFirestore = ['collection', 'addDoc', 'deleteDoc', 'runTransaction', 'doc', 'getDocsFromServer', 'getDocsFromCache', 'documentId', 'query', 'where', 'orderBy', 'limit'];
  const firestore = new SyntheticModule(nomesFirestore, function () {
    for (const nome of nomesFirestore) this.setExport(nome, () => ({ docs: [] }));
  }, { context });
  const modules = new Map();
  async function carregar(specifier) {
    if (specifier === './firebase') return firebase;
    if (specifier === 'firebase/firestore') return firestore;
    const nome = specifier.replace(/\.ts$/, '');
    if (!['./apiConfig', './sincronizacaoIncremental', './ocorrencias', './csat', './centrais', './ia', './whatsapp'].includes(nome)) {
      throw new Error(`Import inesperado: ${specifier}`);
    }
    if (modules.has(nome)) return modules.get(nome);
    const source = readFileSync(new URL(`../src/services/${nome.slice(2)}.ts`, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = new SourceTextModule(code, { context, initializeImportMeta: meta => { meta.env = env; } });
    modules.set(nome, module);
    await module.link(carregar);
    return module;
  }
  async function servico(nome) {
    const module = await carregar(`./${nome}`);
    await module.evaluate();
    return module.namespace;
  }
  return { servico, chamadas, estado };
}

test('sem configuração, API do Radar usa 5001 e bot usa 5000', async () => {
  const { servico } = await ambiente();
  const config = await servico('apiConfig');
  assert.equal(config.RADAR_API_URL, 'http://localhost:5001');
  assert.equal(config.WHATSAPP_API_URL, 'http://localhost:5000');
});

test('endereços explícitos são independentes e normalizam espaços e barras finais', async () => {
  const { servico } = await ambiente({ VITE_RADAR_API_URL: ' https://api.example.test/radar/// ', VITE_WHATSAPP_API_URL: ' https://bot.example.test/// ' });
  const config = await servico('apiConfig');
  assert.equal(config.RADAR_API_URL, 'https://api.example.test/radar');
  assert.equal(config.WHATSAPP_API_URL, 'https://bot.example.test');
});

test('configuração antiga de domínio único continua atendendo os dois processos', async () => {
  const { servico } = await ambiente({ VITE_WHATSAPP_API_URL: 'https://radar.example.test/' });
  const config = await servico('apiConfig');
  assert.equal(config.RADAR_API_URL, 'https://radar.example.test');
  assert.equal(config.WHATSAPP_API_URL, 'https://radar.example.test');
});

test('configurar somente a API do Radar mantém a porta padrão do bot', async () => {
  const { servico } = await ambiente({ VITE_RADAR_API_URL: 'https://api.example.test' });
  const config = await servico('apiConfig');
  assert.equal(config.RADAR_API_URL, 'https://api.example.test');
  assert.equal(config.WHATSAPP_API_URL, 'http://localhost:5000');
});

test('variáveis vazias não viram endereços relativos acidentais', async () => {
  const { servico } = await ambiente({ VITE_RADAR_API_URL: '  ', VITE_WHATSAPP_API_URL: '' });
  const config = await servico('apiConfig');
  assert.equal(config.RADAR_API_URL, 'http://localhost:5001');
  assert.equal(config.WHATSAPP_API_URL, 'http://localhost:5000');
});

test('índices, estrelas, CSAT, Centrais e IA usam a API; WhatsApp e Socket.IO usam o bot', async () => {
  const { servico, chamadas } = await ambiente({ VITE_RADAR_API_URL: 'http://localhost:5001', VITE_WHATSAPP_API_URL: 'http://localhost:5000' });
  const sync = await servico('sincronizacaoIncremental');
  await sync.sincronizarColecao('empresas');
  await sync.sincronizarColecao('ocorrencias');
  const ocorrencias = await servico('ocorrencias');
  await ocorrencias.definirOcorrenciaFavorita('oc-1', true);
  const csat = await servico('csat');
  await csat.requisicaoCsat('reservas', undefined, true);
  await csat.requisicaoCsat('publico/token-teste');
  const centrais = await servico('centrais');
  assert.equal(await centrais.buscarIdCentralPorNome('Cliente Teste'), 'central-teste');
  const ia = await servico('ia');
  assert.equal(await ia.resumirOcorrencias('Cliente Teste', []), 'Resumo de teste');
  const whatsapp = await servico('whatsapp');
  await whatsapp.obterStatusWhatsApp();
  await whatsapp.enviarMensagemWhatsApp({ to: 'numero-ficticio', message: 'Mensagem simulada' });
  await whatsapp.desconectarWhatsApp();
  assert.equal(whatsapp.obterWhatsAppSocketUrl(), 'http://localhost:5000');
  assert.deepEqual(chamadas.map(c => [c.url, c.method ?? 'GET']), [
    ['http://localhost:5001/api/sincronizacao/empresas', 'GET'],
    ['http://localhost:5001/api/sincronizacao/ocorrencias', 'GET'],
    ['http://localhost:5001/api/ocorrencias/oc-1/favorito', 'PATCH'],
    ['http://localhost:5001/api/csat/reservas', 'GET'],
    ['http://localhost:5001/api/csat/publico/token-teste', 'GET'],
    ['http://localhost:5001/api/centrais/id-central?nome=Cliente%20Teste', 'GET'],
    ['http://localhost:5001/api/ia/resumir', 'POST'],
    ['http://localhost:5000/api/whatsapp/status', 'GET'],
    ['http://localhost:5000/api/whatsapp/send', 'POST'],
    ['http://localhost:5000/api/whatsapp/disconnect', 'POST'],
  ]);
  for (const chamada of chamadas.slice(0, 4)) assert.equal(chamada.headers.Authorization, 'Bearer token-de-teste');
  assert.equal(chamadas[4].headers.Authorization, undefined);
  assert.equal(chamadas[2].body, JSON.stringify({ favorita: true }));
});

test('rotas protegidas mantêm a exigência de sessão antes de enviar qualquer requisição', async () => {
  const { servico, estado, chamadas } = await ambiente();
  estado.usuario = null;
  const sync = await servico('sincronizacaoIncremental');
  await assert.rejects(sync.sincronizarColecao('empresas'), /Entre novamente/);
  const ocorrencias = await servico('ocorrencias');
  await assert.rejects(ocorrencias.definirOcorrenciaFavorita('oc-1', true), /Entre no Radar/);
  const csat = await servico('csat');
  await assert.rejects(csat.requisicaoCsat('reservas', undefined, true), /Entre novamente/);
  assert.equal(chamadas.length, 0);
});
