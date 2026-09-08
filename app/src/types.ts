export type CS = string;

export type ContatoCliente = {
  nome: string;
  telefone: string;
};

export type WhatsappStatus = "enviado" | "falhou" | "parcial" | "nao_enviado";

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

  temaText: string;

  dataText: string;

  currentPhase: number;

  updatedAt: number;

  csResponsavel?: CS;

  comercialResponsavel?: string;

  telefone?: string;

  persona?: string;

  produto?: "Pro" | "Lite" | "Start" | "";

  contato?: string;

  contatos?: ContatoCliente[];

  localizacao?: string;

  dataFinalizacao?: string;
  dataFollowUpFinal?: string;

  score?: number;
  scoreAnswers?: any;
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
  }[];
  isOngoing?: boolean;
  isSuspended?: boolean;
  isCancelled?: boolean;
  valorContrato?: number;
  idNumeric?: number;
  /** Marcação de envio da notificação de WhatsApp de Suspensão, para o perfil master. */
  whatsappStatusSuspensao?: WhatsappStatus;
  whatsappEnviadoEmSuspensao?: number;
  whatsappDestinatariosSuspensao?: WhatsappDestinatarioEnvio[];
};

export type Ocorrencia = {
  id?: string;
  empresa: string;
  tipo: string;
  descricao: string;
  departamento: string;
  responsavel: string;
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
  temaForaEsteira?: boolean;
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
  temaForaEsteira?: boolean;
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
    | "chamado_falha";
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
