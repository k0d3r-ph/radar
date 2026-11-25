/**
 * Mapeamento das coleções do Radar (nomes herdados do Firestore) para tabelas do PostgreSQL.
 *
 * Só coleções listadas aqui são aceitas: o nome da tabela entra no SQL, então nunca vem de
 * dados externos sem passar por este registro.
 */
export const TABELAS_RAIZ = {
  usuarios: 'usuarios',
  empresas: 'empresas',
  ocorrencias: 'ocorrencias',
  gamificacao_pontos: 'gamificacao_pontos',
  checklist_tarefas: 'checklist_tarefas',
  configuracoes: 'configuracoes',
  temasOcorrencia: 'temas_ocorrencia',
  integracoes: 'integracoes',
  favoritosOcorrencias: 'favoritos_ocorrencias',
  csatReservas: 'csat_reservas',
  csatLinks: 'csat_links',
  csatControle: 'csat_controle',
  validacao_perguntas: 'validacao_perguntas',
  validacao_tentativas: 'validacao_tentativas',
  validacao_clientes: 'validacao_clientes',
  validacao_controle: 'validacao_controle',
  ssxDeskImportacoes: 'ssx_desk_importacoes',
  ssxDeskSessoes: 'ssx_desk_sessoes',
} as const;

/** Subcoleções: chave "colecaoPai/subcolecao". A tabela guarda o id do pai em `pai_id`. */
export const TABELAS_SUBCOLECAO = {
  'csatReservas/respostas': 'csat_reservas_respostas',
} as const;

export type ColecaoRaiz = keyof typeof TABELAS_RAIZ;

export interface DestinoColecao {
  tabela: string;
  /** Id do documento pai, só em subcoleções. */
  paiId?: string;
  /** Caminho da coleção, ex.: "csatReservas/abc/respostas". */
  caminho: string;
  nome: string;
}

const SEGMENTO_VALIDO = /^[^/\s][^/]{0,1499}$/;

export function validarSegmento(segmento: string, tipo: string): string {
  if (typeof segmento !== 'string' || !SEGMENTO_VALIDO.test(segmento) || segmento === '.' || segmento === '..') {
    throw new Error(`Identificador de ${tipo} inválido: "${segmento}".`);
  }
  return segmento;
}

export function resolverColecao(caminho: string): DestinoColecao {
  const partes = caminho.split('/');
  if (partes.length === 1) {
    const tabela = (TABELAS_RAIZ as Record<string, string>)[partes[0]];
    if (!tabela) throw new Error(`Coleção desconhecida no PostgreSQL: "${caminho}".`);
    return { tabela, caminho, nome: partes[0] };
  }
  if (partes.length === 3) {
    const tabela = (TABELAS_SUBCOLECAO as Record<string, string>)[`${partes[0]}/${partes[2]}`];
    if (!tabela) throw new Error(`Subcoleção desconhecida no PostgreSQL: "${caminho}".`);
    return { tabela, paiId: validarSegmento(partes[1], 'documento'), caminho, nome: partes[2] };
  }
  throw new Error(`Caminho de coleção inválido: "${caminho}".`);
}

export function todasAsTabelas(): string[] {
  return [...Object.values(TABELAS_RAIZ), ...Object.values(TABELAS_SUBCOLECAO)];
}
