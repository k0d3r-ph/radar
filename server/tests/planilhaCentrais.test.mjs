import assert from 'node:assert/strict';
import test from 'node:test';
import { baixarCentrais, baixarTodasCentrais, extrairCentrais, urlExportacaoPlanilha, parsearValorContrato, resolverCentral } from '../dist/infrastructure/planilha/PlanilhaCentraisService.js';
import { AtualizarValoresContrato } from '../dist/application/use-cases/AtualizarValoresContrato.js';
import { CentraisController } from '../dist/adapters/controllers/CentraisController.js';

test('link compartilhado é convertido para CSV preservando a aba', () => {
  assert.equal(urlExportacaoPlanilha('https://docs.google.com/spreadsheets/d/abc/edit?usp=sharing#gid=123'), 'https://docs.google.com/spreadsheets/d/abc/export?format=csv&gid=123');
  assert.equal(urlExportacaoPlanilha('https://docs.google.com/spreadsheets/d/abc/edit?gid=0#gid=0'), 'https://docs.google.com/spreadsheets/d/abc/export?format=csv&gid=0');
  const publicada = 'https://docs.google.com/spreadsheets/d/e/abc/pub?output=csv&gid=2';
  assert.equal(urlExportacaoPlanilha(publicada), publicada);
});

test('HTML com HTTP 200 nunca é interpretado como cliente ausente', async () => {
  for (const tipo of ['text/html; charset=utf-8', 'text/plain']) {
    await assert.rejects(baixarCentrais('https://example.com/dados', async () =>
      new Response('<!DOCTYPE html><html>Login</html>', { headers: { 'content-type': tipo } })), /HTML em vez do CSV/);
  }
});

test('aba errada, CSV vazio e acesso negado geram erros explícitos', async () => {
  assert.throws(() => extrairCentrais('Outra coluna,Valor\nAtos,1055'), /gid/);
  assert.throws(() => extrairCentrais(''), /vazio/);
  await assert.rejects(baixarCentrais('https://example.com/dados', async () => new Response('', { status: 403 })), /HTTP 403/);
});

test('CSV válido conserva acentos, aspas, vírgulas e quebras de linha em campos', async () => {
  const csv = '\ufeff2 - Cliente,Id central,Observação\r\nAtos 3,1055,"Texto, com vírgula\ne outra linha"\r\n"SN Rastreamento/Farejador Rastreamento",1086,"Aspas ""duplas"""';
  const linhas = await baixarCentrais('https://docs.google.com/spreadsheets/d/abc/edit#gid=0', async url => {
    assert.equal(url, 'https://docs.google.com/spreadsheets/d/abc/export?format=csv&gid=0');
    return new Response(csv, { headers: { 'content-type': 'text/csv' } });
  });
  assert.deepEqual(linhas, [{ nomeCentral: 'Atos 3', idCentral: '1055' }, { nomeCentral: 'SN Rastreamento/Farejador Rastreamento', idCentral: '1086' }]);
});

test('baixarTodasCentrais soma linhas de várias abas e resolverCentral enxerga o conjunto inteiro', async () => {
  const csvPrincipal = 'Cliente,Id central\nCliente A,1';
  const csvOngoing = 'Cliente,Id central\nAlltech,99';
  const respostasPorUrl = {
    'https://docs.google.com/spreadsheets/d/abc/export?format=csv&gid=0': csvPrincipal,
    'https://docs.google.com/spreadsheets/d/abc/export?format=csv&gid=1': csvOngoing,
  };
  const linhas = await baixarTodasCentrais(
    ['https://docs.google.com/spreadsheets/d/abc/edit#gid=0', 'https://docs.google.com/spreadsheets/d/abc/edit#gid=1'],
    async (url) => new Response(respostasPorUrl[url], { headers: { 'content-type': 'text/csv' } }),
  );
  assert.deepEqual(linhas, [{ nomeCentral: 'Cliente A', idCentral: '1' }, { nomeCentral: 'Alltech', idCentral: '99' }]);
  assert.deepEqual(resolverCentral(linhas, { nomeEmpresa: 'Alltech' }), { nomeCentral: 'Alltech', idCentral: '99' });
});

test('baixarTodasCentrais com uma falha em qualquer aba rejeita sem devolver lista parcial', async () => {
  await assert.rejects(
    baixarTodasCentrais(
      ['https://docs.google.com/spreadsheets/d/abc/edit#gid=0', 'https://docs.google.com/spreadsheets/d/abc/edit#gid=1'],
      async (url) => url.includes('gid=1')
        ? new Response('', { status: 403 })
        : new Response('Cliente,Id central\nCliente A,1', { headers: { 'content-type': 'text/csv' } }),
    ),
    /HTTP 403/,
  );
});

test('valores monetários brasileiros, decimais e zero são convertidos sem confundir vazios com zero', () => {
  for (const [celula, esperado] of [['R$ 1.500,25', 1500.25], ['1.500', 1500], ['1500,5', 1500.5],
    ['1500.25', 1500.25], ['1500', 1500], [' R$\u00a00,00 ', 0], ['0', 0]]) {
    assert.equal(parsearValorContrato(celula), esperado, celula);
  }
  for (const celula of ['', ' ', '-', 'a combinar', 'R$', '-10,00', 'Infinity', 'NaN', '1e3', '1,234.56', '12.34,56', '999999999999999999999']) {
    assert.equal(parsearValorContrato(celula), undefined, celula);
  }
});

test('coluna de contrato é opcional e nunca altera o ID nem desloca colunas', () => {
  assert.deepEqual(extrairCentrais('Cliente,Id central,15 - Valor de contrato,Observação\n"SSX_Águia",101,"R$ 1.500,25","texto, com vírgula"\nZero,102,"0,00",\nVazio,103,,\nInválido,104,pendente,\nSem ID,,"99,90",'), [
    { nomeCentral: 'SSX_Águia', idCentral: '101', valorContrato: 1500.25 },
    { nomeCentral: 'Zero', idCentral: '102', valorContrato: 0 },
    { nomeCentral: 'Vazio', idCentral: '103' },
    { nomeCentral: 'Inválido', idCentral: '104' },
    { nomeCentral: 'Sem ID', idCentral: '', valorContrato: 99.9 },
  ]);
  assert.deepEqual(extrairCentrais('Cliente,Id central\nA,1'), [{ nomeCentral: 'A', idCentral: '1' }]);
});

test('vínculo prioriza ID único e exige nome em IDs compartilhados; conflitos não escolhem a primeira linha', () => {
  const linhas = [{ nomeCentral: 'SSX_Águia', idCentral: '1', valorContrato: 100 },
    { nomeCentral: 'Outra', idCentral: '2', valorContrato: 200 },
    { nomeCentral: 'Matriz', idCentral: '2', valorContrato: 300 }];
  assert.equal(resolverCentral(linhas, { nomeEmpresa: 'águia' }), linhas[0]);
  assert.equal(resolverCentral(linhas, { nomeEmpresa: 'Nome antigo', idCentral: '1' }), linhas[0]);
  assert.equal(resolverCentral(linhas, { nomeEmpresa: 'MATRIZ', idCentral: '2' }), linhas[2]);
  assert.equal(resolverCentral(linhas, { nomeEmpresa: 'desconhecido', idCentral: '2' }), null);
  assert.equal(resolverCentral(linhas, { nomeEmpresa: 'águia', idCentral: '999' }), null);
  assert.equal(resolverCentral([...linhas, { ...linhas[0], valorContrato: 999 }], { nomeEmpresa: 'Águia' }), null);
  assert.equal(resolverCentral([...linhas, { ...linhas[0], idCentral: '9' }], { nomeEmpresa: 'Águia' }), null);
});

function database(iniciais, antesDaTransacao) {
  const registros = new Map(Object.entries(structuredClone(iniciais)));
  const gravacoes = [];
  let leituras = 0;
  const ref = id => ({ id });
  const snapshot = id => ({ id, ref: ref(id), exists: registros.has(id), data: () => structuredClone(registros.get(id)) });
  return { registros, gravacoes, get leituras() { return leituras; },
    collection: () => ({ get: async () => { leituras++; return { size: registros.size, docs: [...registros.keys()].map(snapshot) }; } }),
    runTransaction: async callback => {
      antesDaTransacao?.(registros);
      const pendentes = [];
      const resultado = await callback({ get: async referencia => snapshot(referencia.id), update: (referencia, dados) => pendentes.push([referencia.id, dados]) });
      for (const [id, dados] of pendentes) { gravacoes.push({ id, ...dados }); registros.set(id, { ...registros.get(id), ...dados }); }
      return resultado;
    },
  };
}
const linhasContrato = [{ nomeCentral: 'Cliente A', idCentral: '1', valorContrato: 100 },
  { nomeCentral: 'Cliente B', idCentral: '2', valorContrato: 0 },
  { nomeCentral: 'Sem valor', idCentral: '3' }];

test('simulação não grava e lote preserva valores existentes e clientes fora da esteira', async () => {
  const db = database({ a: { nomeEmpresa: 'Cliente A', idCentral: '1', observacao: 'preservar' },
    b: { nomeEmpresa: 'Cliente B' }, existente: { nomeEmpresa: 'Cliente A', valorContrato: 500 },
    zero: { nomeEmpresa: 'Cliente A', valorContrato: 0 }, ongoing: { nomeEmpresa: 'Cliente A', isOngoing: true },
    suspenso: { nomeEmpresa: 'Cliente A', isSuspended: true }, cancelado: { nomeEmpresa: 'Cliente A', isCancelled: true },
    semVinculo: { nomeEmpresa: 'Ausente' }, semValor: { nomeEmpresa: 'Sem valor', idCentral: '3' }, interna: { nomeEmpresa: 'Systemsat' } });
  const usecase = new AtualizarValoresContrato(db);
  const previa = await usecase.execute(linhasContrato);
  assert.equal(previa.alteracoes.length, 2);
  assert.equal(previa.foraDaEsteira, 4);
  assert.equal(previa.preservados, 2);
  assert.deepEqual(previa.semCorrespondencia, ['Ausente']);
  assert.deepEqual(previa.semValorValido, ['Sem valor']);
  assert.equal(db.gravacoes.length, 0);
  await usecase.execute(linhasContrato, { aplicar: true });
  assert.equal(db.gravacoes.length, 2);
  assert.equal(db.registros.get('a').valorContrato, 100);
  assert.equal(db.registros.get('a').observacao, 'preservar');
  assert.equal(typeof db.registros.get('a').updatedAt, 'number');
  assert.equal(db.registros.get('b').valorContrato, 0);
  assert.equal((await usecase.execute(linhasContrato, { aplicar: true })).alteracoes.length, 0);
  assert.equal(db.gravacoes.length, 2);
});

test('sobrescrever é explícito, mantém idempotência e não apaga valor por célula vazia', async () => {
  const db = database({ a: { nomeEmpresa: 'Cliente A', valorContrato: 500 }, b: { nomeEmpresa: 'Sem valor', valorContrato: 800 } });
  await new AtualizarValoresContrato(db).execute(linhasContrato, { aplicar: true, sobrescrever: true });
  assert.equal(db.registros.get('a').valorContrato, 100);
  assert.equal(db.registros.get('b').valorContrato, 800);
  assert.equal((await new AtualizarValoresContrato(db).execute(linhasContrato, { aplicar: true, sobrescrever: true })).alteracoes.length, 0);
});

test('lote revalida exclusão, status, nome, ID e valor concorrentes dentro da transação', async () => {
  for (const alterar of [registros => registros.delete('a'), registros => registros.get('a').isSuspended = true,
    registros => registros.get('a').isOngoing = true, registros => registros.get('a').isCancelled = true,
    registros => registros.get('a').nomeEmpresa = 'Outra', registros => registros.get('a').idCentral = '999',
    registros => registros.get('a').valorContrato = 700]) {
    const db = database({ a: { nomeEmpresa: 'Cliente A', idCentral: '1' } }, alterar);
    const resultado = await new AtualizarValoresContrato(db).execute(linhasContrato, { aplicar: true, sobrescrever: true });
    assert.deepEqual(resultado.conflitos, ['Cliente A']);
    assert.equal(db.gravacoes.length, 0);
  }
});

test('sem coluna preenchida o lote aborta antes de ler o Firestore', async () => {
  const db = database({});
  await assert.rejects(new AtualizarValoresContrato(db).execute([{ nomeCentral: 'A', idCentral: '1' }]), /valores de contrato/);
  assert.equal(db.leituras, 0);
});

test('falha parcial é relatada e não impede os demais clientes; reexecução completa os pendentes', async () => {
  const db = database({ a: { nomeEmpresa: 'Cliente A' }, b: { nomeEmpresa: 'Cliente B' } });
  const original = db.runTransaction;
  let primeira = true;
  db.runTransaction = async callback => {
    if (primeira) { primeira = false; throw new Error('temporário'); }
    return original(callback);
  };
  const usecase = new AtualizarValoresContrato(db);
  const resultado = await usecase.execute(linhasContrato, { aplicar: true });
  assert.deepEqual(resultado.falhas, ['Cliente A']);
  assert.equal(resultado.alteracoes.length, 1);
  assert.equal(db.registros.get('a').valorContrato, undefined);
  assert.equal(db.registros.get('b').valorContrato, 0);
  const retomada = await usecase.execute(linhasContrato, { aplicar: true });
  assert.equal(retomada.alteracoes.length, 1);
  assert.equal(retomada.falhas.length, 0);
});

function response() { return { code: 200, body: null, set() { return this; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
const request = { headers: { authorization: 'Bearer token' }, query: { nome: 'Cliente A', idCentral: '1' } };
const auth = { verifyIdToken: async () => ({ uid: 'u1' }) };
const userDb = cadastro => ({ buscarPorUid: async () => cadastro });

test('consulta de contratos exige autenticação, cadastro ativo, senha definida e perfil da tela', async () => {
  for (const [cadastro, tokenAuth, req, status] of [
    [{ role: 'master' }, auth, { ...request, headers: {} }, 401],
    [{ role: 'master' }, { verifyIdToken: async () => { throw new Error(); } }, request, 401],
    [undefined, auth, request, 403], [{ role: 'master', inativo: true }, auth, request, 403],
    [{ role: 'treinador', needsPasswordChange: true }, auth, request, 403],
    ...['suporte', 'cs', 'painel', 'financeiro', 'comercial', ''].map(role => [{ role }, auth, request, 403]),
  ]) {
    let chamadas = 0;
    const controller = new CentraisController(userDb(cadastro), tokenAuth, async () => { chamadas++; return linhasContrato[0]; });
    const res = response();
    await controller.buscarDados(req, res);
    assert.equal(res.code, status);
    assert.equal(chamadas, 0);
  }
});

test('consulta autenticada retorna contrato e valida parâmetros antes de consultar a planilha', async () => {
  for (const role of ['master', 'treinador']) {
    const controller = new CentraisController(userDb({ role }), auth, async cliente => {
      assert.deepEqual(cliente, { nomeEmpresa: 'Cliente A', idCentral: '1' });
      return linhasContrato[0];
    });
    const res = response();
    await controller.buscarDados(request, res);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, { central: linhasContrato[0] });
    await controller.buscarDados({ ...request, query: { nome: ['A', 'B'] } }, res);
    assert.equal(res.code, 400);
  }
});
