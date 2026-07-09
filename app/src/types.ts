export type CS = string;

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

  contato?: string;

  localizacao?: string;

  dataFinalizacao?: string;
  dataFollowUpFinal?: string;

  score?: number;
  scoreAnswers?: any;
  isOngoing?: boolean;
  isSuspended?: boolean;
  valorContrato?: number;
  idNumeric?: number;
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
  treinamentoNotas?: number[];
  treinamentoNotaMedia?: number | null;
  isRevisao?: boolean;
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
  treinamentoNotas?: string[];
  isRevisao?: boolean;
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
  tipoAcao: "treinamento" | "nova_doc" | "att_doc" | "ferramenta_aut" | "chamado_falha";
  pontos: number;
  descricao: string;
  dataLancamento: number;
  criadoPorId: string;
  criadoPorNome: string;
  // Campos específicos de treinamento para uso em relatórios/gráficos
  treinamentoEmpresa?: string;
  treinamentoTema?: string;
  treinamentoDataSolicitacao?: string;
  treinamentoDataRealizacao?: string;
  treinamentoTempoAgenda?: string;
  treinamentoSolicitante?: string;
  treinamentoNotas?: number[];
  treinamentoNotaMedia?: number | null;
  ocorrenciaId?: string;
  isAlerta?: boolean;
}

