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
const modulo = carregar(new URL("../src/utils/certificadoTreinamento.ts", import.meta.url));
await modulo.link((specifier, importador) => carregar(new URL(specifier, importador.identifier)));
await modulo.evaluate();
const {
  arredondarMinutos,
  calcularDadosCertificado,
  dataCertificadoValida,
  formatarCargaHoraria,
  mascararDataCertificado,
  montarTextoCertificado,
  nomeArquivoCertificado,
  participantesSugeridos,
} = modulo.namespace;

// Meio-dia em Brasília (UTC-3), para a data não virar de dia na conversão.
const dia = (iso) => Date.parse(`${iso}T15:00:00Z`);
const treino = (id, iso, tempo, extra = {}) => ({
  id, empresa: "Cliente X", tipo: "Treinamento", temaOcorrencia: ["Debug"],
  treinamentoTempoAgenda: tempo, createdAt: dia(iso), ...extra,
});

test("carga horária arredonda para 10 minutos e formata como no certificado", () => {
  assert.equal(arredondarMinutos(457), 460);
  assert.equal(arredondarMinutos(454), 450);
  assert.equal(arredondarMinutos(3), 10);
  assert.equal(formatarCargaHoraria(460), "7h40min");
  assert.equal(formatarCargaHoraria(480), "8h");
  assert.equal(formatarCargaHoraria(40), "40min");
  assert.equal(formatarCargaHoraria(605), "10h05min");
});

test("soma as agendas realizadas do cliente até a validação e monta o período", () => {
  const ocorrencias = [
    treino("a", "2024-02-05", "02:00"),
    treino("b", "2024-02-20", "01:47", { temaOcorrencia: ["Revisão de Debug"] }),
    treino("c", "2024-03-01", "01:30", { temaOcorrencia: ["Ausente"] }), // não realizado
    treino("d", "2024-01-10", "05:00", { empresa: "Outro cliente" }),
    treino("e", "2024-04-20", "03:00"), // depois da validação
    { id: "f", empresa: "Cliente X", tipo: "Informativo", createdAt: dia("2024-01-02") },
    treino("val", "2024-03-11", "03:50", { temaOcorrencia: ["Validação do conhecimento"] }),
  ];
  const dados = calcularDadosCertificado(
    { empresa: "Cliente X", concluidaEm: dia("2024-03-11"), percentual: 89.4, ocorrenciaId: "val", treinamentoTempoAgenda: "03:50" },
    ocorrencias,
    dia("2024-04-08"),
  );
  assert.equal(dados.minutosExatos, 120 + 107 + 230);
  assert.equal(dados.agendas, 3);
  assert.equal(dados.cargaHoraria, "7h40min");
  assert.equal(dados.inicio, "05/02/2024");
  assert.equal(dados.fim, "11/03/2024");
  assert.equal(dados.aproveitamento, "89%");
  assert.equal(dados.dataGeracao, "08/04/2024");
});

test("inclui a agenda da validação quando a ocorrência ainda não está no cache", () => {
  const dados = calcularDadosCertificado(
    { empresa: "Cliente X", concluidaEm: dia("2024-03-11"), percentual: 100, ocorrenciaId: "nova", treinamentoTempoAgenda: "01:00" },
    [treino("a", "2024-02-05", "02:00")],
    dia("2024-03-11"),
  );
  assert.equal(dados.minutosExatos, 180);
  assert.equal(dados.cargaHoraria, "3h");
});

test("sem treinamentos anteriores, o período começa e termina na validação", () => {
  const dados = calcularDadosCertificado(
    { empresa: "Cliente X", concluidaEm: dia("2024-03-11"), percentual: 80, treinamentoTempoAgenda: "02:00" },
    [],
    dia("2024-03-12"),
  );
  assert.equal(dados.inicio, "11/03/2024");
  assert.equal(dados.fim, "11/03/2024");
});

test("texto das duas versões do certificado", () => {
  const base = { cargaHoraria: "7h40min", inicio: "05/02/2024", fim: "11/03/2024", aproveitamento: "89%" };
  assert.equal(
    montarTextoCertificado({ ...base, tipo: "roubo_furto" }),
    "Concluiu o treinamento da plataforma SSX, com ênfase em Roubo e Furto com carga horária de 7h40min, no período de 05/02/2024 a 11/03/2024. Obteve 89% de aproveitamento.",
  );
  assert.match(montarTextoCertificado({ ...base, tipo: "gestao_frotas" }), /ênfase em Gestão de Frotas com carga/);
});

test("datas, nomes sugeridos e nome do arquivo", () => {
  assert.equal(mascararDataCertificado("08042024"), "08/04/2024");
  assert.equal(mascararDataCertificado("0804"), "08/04");
  assert.equal(dataCertificadoValida("31/02/2024"), false);
  assert.equal(dataCertificadoValida("29/02/2024"), true);
  assert.deepEqual(
    participantesSugeridos([{ nome: " Robson  Ramos " }, { nome: "robson ramos" }, { nome: "" }, { nome: "Ana" }]),
    ["Robson Ramos", "Ana"],
  );
  assert.equal(nomeArquivoCertificado("João Ávila", "08/04/2024"), "certificado-joao-avila-08-04-2024.jpg");
});
