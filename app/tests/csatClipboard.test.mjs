import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, SourceTextModule } from 'node:vm';
import ts from 'typescript';

const ler = arquivo => readFileSync(new URL(`../src/${arquivo}`, import.meta.url), 'utf8');
function procurar(arquivo, predicado) {
  const source = ts.createSourceFile('pagina.tsx', ler(arquivo), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let encontrado;
  function visitar(node) { if (!encontrado && predicado(node)) encontrado = node; if (!encontrado) ts.forEachChild(node, visitar); }
  visitar(source);
  assert.ok(encontrado, `Fluxo não encontrado em ${arquivo}`);
  return encontrado;
}

async function cenario(fluxo, { bloquear = false, falharGeracao = false, semClipboard = false } = {}) {
  const estado = { eventos: [], copias: [], sucessos: [], avisos: [], erros: [], reservas: [], atual: null };
  const reserva = { id: 'r1', token: 'token-de-teste', idSeqFormatted: '#1' };
  const concluida = { id: 't1', status: 'concluida', csatToken: 'token-de-teste', concluiuEsteira: true };
  const clipboard = { writeText: async texto => { estado.eventos.push('copiar'); if (bloquear) throw Error('Permissão negada'); estado.copias.push(texto); } };
  const context = createContext({
    Error, console, navigator: semClipboard ? {} : { clipboard },
    isTreinador: true, gerandoCsat: false, ultimaReservaCsat: null, carregandoReservasCsat: false, erroReservasCsat: '',
    empresasList: [{ id: 'e1', nomeEmpresa: 'Cliente Teste' }], atual: { id: 't1', numero: 1 },
    setErroGerarCsat: erro => { if (erro) estado.erros.push(erro); }, setGerandoCsat() {}, setModalCsatAberto() {},
    setReservasCsat: valor => { estado.reservas = typeof valor === 'function' ? valor(estado.reservas) : valor; },
    requisicaoCsat: async (_path, body) => { if (!body) return []; estado.eventos.push('gerar'); if (falharGeracao) throw Error('Falha na API'); return reserva; },
    listarEmpresas: async () => { estado.eventos.push('atualizar'); return []; }, setEmpresasList() {},
    salvarTentativaConhecimento: async t => { estado.eventos.push('salvar'); return t; },
    concluirTentativaConhecimento: async () => { estado.eventos.push('concluir'); if (falharGeracao) throw Error('Falha na API'); return concluida; },
    guardar: t => { estado.atual = t; }, prepararAvisoConclusao: async () => { estado.eventos.push('aviso'); },
    linkCsat: token => `https://radar.test/csat/${token}`,
    toast: { success: texto => estado.sucessos.push(texto), warning: texto => estado.avisos.push(texto), error: texto => estado.erros.push(texto) },
  });
  async function carregar(codigo) {
    const js = ts.transpileModule(codigo, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const modulo = new SourceTextModule(js, { context }); await modulo.link(() => { throw Error('Import inesperado'); }); await modulo.evaluate(); return modulo.namespace;
  }
  context.copiarTexto = (await carregar(ler('utils/clipboard.ts'))).copiarTexto;
  let codigo;
  if (fluxo === 'historico') {
    const node = procurar('pages/Historico/Historico.tsx', n => ts.isFunctionDeclaration(n) && n.name?.text === 'gerarCsat');
    codigo = `${node.getText()}\nexport { gerarCsat as executar };`;
  } else {
    const node = procurar('pages/ValidacaoConhecimento/ValidacaoConhecimento.tsx', n => ts.isCallExpression(n) && n.expression.getText() === 'executar' && n.arguments[0] && ts.isArrowFunction(n.arguments[0]) && n.arguments[0].getText().includes('concluirTentativaConhecimento'));
    codigo = `export const executar = ${node.arguments[0].getText()};`;
  }
  return { estado, executar: (await carregar(codigo)).executar };
}

for (const fluxo of ['historico', 'validacao']) {
  test(`${fluxo}: copia o link completo assim que a geração retorna, antes das atualizações secundárias`, async () => {
    const { estado, executar } = await cenario(fluxo);
    assert.equal(estado.copias.length, 0);
    await executar('e1');
    assert.deepEqual(estado.copias, ['https://radar.test/csat/token-de-teste']);
    assert.deepEqual(estado.eventos, fluxo === 'historico' ? ['gerar', 'copiar', 'atualizar'] : ['salvar', 'concluir', 'copiar', 'aviso']);
    assert.ok(estado.sucessos.some(texto => texto.includes('copiado')));
  });
  test(`${fluxo}: bloqueio da área de transferência mantém a geração bem-sucedida e orienta cópia manual`, async () => {
    const { estado, executar } = await cenario(fluxo, { bloquear: true });
    await executar('e1');
    assert.equal(estado.copias.length, 0); assert.equal(estado.erros.length, 0);
    assert.ok(estado.avisos.some(texto => texto.includes('Copiar link')));
    assert.equal(fluxo === 'historico' ? estado.reservas[0].token : estado.atual.csatToken, 'token-de-teste');
  });
  test(`${fluxo}: falha da geração não copia nenhum link`, async () => {
    const { estado, executar } = await cenario(fluxo, { falharGeracao: true });
    if (fluxo === 'historico') await executar('e1'); else await assert.rejects(executar(), /Falha na API/);
    assert.equal(estado.copias.length, 0); assert.equal(estado.eventos.includes('copiar'), false);
  });
}
test('área de transferência indisponível não interrompe a reserva gerada', async () => {
  const { estado, executar } = await cenario('historico', { semClipboard: true });
  await executar('e1');
  assert.equal(estado.reservas.length, 1); assert.equal(estado.avisos.length, 1); assert.equal(estado.erros.length, 0);
});
