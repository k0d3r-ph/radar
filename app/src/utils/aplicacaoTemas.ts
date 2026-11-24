import type {
  AjustesAplicacaoTemas,
  Ocorrencia,
  TemaAplicacaoAdicionado,
} from "../types";
import { normalizarEmpresaOcorrencia } from "./registroTreinamento";
import {
  instanteRealizacaoTreinamento,
  isTreinamentoRealizado,
  lerTemasTreinamento,
} from "./temasTreinamento";
import { textosParaLinhasTema } from "./temasEsteira";

/** Colunas D-0 … D-30 da tabela de aplicação dos temas na base do cliente. */
export const TOTAL_DIAS_APLICACAO = 30;
/** D-0: o cliente já aplicou o tema na base antes mesmo do treinamento. */
export const DIA_APLICACAO_ANTES_DO_TREINAMENTO = 0;

/**
 * Uma linha da tabela "Aplicação dos temas": um tema, já ensinado (`realizado`) ou
 * ainda planejado na esteira (somente leitura). Cada tema tem a própria linha, mesmo
 * quando vários foram ensinados no mesmo dia, porque o cliente pode aplicar um e não
 * o outro.
 */
export type LinhaAplicacaoTema = {
  /**
   * Nas linhas realizadas, a chave da marcação em `aplicacaoTemasDias`:
   * `YYYY-MM-DD|<chave do tema>` ({@link chaveMarcacaoAplicacao}). Nas planejadas,
   * `pendente-<chave do tema>`.
   */
  chave: string;
  /** Nomes exibidos (já com os ajustes), na mesma ordem de {@link itens}. */
  temas: string[];
  itens: ItemTemaAplicacao[];
  /** DD/MM do treinamento realizado, ou a data planejada na esteira (pode ser vazia). */
  data: string;
  realizado: boolean;
  /** Dia D-N marcado pelo treinador, quando houver (0 = já aplicou antes do treinamento). */
  diaMarcado?: number;
  /** Dias corridos desde o treinamento até `hoje`; limita quais colunas podem ser marcadas. */
  diasDecorridos?: number;
  /**
   * Presente quando a marcação vem do formato antigo, gravado por dia (`YYYY-MM-DD`) e
   * compartilhado por todos os temas daquele dia. Lista as chaves por tema de todos os
   * temas do dia que ainda herdam esse valor (inclusive retirados da tabela), para a
   * próxima marcação gravá-los um a um antes de apagar a chave do dia.
   */
  herdaMarcacaoDoDia?: { diaTreinamento: string; chaves: string[] };
};

/** Chave da marcação de um tema em `aplicacaoTemasDias`. */
export const chaveMarcacaoAplicacao = (
  diaTreinamento: string,
  chaveTema: string,
) => `${diaTreinamento}|${chaveTema}`;

/**
 * Gravações para marcar (ou limpar, com `null`) o D-N de uma linha. Se a linha ainda
 * herda a marcação antiga do dia, os demais temas daquele dia recebem esse valor na
 * própria chave e a chave do dia é apagada — assim mexer num tema não muda os outros.
 */
export function atualizacoesMarcacaoAplicacao(
  linha: LinhaAplicacaoTema,
  dia: number | null,
): Record<string, number | null> {
  const atualizacoes: Record<string, number | null> = {};
  const herdada = linha.herdaMarcacaoDoDia;
  if (herdada && linha.diaMarcado !== undefined) {
    herdada.chaves.forEach(
      (chave) => (atualizacoes[chave] = linha.diaMarcado!),
    );
    atualizacoes[herdada.diaTreinamento] = null;
  }
  atualizacoes[linha.chave] = dia;
  return atualizacoes;
}

/** Um tema dentro de uma linha da tabela, com o necessário para renomear ou retirar. */
export type ItemTemaAplicacao = {
  /** {@link chaveTemaAplicacao} do nome original: identifica o tema nos ajustes. */
  chave: string;
  /** Nome exibido (renomeado, quando houver ajuste). */
  nome: string;
  /** Nome como veio da ocorrência, da esteira ou da inclusão manual. */
  original: string;
  /** Presente quando o tema foi incluído à mão na tabela. */
  adicionadoId?: string;
};

const limparEspacos = (texto: string) => texto.trim().replace(/\s+/g, " ");

/** Identidade de um tema, sem diferenciar maiúsculas nem espaços extras. */
export const chaveTemaAplicacao = (tema: string) =>
  limparEspacos(tema).toLowerCase();
const normalizarTema = chaveTemaAplicacao;

const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const isTexto = (valor: unknown): valor is string =>
  typeof valor === "string" && valor.trim().length > 0;

function lerMapaTextos(valor: unknown): Record<string, string> {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  return Object.fromEntries(
    Object.entries(valor as Record<string, unknown>).filter(
      (entrada): entrada is [string, string] => isTexto(entrada[1]),
    ),
  );
}

function isAdicionadoValido(valor: unknown): valor is TemaAplicacaoAdicionado {
  if (!valor || typeof valor !== "object") return false;
  const a = valor as Record<string, unknown>;
  return (
    isTexto(a.id) &&
    isTexto(a.tema) &&
    typeof a.dia === "string" &&
    DIA_ISO.test(a.dia)
  );
}

/** Lê os ajustes gravados no Firestore descartando entradas malformadas. */
export function lerAjustesAplicacaoTemas(
  valor: unknown,
): Required<AjustesAplicacaoTemas> {
  const bruto =
    valor && typeof valor === "object"
      ? (valor as Record<string, unknown>)
      : {};
  return {
    renomeados: lerMapaTextos(bruto.renomeados),
    removidos: lerMapaTextos(bruto.removidos),
    adicionados: Array.isArray(bruto.adicionados)
      ? bruto.adicionados.filter(isAdicionadoValido)
      : [],
  };
}

/** Novo nome de um tema da tabela. Voltar ao nome original desfaz o ajuste. */
export function renomearTemaAplicacao(
  ajustes: AjustesAplicacaoTemas | undefined,
  item: ItemTemaAplicacao,
  novoNome: string,
): Required<AjustesAplicacaoTemas> {
  const atual = lerAjustesAplicacaoTemas(ajustes);
  const nome = limparEspacos(novoNome);
  if (item.adicionadoId) {
    return {
      ...atual,
      adicionados: atual.adicionados.map((a) =>
        a.id === item.adicionadoId ? { ...a, tema: nome } : a,
      ),
    };
  }
  const renomeados = { ...atual.renomeados };
  if (nome === limparEspacos(item.original)) delete renomeados[item.chave];
  else renomeados[item.chave] = nome;
  return { ...atual, renomeados };
}

/** Tira o tema da tabela e do gráfico. Um tema incluído à mão é apagado. */
export function removerTemaAplicacao(
  ajustes: AjustesAplicacaoTemas | undefined,
  item: ItemTemaAplicacao,
): Required<AjustesAplicacaoTemas> {
  const atual = lerAjustesAplicacaoTemas(ajustes);
  if (item.adicionadoId) {
    return {
      ...atual,
      adicionados: atual.adicionados.filter((a) => a.id !== item.adicionadoId),
    };
  }
  return {
    ...atual,
    removidos: { ...atual.removidos, [item.chave]: item.original },
  };
}

export function restaurarTemaAplicacao(
  ajustes: AjustesAplicacaoTemas | undefined,
  chave: string,
): Required<AjustesAplicacaoTemas> {
  const atual = lerAjustesAplicacaoTemas(ajustes);
  const removidos = { ...atual.removidos };
  delete removidos[chave];
  return { ...atual, removidos };
}

/** Inclui um tema na linha do dia informado (ou abre uma linha para esse dia). */
export function adicionarTemaAplicacao(
  ajustes: AjustesAplicacaoTemas | undefined,
  adicionado: TemaAplicacaoAdicionado,
): Required<AjustesAplicacaoTemas> {
  const atual = lerAjustesAplicacaoTemas(ajustes);
  return {
    ...atual,
    adicionados: [
      ...atual.adicionados,
      { ...adicionado, tema: limparEspacos(adicionado.tema) },
    ],
  };
}

/** Temas retirados da tabela, com o nome exibido antes da retirada. */
export function listarTemasRemovidosAplicacao(
  ajustes: AjustesAplicacaoTemas | undefined,
): { chave: string; nome: string }[] {
  const { removidos, renomeados } = lerAjustesAplicacaoTemas(ajustes);
  return Object.entries(removidos)
    .map(([chave, original]) => ({
      chave,
      nome: renomeados[chave] ?? original,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

const mesmoItem = (a: ItemTemaAplicacao, b: ItemTemaAplicacao) =>
  a.chave === b.chave && a.adicionadoId === b.adicionadoId;

/**
 * Valida o nome ao renomear (`item`) ou incluir um tema: impede nome vazio ou repetido
 * na tabela e, na inclusão, aponta "Restaurar" quando o tema foi retirado antes.
 */
export function validarNomeTemaAplicacao(
  nome: string,
  linhas: LinhaAplicacaoTema[],
  ajustes: AjustesAplicacaoTemas | undefined,
  item?: ItemTemaAplicacao,
): string | null {
  const chave = chaveTemaAplicacao(nome);
  if (!chave) return "Informe o nome do tema.";
  if (chave.length > 120) return "Use no máximo 120 caracteres.";
  const repetido = linhas.some((l) =>
    l.itens.some(
      (i) =>
        !(item && mesmoItem(i, item)) &&
        (chaveTemaAplicacao(i.nome) === chave || i.chave === chave),
    ),
  );
  if (repetido) return "Já existe um tema com esse nome na tabela.";
  if (!item && lerAjustesAplicacaoTemas(ajustes).removidos[chave]) {
    return "Esse tema foi retirado da tabela. Use “Restaurar” na lista de temas retirados.";
  }
  return null;
}

/**
 * Temas que não são aplicados pelo cliente no dia a dia (ex.: "Início", a abertura da
 * esteira) e por isso ficam fora da tabela e do gráfico de aplicação.
 */
const TEMAS_SEM_APLICACAO = new Set(["inicio"]);

function isTemaComAplicacao(tema: string): boolean {
  const semAcento = normalizarTema(tema).normalize("NFD").replace(/[̀-ͯ]/g, "");
  return !TEMAS_SEM_APLICACAO.has(semAcento);
}

function dataLocalISO(data: Date): string {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

function diasEntre(inicioISO: string, fim: Date): number {
  const [ano, mes, dia] = inicioISO.split("-").map(Number);
  const inicio = new Date(ano, mes - 1, dia);
  const fimDia = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate());
  return Math.round((fimDia.getTime() - inicio.getTime()) / 86_400_000);
}

/** Aceita só marcações D-0 … D-30 vindas do Firestore. */
export function isDiaAplicacaoValido(valor: unknown): valor is number {
  return (
    Number.isInteger(valor) &&
    (valor as number) >= DIA_APLICACAO_ANTES_DO_TREINAMENTO &&
    (valor as number) <= TOTAL_DIAS_APLICACAO
  );
}

/**
 * Tema já ensinado, com o D-1 já alcançado e sem nenhuma marcação: a tabela destaca a
 * linha em vermelho. Antes disso (previsto, ou treinamento hoje) segue o padrão.
 */
export function isSemAplicacaoMarcada(linha: LinhaAplicacaoTema): boolean {
  return (
    linha.realizado &&
    (linha.diasDecorridos ?? 0) >= 1 &&
    linha.diaMarcado === undefined
  );
}

/**
 * Monta as linhas da tabela, uma por tema, a partir das ocorrências de Treinamento
 * realizadas do cliente (ausências e cancelamentos ficam de fora). Cada tema entra apenas
 * no primeiro dia em que foi ensinado; revisões não abrem linha nova, porque o
 * aprendizado já foi contado no treinamento original. "Início" também fica de fora
 * (ver {@link TEMAS_SEM_APLICACAO}). Temas da esteira ainda não ensinados aparecem
 * depois, na ordem da esteira e sem permitir marcação. A marcação é por tema
 * ({@link chaveMarcacaoAplicacao}); a antiga, gravada por dia, vale para todos os temas
 * daquele dia até que um deles seja alterado.
 * Por fim, os `ajustes` do treinador: nomes trocados, temas retirados (somem da tabela
 * e do gráfico, sem voltar como previstos) e temas incluídos à mão, cada um na própria linha, com o dia
 * informado — com data futura, a linha fica prevista até o dia chegar.
 */
export function montarLinhasAplicacaoTemas(params: {
  nomeEmpresa: string;
  ocorrencias: Ocorrencia[];
  temaText?: string;
  dataText?: string;
  blocoText?: string;
  marcacoes?: Record<string, number>;
  ajustes?: AjustesAplicacaoTemas;
  hoje?: Date;
}): LinhaAplicacaoTema[] {
  const {
    nomeEmpresa,
    ocorrencias,
    temaText,
    dataText,
    blocoText,
    marcacoes = {},
    hoje = new Date(),
  } = params;
  const { renomeados, removidos, adicionados } = lerAjustesAplicacaoTemas(
    params.ajustes,
  );
  const hojeISO = dataLocalISO(hoje);
  const itemOriginal = (original: string): ItemTemaAplicacao => {
    const chave = chaveTemaAplicacao(original);
    return { chave, nome: renomeados[chave] ?? original, original };
  };
  // Retirados continuam contando como ensinados, para não reaparecerem como previstos.
  const visivel = (item: ItemTemaAplicacao) =>
    !!item.adicionadoId || !removidos[item.chave];
  const empresa = normalizarEmpresaOcorrencia(nomeEmpresa);

  const treinamentos = ocorrencias
    .filter(
      (o) =>
        normalizarEmpresaOcorrencia(o.empresa || "") === empresa &&
        isTreinamentoRealizado(o),
    )
    // Dia da aula, não o "próximo treinamento" guardado em dataOcorrencia.
    .map((o) => ({ o, instante: instanteRealizacaoTreinamento(o) }))
    // Registro legado (sem createdAt) com data futura é agendamento, não realizado.
    .filter(({ instante }) => instante > 0 && instante <= hoje.getTime())
    .sort((a, b) => a.instante - b.instante);

  const ensinados = new Set<string>();
  const porDia = new Map<string, ItemTemaAplicacao[]>();

  for (const { o, instante } of treinamentos) {
    const { temas, temasRevisados } = lerTemasTreinamento(
      o.temaOcorrencia ?? [],
      o.isRevisao,
    );
    const novos = temas.filter(
      (t) =>
        isTemaComAplicacao(t) &&
        !temasRevisados.includes(t) &&
        !ensinados.has(normalizarTema(t)),
    );
    if (novos.length === 0) continue;
    const dia = dataLocalISO(new Date(instante));
    const lista = porDia.get(dia) ?? [];
    novos.forEach((t) => {
      ensinados.add(normalizarTema(t));
      lista.push(itemOriginal(t));
    });
    porDia.set(dia, lista);
  }

  // Incluídos à mão entram como ensinados no dia informado. Se uma ocorrência
  // já registrou o mesmo tema, vale a ocorrência.
  [...adicionados]
    .sort((a, b) => a.dia.localeCompare(b.dia))
    .forEach((a) => {
      const chave = chaveTemaAplicacao(a.tema);
      if (ensinados.has(chave)) return;
      ensinados.add(chave);
      porDia.set(a.dia, [
        ...(porDia.get(a.dia) ?? []),
        { chave, nome: a.tema, original: a.tema, adicionadoId: a.id },
      ]);
    });

  const linhasPorTema = [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([dia, itensDoDia]) => {
      const [, mes, d] = dia.split("-");
      const realizado = dia <= hojeISO;
      const legado = marcacoes[dia];
      const temLegado = realizado && isDiaAplicacaoValido(legado);
      // Temas do dia (inclusive retirados) sem marcação própria herdam a antiga do dia.
      const herdeiros = temLegado
        ? itensDoDia
            .map((i) => chaveMarcacaoAplicacao(dia, i.chave))
            .filter((c) => marcacoes[c] === undefined)
        : [];
      return itensDoDia.filter(visivel).map((item): LinhaAplicacaoTema => {
        const chave = chaveMarcacaoAplicacao(dia, item.chave);
        const propria = marcacoes[chave];
        const herda = temLegado && propria === undefined;
        const marcado = herda ? legado : propria;
        return {
          chave,
          temas: [item.nome],
          itens: [item],
          data: `${d}/${mes}`,
          realizado,
          ...(realizado && {
            diaMarcado: isDiaAplicacaoValido(marcado) ? marcado : undefined,
            diasDecorridos: diasEntre(dia, hoje),
          }),
          ...(herda && {
            herdaMarcacaoDoDia: {
              diaTreinamento: dia,
              chaves: herdeiros.filter((c) => c !== chave),
            },
          }),
        };
      });
    });
  const realizadas = linhasPorTema.filter((l) => l.realizado);
  // Inclusão manual com data futura: aparece como prevista, depois dos temas da esteira.
  const futurasIncluidas = linhasPorTema.filter((l) => !l.realizado);

  const pendentes: LinhaAplicacaoTema[] = [];
  const pendentesVistos = new Set<string>();
  textosParaLinhasTema(temaText, dataText, blocoText).forEach(
    (linhaEsteira) => {
      const tema = linhaEsteira.tema.trim();
      if (
        !tema ||
        !isTemaComAplicacao(tema) ||
        ensinados.has(normalizarTema(tema))
      )
        return;
      const item = itemOriginal(tema);
      if (!visivel(item) || pendentesVistos.has(item.chave)) return;
      pendentesVistos.add(item.chave);
      pendentes.push({
        chave: `pendente-${item.chave}`,
        temas: [item.nome],
        itens: [item],
        data: linhaEsteira.data.trim(),
        realizado: false,
      });
    },
  );

  return [...realizadas, ...pendentes, ...futurasIncluidas];
}
