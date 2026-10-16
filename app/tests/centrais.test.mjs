import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import ts from 'typescript';

async function ambiente() {
  const estado = { usuario: { uid: 'u1', getIdToken: async () => 'token' }, chamadas: 0,
    dados: { central: { nomeCentral: 'Cliente A', idCentral: '1', valorContrato: 1500.25 } } };
  const context = createContext({ URLSearchParams, AbortSignal, Date, fetch: async (url, options) => {
    estado.chamadas++;
    estado.ultimaConsulta = { url, options };
    await estado.espera;
    if (estado.erro) throw new Error('offline');
    return { ok: estado.status !== 500, json: async () => estado.dados };
  } });
  const firebase = new SyntheticModule(['auth'], function () {
    this.setExport('auth', { get currentUser() { return estado.usuario; } });
  }, { context });
  const api = new SyntheticModule(['RADAR_API_URL'], function () { this.setExport('RADAR_API_URL', 'https://api.test'); }, { context });
  const codigo = ts.transpileModule(readFileSync(new URL('../src/services/centrais.ts', import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const module = new SourceTextModule(codigo, { context });
  await module.link(specifier => specifier === './firebase' ? firebase : api);
  await module.evaluate();
  return { estado, ...module.namespace };
}

test('consulta usa token, nome e ID; chamadas simultâneas e salvar compartilham resultado', async () => {
  const { estado, buscarDadosCentral } = await ambiente();
  const resultados = await Promise.all([buscarDadosCentral(' Cliente A ', '1'), buscarDadosCentral('Cliente A', '1')]);
  assert.equal(resultados[0].valorContrato, 1500.25);
  assert.equal(estado.chamadas, 1);
  assert.equal(estado.ultimaConsulta.options.headers.Authorization, 'Bearer token');
  const url = new URL(estado.ultimaConsulta.url);
  assert.equal(url.pathname, '/api/centrais/dados');
  assert.equal(url.searchParams.get('nome'), 'Cliente A');
  assert.equal(url.searchParams.get('idCentral'), '1');
  await buscarDadosCentral('Cliente A', '1');
  assert.equal(estado.chamadas, 1);
});

test('cache é separado por usuário e resposta de sessão antiga é rejeitada', async () => {
  const { estado, buscarDadosCentral } = await ambiente();
  await buscarDadosCentral('Cliente A');
  estado.usuario = { uid: 'u2', getIdToken: async () => 'token-2' };
  await buscarDadosCentral('Cliente A');
  assert.equal(estado.chamadas, 2);
  let liberar;
  estado.espera = new Promise(resolve => { liberar = resolve; });
  const pendente = buscarDadosCentral('Cliente B');
  await new Promise(resolve => setImmediate(resolve));
  estado.usuario = null;
  liberar();
  await assert.rejects(pendente, /sessão mudou/);
  await assert.rejects(buscarDadosCentral('Cliente A'), /Entre novamente/);
});

test('falha permite tentar novamente; respostas inválidas nunca preenchem contrato', async () => {
  const { estado, buscarDadosCentral } = await ambiente();
  estado.erro = true;
  await assert.rejects(buscarDadosCentral('Cliente A'), /offline/);
  estado.erro = false;
  assert.equal((await buscarDadosCentral('Cliente A')).valorContrato, 1500.25);
  for (const valorContrato of ['1500', null, -1, NaN, Infinity]) {
    estado.dados = { central: { nomeCentral: 'A', idCentral: '1', valorContrato } };
    await assert.rejects(buscarDadosCentral(`Inválido ${valorContrato}`), /inválida/);
  }
  estado.dados = {};
  await assert.rejects(buscarDadosCentral('Sem central'), /inválida/);
  estado.dados = { central: null };
  assert.equal(await buscarDadosCentral('Ausente'), null);
});

test('preenchimento automático conserva valores manuais, zero e demais campos do formulário', async () => {
  const { preencherDadosCentral } = await ambiente();
  const central = { nomeCentral: 'Cliente A', idCentral: '1', valorContrato: 1500.25 };
  const vazio = { nomeEmpresa: 'Cliente A', responsavel: 'Ana' };
  const preenchido = preencherDadosCentral(vazio, central);
  assert.equal(preenchido.idCentral, '1');
  assert.equal(preenchido.valorContrato, 1500.25);
  assert.equal(preenchido.responsavel, 'Ana');
  assert.equal(vazio.idCentral, undefined);
  for (const valorContrato of [0, 50]) {
    const cliente = preencherDadosCentral({ idCentral: 'manual', valorContrato }, central);
    assert.equal(cliente.idCentral, 'manual');
    assert.equal(cliente.valorContrato, valorContrato);
  }
  assert.equal(preencherDadosCentral({}, { ...central, valorContrato: 0 }).valorContrato, 0);
  assert.equal(preencherDadosCentral({}, { nomeCentral: 'A', idCentral: '1' }).valorContrato, undefined);
});

async function formulario() {
  const { preencherDadosCentral } = await ambiente();
  const slots = [], timers = new Map(), consultas = [];
  let indice = 0, sequencia = 0;
  const user = { uid: 'u1' };
  const efeitos = [];
  const estado = { cliente: { nomeEmpresa: 'Cliente A' }, aberto: true };
  const setCliente = valor => { estado.cliente = typeof valor === 'function' ? valor(estado.cliente) : valor; };
  const context = createContext({
    setTimeout: callback => { const id = ++sequencia; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const react = new SyntheticModule(['useState', 'useRef', 'useEffect'], function () {
    this.setExport('useState', initial => {
      const posicao = indice++;
      slots[posicao] ??= { valor: initial };
      return [slots[posicao].valor, valor => { slots[posicao].valor = typeof valor === 'function' ? valor(slots[posicao].valor) : valor; }];
    });
    this.setExport('useRef', initial => { const posicao = indice++; return slots[posicao] ??= { current: initial }; });
    this.setExport('useEffect', (callback, deps) => {
      const posicao = indice++, anterior = slots[posicao];
      if (!anterior || deps.some((dep, i) => !Object.is(dep, anterior.deps[i]))) {
        efeitos.push(() => { anterior?.limpar?.(); slots[posicao] = { deps, limpar: callback() }; });
      }
    });
  }, { context });
  const auth = new SyntheticModule(['useAuth'], function () { this.setExport('useAuth', () => ({ user })); }, { context });
  const service = new SyntheticModule(['buscarDadosCentral', 'preencherDadosCentral'], function () {
    this.setExport('preencherDadosCentral', preencherDadosCentral);
    this.setExport('buscarDadosCentral', (nome, id) => new Promise((resolve, reject) => consultas.push({ nome, id, resolve, reject })));
  }, { context });
  const codigo = ts.transpileModule(readFileSync(new URL('../src/hooks/useCentralPlanilha.ts', import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const module = new SourceTextModule(codigo, { context });
  await module.link(specifier => specifier === 'react' ? react : specifier.includes('AuthContext') ? auth : service);
  await module.evaluate();
  const render = () => {
    indice = 0;
    const resultado = module.namespace.useCentralPlanilha(estado.aberto, estado.cliente, setCliente);
    efeitos.splice(0).forEach(efeito => efeito());
    return resultado;
  };
  const consultar = () => { const [id, callback] = timers.entries().next().value; timers.delete(id); return callback(); };
  return { estado, consultas, render, consultar };
}

test('consulta atrasada não preenche outro cliente nem formulário fechado', async () => {
  for (const fechar of [false, true]) {
    const h = await formulario();
    h.render();
    const consulta = h.consultar();
    if (fechar) h.estado.aberto = false;
    else h.estado.cliente = { nomeEmpresa: 'Cliente B' };
    h.render();
    h.consultas[0].resolve({ nomeCentral: 'A', idCentral: '1', valorContrato: 100 });
    await consulta;
    assert.equal(h.estado.cliente.valorContrato, undefined);
    assert.equal(h.estado.cliente.idCentral, undefined);
  }
});

test('digitação manual durante a busca tem prioridade sobre o retorno automático', async () => {
  const h = await formulario();
  h.render();
  const consulta = h.consultar();
  h.estado.cliente = { ...h.estado.cliente, valorContrato: 77 };
  h.render();
  h.consultas[0].resolve({ nomeCentral: 'A', idCentral: '1', valorContrato: 100 });
  await consulta;
  assert.equal(h.estado.cliente.valorContrato, 77);
  assert.equal(h.estado.cliente.idCentral, '1');
});

test('alterar a identificação descarta sugestões antigas e conserva correções manuais', async () => {
  for (const manual of [false, true]) {
    const h = await formulario();
    h.render();
    const consulta = h.consultar();
    h.consultas[0].resolve({ nomeCentral: 'A', idCentral: '1', valorContrato: 100 });
    await consulta;
    h.render();
    if (manual) h.estado.cliente = { ...h.estado.cliente, valorContrato: 77 };
    h.estado.cliente = { ...h.estado.cliente, nomeEmpresa: 'Cliente B' };
    h.render();
    assert.equal(h.estado.cliente.idCentral, undefined);
    assert.equal(h.estado.cliente.valorContrato, manual ? 77 : undefined);
  }
});
