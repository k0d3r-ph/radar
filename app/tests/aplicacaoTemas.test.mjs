import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { SourceTextModule } from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

// Os utilitários importam sem extensão (padrão do Vite); este carregador resolve `.ts`.
const modulos = new Map();
function carregar(url) {
  let caminho = fileURLToPath(url);
  if (!(existsSync(caminho) && statSync(caminho).isFile())) caminho = `${caminho}.ts`;
  const identificador = pathToFileURL(caminho).href;
  if (modulos.has(identificador)) return modulos.get(identificador);
  const code = ts.transpileModule(readFileSync(caminho, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const modulo = new SourceTextModule(code, { identifier: identificador });
  modulos.set(identificador, modulo);
  return modulo;
}
const modulo = carregar(new URL("../src/utils/aplicacaoTemas.ts", import.meta.url));
await modulo.link((specifier, importador) => carregar(new URL(specifier, importador.identifier)));
await modulo.evaluate();
const {
  montarLinhasAplicacaoTemas,
  renomearTemaAplicacao,
  removerTemaAplicacao,
  restaurarTemaAplicacao,
  adicionarTemaAplicacao,
  listarTemasRemovidosAplicacao,
  validarNomeTemaAplicacao,
  lerAjustesAplicacaoTemas,
  atualizacoesMarcacaoAplicacao,
  isSemAplicacaoMarcada,
} = modulo.namespace;

const dia = (d, h = 10) => new Date(2026, 10, d, h).getTime();
// Como no formulário: createdAt é o momento da aula; dataOcorrencia, o próximo treinamento.
const treino = (d, temas, extra = {}) => ({
  empresa: "Central X", tipo: "Treinamento", descricao: "", departamento: "", responsavel: "",
  createdAt: dia(d), dataOcorrencia: 0, temaOcorrencia: temas, ...extra,
});

const base = {
  nomeEmpresa: "Central X",
  temaText: "Gateway\nDebug\nCliente\nPessoas",
  dataText: "11/11\n11/11\n12/11\n13/11",
  blocoText: "1\n\n\n",
  hoje: new Date(2026, 10, 14, 9),
};

test("cada tema tem a própria linha e a própria marcação, mesmo ensinados no mesmo dia", () => {
  const linhas = montarLinhasAplicacaoTemas({
    ...base,
    ocorrencias: [treino(11, ["Gateway"]), treino(11, ["Debug"], { createdAt: dia(11, 15) })],
    marcacoes: { "2026-11-11|gateway": 2 },
  });
  assert.deepEqual(linhas[0], {
    chave: "2026-11-11|gateway", temas: ["Gateway"], data: "11/11", realizado: true,
    itens: [{ chave: "gateway", nome: "Gateway", original: "Gateway" }],
    diaMarcado: 2, diasDecorridos: 3,
  });
  assert.deepEqual([linhas[1].chave, linhas[1].temas, linhas[1].diaMarcado], ["2026-11-11|debug", ["Debug"], undefined]);
  // Temas previstos também ficam um por linha, mesmo quando a esteira os agrupa num bloco.
  assert.deepEqual(linhas.slice(2).map((l) => [l.chave, l.temas, l.realizado, l.data]), [
    ["pendente-cliente", ["Cliente"], false, "12/11"],
    ["pendente-pessoas", ["Pessoas"], false, "13/11"],
  ]);
  assert.deepEqual(
    montarLinhasAplicacaoTemas({ ...base, ocorrencias: [] }).map((l) => l.chave),
    ["pendente-gateway", "pendente-debug", "pendente-cliente", "pendente-pessoas"],
  );
});

test("marcação antiga por dia vale para os temas do dia; alterar um tema grava os outros um a um", () => {
  const ocorrencias = [treino(11, ["Gateway", "Debug"]), treino(11, ["Cliente"], { createdAt: dia(11, 16) })];
  const marcacoes = { "2026-11-11": 2 };
  // Debug retirado da tabela também herda, para não perder a marcação se for restaurado.
  const ajustes = removerTemaAplicacao(undefined, { chave: "debug", nome: "Debug", original: "Debug" });
  const linhas = montarLinhasAplicacaoTemas({ ...base, ocorrencias, marcacoes, ajustes });
  assert.deepEqual(linhas.filter((l) => l.realizado).map((l) => [l.chave, l.diaMarcado]), [
    ["2026-11-11|gateway", 2],
    ["2026-11-11|cliente", 2],
  ]);

  assert.deepEqual(atualizacoesMarcacaoAplicacao(linhas[1], null), {
    "2026-11-11|gateway": 2,
    "2026-11-11|debug": 2,
    "2026-11-11": null,
    "2026-11-11|cliente": null,
  });

  // Depois da conversão, cada tema segue só a própria chave.
  const convertidas = { "2026-11-11|gateway": 2, "2026-11-11|debug": 2 };
  const depois = montarLinhasAplicacaoTemas({ ...base, ocorrencias, marcacoes: convertidas, ajustes });
  assert.deepEqual(depois.filter((l) => l.realizado).map((l) => [l.temas[0], l.diaMarcado, !!l.herdaMarcacaoDoDia]), [
    ["Gateway", 2, false],
    ["Cliente", undefined, false],
  ]);
  assert.deepEqual(atualizacoesMarcacaoAplicacao(depois[1], 4), { "2026-11-11|cliente": 4 });
});

test("ignora ausências, cancelamentos, outras empresas, revisões e temas já ensinados", () => {
  const linhas = montarLinhasAplicacaoTemas({
    ...base,
    ocorrencias: [
      treino(11, ["Gateway", "Debug"]),
      treino(12, ["Ausente"]),
      treino(12, ["Cliente"], { empresa: "Outra" }),
      treino(13, ["Revisão de Gateway"]),
      treino(13, ["Gateway", "Pessoas"]),
      { ...treino(13, ["Cliente"]), tipo: "Dúvida" },
    ],
  });
  assert.deepEqual(linhas.map((l) => [l.chave, l.temas]), [
    ["2026-11-11|gateway", ["Gateway"]],
    ["2026-11-11|debug", ["Debug"]],
    ["2026-11-13|pessoas", ["Pessoas"]],
    ["pendente-cliente", ["Cliente"]],
  ]);
});

test("não lista o tema Início, com ou sem acento, nem nas linhas realizadas nem nas previstas", () => {
  const linhas = montarLinhasAplicacaoTemas({
    ...base,
    temaText: "Início\nGateway\nDebug",
    dataText: "10/11\n11/11\n12/11",
    blocoText: "",
    ocorrencias: [treino(10, ["Inicio"]), treino(11, ["Início", "Gateway"])],
  });
  assert.deepEqual(linhas.map((l) => [l.chave, l.temas]), [
    ["2026-11-11|gateway", ["Gateway"]],
    ["pendente-debug", ["Debug"]],
  ]);
});

test("usa o dia da aula (createdAt), não a data do próximo treinamento", () => {
  const linhas = montarLinhasAplicacaoTemas({
    ...base,
    ocorrencias: [
      treino(11, ["Gateway", "Debug"], { createdAt: dia(11, 10), dataOcorrencia: dia(12, 10) }),
      // Próximo treinamento ainda no futuro: a aula de hoje já conta como realizada.
      treino(13, ["Cliente"], { dataOcorrencia: dia(20, 10) }),
    ],
  });
  assert.deepEqual(linhas.map((l) => [l.chave, l.temas, l.data]), [
    ["2026-11-11|gateway", ["Gateway"], "11/11"],
    ["2026-11-11|debug", ["Debug"], "11/11"],
    ["2026-11-13|cliente", ["Cliente"], "13/11"],
    ["pendente-pessoas", ["Pessoas"], "13/11"],
  ]);
});

test("registro legado sem createdAt usa dataOcorrencia; data futura é agendamento", () => {
  const linhas = montarLinhasAplicacaoTemas({
    ...base,
    ocorrencias: [
      treino(11, ["Gateway", "Debug"], { createdAt: undefined, dataOcorrencia: dia(11) }),
      treino(15, ["Cliente"], { createdAt: undefined, dataOcorrencia: dia(15) }),
    ],
  });
  assert.deepEqual(linhas.map((l) => [l.temas, l.realizado]), [
    [["Gateway"], true],
    [["Debug"], true],
    [["Cliente"], false],
    [["Pessoas"], false],
  ]);
});

test("descarta marcação fora de D-1 … D-30", () => {
  const [linha] = montarLinhasAplicacaoTemas({
    ...base,
    ocorrencias: [treino(11, ["Gateway"])],
    marcacoes: { "2026-11-11|gateway": 31 },
  });
  assert.equal(linha.diaMarcado, undefined);
});

const itemDe = (linhas, nome) => linhas.flatMap((l) => l.itens).find((i) => i.nome === nome);

test("renomear troca o nome exibido em linhas realizadas e previstas; voltar ao original desfaz", () => {
  const ocorrencias = [treino(11, ["Gateway", "Debug"])];
  let linhas = montarLinhasAplicacaoTemas({ ...base, ocorrencias });
  let ajustes = renomearTemaAplicacao(undefined, itemDe(linhas, "Debug"), "  Leitura   do Debug ");
  ajustes = renomearTemaAplicacao(ajustes, itemDe(linhas, "Pessoas"), "Cadastro de Pessoas");
  linhas = montarLinhasAplicacaoTemas({ ...base, ocorrencias, ajustes });
  assert.deepEqual(linhas.map((l) => l.temas), [["Gateway"], ["Leitura do Debug"], ["Cliente"], ["Cadastro de Pessoas"]]);

  ajustes = renomearTemaAplicacao(ajustes, itemDe(linhas, "Leitura do Debug"), "Debug");
  assert.deepEqual(ajustes.renomeados, { pessoas: "Cadastro de Pessoas" });
});

test("retirar some com a linha do tema sem voltar como previsto; restaurar traz de volta", () => {
  const ocorrencias = [treino(11, ["Gateway"]), treino(12, ["Debug"])];
  const marcacoes = { "2026-11-12|debug": 1 };
  let linhas = montarLinhasAplicacaoTemas({ ...base, ocorrencias, marcacoes });
  let ajustes = removerTemaAplicacao(undefined, itemDe(linhas, "Debug"));
  ajustes = removerTemaAplicacao(ajustes, itemDe(linhas, "Cliente"));
  linhas = montarLinhasAplicacaoTemas({ ...base, ocorrencias, ajustes, marcacoes });
  assert.deepEqual(linhas.map((l) => [l.chave, l.temas]), [["2026-11-11|gateway", ["Gateway"]], ["pendente-pessoas", ["Pessoas"]]]);
  assert.deepEqual(listarTemasRemovidosAplicacao(ajustes).map((r) => r.nome), ["Cliente", "Debug"]);

  // A marcação do tema fica guardada e volta junto com ele.
  ajustes = restaurarTemaAplicacao(ajustes, "debug");
  linhas = montarLinhasAplicacaoTemas({ ...base, ocorrencias, ajustes, marcacoes });
  assert.deepEqual(linhas[1], { ...linhas[1], chave: "2026-11-12|debug", temas: ["Debug"], diaMarcado: 1 });
});

test("incluir cria a linha do tema no dia informado, tira da lista de previstos e respeita data futura", () => {
  const ocorrencias = [treino(11, ["Gateway"])];
  let ajustes = adicionarTemaAplicacao(undefined, { id: "a1", tema: "Debug", dia: "2026-11-11" });
  ajustes = adicionarTemaAplicacao(ajustes, { id: "a2", tema: " Calculadora ", dia: "2026-11-09" });
  ajustes = adicionarTemaAplicacao(ajustes, { id: "a3", tema: "Videotelemetria", dia: "2026-11-20" });
  const linhas = montarLinhasAplicacaoTemas({ ...base, ocorrencias, ajustes, marcacoes: { "2026-11-09|calculadora": 3 } });
  assert.deepEqual(linhas.map((l) => [l.chave, l.temas, l.realizado]), [
    ["2026-11-09|calculadora", ["Calculadora"], true],
    ["2026-11-11|gateway", ["Gateway"], true],
    ["2026-11-11|debug", ["Debug"], true],
    ["pendente-cliente", ["Cliente"], false],
    ["pendente-pessoas", ["Pessoas"], false],
    ["2026-11-20|videotelemetria", ["Videotelemetria"], false],
  ]);
  assert.equal(linhas[0].diaMarcado, 3);
  assert.equal(linhas[5].diaMarcado, undefined);

  // Excluir um tema incluído apaga a inclusão (não vai para "retirados").
  const semDebug = removerTemaAplicacao(ajustes, itemDe(linhas, "Debug"));
  assert.deepEqual(semDebug.adicionados.map((a) => a.id), ["a2", "a3"]);
  assert.deepEqual(semDebug.removidos, {});
});

test("ocorrência vence a inclusão manual do mesmo tema", () => {
  const ajustes = adicionarTemaAplicacao(undefined, { id: "a1", tema: "gateway", dia: "2026-11-13" });
  const linhas = montarLinhasAplicacaoTemas({ ...base, ocorrencias: [treino(11, ["Gateway"])], ajustes });
  assert.deepEqual(linhas[0].temas, ["Gateway"]);
  assert.equal(linhas.some((l) => l.chave.startsWith("2026-11-13")), false);
});

test("validação do nome barra vazio, repetido e tema retirado (na inclusão)", () => {
  const ocorrencias = [treino(11, ["Gateway", "Debug"])];
  const ajustes = removerTemaAplicacao(undefined, itemDe(montarLinhasAplicacaoTemas({ ...base, ocorrencias }), "Cliente"));
  const linhas = montarLinhasAplicacaoTemas({ ...base, ocorrencias, ajustes });
  assert.match(validarNomeTemaAplicacao("  ", linhas, ajustes), /Informe/);
  assert.match(validarNomeTemaAplicacao("debug", linhas, ajustes), /Já existe/);
  assert.match(validarNomeTemaAplicacao(" Cliente", linhas, ajustes), /Restaurar/);
  assert.equal(validarNomeTemaAplicacao("Novo tema", linhas, ajustes), null);
  // Renomear o próprio tema (só mudando maiúsculas) é permitido.
  assert.equal(validarNomeTemaAplicacao("DEBUG", linhas, ajustes, itemDe(linhas, "Debug")), null);
  assert.match(validarNomeTemaAplicacao("Gateway", linhas, ajustes, itemDe(linhas, "Debug")), /Já existe/);
});

test("ajustes malformados vindos do Firestore são ignorados", () => {
  assert.deepEqual(
    lerAjustesAplicacaoTemas({
      renomeados: { a: "A", b: 3 },
      removidos: [],
      adicionados: [{ id: "x", tema: "T", dia: "2026-11-11" }, { id: "y", tema: "", dia: "2026-11-11" }, { id: "z", tema: "T", dia: "11/11" }],
    }),
    { renomeados: { a: "A" }, removidos: {}, adicionados: [{ id: "x", tema: "T", dia: "2026-11-11" }] },
  );
});

test("D-0 (aplicou antes do treinamento) é uma marcação válida; acima de D-30 não", () => {
  const linhas = montarLinhasAplicacaoTemas({
    ...base,
    ocorrencias: [treino(11, ["Gateway", "Debug"])],
    marcacoes: { "2026-11-11|gateway": 0, "2026-11-11|debug": 31 },
  });
  assert.deepEqual(linhas.slice(0, 2).map((l) => l.diaMarcado), [0, undefined]);
});

test("vermelho só para tema ensinado, com D-1 alcançado e sem marcação", () => {
  const linhas = montarLinhasAplicacaoTemas({
    ...base,
    // Hoje é 14/11: Gateway (11/11) marcado, Debug (11/11) sem marcação, Cliente ensinado hoje.
    ocorrencias: [treino(11, ["Gateway", "Debug"]), treino(14, ["Cliente"], { createdAt: dia(14, 8) })],
    marcacoes: { "2026-11-11|gateway": 0 },
  });
  assert.deepEqual(linhas.map((l) => [l.temas[0], isSemAplicacaoMarcada(l)]), [
    ["Gateway", false],
    ["Debug", true],
    ["Cliente", false],
    ["Pessoas", false],
  ]);
});
