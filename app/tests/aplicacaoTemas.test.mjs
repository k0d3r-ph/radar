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

test("agrupa na mesma linha os temas ensinados no mesmo dia, inclusive em ocorrências diferentes", () => {
  const linhas = montarLinhasAplicacaoTemas({
    ...base,
    ocorrencias: [treino(11, ["Gateway"]), treino(11, ["Debug"], { createdAt: dia(11, 15) })],
    marcacoes: { "2026-11-11": 2 },
  });
  assert.deepEqual(linhas[0], {
    chave: "2026-11-11", temas: ["Gateway", "Debug"], data: "11/11", realizado: true,
    itens: [
      { chave: "gateway", nome: "Gateway", original: "Gateway" },
      { chave: "debug", nome: "Debug", original: "Debug" },
    ],
    diaMarcado: 2, diasDecorridos: 3,
  });
  assert.deepEqual(linhas.slice(1).map((l) => [l.temas, l.realizado, l.data]), [
    [["Cliente"], false, "12/11"],
    [["Pessoas"], false, "13/11"],
  ]);
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
    ["2026-11-11", ["Gateway", "Debug"]],
    ["2026-11-13", ["Pessoas"]],
    ["pendente-1", ["Cliente"]],
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
    ["2026-11-11", ["Gateway"]],
    ["pendente-2", ["Debug"]],
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
    ["2026-11-11", ["Gateway", "Debug"], "11/11"],
    ["2026-11-13", ["Cliente"], "13/11"],
    ["pendente-2", ["Pessoas"], "13/11"],
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
    [["Gateway", "Debug"], true],
    [["Cliente"], false],
    [["Pessoas"], false],
  ]);
});

test("descarta marcação fora de D-1 … D-30", () => {
  const [linha] = montarLinhasAplicacaoTemas({
    ...base,
    ocorrencias: [treino(11, ["Gateway"])],
    marcacoes: { "2026-11-11": 31 },
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
  assert.deepEqual(linhas.map((l) => l.temas), [["Gateway", "Leitura do Debug"], ["Cliente"], ["Cadastro de Pessoas"]]);

  ajustes = renomearTemaAplicacao(ajustes, itemDe(linhas, "Leitura do Debug"), "Debug");
  assert.deepEqual(ajustes.renomeados, { pessoas: "Cadastro de Pessoas" });
});

test("retirar some com o tema (e com a linha vazia) sem voltar como previsto; restaurar traz de volta", () => {
  const ocorrencias = [treino(11, ["Gateway"]), treino(12, ["Debug"])];
  let linhas = montarLinhasAplicacaoTemas({ ...base, ocorrencias, marcacoes: { "2026-11-12": 1 } });
  let ajustes = removerTemaAplicacao(undefined, itemDe(linhas, "Debug"));
  ajustes = removerTemaAplicacao(ajustes, itemDe(linhas, "Cliente"));
  linhas = montarLinhasAplicacaoTemas({ ...base, ocorrencias, ajustes, marcacoes: { "2026-11-12": 1 } });
  assert.deepEqual(linhas.map((l) => [l.chave, l.temas]), [["2026-11-11", ["Gateway"]], ["pendente-2", ["Pessoas"]]]);
  assert.deepEqual(listarTemasRemovidosAplicacao(ajustes).map((r) => r.nome), ["Cliente", "Debug"]);

  // A marcação do dia fica guardada e volta junto com o tema.
  ajustes = restaurarTemaAplicacao(ajustes, "debug");
  linhas = montarLinhasAplicacaoTemas({ ...base, ocorrencias, ajustes, marcacoes: { "2026-11-12": 1 } });
  assert.deepEqual(linhas[1], { ...linhas[1], chave: "2026-11-12", temas: ["Debug"], diaMarcado: 1 });
});

test("incluir junta o tema ao dia existente, abre linha nova, tira da lista de previstos e respeita data futura", () => {
  const ocorrencias = [treino(11, ["Gateway"])];
  let ajustes = adicionarTemaAplicacao(undefined, { id: "a1", tema: "Debug", dia: "2026-11-11" });
  ajustes = adicionarTemaAplicacao(ajustes, { id: "a2", tema: " Calculadora ", dia: "2026-11-09" });
  ajustes = adicionarTemaAplicacao(ajustes, { id: "a3", tema: "Videotelemetria", dia: "2026-11-20" });
  const linhas = montarLinhasAplicacaoTemas({ ...base, ocorrencias, ajustes, marcacoes: { "2026-11-09": 3 } });
  assert.deepEqual(linhas.map((l) => [l.chave, l.temas, l.realizado]), [
    ["2026-11-09", ["Calculadora"], true],
    ["2026-11-11", ["Gateway", "Debug"], true],
    ["pendente-1", ["Cliente"], false],
    ["pendente-2", ["Pessoas"], false],
    ["2026-11-20", ["Videotelemetria"], false],
  ]);
  assert.equal(linhas[0].diaMarcado, 3);
  assert.equal(linhas[4].diaMarcado, undefined);

  // Excluir um tema incluído apaga a inclusão (não vai para "retirados").
  const semDebug = removerTemaAplicacao(ajustes, itemDe(linhas, "Debug"));
  assert.deepEqual(semDebug.adicionados.map((a) => a.id), ["a2", "a3"]);
  assert.deepEqual(semDebug.removidos, {});
});

test("ocorrência vence a inclusão manual do mesmo tema", () => {
  const ajustes = adicionarTemaAplicacao(undefined, { id: "a1", tema: "gateway", dia: "2026-11-13" });
  const linhas = montarLinhasAplicacaoTemas({ ...base, ocorrencias: [treino(11, ["Gateway"])], ajustes });
  assert.deepEqual(linhas[0].temas, ["Gateway"]);
  assert.equal(linhas.some((l) => l.chave === "2026-11-13"), false);
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
