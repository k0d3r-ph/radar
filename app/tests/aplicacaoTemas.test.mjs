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
const { montarLinhasAplicacaoTemas } = modulo.namespace;

const dia = (d, h = 10) => new Date(2026, 10, d, h).getTime();
const treino = (d, temas, extra = {}) => ({
  empresa: "Central X", tipo: "Treinamento", descricao: "", departamento: "", responsavel: "",
  dataOcorrencia: dia(d), temaOcorrencia: temas, ...extra,
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
    ocorrencias: [treino(11, ["Gateway"]), treino(11, ["Debug"], { dataOcorrencia: dia(11, 15) })],
    marcacoes: { "2026-11-11": 2 },
  });
  assert.deepEqual(linhas[0], {
    chave: "2026-11-11", temas: ["Gateway", "Debug"], data: "11/11", realizado: true,
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

test("treinamento com data futura é agendamento: o tema continua aguardando", () => {
  const linhas = montarLinhasAplicacaoTemas({
    ...base,
    ocorrencias: [treino(11, ["Gateway", "Debug"]), treino(15, ["Cliente"])],
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
