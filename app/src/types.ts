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

  responsavel: string;

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

  /**
   * Uma linha por fase (alinhada com `temaText`/`dataText`): "1" quando esse tema
   * acontece no mesmo dia do próximo (mesmo bloco/encontro), vazio caso contrário.
   * A última fase nunca tem esse marcador, pois não há um "próximo" para agrupar.
   */
  blocoText?: string;

  /** Nome exato do tema (linha de {@link temaText}) marcado como o "Gol" da esteira. */
  temaGol?: string;

  /**
   * Dias úteis entre um treinamento e o próximo, validados com o cliente (ex.: "de 2 em 2
   * dias"). Usado para estimar a data do último treinamento da esteira e medir o indicador
   * "Treinamentos no prazo". Sem esse campo preenchido, a empresa fica fora desse indicador.
   */
  cadenciaDiasTreinamento?: number;

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
  /**
   * Editável diretamente pelo master no cadastro, ou preenchida automaticamente
   * pela ocorrência de tipo "Follow up final" quando o treinador marca
   * "Encaminhar pro suporte" (ver followUpEncaminharSuporte em Ocorrencia).
   * Junto com dataFinalizacao, determina clienteConcluido() na Home.
   */
  dataFollowUpFinal?: string;

  /** Carimbo "Lobo Solitário" marcado manualmente no cadastro do cliente. */
  loboSolitario?: boolean;

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
  /** Exibe avisos de contato com o Suporte na Home. Ausente equivale a true. */
  exibirAvisosSuporte?: boolean;
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
  /** Números reservados pelo backend para ocorrências geradas via CSAT. */
  ocorrenciasSequenciasReservadas?: number[];
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
  whatsappStatusConclusao?: WhatsappStatus;
  whatsappEnviadoEmConclusao?: number;
  whatsappDestinatariosConclusao?: WhatsappDestinatarioEnvio[];
};

export type MotivoEsperaTreinamento = "cliente" | "agenda_treinador";

export type Ocorrencia = {
  validacaoTentativaId?: string;
  validacaoAprovada?: boolean;
  validacaoNota?: number;
  validacaoPercentual?: number;
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
  csatReservaId?: string;
  /** `nota` (1 a 5 estrelas) é o modelo atual; `experiencia` ("Bom"/"Ruim") é derivado dela para os indicadores antigos, ou vem preenchido direto em respostas registradas antes da reintrodução das estrelas. */
  csatRespostas?: { nome: string; nota?: number; experiencia: "Bom" | "Ruim"; opiniao: string; respondidoEm: number; editadoPor?: string; editadoEm?: number }[];
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
  /**
   * Uid de quem marcou que o contato com o cliente foi feito mas ele não
   * respondeu — diferente de avisoTreinamentoResolvidoPorId, não remove o
   * aviso da Home, só sinaliza que já houve tentativa de contato.
   */
  avisoTreinamentoContatoRealizadoPorId?: string;
  avisoTreinamentoContatoRealizadoEm?: number;
  treinamentoDataSolicitacao?: string;
  /** Contexto da espera longa; null remove uma classificação anterior após alterar as datas. */
  treinamentoMotivoEspera?: MotivoEsperaTreinamento | null;
  treinamentoTempoAgenda?: string;
  treinamentoSolicitante?: string;
  /** Notas de 1 a 5 estrelas por participante, extraídas de {@link csatRespostas}. */
  treinamentoNotas?: number[];
  /** Média calculada de {@link treinamentoNotas}; null quando nenhuma resposta trouxe nota em estrelas. */
  treinamentoNotaMedia?: number | null;
  /** Resultado do CSAT por participante, derivado da nota ("Bom" a partir de 4 estrelas) para preservar os indicadores já existentes. */
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
  /** Resultado da análise de aplicação do tema treinado (ocorrência Follow up final). */
  followUpResultadoAnalise?: "Aplicado" | "Sem evidência de aplicação" | "Parcialmente aplicado";
  /** Status do contato com o cliente para o follow up final. Aguardando retorno deixa a ocorrência incompleta até ser editada. */
  followUpStatusContato?: "Aguardando retorno" | "Contato bem-sucedido";
  /** Próxima ação definida após contato bem-sucedido. Só preenchida quando followUpStatusContato é "Contato bem-sucedido". */
  followUpProximaAcao?: "Nenhuma ação necessária" | "Orientação complementar" | "Reforço de treinamento";
  /** Encaminha o cliente para o Suporte, concluindo o acompanhamento (preenche Empresa.dataFollowUpFinal com a data desta ocorrência). Indisponível quando followUpProximaAcao é "Reforço de treinamento". */
  followUpEncaminharSuporte?: boolean;
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
  treinamentoMotivoEspera?: MotivoEsperaTreinamento | null;
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
  followUpResultadoAnalise?: "Aplicado" | "Sem evidência de aplicação" | "Parcialmente aplicado" | "";
  followUpStatusContato?: "Aguardando retorno" | "Contato bem-sucedido" | "";
  followUpProximaAcao?: "Nenhuma ação necessária" | "Orientação complementar" | "Reforço de treinamento" | "";
  followUpEncaminharSuporte?: boolean;
};

export type Atualizacao = {
  descricao: string;
  /** Instante original da atualização; preservado ao corrigir seu texto. */
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
  treinamentoMotivoEspera?: MotivoEsperaTreinamento | null;
  treinamentoDataRealizacao?: string;
  treinamentoTempoAgenda?: string;
  treinamentoSolicitante?: string;
  /** Notas de 1 a 5 estrelas por participante, extraídas de csatRespostas. */
  treinamentoNotas?: number[];
  /** Média calculada de {@link treinamentoNotas}; null quando nenhuma resposta trouxe nota em estrelas. */
  treinamentoNotaMedia?: number | null;
  /** Resultado do CSAT por participante, derivado da nota ("Bom" a partir de 4 estrelas) para preservar os indicadores já existentes. */
  treinamentoResultados?: ("Bom" | "Ruim")[];
  ocorrenciaId?: string;
  isAlerta?: boolean;
}

export type PrioridadeTarefa = "baixa" | "normal" | "alta" | "urgente";

export interface TarefaChecklist {
  empresaId?: string;
  empresa?: string;
  automatica?: boolean;
  origemAutomatica?: 'follow_up_final' | 'agendar_treinamento';
  baseAutomatica?: number;
  excluida?: boolean;
  excluidaEm?: number;
  excluidaPorId?: string;
  pausada?: boolean;
  updatedAt?: number;
  concluidaEm?: number;
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
