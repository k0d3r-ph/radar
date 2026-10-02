import assert from 'node:assert/strict';
import test from 'node:test';
import { baixarCentrais, extrairCentrais, urlExportacaoPlanilha } from '../dist/infrastructure/planilha/PlanilhaCentraisService.js';

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
