export type CS = string;

/**
 * Contador de quantas vezes seguidas cada pergunta escalonada do questionário de score
 * foi respondida com a opção que perde ponto (desde o último "Sim"). Ver
 * {@link calcularPontuacaoScore} em `utils/score.ts`.
 */
export type ContadorPerdasScore = {
  entraComputador?: number;
  compartilhaTela?: number;
  /**
   * Perda acumulada (em pontos) de "Cliente se recorda de temas anteriores?", não a
   * quantidade de marcações. Anda em degraus: 0 → 2 (1ª marcação de "Não") → 5 (2ª
   * marcação seguida); "Sim" desfaz os degraus na mesma ordem, recuperando 2 pontos
   * na 1ª vez e 3 na 2ª. Ver {@link calcularPontuacaoScore} em `utils/score.ts`.
   */
  recordaTemas?: number;
};

export type ContatoCliente = {
  nome: string;
  /** Primeiro número, mantido para compatibilidade com cadastros antigos. */
  telefone: string;
  telefones?: string[];
};

export type WhatsappStatus =
  | "enviado"
  | "falhou"
  | "parcial"
  | "nao_enviado"
  | "sem_destinatario";

export type WhatsappDestinatarioEnvio = {
  nome: string;
  telefone: string;
  status: "enviado" | "falhou";
  erro?: string;
};

export type Empresa = {
  id?: string;

  nomeEmpresa: string;

  responsavel: "Pedro" | "Jean" | "Jeff" | "Natalia" | "Clarice" | "";

  tipo: "Fast" | "Safety" | "";

  dataEntrada: string;

  alerta?: boolean;
  pendencia?: {
    ativa: boolean;
    tipoId: string;
    tipoNome: string;
    /** Data inclusiva (YYYY-MM-DD) no horário de Brasília; vazio significa sem vencimento. */
    venceEm?: string;
  };

  temaText: string;

  dataText: string;

  /** Nome exato do tema (linha de {@link temaText}) marcado como o "Gol" da esteira. */
  temaGol?: string;

  currentPhase: number;

  updatedAt: number;

  csResponsavel?: CS;

  comercialResponsavel?: string;

  telefone?: string;

  persona?: string;

  produto?: "Pro" | "Lite" | "Start" | "";

  contato?: string;

  contatos?: ContatoCliente[];

  /** E-mails do cliente, campo opcional para contato adicional. */
  emails?: string[];

  localizacao?: string;

  dataFinalizacao?: string;
  dataFollowUpFinal?: string;

  score?: number;
  scoreAnswers?: any;
  /**
   * Quantas vezes seguidas (desde o último "Sim") cada pergunta escalonada do questionário
   * de score foi respondida com a opção que perde ponto. Usado para calcular a perda
   * crescente dessas perguntas a cada novo cálculo; volta a 0 quando a pergunta é
   * respondida "Sim". Ver {@link calcularPontuacaoScore}.
   */
  scoreContadoresPerda?: ContadorPerdasScore;
  /**
   * Dúvidas do cliente sobre temas anteriores, preenchidas ao marcar "Não" em
   * "Cliente se recorda de temas anteriores?" no questionário de score.
   */
  duvidasTemasAnteriores?: string[];
  /**
   * Reduções temporárias aplicadas ao score (ex.: contato com o Suporte para tirar
   * dúvidas reduz 1 ponto por 15 dias). Cada ajuste vale enquanto `Date.now() < expiraEm`;
   * o score exibido/usado deve ser calculado com {@link calcularScoreEfetivo}.
   */
  scoreAjustesTemporarios?: {
    motivo: string;
    valor: number;
    criadoEm: number;
    expiraEm: number;
    /** Id da ocorrência que originou o ajuste, para permitir referenciá-la na UI (ex.: "Oc. #1542"). */
    ocorrenciaId?: string;
  }[];
  isOngoing?: boolean;
  isSuspended?: boolean;
  /** Data (YYYY-MM-DD) em que o cliente foi suspenso, usada para congelar a contagem de dias na esteira. */
  dataSuspensao?: string;
  /** Soma dos dias já passados em suspensões anteriores, para excluir do total de dias na esteira ao retornar. */
  diasSuspensoAcumulado?: number;
  isCancelled?: boolean;
  /**
   * Configuração (Master-only) de dedução de pontos de gamificação do treinador
   * responsável (campo {@link Empresa.responsavel}) quando este cliente entra em
   * contato com o Suporte. Cada tipo de ocorrência tem valores separados para
   * dentro/fora do expediente (09h-18h); um valor vazio/0 significa que aquele
   * tipo/período não desconta pontos.
   */
  gamificacaoDeducaoSuporte?: {
    ativo: boolean;
    duvida?: { dentroExpediente?: number; foraExpediente?: number };
    problema?: { dentroExpediente?: number; foraExpediente?: number };
    solicitacao?: { dentroExpediente?: number; foraExpediente?: number };
  };
  valorContrato?: number;
  idNumeric?: number;
  /**
   * ID da central de rastreamento no sistema SSX, vinculado a partir da planilha de
   * controle do CS pelo nome da central (ver `services/centrais.ts`). Preenchido
   * automaticamente ao cadastrar/editar o cliente na Esteira, mas pode ser
   * corrigido manualmente quando o casamento automático não encontra a central.
   */
  idCentral?: string;
  /** Marcação de envio da notificação de WhatsApp de Suspensão. */
  whatsappStatusSuspensao?: WhatsappStatus;
  whatsappEnviadoEmSuspensao?: number;
  whatsappDestinatariosSuspensao?: WhatsappDestinatarioEnvio[];
  /** Marcação de envio da notificação de WhatsApp de Cancelamento. */
  whatsappStatusCancelamento?: WhatsappStatus;
  whatsappEnviadoEmCancelamento?: number;
  whatsappDestinatariosCancelamento?: WhatsappDestinatarioEnvio[];
};

export type Ocorrencia = {
  id?: string;
  empresa: string;
  tipo: string;
  descricao: string;
  departamento: string;
  responsavel: string;
  favorita?: boolean;
  favoritadaPor?: string;
  favoritadaEm?: number | null;
  favoritaEmpresaId?: string;
  origem?: 'ssx-desk';
  ssxDesk?: {
    conversationId: string;
    sessionId: string;
    companyId: string;
    empresaId: string;
    customerName: string;
    startedAt: string;
    finishedAt: string;
    summaryGeneratedAt: string | null;
    tags: string[];
    importedAt: number;
  };
  createdAt?: number;
  dataOcorrencia: number;
  updatedAt?: number;
  temaOcorrencia?: string[];
  idSeqFormatted?: string;
  atualizacoes?: Atualizacao[];
  scoreCalculado?: number;
  scoreAnswers?: any;
  alerta?: boolean;
  retirarAlerta?: boolean;
  alertaResolvidoPorId?: string;
  alertaOriginalId?: string;
  gamificacaoPontoId?: string;
  /** Lançamento de desconto de pontos do treinador por contato de Suporte (ver gamificacaoDeducaoSuporte na Empresa), vinculado a esta ocorrência. */
  gamificacaoDescontoPontoId?: string;
  /**
   * Uid de quem marcou como feito o aviso de "cliente em treinamento contatou o
   * Suporte" exibido na Home (ver painel de avisos em Home.tsx). Ausente enquanto
   * o aviso está pendente.
   */
  avisoTreinamentoResolvidoPorId?: string;
  avisoTreinamentoResolvidoEm?: number;
  treinamentoDataSolicitacao?: string;
  treinamentoTempoAgenda?: string;
  treinamentoSolicitante?: string;
  /** @deprecated Modelo antigo (nota 1 a 5). Mantido só para exibir/alimentar médias de registros antigos. */
  treinamentoNotas?: number[];
  /** @deprecated Média calculada de {@link treinamentoNotas}. Mantido só para dados antigos. */
  treinamentoNotaMedia?: number | null;
  /** Resultado do CSAT por participante, no modelo atual: "Bom" ou "Ruim". */
  treinamentoResultados?: ("Bom" | "Ruim")[];
  isRevisao?: boolean;
  retornarEsteira?: boolean;
  /** Marca que esta ocorrência foi a responsável por suspender o cliente temporariamente. */
  suspenderCliente?: boolean;
  temaForaEsteira?: boolean;
  /** Nota CSAT do contato com o Suporte (opcional, só preenchida quando departamento é "Suporte"). */
  csatSuporte?: "Bom" | "Ruim";
  /** Marca que, a partir desta ocorrência do tipo Problema, foi aberto um chamado para resolução. */
  chamadoAberto?: boolean;
  /** Descrição do problema que está sendo resolvido pelo chamado (preenchida quando chamadoAberto é true). */
  chamadoDescricao?: string;
  /** Link opcional relacionado ao chamado (ex.: ticket, board, sistema externo). */
  chamadoLink?: string;
  /** Status do envio da notificação de chamado aberto ao CS Responsável (ver chamadoAberto). */
  chamadoWhatsappStatus?: WhatsappStatus;
  chamadoWhatsappEnviadoEm?: number;
  chamadoWhatsappDestinatarios?: WhatsappDestinatarioEnvio[];
  whatsappStatus?: WhatsappStatus;
  whatsappEnviadoEm?: number;
  whatsappDestinatarios?: WhatsappDestinatarioEnvio[];
};

export type OcorrenciaForm = {
  empresa: string;
  tipo: string;
  descricao: string;
  departamento: string;
  responsavel: string;
  dataOcorrencia: string;
  horaOcorrencia?: string;
  temaOcorrencia?: string[];
  alerta?: boolean;
  retirarAlerta?: boolean;
  alertaResolvidoPorId?: string;
  alertaOriginalId?: string;
  gamificacaoPontoId?: string;
  treinamentoDataSolicitacao?: string;
  treinamentoTempoAgenda?: string;
  treinamentoSolicitante?: string;
  /** @deprecated Modelo antigo (nota 1 a 5). Não é mais preenchido pelo formulário. */
  treinamentoNotas?: string[];
  treinamentoResultados?: string[];
  isRevisao?: boolean;
  createdAt?: string;
  horaCriacao?: string;
  retornarEsteira?: boolean;
  suspenderCliente?: boolean;
  temaForaEsteira?: boolean;
  csatSuporte?: "Bom" | "Ruim" | "";
  chamadoAberto?: boolean;
  chamadoDescricao?: string;
  chamadoLink?: string;
};

export type Atualizacao = {
  descricao: string;
  updatedAt: number;
  responsavel?: string;
};

export interface Historico {
  id?: string;

  empresaId: string;

  tipo: string;

  descricao?: string;

  data: string;

  createdAt?: number;

  updatedAt?: number;
}

export interface LancamentoPonto {
  id?: string;
  treinadorId: string;
  treinadorNome: string;
  tipoAcao:
    | "treinamento"
    | "nova_doc"
    | "att_doc"
    | "ferramenta_aut"
    | "chamado_falha"
    | "desconto_suporte";
  pontos: number;
  descricao: string;
  dataLancamento: number;
  /** Necessário para a sincronização incremental da coleção. */
  updatedAt?: number;
  criadoPorId: string;
  criadoPorNome: string;
  // Campos específicos de treinamento para uso em relatórios/gráficos
  treinamentoEmpresa?: string;
  treinamentoTema?: string;
  treinamentoDataSolicitacao?: string;
  treinamentoDataRealizacao?: string;
  treinamentoTempoAgenda?: string;
  treinamentoSolicitante?: string;
  /** @deprecated Modelo antigo (nota 1 a 5). Mantido só para exibir/alimentar médias de registros antigos. */
  treinamentoNotas?: number[];
  /** @deprecated Média calculada de {@link treinamentoNotas}. Mantido só para dados antigos. */
  treinamentoNotaMedia?: number | null;
  /** Resultado do CSAT por participante, no modelo atual: "Bom" ou "Ruim". */
  treinamentoResultados?: ("Bom" | "Ruim")[];
  ocorrenciaId?: string;
  isAlerta?: boolean;
}

export type PrioridadeTarefa = "baixa" | "normal" | "alta" | "urgente";

export interface TarefaChecklist {
  id?: string;
  treinadorId: string;
  treinadorNome: string;
  descricao: string;
  concluida: boolean;
  criadoPorId: string;
  criadoPorNome: string;
  createdAt: number;
  slaEm?: number;
  prioridade?: PrioridadeTarefa;
}
