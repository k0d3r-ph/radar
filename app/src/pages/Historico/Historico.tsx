import { reordenarTemasEnsinados } from "../../utils/reordenarTemasEnsinados";
import { calcularDiasSuspensaoAtual } from "../../utils/monitoramento";
import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import "./CsatReservas.css";
import { requisicaoCsat, linkCsat, editarRespostaCsat } from "../../services/csat";
import { copiarTexto } from '../../utils/clipboard';
import type { ReservaCsat } from "../../services/csat";
import { GerarCsatModal } from "./GerarCsatModal";
import * as XLSX from "xlsx";
import {
  salvarOcorrencia,
  listarOcorrencias,
  removerOcorrencia,
  definirOcorrenciaFavorita,
  validarClienteParaNovoTreinamento,
  type AcaoLancamentoPonto,
} from "../../services/ocorrencias";
import {
  listarEmpresas,
  salvarEmpresas,
  aplicarReducaoScoreEmpresa,
  isEmpresaInterna,
} from "../../services/empresas";
import {
  obterDestinatariosCliente,
  formatarTelefoneExibicao,
} from "../../utils/telefone";
import { listarUsuarios } from "../../services/auth";
import type { UsuarioDocument } from "../../services/auth";
import { enviarMensagemWhatsApp } from "../../services/whatsapp";
import {
  obterDestinatariosGestao,
  obterDestinatarioCSChamado,
  montarMensagemAlertaGestao,
  montarMensagemConclusaoEsteiraGestao,
  montarMensagemSuspensaoGestao,
  montarMensagemRetornoEsteiraGestao,
  montarMensagemAlertaRetiradoGestao,
  montarMensagemChamadoAbertoCS,
  aplicarNomeDestinatario,
  PLACEHOLDER_NOME,
} from "../../services/notificacoes";
import type { EventoNotificacaoGestao } from "../../services/notificacoes";
import type { DestinatarioGestao } from "../../services/notificacoes";
import { resumirOcorrencias } from "../../services/ia";
import {
  listarTemas,
  temaDisponivelParaPerfil,
  TIPOS_PADRAO_SISTEMA,
} from "../../services/temasOcorrencia";
import { generateEsteiraImage } from "../../utils/generateEsteiraImage";
import { obterDataRealizacaoTreinamento, obterInstanteRealizacaoTreinamento } from "../../utils/dataTreinamento";
import { GestaoNotificacaoModal } from "../../components/GestaoNotificacaoModal";
import { ConfirmarDescarteModal } from "../../components/ConfirmarDescarteModal";
import { ConfirmarNovoFollowUpModal } from "../../components/ConfirmarNovoFollowUpModal";
import { MotivoEsperaTreinamentoModal } from "../../components/MotivoEsperaTreinamentoModal";
import { bloquearTreinamentoSuspenso, exigeClienteAtivoParaTreinamento, MENSAGEM_TREINAMENTO_SUSPENSO } from "../../utils/registroTreinamento";
import { avaliarMotivoEsperaTreinamento, descreverMotivoEsperaTreinamento, motivoEsperaValido } from "../../utils/esperaTreinamento";
import { camposResultadoConclusao } from "../../utils/notificacaoConclusao";

import {
  salvarLancamentoPonto,
  atualizarLancamentoPonto,
  removerLancamentoPonto,
} from "../../services/gamificacao";
import type {
  Ocorrencia,
  Empresa,
  OcorrenciaForm,
  ContadorPerdasScore,
  MotivoEsperaTreinamento,
} from "../../types";
import "./Historico.css";
import "./Favoritos.css";
import { DoughnutChart } from "../../components/DoughnutChart";
import { BarChart } from "../../components/BarChart";
import { useAuth } from "../../context/AuthContext";
import { formatarNome } from "../../utils/formatarNome";
import { formatarListaNomes } from "../../utils/formatarListaNomes";
import {
  isTemaTreinamento,
  isTreinamentoRealizado,
  lerTemasTreinamento,
  normalizarTemasTreinamento,
  prepararTemasTreinamento,
} from "../../utils/temasTreinamento";
import {
  MOTIVO_REDUCAO_SCORE_SUPORTE,
  VALOR_REDUCAO_SCORE_SUPORTE,
  DIAS_REDUCAO_SCORE_SUPORTE,
  MOTIVO_REDUCAO_SCORE_TREINAMENTO,
  VALOR_REDUCAO_SCORE_TREINAMENTO,
  DIAS_REDUCAO_SCORE_TREINAMENTO,
  MOTIVO_REDUCAO_SCORE_GAP_AGENDA,
  VALOR_REDUCAO_SCORE_GAP_AGENDA,
  DIAS_REDUCAO_SCORE_GAP_AGENDA,
  LIMITE_DIAS_GAP_AGENDA,
  criarAjusteTemporarioScore,
  calcularPontuacaoScore,
  obterAjustesAtivos,
  encontrarOcorrenciaDoAjuste,
  descreverMotivosReducaoAtiva,
} from "../../utils/score";
import { estaDentroDoExpediente } from "../../utils/expediente";
import {
  atribuirIdsOcorrencias,
  obterInfoTipoOcorrencia,
} from "../../utils/empresaUtils";
import {
  Star,
  GraduationCap,
  Wrench,
  TrendingUp,
  Code,
  Cpu,
  Trash2,
  X,
  Share2,
} from "lucide-react";

const TIPOS_PADRAO = TIPOS_PADRAO_SISTEMA;

/** Valores especiais do filtro "Tipo", que não correspondem a um `tipo` de ocorrência
 * e sim ao status de alerta/suspensão sincronizado na empresa a partir da ocorrência. */
const FILTRO_ALERTAS = "__alertas__";
const FILTRO_SEM_CLASSIFICACAO = "__sem_classificacao__";
const FILTRO_SUSPENSOES = "__suspensoes__";
const FILTRO_TREINAMENTO_CAN = "__treinamento_can__";
const FILTRO_TREINAMENTO_AUS = "__treinamento_aus__";
const FILTRO_TREINAMENTO_REA = "__treinamento_rea__";

const DEPARTAMENTO = ["Treinamento", "CS", "Suporte", "Hardware", "Comercial"];

// Listas padrão usadas apenas como fallback antes do primeiro carregamento
// do Firestore (coleção "temasOcorrencia", gerenciada em /tipos-ocorrencia).
const DUVIDA_OPCOES_PADRAO = [
  "Acesso a plataforma",
  "Configurar/apontar câmera",
  "Apontar rastreador tradicional (QS)",
  "Cadastrar cliente",
  "Cadastrar rastreador",
  "Cadastrar veículo",
  "Cadastrar gateway",
  "Cadastrar Chip/operadora",
  "Cadastrar/configurar pessoas",
  "Unidades Organizacional",
  "Debug",
  "Áreas e Rotas",
  "Comandos",
  "Configuração de bloqueio",
  "Rastreador desatualizado",
  "Correção de odômetro/horímetro",
  "Envio de comando",
  "Funções da tela operacional",
  "Chamados",
  "Hardware",
  "Identificação de motorista",
  "Pessoas",
  "Perfil de acesso",
  "Rastreador integrado ao SSX",
  "Regras",
  "Relatório",
  "Templates",
  "Reset de senha",
  "SSX Mobile",
  "SSX Onboard",
  "Desassociar rastreador",
  "Uso de TAGs",
  "Importação de arquivos",
  "Performance",
  "Logistics",
  "Jornada de Trabalho",
  "Videotelemetria",
  "Abastecimento",
  "Manutenção",
  "Gestão de Multas",
];

const SOLICITACAO_OPCOES_PADRAO = [
  "Mascaramento da URL",
  "Liberação/Exclusão de Gateway",
  "Material de apoio",
  "Troca de email do usuário Admin",
  "Troca de nome da central",
  "Informações ou configurações de API",
  "Exclusão de UR gerada por aplicativo",
  "Antecipação de tema",
  "Sugestão de desenvolvimento",
];

const DEPARTAMENTO_CLASS: Record<string, string> = {
  Treinamento: "departamento-treinamento",
  CS: "departamento-cs",
  Suporte: "departamento-suporte",
  Hardware: "departamento-hardware",
  Comercial: "departamento-comercial",
};

const DEPARTAMENTO_ICONES: Record<string, React.ReactNode> = {
  Treinamento: <GraduationCap size={14} />,
  CS: <Star size={14} />,
  Suporte: <Wrench size={14} />,
  Hardware: <Cpu size={14} />,
  Comercial: <TrendingUp size={14} />,
};

const TIPO_CLASS: Record<string, string> = {
  Informativa: "tipo--informativa",
  Financeira: "tipo--financeira",
  Comercial: "tipo--comercial",
  Treinamento: "tipo--treinamento",
  Checkpoint: "tipo--checkpoint",
  "Mudança de score": "tipo--mudanca-score",
  Problema: "tipo--problema",
  Dúvida: "tipo--duvida",
  Solicitação: "tipo--solicitacao",
  Gol: "tipo--gol",
};

const TIPO_CORES: Record<string, string> = {
  Informativa: "#6b7280",
  Financeira: "#3b82f6",
  Comercial: "#f59e0b",
  Treinamento: "#a855f7",
  Checkpoint: "#6366f1",
  "Mudança de score": "#0ea5e9",
  Problema: "#ef4444",
  Dúvida: "#14b8a6",
  Solicitação: "#f97316",
  Gol: "#16a34a",
};

const DEPARTAMENTO_CORES: Record<string, string> = {
  Treinamento: "#a855f7",
  CS: "#f59e0b",
  Suporte: "#3b82f6",
  Hardware: "#06b6d4",
  Comercial: "#10b981",
};

function getOcorrenciaTimestamp(o: Ocorrencia): number {
  if (
    (o.tipo === "Problema" ||
      o.tipo === "Dúvida" ||
      o.departamento === "Suporte") &&
    o.dataOcorrencia &&
    o.dataOcorrencia > 0
  ) {
    return o.dataOcorrencia;
  }
  return o.createdAt ?? o.dataOcorrencia ?? 0;
}

const parseInlineMarkdown = (text: string) => {
  const parts: React.ReactNode[] = [];
  let currentIndex = 0;
  const boldRegex = /\*\*([^*]+)\*\*/g;
  let match;

  while ((match = boldRegex.exec(text)) !== null) {
    if (match.index > currentIndex) {
      parts.push(text.substring(currentIndex, match.index));
    }
    parts.push(
      <strong key={match.index} style={{ fontWeight: 700, color: "inherit" }}>
        {match[1]}
      </strong>,
    );
    currentIndex = boldRegex.lastIndex;
  }

  if (currentIndex < text.length) {
    parts.push(text.substring(currentIndex));
  }

  return parts.length > 0 ? parts : text;
};

const renderMarkdown = (text: string) => {
  if (!text) return null;
  return text.split("\n").map((line, index) => {
    // 1. Headers (e.g. ### 1. Visão Geral)
    const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const content = parseInlineMarkdown(headerMatch[2]);
      const style = {
        display: "block",
        fontWeight: "bold" as const,
        color: level <= 3 ? "#a5b4fc" : "#e9d5ff",
        marginTop: index > 0 ? "16px" : "4px",
        marginBottom: "8px",
        fontSize: level === 1 ? "1.4rem" : level === 2 ? "1.2rem" : "1.05rem",
      };
      return (
        <div key={index} style={style}>
          {content}
        </div>
      );
    }

    // 2. Bullet list items (e.g. • or - or *)
    const bulletMatch = line.match(/^(\*|-|•)\s+(.*)$/);
    if (bulletMatch) {
      const content = parseInlineMarkdown(bulletMatch[2]);
      return (
        <div
          key={index}
          style={{
            paddingLeft: "16px",
            marginBottom: "4px",
            display: "flex",
            gap: "6px",
            alignItems: "flex-start",
          }}
        >
          <span style={{ color: "var(--lt-texto-a5b4fc, #a5b4fc)" }}>•</span>
          <span>{content}</span>
        </div>
      );
    }

    // 3. Empty lines
    if (line.trim() === "") {
      return <div key={index} style={{ height: "8px" }} />;
    }

    // 4. Standard text paragraphs
    return (
      <div key={index} style={{ marginBottom: "6px", display: "block" }}>
        {parseInlineMarkdown(line)}
      </div>
    );
  });
};

const montarTemplateTreinamento = (participantes?: string) =>
  `Participantes: ${participantes ?? ""}\n\nNOTA: \n\nRelatório de treinamento:\n\n• Cliente se manteve atento? \n• Cliente absorveu o conteúdo aplicado?\n• Cliente foi participativo?\n• Houve alguma interrupção?\n• Ambiente favorável (Som)?\n• Manifestou alguma insatisfação?\n• Treinamento foi gravado?\n\nRelatório do atendimento:`;
const TEMPLATE_TREINAMENTO = montarTemplateTreinamento();

/** Ocorrência de Follow up final mais recente do cliente, para decidir se um novo
 * registro precisa do modal de confirmação (follow up anterior em "Reforço de
 * treinamento", ainda não concluído). */
function obterUltimoFollowUpFinal(
  historico: Ocorrencia[],
  empresaNome: string,
): Ocorrencia | undefined {
  const nome = empresaNome.trim().toLowerCase();
  const registros = historico.filter(
    (item) => item.empresa.trim().toLowerCase() === nome && item.tipo === "Follow up final",
  );
  if (!registros.length) return undefined;
  return registros.sort(
    (a, b) => (b.dataOcorrencia || b.createdAt || 0) - (a.dataOcorrencia || a.createdAt || 0),
  )[0];
}

const EMPTY: OcorrenciaForm = {
  empresa: "",
  tipo: "",
  descricao: "",
  departamento: "",
  responsavel: "",
  dataOcorrencia: "",
  horaOcorrencia: "",
  temaOcorrencia: [],
  alerta: false,
  retirarAlerta: false,
  alertaResolvidoPorId: "",
  alertaOriginalId: "",
  gamificacaoPontoId: "",
  treinamentoDataSolicitacao: "",
  treinamentoMotivoEspera: null,
  treinamentoTempoAgenda: "",
  treinamentoSolicitante: "CS",
  treinamentoNotas: [],
  treinamentoResultados: [],
  createdAt: "",
  horaCriacao: "",
  retornarEsteira: false,
  suspenderCliente: false,
  temaForaEsteira: false,
  csatSuporte: "",
  chamadoAberto: false,
  chamadoDescricao: "",
  chamadoLink: "",
  followUpResultadoAnalise: "",
  followUpStatusContato: "",
  followUpProximaAcao: "",
  followUpEncaminharSuporte: false,
};

interface ScoreFormAnswers {
  entraComputador: "Sim" | "Não" | "";
  compartilhaTela: "Sim" | "Não" | "";
  fazPerguntas: "Sim" | "Não" | "";
  recordaTemas: "Sim" | "Não" | "";
  faltouDoisDias: "Sim" | "Não" | "";
  estruturaNecessaria: "Sim" | "Não" | "";
  clienteReclamante: "Sim" | "Não" | "";
  clienteSumido: "Sim" | "Não" | "";
}

const INITIAL_SCORE_ANSWERS: ScoreFormAnswers = {
  entraComputador: "",
  compartilhaTela: "",
  fazPerguntas: "",
  recordaTemas: "",
  faltouDoisDias: "",
  estruturaNecessaria: "",
  clienteReclamante: "",
  clienteSumido: "",
};

function descreverMudancas(
  antigo: ScoreFormAnswers,
  novo: ScoreFormAnswers,
): string[] {
  const mudancas: string[] = [];

  const descreverSimNao = (val: string) => {
    if (val === "Sim") return "Sim";
    if (val === "Não") return "Não";
    return "Não respondido";
  };

  const descreverEntraComputador = (val: string) => {
    if (val === "Sim") return "Entra pelo computador";
    if (val === "Não") return "Não entra pelo computador";
    return "Não respondido";
  };

  const descreverFaltouDoisDias = (val: string) => {
    if (val === "Sim") return "Faltou 2 dias seguidos";
    if (val === "Não") return "Não faltou 2 dias seguidos";
    return "Não respondido";
  };

  const descreverEstrutura = (val: string) => {
    if (val === "Sim") return "Possui estrutura necessária";
    if (val === "Não") return "Não possui estrutura necessária";
    return "Não respondido";
  };

  const descreverReclamante = (val: string) => {
    if (val === "Sim") return "Cliente reclama do sistema";
    if (val === "Não") return "Cliente não reclama do sistema";
    return "Não respondido";
  };

  const descreverSumico = (val: string) => {
    if (val === "Sim") return "Cliente sumiu";
    if (val === "Não") return "Cliente não sumiu";
    return "Não respondido";
  };

  if (antigo.entraComputador !== novo.entraComputador) {
    mudancas.push(
      `- Cliente entra pelo computador: de "${descreverEntraComputador(antigo.entraComputador)}" para "${descreverEntraComputador(novo.entraComputador)}"`,
    );
  }
  if (antigo.compartilhaTela !== novo.compartilhaTela) {
    mudancas.push(
      `- Cliente compartilha a tela: de "${descreverSimNao(antigo.compartilhaTela)}" para "${descreverSimNao(novo.compartilhaTela)}"`,
    );
  }
  if (antigo.fazPerguntas !== novo.fazPerguntas) {
    mudancas.push(
      `- Cliente faz perguntas: de "${descreverSimNao(antigo.fazPerguntas)}" para "${descreverSimNao(novo.fazPerguntas)}"`,
    );
  }
  if (antigo.recordaTemas !== novo.recordaTemas) {
    mudancas.push(
      `- Cliente se recorda de temas anteriores: de "${descreverSimNao(antigo.recordaTemas)}" para "${descreverSimNao(novo.recordaTemas)}"`,
    );
  }
  if (antigo.faltouDoisDias !== novo.faltouDoisDias) {
    mudancas.push(
      `- Cliente faltou 2 dias seguidos: de "${descreverFaltouDoisDias(antigo.faltouDoisDias)}" para "${descreverFaltouDoisDias(novo.faltouDoisDias)}"`,
    );
  }
  if (antigo.estruturaNecessaria !== novo.estruturaNecessaria) {
    mudancas.push(
      `- Cliente possui estrutura necessária: de "${descreverEstrutura(antigo.estruturaNecessaria)}" para "${descreverEstrutura(novo.estruturaNecessaria)}"`,
    );
  }
  if (antigo.clienteReclamante !== novo.clienteReclamante) {
    mudancas.push(
      `- Cliente reclama do sistema: de "${descreverReclamante(antigo.clienteReclamante)}" para "${descreverReclamante(novo.clienteReclamante)}"`,
    );
  }
  if (antigo.clienteSumido !== novo.clienteSumido) {
    mudancas.push(
      `- Cliente sumiu: de "${descreverSumico(antigo.clienteSumido)}" para "${descreverSumico(novo.clienteSumido)}"`,
    );
  }

  return mudancas;
}

function descreverRespostas(respostas: ScoreFormAnswers): string[] {
  const descreverSimNao = (val: string) => {
    if (val === "Sim") return "Sim";
    if (val === "Não") return "Não";
    return "Não respondido";
  };

  const descreverEntraComputador = (val: string) => {
    if (val === "Sim") return "Entra pelo computador";
    if (val === "Não") return "Não entra pelo computador";
    return "Não respondido";
  };

  const descreverFaltouDoisDias = (val: string) => {
    if (val === "Sim") return "Faltou 2 dias seguidos";
    if (val === "Não") return "Não faltou 2 dias seguidos";
    return "Não respondido";
  };

  const descreverEstrutura = (val: string) => {
    if (val === "Sim") return "Possui estrutura necessária";
    if (val === "Não") return "Não possui estrutura necessária";
    return "Não respondido";
  };

  const descreverReclamante = (val: string) => {
    if (val === "Sim") return "Cliente reclama do sistema";
    if (val === "Não") return "Cliente não reclama do sistema";
    return "Não respondido";
  };

  const descreverSumico = (val: string) => {
    if (val === "Sim") return "Cliente sumiu";
    if (val === "Não") return "Cliente não sumiu";
    return "Não respondido";
  };

  return [
    `- Cliente entra pelo computador: "${descreverEntraComputador(respostas.entraComputador)}"`,
    `- Cliente compartilha a tela: "${descreverSimNao(respostas.compartilhaTela)}"`,
    `- Cliente faz perguntas: "${descreverSimNao(respostas.fazPerguntas)}"`,
    `- Cliente se recorda de temas anteriores: "${descreverSimNao(respostas.recordaTemas)}"`,
    `- Cliente faltou 2 dias seguidos: "${descreverFaltouDoisDias(respostas.faltouDoisDias)}"`,
    `- Cliente possui estrutura necessária: "${descreverEstrutura(respostas.estruturaNecessaria)}"`,
    `- Cliente reclama do sistema: "${descreverReclamante(respostas.clienteReclamante)}"`,
    `- Cliente sumiu: "${descreverSumico(respostas.clienteSumido)}"`,
  ];
}

export function Historico() {
  const { role, userName, user } = useAuth();
  const isTreinador = role === "treinador" || role === "master";
  const [reservasCsat, setReservasCsat] = useState<ReservaCsat[]>([]);
  const [carregandoReservasCsat, setCarregandoReservasCsat] = useState(true);
  const [gerandoCsat, setGerandoCsat] = useState(false);
  const [modalCsatAberto, setModalCsatAberto] = useState(false);
  const [erroGerarCsat, setErroGerarCsat] = useState("");
  const [erroReservasCsat, setErroReservasCsat] = useState("");
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [modalScoreAberto, setModalScoreAberto] = useState(false);
  const [modalDuvidasClienteAberto, setModalDuvidasClienteAberto] =
    useState(false);
  const [duvidasClienteModal, setDuvidasClienteModal] = useState<string[]>([]);
  const [duvidasClienteModalEmpresaId, setDuvidasClienteModalEmpresaId] =
    useState<string | undefined>(undefined);
  const [rankingDuvidasCliente, setRankingDuvidasCliente] = useState<
    { tema: string; contagem: number; origemManual: boolean }[]
  >([]);
  const [removendoDuvidaCliente, setRemovendoDuvidaCliente] = useState<
    number | null
  >(null);
  const [dashboardAberto, setDashboardAberto] = useState(false);
  const [painelIaAberto, setPainelIaAberto] = useState(false);
  const [iaClienteSelecionado, setIaClienteSelecionado] = useState("");
  const [iaResumo, setIaResumo] = useState("");
  const [iaCarregando, setIaCarregando] = useState(false);
  const [iaErro, setIaErro] = useState("");
  const [respostasScore, setRespostasScore] = useState<ScoreFormAnswers>({
    ...INITIAL_SCORE_ANSWERS,
  });
  const [duvidasTemasHistorico, setDuvidasTemasHistorico] = useState<string[]>(
    [],
  );
  const [novaDuvidaTemaHistorico, setNovaDuvidaTemaHistorico] = useState("");
  const [duvidaOpcoes, setDuvidaOpcoes] =
    useState<string[]>(DUVIDA_OPCOES_PADRAO);
  const [solicitacaoOpcoes, setSolicitacaoOpcoes] = useState<string[]>(
    SOLICITACAO_OPCOES_PADRAO,
  );
  // Lista completa de tipos de ocorrência, vinda do Firestore (coleção
  // "temasOcorrencia", categoria "tipo"). Inclui tanto os tipos originais do
  // sistema quanto os personalizados — todos livremente editáveis/excluíveis
  // em /tipos-ocorrencia. TIPOS_PADRAO serve só de valor inicial (antes do
  // primeiro carregamento) para a tela não aparecer vazia.
  const [tabulacoesTipos, setTabulacoesTipos] = useState<
    import("../../services/temasOcorrencia").TemaOcorrencia[]
  >([]);
  const [tipos, setTipos] = useState<string[]>(TIPOS_PADRAO);

  useEffect(() => {
    listarTemas("duvida")
      .then((lista) =>
        setDuvidaOpcoes(
          lista
            .filter((t) => temaDisponivelParaPerfil(t, role))
            .map((t) => t.nome),
        ),
      )
      .catch((error) =>
        console.error("Erro ao carregar assuntos de dúvida:", error),
      );
    listarTemas("solicitacao")
      .then((lista) =>
        setSolicitacaoOpcoes(
          lista
            .filter((t) => temaDisponivelParaPerfil(t, role))
            .map((t) => t.nome),
        ),
      )
      .catch((error) =>
        console.error("Erro ao carregar assuntos de solicitação:", error),
      );
    listarTemas("tipo")
      .then((lista) => {
        setTabulacoesTipos(lista);
        setTipos(lista.map((t) => t.nome));
      })
      .catch((error) =>
        console.error("Erro ao carregar tipos de ocorrência:", error),
      );
  }, [role]);

  function adicionarDuvidaTemaHistorico() {
    const texto = novaDuvidaTemaHistorico.trim();
    if (!texto) return;
    setDuvidasTemasHistorico((prev) => [...prev, texto]);
    setNovaDuvidaTemaHistorico("");
  }

  function removerDuvidaTemaHistorico(index: number) {
    setDuvidasTemasHistorico((prev) => prev.filter((_, i) => i !== index));
  }

  // Rankeia (do maior pro menor) os temas de dúvida do cliente, somando as dúvidas
  // manuais registradas no questionário de score com os temas marcados nas ocorrências
  // de Dúvida abertas pelo Suporte/Treinamento para essa empresa.
  function montarRankingDuvidas(
    nomeEmpresa: string,
    duvidasManuais: string[],
  ): { tema: string; contagem: number; origemManual: boolean }[] {
    const contagens: Record<string, number> = {};
    const temasComOrigemManual = new Set<string>();

    duvidasManuais.forEach((texto) => {
      const chave = texto.trim();
      if (!chave) return;
      contagens[chave] = (contagens[chave] || 0) + 1;
      temasComOrigemManual.add(chave);
    });

    ocorrencias
      .filter(
        (o) =>
          o.tipo === "Dúvida" &&
          (o.departamento === "Suporte" || o.departamento === "Treinamento") &&
          normalizar(o.empresa) === normalizar(nomeEmpresa),
      )
      .forEach((o) => {
        (o.temaOcorrencia ?? []).forEach((tema) => {
          const chave = tema.trim();
          if (!chave) return;
          contagens[chave] = (contagens[chave] || 0) + 1;
        });
      });

    return Object.entries(contagens)
      .map(([tema, contagem]) => ({
        tema,
        contagem,
        origemManual: temasComOrigemManual.has(tema),
      }))
      .sort((a, b) => b.contagem - a.contagem);
  }

  async function removerDuvidaCliente(index: number) {
    if (!duvidasClienteModalEmpresaId) return;
    const emp = empresasList.find((e) => e.id === duvidasClienteModalEmpresaId);
    if (!emp) return;

    const novaLista = duvidasClienteModal.filter((_, i) => i !== index);

    setRemovendoDuvidaCliente(index);
    try {
      const empresaAtualizada: Empresa = {
        ...emp,
        duvidasTemasAnteriores: novaLista,
        updatedAt: Date.now(),
      };
      await salvarEmpresas(empresaAtualizada);
      setDuvidasClienteModal(novaLista);
      setRankingDuvidasCliente(
        montarRankingDuvidas(emp.nomeEmpresa, novaLista),
      );
      setEmpresasList((prev) =>
        prev.map((e) =>
          e.id === duvidasClienteModalEmpresaId ? empresaAtualizada : e,
        ),
      );
      toast.success("Dúvida removida!");
    } catch (error) {
      console.error("Erro ao remover dúvida do cliente:", error);
      toast.error("Erro ao remover a dúvida.");
    } finally {
      setRemovendoDuvidaCliente(null);
    }
  }
  const [calculoScoreResult, setCalculoScoreResult] = useState<{
    score: number | null;
    tipo: "Fast" | "Safety" | "";
    isNeutro?: boolean;
    contadores?: ContadorPerdasScore;
  } | null>(null);

  // WhatsApp Integration States
  const [whatsappConfirmModalOpen, setWhatsappConfirmModalOpen] =
    useState(false);
  const [pendingWhatsAppMessage, setPendingWhatsAppMessage] = useState<{
    ocorrenciaId: string;
    destinatarios: { nome: string; telefone: string }[];
    telefonesSelecionados: string[];
    empresaNome: string;
    temas: string[];
    dataStr: string;
    empresaObjeto: Empresa;
  } | null>(null);
  const [editedWhatsAppText, setEditedWhatsAppText] = useState("");
  const [sendConveyorImage, setSendConveyorImage] = useState(true);
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
  const destinatariosWhatsAppSelecionados =
    pendingWhatsAppMessage?.destinatarios.filter((d) =>
      pendingWhatsAppMessage.telefonesSelecionados.includes(d.telefone),
    ) ?? [];

  // Notificação de Gestão (Alerta -> Supervisor + CS Responsável) via WhatsApp
  const [gestaoConfirmModalOpen, setGestaoConfirmModalOpen] = useState(false);
  const [gestaoDestinatarios, setGestaoDestinatarios] = useState<
    DestinatarioGestao[]
  >([]);
  const [gestaoAvisos, setGestaoAvisos] = useState<string[]>([]);
  const [gestaoMensagem, setGestaoMensagem] = useState("");
  const [gestaoConclusaoEmpresaId, setGestaoConclusaoEmpresaId] =
    useState<string>();
  const [gestaoOcorrenciaId, setGestaoOcorrenciaId] = useState<
    string | undefined
  >(undefined);
  const [gestaoOcorrenciaEvento, setGestaoOcorrenciaEvento] =
    useState<EventoNotificacaoGestao>("alerta");

  // Notificação de Chamado Aberto (tipo Problema) -> apenas CS Responsável, via WhatsApp
  const [chamadoConfirmModalOpen, setChamadoConfirmModalOpen] = useState(false);
  const [chamadoDestinatarios, setChamadoDestinatarios] = useState<
    DestinatarioGestao[]
  >([]);
  const [chamadoAvisos, setChamadoAvisos] = useState<string[]>([]);
  const [chamadoMensagem, setChamadoMensagem] = useState("");
  const [chamadoOcorrenciaId, setChamadoOcorrenciaId] = useState<
    string | undefined
  >(undefined);

  const [novaAtualizacaoAberta, setNovaAtualizacaoAberta] = useState(false);
  const [novaDescricaoAtual, setNovaDescricaoAtual] = useState("");
  const [editingUpdateIdx, setEditingUpdateIdx] = useState<number | null>(null);
  const [editingUpdateText, setEditingUpdateText] = useState("");
  const [editingCsatIdx, setEditingCsatIdx] = useState<number | null>(null);
  const [editingCsatExperiencia, setEditingCsatExperiencia] = useState<"Bom" | "Ruim">("Bom");
  const [editingCsatOpiniao, setEditingCsatOpiniao] = useState("");
  const [novoResponsavelAtual, setNovoResponsavelAtual] = useState("");
  const [empresasList, setEmpresasList] = useState<Empresa[]>([]);
  const [usuariosList, setUsuariosList] = useState<UsuarioDocument[]>([]);
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([]);
  const [selecionada, setSelecionada] = useState<Ocorrencia | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const formSnapshotRef = useRef<string>(JSON.stringify(EMPTY));
  const [confirmarDescarteAberto, setConfirmarDescarteAberto] = useState(false);
  const [followUpGateAberto, setFollowUpGateAberto] = useState(false);
  const origemPainelRef = useRef<HTMLElement | null>(null);
  const novaOcorrenciaRef = useRef<HTMLButtonElement>(null);
  const listaOcorrenciasRef = useRef<HTMLDivElement>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const editandoImportadaSsx =
    !!editandoId &&
    ocorrencias.some((o) => o.id === editandoId && o.origem === "ssx-desk");
  const [busca, setBusca] = useState(() => searchParams.get("busca") || "");
  const [buscaAssunto, setBuscaAssunto] = useState("");
  const [filtroTipo, setFiltroTipo] = useState(
    () => searchParams.get("tipo") || "",
  );
  const [filtroAssuntoDuvida, setFiltroAssuntoDuvida] = useState(
    () => searchParams.get("assuntoDuvida") || "",
  );
  const [filtroFavoritas, setFiltroFavoritas] = useState(() => searchParams.get("favoritas") === "1");
  const [salvandoFavorita, setSalvandoFavorita] = useState(false);
  const [filtroDepto, setFiltroDepto] = useState(
    () => searchParams.get("depto") || "",
  );
  const [dataInicio, setDataInicio] = useState(
    () => searchParams.get("dataInicio") || "",
  );
  const [dataFim, setDataFim] = useState(
    () => searchParams.get("dataFim") || "",
  );
  const [ordenacaoData, setOrdenacaoData] = useState<"desc" | "asc">("desc");
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const salvarEmAndamentoRef = useRef(false);
  const [diasConfirmacaoEspera, setDiasConfirmacaoEspera] = useState<number | null>(null);
  const respostaEsperaRef = useRef<((motivo: MotivoEsperaTreinamento | null) => void) | null>(null);
  useEffect(() => () => {
    respostaEsperaRef.current?.(null);
    respostaEsperaRef.current = null;
  }, []);

  function perguntarMotivoEspera(dias: number): Promise<MotivoEsperaTreinamento | null> {
    if (respostaEsperaRef.current) return Promise.resolve(null);
    return new Promise((resolve) => {
      respostaEsperaRef.current = resolve;
      setDiasConfirmacaoEspera(dias);
    });
  }

  function responderMotivoEspera(motivo: MotivoEsperaTreinamento | null) {
    const resolver = respostaEsperaRef.current;
    respostaEsperaRef.current = null;
    setDiasConfirmacaoEspera(null);
    resolver?.(motivo);
  }
  const [painelAberto, setPainelAberto] = useState(false);
  const [usarTemplate, setUsarTemplate] = useState(true);
  const [temaOcorrenciaOngoingText, setTemaOcorrenciaOngoingText] =
    useState("");
  const [isRevisao, setIsRevisao] = useState(false);
  const [temasRevisados, setTemasRevisados] = useState<string[]>([]);
  const [temaForaEsteira, setTemaForaEsteira] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 50;
  const podeFavoritar = role === "treinador" || role === "master";

  async function alternarFavorita() {
    if (!selecionada?.id || !podeFavoritar || salvandoFavorita) return;
    const id = selecionada.id;
    const favorita = !selecionada.favorita;
    setSalvandoFavorita(true);
    try {
      const dados = await definirOcorrenciaFavorita(id, favorita);
      setOcorrencias((lista) =>
        lista.map((o) => (o.id === id ? { ...o, ...dados } : o)),
      );
      setSelecionada((atual) =>
        atual?.id === id ? { ...atual, ...dados } : atual,
      );
      toast.success(
        favorita ? "Ocorrência marcada com estrela." : "Estrela removida.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível alterar a estrela.",
      );
    } finally {
      setSalvandoFavorita(false);
    }
  }

  useEffect(() => {
    const tipo = searchParams.get("tipo") || "";
    const start = searchParams.get("dataInicio") || "";
    const end = searchParams.get("dataFim") || "";
    setFiltroTipo(tipo);
    setBusca(searchParams.get("busca") || "");
    setFiltroAssuntoDuvida(searchParams.get("assuntoDuvida") || "");
    setFiltroFavoritas(searchParams.get("favoritas") === "1");
    setFiltroDepto(searchParams.get("depto") || "");
    setDataInicio(start);
    setDataFim(end);
  }, [searchParams]);

  const handleAddResultado = () => {
    setForm((f) => ({
      ...f,
      treinamentoResultados: [...(f.treinamentoResultados ?? []), ""],
    }));
  };

  const handleUpdateResultado = (index: number, val: string) => {
    setForm((f) => {
      const copy = [...(f.treinamentoResultados ?? [])];
      copy[index] = val;
      return { ...f, treinamentoResultados: copy };
    });
  };

  const handleRemoveResultado = (index: number) => {
    setForm((f) => ({
      ...f,
      treinamentoResultados: (f.treinamentoResultados ?? []).filter(
        (_, i) => i !== index,
      ),
    }));
  };
  const empresaFiltro = searchParams.get("empresa") || "";
  const reservaEditando = reservasCsat.find((r) => r.id === editandoId);
  const nomesParticipantesReserva = reservaEditando
    ? formatarListaNomes(
        reservaEditando.respostas.map((r) => formatarNome(r.nome)),
      )
    : "";
  const templateTreinamentoAtual = montarTemplateTreinamento(
    nomesParticipantesReserva || undefined,
  );
  function reservaDeClienteSuspenso(reserva: Pick<ReservaCsat, "empresa" | "empresaId">) {
    return empresasList.some((e) => (reserva.empresaId ? e.id === reserva.empresaId : normalizar(e.nomeEmpresa) === normalizar(reserva.empresa)) && e.isSuspended);
  }
  const ultimaReservaCsat = reservasCsat.filter((r) => !reservaDeClienteSuspenso(r)).reduce<ReservaCsat | undefined>(
    (ultima, reserva) =>
      !ultima || (reserva.createdAt || 0) > (ultima.createdAt || 0)
        ? reserva
        : ultima,
    undefined,
  );
  function registrarUltimoCsat() {
    if (!ultimaReservaCsat) return;
    setErroGerarCsat("");
    abrirEdicao({
      ...ultimaReservaCsat,
      treinamentoResultados: ultimaReservaCsat.respostas.map(
        (r) => r.experiencia,
      ),
    });
  }
  function abrirGeracaoCsat() {
    if (ultimaReservaCsat) {
      registrarUltimoCsat();
      return;
    }
    setErroGerarCsat("");
    setModalCsatAberto(true);
  }
  async function gerarCsat(empresaId: string) {
    if (!isTreinador || gerandoCsat) return;
    if (ultimaReservaCsat) {
      setModalCsatAberto(false);
      registrarUltimoCsat();
      return;
    }
    if (carregandoReservasCsat || erroReservasCsat) return;
    const empresa = empresasList.find(
      (e) => e.id === empresaId,
    );
    setErroGerarCsat("");
    if (!empresa?.id) {
      const mensagem =
        "Selecione um cliente cadastrado para gerar o link.";
      setErroGerarCsat(mensagem);
      toast.error(mensagem);
      return;
    }
    if (empresa.isSuspended) {
      setErroGerarCsat(MENSAGEM_TREINAMENTO_SUSPENSO);
      return;
    }
    setGerandoCsat(true);
    try {
      const reserva = (await requisicaoCsat(
        "reservas",
        { empresaId: empresa.id },
        true,
      )) as ReservaCsat;
      setReservasCsat((prev) => [...prev, reserva]);
      setModalCsatAberto(false);
      const copiado = await copiarTexto(linkCsat(reserva.token));
      toast.success(
        `Link gerado${copiado ? ' e copiado' : ''}. Ocorrência ${reserva.idSeqFormatted} reservada.`,
      );
      if (!copiado) toast.warning('O navegador não permitiu copiar automaticamente. Use “Copiar link” ou selecione o endereço no campo do CSAT.');
      // Uma falha ao atualizar os cadastros não invalida o link já criado.
      try {
        setEmpresasList(await listarEmpresas(true));
      } catch {
        toast.warning("O link foi gerado, mas os cadastros não foram atualizados. Atualize a página antes de registrar a ocorrência.");
      }
    } catch (error) {
      const mensagem =
        error instanceof Error
          ? error.message
          : "Não foi possível gerar o link.";
      setErroGerarCsat(mensagem);
      toast.error(mensagem);
      // Recupera também uma reserva criada em outra aba enquanto esta tela estava aberta.
      try {
        const reservas = await requisicaoCsat("reservas", undefined, true) as ReservaCsat[];
        setReservasCsat(reservas);
        if (reservas.length > 0) setModalCsatAberto(false);
      } catch {
        /* Preserva a mensagem original de falha na geração. */
      }
    } finally {
      setGerandoCsat(false);
    }
  }
  const ocorrenciaIdFiltro = searchParams.get("ocorrencia") || "";
  const expedienteFiltro = searchParams.get("expediente") || "";

  useEffect(() => {
    setCurrentPage(1);
  }, [
    busca,
    filtroTipo,
    filtroAssuntoDuvida,
    filtroDepto,
    dataInicio,
    dataFim,
    empresaFiltro,
    expedienteFiltro,
    filtroFavoritas,
  ]);

  useEffect(() => {
    if (!loading && ocorrenciaIdFiltro && ocorrencias.length > 0) {
      const encontrada = ocorrencias.find((o) => o.id === ocorrenciaIdFiltro);
      if (encontrada) {
        setSelecionada(encontrada);
      }
    }
  }, [loading, ocorrenciaIdFiltro, ocorrencias]);

  const temAusenteOuCancelado =
    form.temaOcorrencia?.some((t) => t === "Ausente" || t === "Cancelado") ??
    false;
  const temOutrosTemas =
    form.temaOcorrencia?.some((t) => t !== "Ausente" && t !== "Cancelado") ??
    false;
  const temTemaValido = temOutrosTemas && !temAusenteOuCancelado;

  async function carregar(forceRefresh = true) {
    setLoading(true);
    setCarregandoReservasCsat(true);
    // Carrega as reservas em paralelo para não bloquear a identificação do cliente.
    const reservasPromise = isTreinador
      ? requisicaoCsat("reservas", undefined, true)
          .then((reservas) => {
            setReservasCsat(reservas);
            setErroReservasCsat("");
          })
          .catch((error) => {
            setErroReservasCsat(
              error instanceof Error
                ? error.message
                : "Não foi possível carregar as reservas de CSAT.",
            );
          })
          .finally(() => setCarregandoReservasCsat(false))
      : Promise.resolve();
    const [ocLista, empLista, usrLista] = await Promise.all([
      listarOcorrencias(forceRefresh),
      listarEmpresas(forceRefresh).then((empresas) => {
        // Libera o botão assim que o cliente chegar, sem esperar histórico e usuários.
        setEmpresasList(empresas);
        return empresas;
      }),
      listarUsuarios().catch((error) => {
        console.error("Erro ao listar usuários no Histórico:", error);
        return [];
      }),
    ]);
    const enriquecidas = atribuirIdsOcorrencias(ocLista, empLista);
    setOcorrencias(enriquecidas);
    setEmpresasList(empLista);
    setUsuariosList(usrLista);
    setLoading(false);
    await reservasPromise;
    return enriquecidas;
  }

  /**
   * Abre o GestaoNotificacaoModal para retentar o envio da notificação de gestão
   * de uma ocorrência que já foi processada mas teve falhas no WhatsApp.
   * Filtra apenas os destinatários que falharam para não reincidir sobre os que já receberam.
   */
  async function reabrirNotificacaoGestao(oc: Ocorrencia) {
    const empresaObjeto = empresasList.find(
      (e) => normalizar(e.nomeEmpresa) === normalizar(oc.empresa),
    );

    if (!empresaObjeto) {
      toast.error("Empresa não encontrada para retentar a notificação.");
      return;
    }

    // Determina o evento a partir do tipo da ocorrência, para reusar a mesma regra de
    // habilitação por tipo de mensagem na busca de destinatários "frescos".
    const evento: EventoNotificacaoGestao = oc.suspenderCliente
      ? "suspenso"
      : oc.alerta
        ? "alerta"
        : oc.retornarEsteira
          ? "retorno"
          : oc.retirarAlerta
            ? "alerta_retirado"
            : "conclusao";

    // Filtra só os que falharam (se houver registro) — caso contrário reusa todos
    const falhos = (oc.whatsappDestinatarios ?? []).filter(
      (d) => d.status === "falhou",
    );
    const alvos: { nome: string; telefone: string }[] =
      falhos.length > 0
        ? falhos.map((d) => ({ nome: d.nome, telefone: d.telefone }))
        : await obterDestinatariosGestao(empresaObjeto, evento).then(
            ({ destinatarios }) => destinatarios,
          );

    if (alvos.length === 0) {
      toast.error("Nenhum destinatário encontrado para retentar o envio.");
      return;
    }

    // Reconstrói a mensagem com base no tipo da ocorrência
    let mensagem: string;
    if (evento === "suspenso") {
      mensagem = montarMensagemSuspensaoGestao(empresaObjeto, oc.id);
    } else if (evento === "alerta") {
      mensagem = montarMensagemAlertaGestao(empresaObjeto, oc.id);
    } else if (evento === "retorno") {
      mensagem = montarMensagemRetornoEsteiraGestao(
        empresaObjeto,
        oc.id,
        !!oc.retirarAlerta,
      );
    } else if (evento === "alerta_retirado") {
      mensagem = montarMensagemAlertaRetiradoGestao(empresaObjeto, oc.id);
    } else {
      mensagem = montarMensagemConclusaoEsteiraGestao(empresaObjeto, oc.id);
    }

    setGestaoDestinatarios(alvos);
    setGestaoAvisos([]);
    setGestaoMensagem(mensagem);
    setGestaoOcorrenciaId(oc.id);
    setGestaoOcorrenciaEvento(evento);
    setGestaoConclusaoEmpresaId(
      evento === "conclusao" ? empresaObjeto.id : undefined,
    );
    setGestaoConfirmModalOpen(true);
  }

  function podeNotificarTreinamento(oc: Ocorrencia) {
    const empresa = empresasList.find(
      (e) => normalizar(e.nomeEmpresa) === normalizar(oc.empresa),
    );
    return (
      isTreinamentoRealizado(oc) &&
      !oc.temaForaEsteira &&
      !!empresa &&
      !empresa.isOngoing &&
      !isEmpresaInterna(empresa)
    );
  }

  /**
   * Abre o whatsappConfirmModalOpen para retentar o envio da notificação de Esteira
   * (Treinamento) para o cliente.
   */
  async function reabrirNotificacaoEsteira(oc: Ocorrencia) {
    const empresaObjeto = empresasList.find(
      (e) => normalizar(e.nomeEmpresa) === normalizar(oc.empresa),
    );
    if (!empresaObjeto) {
      toast.error("Empresa não encontrada para retentar a notificação.");
      return;
    }

    const falhos = (oc.whatsappDestinatarios ?? []).filter(
      (d) => d.status === "falhou",
    );

    let alvos: { nome: string; telefone: string }[];
    if (falhos.length > 0) {
      alvos = falhos.map((d) => ({ nome: d.nome, telefone: d.telefone }));
    } else if (
      oc.whatsappDestinatarios &&
      oc.whatsappDestinatarios.length > 0
    ) {
      alvos = oc.whatsappDestinatarios.map((d) => ({
        nome: d.nome,
        telefone: d.telefone,
      }));
    } else {
      // Ocorrência sem envio registrado (ex: usuário escolheu "Não enviar" na hora) —
      // busca os contatos do cliente novamente, do mesmo jeito que no envio original.
      alvos = obterDestinatariosCliente(empresaObjeto);
    }

    if (alvos.length === 0) {
      toast.error(
        "O cliente não possui telefone de contato cadastrado para envio do WhatsApp.",
      );
      return;
    }

    const temas = oc.temaOcorrencia ?? [];
    const [year, month, day] = obterDataRealizacaoTreinamento(oc).split("-");
    const dataCompleta = `${day}/${month}/${year}`;

    const temasParaMensagem = temas.filter(
      (t) =>
        t.trim().toLowerCase() !== "inicio" &&
        t.trim().toLowerCase() !== "conclusao",
    );
    const plural = temasParaMensagem.length > 1;
    const textoMensagem = `Olá, *${PLACEHOLDER_NOME}*! 🚀\nSeu treinamento sobre ${plural ? "os temas" : "o tema"} *${temasParaMensagem.join(", ")}* foi registrado com sucesso em *${dataCompleta}*.\n\nConfira acima a sua esteira de evolução atualizada:`;

    setPendingWhatsAppMessage({
      ocorrenciaId: oc.id!,
      // Oferece também os demais números cadastrados, mesmo se o envio
      // anterior tiver sido feito apenas para parte deles.
      destinatarios: [
        ...new Map(
          [...alvos, ...obterDestinatariosCliente(empresaObjeto)].map((d) => [
            d.telefone,
            d,
          ]),
        ).values(),
      ],
      telefonesSelecionados: alvos.map((d) => d.telefone),
      empresaNome: empresaObjeto.nomeEmpresa,
      temas,
      dataStr: dataCompleta,
      empresaObjeto: empresaObjeto,
    });
    setEditedWhatsAppText(textoMensagem);
    setSendConveyorImage(true);
    setWhatsappConfirmModalOpen(true);
  }

  async function salvarNovaAtualizacao() {
    if (!novaDescricaoAtual.trim()) {
      toast.error("Preencha a descrição da atualização.");
      return;
    }

    const atualizacoesAntigas = selecionada!.atualizacoes ?? [];
    const atualizado = {
      ...selecionada!,
      atualizacoes: [
        ...atualizacoesAntigas,
        {
          descricao: novaDescricaoAtual.trim(),
          updatedAt: Date.now(),
          responsavel: formatarNome(userName),
        },
      ],
    };

    setSalvando(true);
    await salvarOcorrencia(atualizado);
    const novasOcs = await carregar();
    setSalvando(false);
    setNovaAtualizacaoAberta(false);
    setNovaDescricaoAtual("");
    setNovoResponsavelAtual("");
    const updatedSelected = novasOcs.find((o) => o.id === selecionada!.id);
    setSelecionada(updatedSelected || atualizado);
    toast.success("Atualização incluída!");
  }

  async function salvarEdicaoAtualizacao(index: number) {
    if (!editingUpdateText.trim()) {
      toast.error("A descrição da atualização não pode ser vazia.");
      return;
    }

    const copy = [...(selecionada!.atualizacoes ?? [])];
    // Corrigir o texto não muda a data nem o autor do comentário original.
    copy[index] = {
      ...copy[index],
      descricao: editingUpdateText.trim(),
    };

    const atualizado = {
      ...selecionada!,
      atualizacoes: copy,
    };

    setSalvando(true);
    try {
      await salvarOcorrencia(atualizado);
      const novasOcs = await carregar();
      const updatedSelected = novasOcs.find((o) => o.id === selecionada!.id);
      setSelecionada(updatedSelected || atualizado);
      setEditingUpdateIdx(null);
      setEditingUpdateText("");
      toast.success("Atualização editada com sucesso!");
    } catch (error) {
      console.error("Erro ao salvar edição da atualização:", error);
      toast.error("Erro ao salvar as alterações.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluirAtualizacao(index: number) {
    if (!selecionada) return;

    toast("Tem certeza que deseja excluir esta atualização?", {
      action: {
        label: "Excluir",
        onClick: async () => {
          const copy = [...(selecionada.atualizacoes ?? [])];
          copy.splice(index, 1);

          const atualizado = {
            ...selecionada,
            atualizacoes: copy,
          };

          setSalvando(true);
          try {
            await salvarOcorrencia(atualizado);
            const novasOcs = await carregar();
            const updatedSelected = novasOcs.find(
              (o) => o.id === selecionada.id,
            );
            setSelecionada(updatedSelected || atualizado);
            toast.success("Atualização excluída com sucesso!");
          } catch (error) {
            console.error("Erro ao excluir atualização:", error);
            toast.error("Erro ao excluir a atualização.");
          } finally {
            setSalvando(false);
          }
        },
      },
      cancel: { label: "Cancelar", onClick: () => {} },
      duration: 10000,
    });
  }

  function fecharDetalhe() {
    setSelecionada(null);
    setNovaAtualizacaoAberta(false);
    setNovaDescricaoAtual("");
    setNovoResponsavelAtual("");
  }

  async function salvarEdicaoCsat(index: number) {
    if (!selecionada?.id) return;
    setSalvando(true);
    try {
      const dados = await editarRespostaCsat(
        selecionada.id,
        index,
        editingCsatExperiencia,
        editingCsatOpiniao.trim(),
      );
      setSelecionada({
        ...selecionada,
        csatRespostas: dados.csatRespostas,
        treinamentoResultados: dados.treinamentoResultados,
      });
      await carregar(true);
      setEditingCsatIdx(null);
      setEditingCsatOpiniao("");
      toast.success("Avaliação do CSAT atualizada com sucesso!");
    } catch (error) {
      console.error("Erro ao editar avaliação do CSAT:", error);
      toast.error(
        error instanceof Error ? error.message : "Erro ao salvar a avaliação.",
      );
    } finally {
      setSalvando(false);
    }
  }

  useEffect(() => {
    carregar(false)
      .catch((error) => {
        console.error("Erro ao sincronizar o histórico:", error);
        toast.error(
          "Não foi possível sincronizar o histórico. Tente atualizar a página.",
        );
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selecionada) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [selecionada]);

  useEffect(() => {
    if (editandoId) return;

    if (form.tipo === "Treinamento") {
      if (usarTemplate && !form.descricao.trim()) {
        setForm((f) => ({ ...f, descricao: TEMPLATE_TREINAMENTO }));
      }
    } else {
      if (form.descricao === TEMPLATE_TREINAMENTO) {
        setForm((f) => ({ ...f, descricao: "" }));
      }
    }
  }, [form.tipo, form.descricao, editandoId, usarTemplate]);

  useEffect(() => {
    if (editandoId) return;

    if (form.tipo !== "Treinamento") {
      setUsarTemplate(true);
    }
  }, [form.tipo, editandoId]);

  function set(campo: keyof typeof EMPTY, valor: string) {
    setForm((f) => {
      const next = { ...f, [campo]: valor };
      if (campo === "empresa") {
        next.temaOcorrencia = [];
        setTemasRevisados([]);
        setIsRevisao(false);
        setTemaOcorrenciaOngoingText("");
      }
      if (
        campo === "tipo" &&
        f.tipo !== valor &&
        (f.tipo === "Treinamento" || f.tipo === "Dúvida")
      ) {
        next.temaOcorrencia = [];
        setTemasRevisados([]);
        setIsRevisao(false);
        setTemaOcorrenciaOngoingText("");
      }
      if (campo === "tipo" && f.tipo !== valor && valor !== "Problema") {
        next.chamadoAberto = false;
        next.chamadoDescricao = "";
        next.chamadoLink = "";
      }
      if (campo === "tipo" && f.tipo !== valor && valor !== "Follow up final") {
        next.followUpResultadoAnalise = "";
        next.followUpStatusContato = "";
        next.followUpProximaAcao = "";
        next.followUpEncaminharSuporte = false;
      }
      return next;
    });
  }

  function abrirNovo() {
    origemPainelRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const deptos = getAllowedDepartments();
    const deptoPadrao = deptos.length === 1 ? deptos[0] : "";
    const novoForm = {
      ...EMPTY,
      empresa: empresaFiltro || "",
      responsavel: userName,
      departamento: deptoPadrao,
    };
    setForm(novoForm);
    formSnapshotRef.current = JSON.stringify(novoForm);
    setTemaOcorrenciaOngoingText("");
    setBuscaAssunto("");
    setEditandoId(null);
    setUsarTemplate(true);
    setCalculoScoreResult(null);
    setRespostasScore({ ...INITIAL_SCORE_ANSWERS });
    setDuvidasTemasHistorico([]);
    setNovaDuvidaTemaHistorico("");
    setPainelAberto(true);
    setIsRevisao(false);
    setTemasRevisados([]);
    setTemaForaEsteira(false);
  }

  function abrirValidacao(nomeEmpresa: string) {
    const empresa = empresasList.find((e) => normalizar(e.nomeEmpresa) === normalizar(nomeEmpresa));
    navigate(empresa?.id ? `/validacao-conhecimento?empresa=${encodeURIComponent(empresa.id)}` : "/validacao-conhecimento");
  }

  function abrirEdicao(o: Ocorrencia) {
    if (o.validacaoTentativaId) {
      toast.info('Esta ocorrência registra uma tentativa concluída da Validação do conhecimento e não pode ser editada aqui.', {
        action: { label: 'Abrir validação', onClick: () => abrirValidacao(o.empresa) },
      });
      return;
    }
    origemPainelRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const treinamento = lerTemasTreinamento(
      o.temaOcorrencia ?? [],
      o.isRevisao,
    );
    const temas =
      o.tipo === "Treinamento" ? treinamento.temas : (o.temaOcorrencia ?? []);
    let dataFormatada = "";
    let hora = "";

    // Reserva de CSAT ainda pendente: dataOcorrencia é só o instante em que o
    // link foi gerado, não uma data de agendamento real. Deixar vazio pro
    // treinador preencher a data do próximo treinamento do cliente.
    const ehReservaCsatPendente = (o as any).status === "reservada";

    if (
      !ehReservaCsatPendente &&
      o.dataOcorrencia &&
      o.dataOcorrencia > 0 &&
      !isNaN(o.dataOcorrencia)
    ) {
      const d = new Date(o.dataOcorrencia);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      dataFormatada = `${year}-${month}-${day}`;
      hora = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }

    let dataCriacaoFormatada = "";
    let horaCriacaoFormatada = "";
    if (o.createdAt && o.createdAt > 0 && !isNaN(o.createdAt)) {
      const d = new Date(o.createdAt);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      dataCriacaoFormatada = `${year}-${month}-${day}`;
      horaCriacaoFormatada = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }

    const formEdicao: OcorrenciaForm = {
      empresa: o.empresa,
      tipo: o.tipo,
      descricao: o.descricao,
      responsavel: o.responsavel,
      departamento: o.departamento ?? "",
      dataOcorrencia: dataFormatada,
      horaOcorrencia: hora,
      temaOcorrencia: temas,
      alerta: o.alerta ?? false,
      retirarAlerta: o.retirarAlerta ?? false,
      alertaResolvidoPorId: o.alertaResolvidoPorId || "",
      alertaOriginalId: o.alertaOriginalId || "",
      gamificacaoPontoId: o.gamificacaoPontoId || "",
      treinamentoDataSolicitacao: o.treinamentoDataSolicitacao || "",
      treinamentoMotivoEspera: motivoEsperaValido(o.treinamentoMotivoEspera) ? o.treinamentoMotivoEspera : null,
      treinamentoTempoAgenda: o.treinamentoTempoAgenda || "",
      treinamentoSolicitante: o.treinamentoSolicitante || "CS",
      treinamentoNotas: o.treinamentoNotas
        ? o.treinamentoNotas.map(String)
        : [],
      treinamentoResultados: o.treinamentoResultados ?? [],
      createdAt: dataCriacaoFormatada,
      horaCriacao: horaCriacaoFormatada,
      retornarEsteira: o.retornarEsteira ?? false,
      suspenderCliente: o.suspenderCliente ?? false,
      csatSuporte: o.csatSuporte ?? "",
      chamadoAberto: o.chamadoAberto ?? false,
      chamadoDescricao: o.chamadoDescricao ?? "",
      chamadoLink: o.chamadoLink ?? "",
      followUpResultadoAnalise: o.followUpResultadoAnalise ?? "",
      followUpStatusContato: o.followUpStatusContato ?? "",
      followUpProximaAcao: o.followUpProximaAcao ?? "",
      followUpEncaminharSuporte: o.followUpEncaminharSuporte ?? false,
    };
    setForm(formEdicao);
    formSnapshotRef.current = JSON.stringify(formEdicao);
    setTemaOcorrenciaOngoingText(temas.join(", "));
    setBuscaAssunto("");
    setEditandoId(o.id ?? null);
    setCalculoScoreResult(null);
    setRespostasScore({ ...INITIAL_SCORE_ANSWERS });
    setDuvidasTemasHistorico([]);
    setNovaDuvidaTemaHistorico("");
    setPainelAberto(true);
    setIsRevisao(o.tipo === "Treinamento" && treinamento.isRevisao);
    setTemasRevisados(
      o.tipo === "Treinamento" ? treinamento.temasRevisados : [],
    );
    setTemaForaEsteira(o.temaForaEsteira ?? false);
  }

  function cancelar(opts?: { skipConfirmacao?: boolean }) {
    if (salvando && !opts?.skipConfirmacao) return;
    const houveAlteracao = JSON.stringify(form) !== formSnapshotRef.current;
    if (!opts?.skipConfirmacao && houveAlteracao) {
      setConfirmarDescarteAberto(true);
      return;
    }
    setConfirmarDescarteAberto(false);
    setTemasRevisados([]);
    setPainelAberto(false);
    setForm({ ...EMPTY });
    setTemaOcorrenciaOngoingText("");
    setBuscaAssunto("");
    setEditandoId(null);
    setUsarTemplate(true);
    setCalculoScoreResult(null);
    setRespostasScore({ ...INITIAL_SCORE_ANSWERS });
    setDuvidasTemasHistorico([]);
    setNovaDuvidaTemaHistorico("");
    setIsRevisao(false);
    setTemaForaEsteira(false);
    const destinoFoco = origemPainelRef.current?.isConnected ? origemPainelRef.current : novaOcorrenciaRef.current;
    destinoFoco?.focus({ preventScroll: true });
  }

  function normalizar(str: string) {
    return str.trim().toLowerCase().replace(/&amp;/g, "&").replace(/\s+/g, " ");
  }

  async function salvar() {
    if (salvando || salvarEmAndamentoRef.current) return;
    salvarEmAndamentoRef.current = true;
    try {
      await salvarFormulario();
    } catch (error) {
      console.error("Erro ao salvar ocorrência:", error);
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar a ocorrência. Tente novamente.");
    } finally {
      salvarEmAndamentoRef.current = false;
      setSalvando(false);
    }
  }

  async function salvarFormulario() {
    if (
      reservaEditando &&
      (form.empresa !== reservaEditando.empresa ||
        form.tipo !== "Treinamento" ||
        form.departamento !== "Treinamento")
    ) {
      toast.error(
        "A reserva de CSAT deve ser registrada como treinamento do cliente original.",
      );
      return;
    }
    const responsavelFinal = formatarNome(
      editandoId ? form.responsavel : userName,
    );

    if (form.tipo === 'Treinamento' && (form.temaOcorrencia ?? []).some(t => normalizar(t) === normalizar('Validação do conhecimento'))) {
      toast.error('Registre este tema pelo módulo Validação do conhecimento. A esteira avança apenas após aprovação na avaliação.');
      return;
    }

    if (
      !form.empresa.trim() ||
      (!form.tipo && !editandoImportadaSsx) ||
      !form.departamento ||
      !form.descricao.trim()
    ) {
      toast.error("Preencha empresa, tipo, departamento e descrição.");
      return;
    }

    const empresaObjeto = empresasList.find(
      (e) => normalizar(e.nomeEmpresa) === normalizar(form.empresa),
    );

    const ocorrenciaOriginal = editandoId
      ? ocorrencias.find((o) => o.id === editandoId) || reservaEditando
      : null;
    const origemTreinamento = reservaEditando ? null : ocorrenciaOriginal;

    if (!empresaObjeto) {
      toast.error(
        "A empresa especificada não foi encontrada. Selecione uma empresa cadastrada válida.",
      );
      return;
    }
    if (bloquearTreinamentoSuspenso(empresaObjeto, form, origemTreinamento)) {
      toast.error(MENSAGEM_TREINAMENTO_SUSPENSO);
      return;
    }

    // Empresas internas (ex.: Systemsat) permitem registrar ocorrências para
    // fins de histórico, mas não devem disparar automações de esteira/WhatsApp
    // nem notificações de gestão, já que não são clientes reais.
    const empresaInterna = isEmpresaInterna(empresaObjeto);

    const CanceladoOuAusente = (form.temaOcorrencia ?? []).some(
      (t) =>
        t.trim().toLowerCase() === "cancelado" ||
        t.trim().toLowerCase() === "ausente",
    );

    if (form.tipo === "Treinamento") {
      if (normalizarTemasTreinamento(form.temaOcorrencia ?? []).length === 0) {
        toast.error("Selecione ao menos um tema de treinamento.");
        return;
      }
      if (!form.treinamentoDataSolicitacao) {
        toast.error("Preencha a data de solicitação.");
        return;
      }
      if (!CanceladoOuAusente && !form.treinamentoTempoAgenda?.trim()) {
        toast.error("Preencha o tempo de agenda.");
        return;
      }
      if (!form.treinamentoSolicitante) {
        toast.error("Selecione quem solicitou o treinamento.");
        return;
      }

      const rawResultados = form.treinamentoResultados ?? [];
      const hasInvalidResultado = rawResultados.some(
        (r) => r !== "Bom" && r !== "Ruim",
      );
      if (hasInvalidResultado) {
        toast.error(
          "Selecione 'Bom' ou 'Ruim' para cada resultado de CSAT adicionado.",
        );
        return;
      }
    }

    if (form.tipo === "Checkpoint" && !form.dataOcorrencia) {
      toast.error("A data do checkpoint é obrigatória.");
      return;
    }

    if (form.tipo === "Dúvida" && (form.temaOcorrencia ?? []).length === 0) {
      toast.error("Selecione ao menos um assunto da dúvida.");
      return;
    }

    if (
      form.tipo === "Problema" &&
      form.chamadoAberto &&
      !form.chamadoDescricao?.trim()
    ) {
      toast.error(
        "Descreva qual o problema que está sendo resolvido pelo chamado.",
      );
      return;
    }

    if (form.tipo === "Follow up final") {
      if (!form.followUpResultadoAnalise) {
        toast.error("Selecione o resultado da análise de aplicação.");
        return;
      }
      if (!form.followUpStatusContato) {
        toast.error("Selecione o status do contato.");
        return;
      }
      if (
        form.followUpStatusContato === "Contato bem-sucedido" &&
        !form.followUpProximaAcao
      ) {
        toast.error("Selecione a próxima ação.");
        return;
      }
    }

    const isOngoing = empresaObjeto.isOngoing ?? false;

    if (
      isTreinador &&
      !editandoId &&
      form.tipo === "Treinamento" &&
      !calculoScoreResult &&
      !isOngoing &&
      !CanceladoOuAusente
    ) {
      toast.error(
        "O cálculo de score é obrigatório para ocorrências do tipo Treinamento.",
      );
      return;
    }

    let timestamp = 0;
    if (form.dataOcorrencia) {
      const [year, month, day] = form.dataOcorrencia.split("-").map(Number);
      const [hours, minutes] = (form.horaOcorrencia || "00:00")
        .split(":")
        .map(Number);
      timestamp = new Date(year, month - 1, day, hours, minutes).getTime();
    } else if (form.tipo === "Gol") {
      timestamp = Date.now();
    }

    const novaDescricao = form.descricao.trim();

    // Dado antigo (modelo de nota 1 a 5): preservado como está no registro
    // original quando em edição, já que o formulário não permite mais editá-lo.
    const computedMedia: number | null =
      ocorrenciaOriginal?.treinamentoNotaMedia ?? null;
    const validNotas: number[] = ocorrenciaOriginal?.treinamentoNotas ?? [];
    // Dado atual (modelo Bom/Ruim)
    const validResultados = (form.treinamentoResultados ?? []).filter(
      (r): r is "Bom" | "Ruim" => r === "Bom" || r === "Ruim",
    );

    // Marca individualmente os temas revisados, inclusive nas agendas mistas.
    const treinamento = prepararTemasTreinamento(
      form.temaOcorrencia ?? [],
      temasRevisados,
      isRevisao,
    );
    const temaOcorrenciaFinal =
      form.tipo === "Treinamento"
        ? treinamento.temaOcorrencia
        : (form.temaOcorrencia ?? []);

    let finalCreatedAt: number | undefined = undefined;
    if (role === "master" && form.createdAt) {
      const [year, month, day] = form.createdAt.split("-").map(Number);
      const originalTime = ocorrenciaOriginal?.createdAt
        ? new Date(ocorrenciaOriginal.createdAt)
        : new Date();
      const [hours, minutes] = form.horaCriacao
        ? form.horaCriacao.split(":").map(Number)
        : [originalTime.getHours(), originalTime.getMinutes()];
      finalCreatedAt = new Date(
        year,
        month - 1,
        day,
        hours,
        minutes,
        form.horaCriacao ? 0 : originalTime.getSeconds(),
        form.horaCriacao ? 0 : originalTime.getMilliseconds(),
      ).getTime();
    } else if (ocorrenciaOriginal?.createdAt) {
      finalCreatedAt = ocorrenciaOriginal.createdAt;
    } else if (form.tipo === "Treinamento") {
      // Mantém a realização consistente com a pergunta, inclusive se o modal atravessar a meia-noite.
      finalCreatedAt = obterInstanteRealizacaoTreinamento({});
    }

    const dataRealizacaoStr =
      form.tipo === "Treinamento"
        ? obterDataRealizacaoTreinamento({ createdAt: finalCreatedAt })
        : "";

    const avaliacaoEspera = avaliarMotivoEsperaTreinamento({
      tipo: form.tipo, temas: form.temaOcorrencia,
      solicitacao: form.treinamentoDataSolicitacao, realizacao: dataRealizacaoStr,
      motivo: form.treinamentoMotivoEspera,
    });
    if (form.tipo === "Treinamento" && !CanceladoOuAusente && avaliacaoEspera.dias === null) {
      toast.error("Confira as datas: a solicitação deve ser válida e não pode ser posterior à realização do treinamento.");
      return;
    }
    let motivoEspera = avaliacaoEspera.motivo;
    if (avaliacaoEspera.precisaConfirmar && avaliacaoEspera.dias !== null) {
      motivoEspera = await perguntarMotivoEspera(avaliacaoEspera.dias);
      if (!motivoEsperaValido(motivoEspera)) return;
      setForm((anterior) => ({ ...anterior, treinamentoMotivoEspera: motivoEspera }));
    }

    const base: Ocorrencia = {
      ...form,
      createdAt: finalCreatedAt,
      empresa: form.empresa.trim(),
      descricao: novaDescricao,
      responsavel: responsavelFinal,
      dataOcorrencia: timestamp,
      treinamentoMotivoEspera: motivoEspera,
      atualizacoes: ocorrenciaOriginal?.atualizacoes ?? [],
      scoreCalculado: calculoScoreResult
        ? calculoScoreResult.isNeutro
          ? null
          : calculoScoreResult.score
        : ocorrenciaOriginal?.scoreCalculado,
      scoreAnswers: calculoScoreResult
        ? calculoScoreResult.isNeutro
          ? null
          : respostasScore
        : ocorrenciaOriginal?.scoreAnswers,
      temaOcorrencia: temaOcorrenciaFinal,
      isRevisao:
        form.tipo === "Treinamento" ? treinamento.isRevisao : undefined,
      temaForaEsteira:
        form.tipo === "Treinamento" ? temaForaEsteira : undefined,
      csatSuporte:
        form.departamento === "Suporte" && form.csatSuporte
          ? form.csatSuporte
          : undefined,
      chamadoAberto:
        form.tipo === "Problema" ? (form.chamadoAberto ?? false) : undefined,
      chamadoDescricao:
        form.tipo === "Problema" && form.chamadoAberto
          ? form.chamadoDescricao?.trim()
          : undefined,
      chamadoLink:
        form.tipo === "Problema" && form.chamadoAberto
          ? form.chamadoLink?.trim() || undefined
          : undefined,
      followUpResultadoAnalise:
        form.tipo === "Follow up final"
          ? form.followUpResultadoAnalise || undefined
          : undefined,
      followUpStatusContato:
        form.tipo === "Follow up final"
          ? form.followUpStatusContato || undefined
          : undefined,
      followUpProximaAcao:
        form.tipo === "Follow up final" &&
        form.followUpStatusContato === "Contato bem-sucedido"
          ? form.followUpProximaAcao || undefined
          : undefined,
      followUpEncaminharSuporte:
        form.tipo === "Follow up final" &&
        form.followUpStatusContato === "Contato bem-sucedido" &&
        form.followUpProximaAcao !== "Reforço de treinamento"
          ? (form.followUpEncaminharSuporte ?? false)
          : undefined,
      ...(form.tipo === "Treinamento"
        ? {
            treinamentoDataSolicitacao: form.treinamentoDataSolicitacao,
            treinamentoTempoAgenda: form.treinamentoTempoAgenda,
            treinamentoSolicitante: form.treinamentoSolicitante,
            // Modelo antigo (nota 1-5): preservado sem alteração, ver acima.
            treinamentoNotas: validNotas.length > 0 ? validNotas : undefined,
            treinamentoNotaMedia: computedMedia,
            // Modelo atual (Bom/Ruim)
            treinamentoResultados:
              validResultados.length > 0 ? validResultados : undefined,
          }
        : {
            treinamentoDataSolicitacao: undefined,
            treinamentoTempoAgenda: undefined,
            treinamentoSolicitante: undefined,
            treinamentoNotas: undefined,
            treinamentoNotaMedia: undefined,
            treinamentoResultados: undefined,
            gamificacaoPontoId: undefined,
          }),
    };

    if (exigeClienteAtivoParaTreinamento(form, origemTreinamento)) {
      if (!empresaObjeto.id) {
        toast.error("Selecione um cliente cadastrado válido para registrar o treinamento.");
        return;
      }
      // Confere o cadastro atual antes de qualquer ponto, cálculo ou notificação.
      setSalvando(true);
      await validarClienteParaNovoTreinamento(empresaObjeto.id, empresaObjeto.nomeEmpresa);
    }
    setSalvando(true);

    if (calculoScoreResult) {
      const antigoScore = empresaObjeto.score;
      const antigoTipo = empresaObjeto.tipo;
      const novoScore = calculoScoreResult.score;
      const novoTipo = calculoScoreResult.tipo;

      // Atualiza só o score: não sobrescreve uma suspensão feita em outra sessão.
      await salvarEmpresas({
        id: empresaObjeto.id,
        score: novoScore,
        tipo: novoTipo,
        scoreAnswers: calculoScoreResult.isNeutro ? null : respostasScore,
        scoreContadoresPerda: calculoScoreResult.isNeutro
          ? undefined
          : calculoScoreResult.contadores,
        duvidasTemasAnteriores: calculoScoreResult.isNeutro
          ? empresaObjeto.duvidasTemasAnteriores
          : duvidasTemasHistorico,
        updatedAt: Date.now(),
      });

      // Gera a ocorrência se for o primeiro cálculo OU se o tipo mudou (desde que não seja marcado como Neutro).
      const isPrimeiroCalculo = typeof antigoScore !== "number";
      const tipoMudou = antigoTipo !== novoTipo;
      const deveGerarOcorrencia =
        (isPrimeiroCalculo || tipoMudou) && !calculoScoreResult.isNeutro;

      if (deveGerarOcorrencia) {
        let descMudanca: string;
        if (isPrimeiroCalculo) {
          const marcadas = descreverRespostas(respostasScore);
          const marcadasTexto =
            marcadas.length > 0
              ? "\n\nRespostas marcadas:\n" + marcadas.join("\n")
              : "";
          descMudanca = `Cálculo inicial de score: ${novoTipo || "Neutro"}

Score atual: ${novoScore !== null ? novoScore : "Neutro"}${marcadasTexto}`;
        } else {
          let mudancasTexto = "";
          if (empresaObjeto.scoreAnswers) {
            const mudancas = descreverMudancas(
              empresaObjeto.scoreAnswers,
              respostasScore,
            );
            if (mudancas.length > 0) {
              mudancasTexto =
                "\n\nAlterações detalhadas:\n" + mudancas.join("\n");
            }
          }

          descMudanca = `Mudança de score de ${antigoTipo || "Sem tipo"} para ${novoTipo || "Neutro"}

Score antigo: ${antigoScore !== null && antigoScore !== undefined ? antigoScore : "Sem score"}
Score atual: ${novoScore !== null ? novoScore : "Neutro"}${mudancasTexto}`;
        }

        await salvarOcorrencia({
          empresa: form.empresa,
          tipo: "Mudança de score",
          descricao: descMudanca,
          responsavel: responsavelFinal,
          departamento: form.departamento || "CS",
          dataOcorrencia: 0,
        });
      }
    }

    // Se a ocorrência foi desmarcada como retirarAlerta mas tinha um alertaOriginalId vinculado
    if (
      editandoId &&
      !form.retirarAlerta &&
      ocorrenciaOriginal?.alertaOriginalId
    ) {
      const origDoc = ocorrencias.find(
        (o) => o.id === ocorrenciaOriginal.alertaOriginalId,
      );
      if (origDoc) {
        await salvarOcorrencia({
          ...origDoc,
          alertaResolvidoPorId: "",
        });
      }
      base.alertaOriginalId = "";
    }

    // Se a ocorrência foi desmarcada como alerta mas tinha um alertaResolvidoPorId vinculado
    if (
      editandoId &&
      !form.alerta &&
      ocorrenciaOriginal?.alertaResolvidoPorId
    ) {
      const resDoc = ocorrencias.find(
        (o) => o.id === ocorrenciaOriginal.alertaResolvidoPorId,
      );
      if (resDoc) {
        await salvarOcorrencia({
          ...resDoc,
          alertaOriginalId: "",
        });
      }
      base.alertaResolvidoPorId = "";
    }

    let pontoId = base.gamificacaoPontoId;
    // Fluxo normal (não é conclusão de reserva CSAT): o lançamento de ponto vai na mesma
    // transação do Firestore que grava a ocorrência (ver salvarOcorrencia/aplicarLancamentoPonto),
    // para os dois nunca ficarem dessincronizados se um dos dois falhar. A conclusão de
    // reserva CSAT (reservaEditando) continua tratada à parte, pelo endpoint do servidor.
    let acaoLancamentoPonto: AcaoLancamentoPonto | undefined;

    if (form.tipo === "Treinamento" && user?.uid) {
      const isZeroPoints = (form.temaOcorrencia ?? []).some(
        (t) =>
          t.trim().toLowerCase() === "cancelado" ||
          t.trim().toLowerCase() === "ausente",
      );
      const pontosAAplicar = isZeroPoints ? 0 : 1;

      const formatarDataInput = (dataStr: string) => {
        if (!dataStr) return "";
        const [y, m, d] = dataStr.split("-");
        return `${d}/${m}/${y}`;
      };

      const dataSol = formatarDataInput(form.treinamentoDataSolicitacao || "");
      const dataReal = formatarDataInput(dataRealizacaoStr);

      let finalDescricao = `Empresa: ${form.empresa.trim()} | Tema: ${(form.temaOcorrencia ?? []).join(", ")} | Solicitado: ${dataSol} | Realizado: ${dataReal} | Tempo: ${(form.treinamentoTempoAgenda || "").trim()} | Solicitante: ${form.treinamentoSolicitante || ""}`;

      if (validNotas.length > 0) {
        finalDescricao += ` | Notas: [${validNotas.join(", ")}] (Média: ${computedMedia})`;
      }

      if (validResultados.length > 0) {
        const bons = validResultados.filter((r) => r === "Bom").length;
        const ruins = validResultados.filter((r) => r === "Ruim").length;
        finalDescricao += ` | Resultados: [${validResultados.join(", ")}] (Bons: ${bons}, Ruins: ${ruins})`;
      }

      if (novaDescricao) {
        finalDescricao += ` | Obs: ${novaDescricao}`;
      }

      let finalTreinadorId = user.uid;
      let finalTreinadorNome =
        formatarNome(userName) || user.email || "Treinador";

      if (usuariosList.length > 0 && responsavelFinal) {
        const trainerObj = usuariosList.find(
          (u) =>
            formatarNome(u.nome).toLowerCase() ===
            formatarNome(responsavelFinal).toLowerCase(),
        );
        if (trainerObj) {
          finalTreinadorId = trainerObj.uid;
          finalTreinadorNome =
            formatarNome(trainerObj.nome) || trainerObj.email || "Treinador";
        }
      }

      const lancamentoDados = {
        treinadorId: finalTreinadorId,
        treinadorNome: finalTreinadorNome,
        tipoAcao: "treinamento" as const,
        pontos: pontosAAplicar,
        descricao: finalDescricao,
        criadoPorId: user.uid,
        criadoPorNome: formatarNome(userName) || user.email || "Sistema",
        treinamentoEmpresa: form.empresa.trim(),
        treinamentoTema: (form.temaOcorrencia ?? []).join(", "),
        treinamentoDataSolicitacao: form.treinamentoDataSolicitacao || "",
        treinamentoMotivoEspera: motivoEspera,
        treinamentoDataRealizacao: dataRealizacaoStr,
        treinamentoTempoAgenda: (form.treinamentoTempoAgenda || "").trim(),
        treinamentoSolicitante: form.treinamentoSolicitante || "",
        treinamentoNotas: validNotas,
        treinamentoNotaMedia: computedMedia,
        treinamentoResultados: validResultados,
      };

      const dadosComData = {
        ...lancamentoDados,
        ...(finalCreatedAt !== undefined ? { dataLancamento: finalCreatedAt } : {}),
      };

      if (reservaEditando) {
        // Conclusão de reserva CSAT: o endpoint do servidor é quem grava a ocorrência,
        // então o lançamento de ponto não pode ir na mesma transação daqui — segue
        // sendo criado/atualizado à parte, como antes.
        if (pontoId) {
          try {
            await atualizarLancamentoPonto(pontoId, dadosComData);
          } catch (error) {
            console.error("Erro ao atualizar lançamento de ponto:", error);
            pontoId = await salvarLancamentoPonto(dadosComData);
          }
        } else {
          pontoId = await salvarLancamentoPonto(dadosComData);
        }
        base.gamificacaoPontoId = pontoId;
      } else {
        acaoLancamentoPonto = pontoId
          ? { acao: "atualizar", id: pontoId, dados: dadosComData }
          : { acao: "criar", dados: dadosComData };
      }
    } else if (ocorrenciaOriginal?.gamificacaoPontoId) {
      if (reservaEditando) {
        try {
          await removerLancamentoPonto(ocorrenciaOriginal.gamificacaoPontoId);
        } catch (error) {
          console.error("Erro ao remover lançamento de ponto anterior:", error);
        }
        base.gamificacaoPontoId = "";
      } else {
        acaoLancamentoPonto = { acao: "remover", id: ocorrenciaOriginal.gamificacaoPontoId };
      }
    }

    let savedId: string;
    try {
      if (reservaEditando) {
        savedId = (
          await requisicaoCsat(
            `reservas/${reservaEditando.id}/concluir`,
            base,
            true,
          )
        ).id;
      } else {
        const resultado = await salvarOcorrencia(
          editandoId ? { ...base, id: editandoId } : base,
          {
            empresaId: empresaObjeto.id,
            ...(editandoId ? { updatedAtEsperado: ocorrenciaOriginal?.updatedAt } : {}),
            ...(acaoLancamentoPonto ? { lancamentoPonto: acaoLancamentoPonto } : {}),
          },
        );
        savedId = resultado.id;
        if (acaoLancamentoPonto) pontoId = resultado.gamificacaoPontoId;
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar a ocorrência.",
      );
      return;
    }

    // Notificações automáticas (best-effort — erros não bloqueiam o fluxo)
    // Alerta: notifica quando a ocorrência *vira* alerta, seja ao criar ou ao editar.
    // Comparar com o estado anterior evita renotificar a cada salvamento de uma
    // ocorrência que já era alerta.
    if (form.alerta && !ocorrenciaOriginal?.alerta && !empresaInterna) {
      const empresaObjetoAlerta = empresasList.find(
        (e) => normalizar(e.nomeEmpresa) === normalizar(form.empresa),
      );
      if (empresaObjetoAlerta) {
        obterDestinatariosGestao(empresaObjetoAlerta, "alerta")
          .then(async ({ destinatarios, avisos }) => {
            if (destinatarios.length === 0) {
              // Nenhum destinatário de gestão encontrado — registra a falha na
              // ocorrência para que fique visível no Histórico, em vez de
              // deixar o envio silenciosamente sem status.
              try {
                await salvarOcorrencia({
                  id: savedId,
                  whatsappStatus: "sem_destinatario",
                  whatsappEnviadoEm: Date.now(),
                  whatsappDestinatarios: [],
                } as Ocorrencia);
                await carregar();
              } catch (error) {
                console.error(
                  "Erro ao registrar falha de notificação de gestão (sem destinatários):",
                  error,
                );
              }
              return;
            }
            setGestaoDestinatarios(destinatarios);
            setGestaoAvisos(avisos);
            setGestaoMensagem(
              montarMensagemAlertaGestao(empresaObjetoAlerta, savedId),
            );
            setGestaoOcorrenciaId(savedId);
            setGestaoOcorrenciaEvento("alerta");
            setGestaoConfirmModalOpen(true);
          })
          .catch((err) =>
            console.error(
              "[notificações] Falha ao montar destinatários de alerta:",
              err,
            ),
          );
      }
    }

    // Chamado aberto (tipo Problema): notifica apenas o CS Responsável — só na
    // criação, para não reenviar a cada edição da mesma ocorrência.
    if (
      !editandoId &&
      !empresaInterna &&
      form.tipo === "Problema" &&
      form.chamadoAberto &&
      form.chamadoDescricao?.trim() &&
      empresaObjeto
    ) {
      obterDestinatarioCSChamado(empresaObjeto)
        .then(async ({ destinatarios, avisos }) => {
          if (destinatarios.length === 0) {
            try {
              await salvarOcorrencia({
                id: savedId,
                chamadoWhatsappStatus: "sem_destinatario",
                chamadoWhatsappEnviadoEm: Date.now(),
                chamadoWhatsappDestinatarios: [],
              } as Ocorrencia);
              await carregar();
            } catch (error) {
              console.error(
                "Erro ao registrar falha de notificação de chamado (sem destinatários):",
                error,
              );
            }
            return;
          }
          setChamadoDestinatarios(destinatarios);
          setChamadoAvisos(avisos);
          setChamadoMensagem(
            montarMensagemChamadoAbertoCS(
              empresaObjeto,
              form.chamadoDescricao!.trim(),
              savedId,
              form.chamadoLink?.trim() || undefined,
            ),
          );
          setChamadoOcorrenciaId(savedId);
          setChamadoConfirmModalOpen(true);
        })
        .catch((err) =>
          console.error(
            "[notificações] Falha ao montar destinatário de chamado aberto:",
            err,
          ),
        );
    }

    // Contato com o Suporte ou com o Treinamento para tirar dúvida reduz
    // temporariamente o score do cliente (best-effort — não bloqueia o fluxo, e
    // só na criação, para não reaplicar a redução a cada edição da mesma
    // ocorrência). Isso dá mobilidade real entre Safety e Fast: um cliente que
    // volta a precisar de ajuda deixa de ficar preso no score alto de antes.
    if (
      !editandoId &&
      !empresaInterna &&
      form.tipo === "Dúvida" &&
      empresaObjeto
    ) {
      const regraPorDepartamento: Record<
        string,
        { motivo: string; valor: number; dias: number } | undefined
      > = {
        Suporte: {
          motivo: MOTIVO_REDUCAO_SCORE_SUPORTE,
          valor: VALOR_REDUCAO_SCORE_SUPORTE,
          dias: DIAS_REDUCAO_SCORE_SUPORTE,
        },
        Treinamento: {
          motivo: MOTIVO_REDUCAO_SCORE_TREINAMENTO,
          valor: VALOR_REDUCAO_SCORE_TREINAMENTO,
          dias: DIAS_REDUCAO_SCORE_TREINAMENTO,
        },
      };
      const regra = regraPorDepartamento[form.departamento];
      if (regra) {
        try {
          if (!empresaObjeto.id) throw new Error("Cliente sem identificador.");
          const quedaParaSafety = await aplicarReducaoScoreEmpresa(
            empresaObjeto.id,
            criarAjusteTemporarioScore(
              regra.motivo,
              regra.valor,
              regra.dias,
              savedId,
            ),
            `dúvida registrada com o ${form.departamento} reduziu o score em ${regra.valor} ponto por ${regra.dias} dias.`,
          );
          if (quedaParaSafety) {
            await salvarOcorrencia({
              empresa: form.empresa,
              tipo: "Mudança de score",
              descricao: quedaParaSafety,
              responsavel: responsavelFinal,
              departamento: form.departamento || "CS",
              dataOcorrencia: 0,
            });
          }
        } catch (error) {
          console.error("Erro ao aplicar redução temporária de score:", error);
          toast.warning("Ocorrência salva, mas não foi possível atualizar a redução de score. Confira o score do cliente.");
        }
      }
    }

    // Intervalo maior que 5 dias entre a última agenda (Treinamento/Informativa/
    // Checkpoint) e a penúltima também reduz temporariamente o score — só na
    // criação, comparando com a agenda mais recente já existente antes desta.
    if (
      !editandoId &&
      !empresaInterna &&
      empresaObjeto &&
      (form.tipo === "Treinamento" ||
        form.tipo === "Informativa" ||
        form.tipo === "Checkpoint")
    ) {
      const agendaAnterior = ocorrencias
        .filter(
          (o) =>
            o.id !== savedId &&
            normalizar(o.empresa) === normalizar(form.empresa) &&
            (o.tipo === "Treinamento" ||
              o.tipo === "Informativa" ||
              o.tipo === "Checkpoint"),
        )
        .sort((a, b) => b.dataOcorrencia - a.dataOcorrencia)[0];

      if (agendaAnterior) {
        const diffDias =
          (base.dataOcorrencia - agendaAnterior.dataOcorrencia) /
          (24 * 60 * 60 * 1000);
        if (diffDias > LIMITE_DIAS_GAP_AGENDA) {
          try {
            if (!empresaObjeto.id) throw new Error("Cliente sem identificador.");
            const quedaParaSafety = await aplicarReducaoScoreEmpresa(
              empresaObjeto.id,
              criarAjusteTemporarioScore(
                MOTIVO_REDUCAO_SCORE_GAP_AGENDA,
                VALOR_REDUCAO_SCORE_GAP_AGENDA,
                DIAS_REDUCAO_SCORE_GAP_AGENDA,
                savedId,
              ),
              `intervalo de ${Math.floor(diffDias)} dias entre agendas reduziu o score em ${VALOR_REDUCAO_SCORE_GAP_AGENDA} ponto por ${DIAS_REDUCAO_SCORE_GAP_AGENDA} dias.`,
            );
            if (quedaParaSafety) {
              await salvarOcorrencia({
                empresa: form.empresa,
                tipo: "Mudança de score",
                descricao: quedaParaSafety,
                responsavel: responsavelFinal,
                departamento: form.departamento || "CS",
                dataOcorrencia: 0,
              });
            }
          } catch (error) {
            console.error(
              "Erro ao aplicar redução temporária de score (gap de agenda):",
              error,
            );
            toast.warning("Ocorrência salva, mas não foi possível atualizar a redução de score pelo intervalo entre agendas. Confira o score do cliente.");
          }
        }
      }
    }

    // Cliente marcado (Master-only, no cadastro) como elegível para dedução de pontos
    // do treinador responsável quando entra em contato com o Suporte por Dúvida,
    // Problema ou Solicitação. Reavaliado também na edição (comparando com
    // `ocorrenciaOriginal`) para que corrigir o departamento/tipo depois de
    // registrar a ocorrência não deixe de aplicar — ou devolva o ponto — o
    // desconto; `jaTinhaDesconto` evita reaplicar duas vezes a mesma dedução.
    const jaTinhaDesconto = !!ocorrenciaOriginal?.gamificacaoDescontoPontoId;
    const qualificaParaDescontoSuporte =
      !empresaInterna &&
      !!empresaObjeto?.gamificacaoDeducaoSuporte?.ativo &&
      !!empresaObjeto.responsavel &&
      form.departamento === "Suporte" &&
      (form.tipo === "Dúvida" ||
        form.tipo === "Problema" ||
        form.tipo === "Solicitação");

    if (editandoId && jaTinhaDesconto && !qualificaParaDescontoSuporte) {
      // Deixou de qualificar (ex.: corrigiram o departamento/tipo): devolve o ponto.
      try {
        await removerLancamentoPonto(ocorrenciaOriginal!.gamificacaoDescontoPontoId!);
        await salvarOcorrencia({
          id: savedId,
          gamificacaoDescontoPontoId: "",
        } as Ocorrencia);
      } catch (error) {
        console.error(
          "Erro ao reverter desconto de gamificação por contato com Suporte:",
          error,
        );
      }
    }

    if (qualificaParaDescontoSuporte && !jaTinhaDesconto) {
      const chavePorTipo = {
        Dúvida: "duvida",
        Problema: "problema",
        Solicitação: "solicitacao",
      } as const;
      const chave =
        chavePorTipo[form.tipo as "Dúvida" | "Problema" | "Solicitação"];
      const config = empresaObjeto!.gamificacaoDeducaoSuporte![chave];
      // Data da ocorrência é opcional para Dúvida/Problema/Solicitação e fica
      // 0 quando não preenchida — nesse caso o contato aconteceu agora, então
      // usamos o momento atual para não cair em 01/01/1970 (sempre "fora do
      // expediente") e aplicar o valor de desconto errado.
      const timestampContato = base.dataOcorrencia || Date.now();
      const dentroDoExpediente = estaDentroDoExpediente(timestampContato);
      const pontosPerdidos = dentroDoExpediente
        ? config?.dentroExpediente
        : config?.foraExpediente;

      // A empresa deveria guardar só o primeiro nome do responsável (ver
      // Gamificacao.tsx), mas o cadastro em Home.tsx às vezes salva o nome
      // completo selecionado no seletor — por isso comparamos pelo primeiro
      // nome dos dois lados, não pelo nome completo do treinador nem pelo
      // valor bruto salvo na empresa.
      const treinadorObj = usuariosList.find((u) => {
        const primeiroNomeTreinador = formatarNome(u.nome).split(" ")[0] || "";
        const primeiroNomeResponsavel =
          (empresaObjeto.responsavel || "").trim().split(/\s+/)[0] || "";
        return (
          normalizar(primeiroNomeTreinador) ===
          normalizar(primeiroNomeResponsavel)
        );
      });

      if (pontosPerdidos && treinadorObj) {
        try {
          const descontoPontoId = await salvarLancamentoPonto({
            treinadorId: treinadorObj.uid,
            treinadorNome:
              formatarNome(treinadorObj.nome) || treinadorObj.email,
            tipoAcao: "desconto_suporte",
            pontos: -Math.abs(pontosPerdidos),
            descricao: `Contato de ${form.empresa.trim()} com o Suporte (${form.tipo}, ${dentroDoExpediente ? "dentro" : "fora"} do expediente)`,
            dataLancamento: timestampContato,
            criadoPorId: user?.uid || "",
            criadoPorNome: formatarNome(userName) || user?.email || "Sistema",
            ocorrenciaId: savedId,
          });
          // Vincula o lançamento à ocorrência para poder devolver o ponto ao
          // treinador se a ocorrência for excluída (ver função `excluir`).
          await salvarOcorrencia({
            id: savedId,
            gamificacaoDescontoPontoId: descontoPontoId,
          } as Ocorrencia);
        } catch (error) {
          console.error(
            "Erro ao aplicar desconto de gamificação por contato com Suporte:",
            error,
          );
        }
      }
    }

    if (form.retornarEsteira) {
      try {
        // Ao retornar da esteira Suspensos, soma o tempo congelado ao acumulado
        // para que os dias suspensos não voltem a contar em calcularDiasNaEsteira.
        // Mesma contagem da coluna "Dias suspenso" da Home: a partir da
        // ocorrência de suspensão, ou da dataSuspensao quando não há ocorrência.
        // A ocorrência de retorno que está sendo salva fica de fora, senão ela
        // anularia a suspensão que está encerrando.
        const nomeEmpresa = empresaObjeto.nomeEmpresa.trim().toLowerCase();
        const diasSuspensoAcumulado =
          (empresaObjeto.diasSuspensoAcumulado || 0) +
          calcularDiasSuspensaoAtual(
            empresaObjeto,
            ocorrencias.filter(
              (o) =>
                o.id !== savedId &&
                o.empresa.trim().toLowerCase() === nomeEmpresa,
            ),
          );

        // Grava só os campos alterados: `empresaObjeto` é o retrato do início do
        // salvar() e espalhá-lo desfaria score/reduções gravados mais acima.
        await salvarEmpresas({
          id: empresaObjeto.id,
          ...(!!form.alerta !== !!empresaObjeto.alerta || form.retirarAlerta
            ? { alerta: !!form.alerta }
            : {}),
          isSuspended: false,
          dataSuspensao: undefined,
          diasSuspensoAcumulado,
        });
      } catch (error) {
        console.error("Erro ao remover suspensão da empresa:", error);
      }
    } else if (form.suspenderCliente && !empresaObjeto.isSuspended) {
      try {
        const hoje = new Date();
        const dataSuspensao = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;

        const alteracoesSuspensao: Partial<Empresa> = {
          ...(!!form.alerta !== !!empresaObjeto.alerta || form.retirarAlerta
            ? { alerta: !!form.alerta }
            : {}),
          isSuspended: true,
          dataSuspensao,
        };
        const empresaSuspensa: Empresa = {
          ...empresaObjeto,
          ...alteracoesSuspensao,
        };

        await salvarEmpresas({ id: empresaObjeto.id, ...alteracoesSuspensao });

        // Notifica Supervisor + CS Responsável sobre a suspensão originada pela ocorrência
        obterDestinatariosGestao(empresaSuspensa, "suspenso")
          .then(async ({ destinatarios, avisos }) => {
            if (destinatarios.length === 0) {
              // Nenhum destinatário de gestão encontrado — registra a falha na
              // ocorrência para que fique visível no Histórico, em vez de
              // deixar o envio silenciosamente sem status.
              try {
                await salvarOcorrencia({
                  id: savedId,
                  whatsappStatus: "sem_destinatario",
                  whatsappEnviadoEm: Date.now(),
                  whatsappDestinatarios: [],
                } as Ocorrencia);
                await carregar();
              } catch (error) {
                console.error(
                  "Erro ao registrar falha de notificação de gestão (sem destinatários):",
                  error,
                );
              }
              return;
            }
            setGestaoDestinatarios(destinatarios);
            setGestaoAvisos(avisos);
            setGestaoMensagem(
              montarMensagemSuspensaoGestao(empresaSuspensa, savedId),
            );
            setGestaoOcorrenciaId(savedId);
            setGestaoOcorrenciaEvento("suspenso");
            setGestaoConfirmModalOpen(true);
          })
          .catch((err) =>
            console.error(
              "[notificações] Falha ao montar destinatários de suspensão:",
              err,
            ),
          );
      } catch (error) {
        console.error(
          "Erro ao suspender empresa a partir da ocorrência:",
          error,
        );
      }
    } else if (!!form.alerta !== !!empresaObjeto.alerta || form.retirarAlerta) {
      try {
        await salvarEmpresas({
          id: empresaObjeto.id,
          alerta: !!form.alerta,
        });
      } catch (error) {
        console.error(
          "Erro ao sincronizar status de alerta na empresa:",
          error,
        );
      }
    }

    // Follow up final com "Encaminhar pro suporte": preenche dataFollowUpFinal com
    // a data deste registro, concluindo o acompanhamento (ver clienteConcluido() na
    // Home). Não sobrescreve se o campo já estiver preenchido (idempotente ao reeditar).
    if (
      form.tipo === "Follow up final" &&
      base.followUpEncaminharSuporte &&
      empresaObjeto.id &&
      !empresaObjeto.dataFollowUpFinal
    ) {
      try {
        const hoje = new Date();
        const dataFollowUpFinal = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
        await salvarEmpresas({ id: empresaObjeto.id, dataFollowUpFinal });
      } catch (error) {
        console.error(
          "Erro ao preencher a data de follow up final da empresa:",
          error,
        );
      }
    }

    // Retorno à esteira e retirada do alerta: avisa a gestão que o cliente saiu da
    // suspensão/do alerta. Só dispara quando a ocorrência *passa* a marcar a ação e o
    // cliente de fato estava suspenso/em alerta — reeditar a mesma ocorrência, ou marcar
    // a ação num cliente que já não estava nessa situação, não renotifica. Quando as duas
    // coisas acontecem na mesma ocorrência, vai uma única mensagem.
    const retornouEsteira =
      !!form.retornarEsteira &&
      !ocorrenciaOriginal?.retornarEsteira &&
      !!empresaObjeto.isSuspended;
    const alertaRetirado =
      !!form.retirarAlerta &&
      !ocorrenciaOriginal?.retirarAlerta &&
      !!empresaObjeto.alerta;
    if ((retornouEsteira || alertaRetirado) && !empresaInterna) {
      const evento: EventoNotificacaoGestao = retornouEsteira
        ? "retorno"
        : "alerta_retirado";
      obterDestinatariosGestao(empresaObjeto, evento)
        .then(async ({ destinatarios, avisos }) => {
          if (destinatarios.length === 0) {
            try {
              await salvarOcorrencia({
                id: savedId,
                whatsappStatus: "sem_destinatario",
                whatsappEnviadoEm: Date.now(),
                whatsappDestinatarios: [],
              } as Ocorrencia);
              await carregar();
            } catch (error) {
              console.error(
                "Erro ao registrar falha de notificação de gestão (sem destinatários):",
                error,
              );
            }
            return;
          }
          setGestaoDestinatarios(destinatarios);
          setGestaoAvisos(avisos);
          setGestaoMensagem(
            retornouEsteira
              ? montarMensagemRetornoEsteiraGestao(
                  empresaObjeto,
                  savedId,
                  alertaRetirado,
                )
              : montarMensagemAlertaRetiradoGestao(empresaObjeto, savedId),
          );
          setGestaoOcorrenciaId(savedId);
          setGestaoOcorrenciaEvento(evento);
          setGestaoConfirmModalOpen(true);
        })
        .catch((err) =>
          console.error(
            "[notificações] Falha ao montar destinatários de retorno/retirada de alerta:",
            err,
          ),
        );
    }

    if (pontoId) {
      try {
        await atualizarLancamentoPonto(pontoId, {
          ocorrenciaId: savedId,
          isAlerta: form.alerta || false,
        });
      } catch (error) {
        console.error(
          "Erro ao vincular ocorrência ao ponto de gamificação:",
          error,
        );
      }
    }

    // Vincula a ocorrência de resolução ao último alerta ativo da empresa (funciona para novo ou edição se ainda não vinculado)
    if (form.retirarAlerta && !base.alertaOriginalId) {
      const alertaOriginal = ocorrencias
        .filter(
          (o) =>
            normalizar(o.empresa) === normalizar(form.empresa) &&
            o.alerta === true &&
            !o.alertaResolvidoPorId &&
            o.id !== savedId,
        )
        .sort(
          (a, b) =>
            (b.dataOcorrencia || b.createdAt || 0) -
            (a.dataOcorrencia || a.createdAt || 0),
        )[0];

      if (alertaOriginal) {
        // Atualiza a ocorrência de alerta original para apontar para esta resolução
        await salvarOcorrencia({
          ...alertaOriginal,
          alertaResolvidoPorId: savedId,
        });

        // Atualiza esta ocorrência de resolução para apontar para o alerta original
        const resolutionOcorrencia = {
          ...base,
          id: savedId,
          alertaOriginalId: alertaOriginal.id,
        };
        await salvarOcorrencia(resolutionOcorrencia);
      }
    }

    // Avança a esteira apenas pelos temas novos, excluindo os revisados.
    if (
      form.tipo === "Treinamento" &&
      treinamento.temasNovos.length > 0 &&
      !isSelectedEmpresaOngoing &&
      !temaForaEsteira &&
      !empresaInterna &&
      empresaObjeto
    ) {
      const temasValidos = treinamento.temasNovos;

      if (temasValidos.length > 0) {
        const normTema = (s: string) =>
          s
            .trim()
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");

        const linhasTema = (empresaObjeto.temaText || "")
          .split("\n")
          .map((l) => l.trim());
        const linhasData = (empresaObjeto.dataText || "")
          .split("\n")
          .map((l) => l.trim());

        // Garante que dataText tem o mesmo número de linhas que temaText
        while (linhasData.length < linhasTema.length) linhasData.push("");

        // Formata data da ocorrência como dd/mm
        let dataStr = "";
        if (dataRealizacaoStr) {
          const [, m, d] = dataRealizacaoStr.split("-");
          dataStr = `${d}/${m}`;
        } else {
          const now = new Date();
          const d = String(now.getDate()).padStart(2, "0");
          const m = String(now.getMonth() + 1).padStart(2, "0");
          dataStr = `${d}/${m}`;
        }

        const temasValidosNorm = temasValidos.map(normTema);

        // Encontra os índices originais dos temas ensinados (em ordem crescente)
        const indicesEnsinados: number[] = [];
        linhasTema.forEach((tema, idx) => {
          if (temasValidosNorm.includes(normTema(tema))) {
            indicesEnsinados.push(idx);
          }
        });

        if (indicesEnsinados.length > 0) {
          const { newTemas, newDatas, ultimoIndice } = reordenarTemasEnsinados(
            linhasTema,
            linhasData,
            indicesEnsinados,
            dataStr,
          );
          const novoTemaText = newTemas.join("\n");
          const novoDataText = newDatas.join("\n");

          // Conclusão da esteira: último tema atingido pela primeira vez através desta
          // ocorrência. Cliente Ongoing não tem esteira a concluir, então não notifica
          // (mesma regra da conclusão manual em Esteira.tsx).
          const concluiuAgora =
            newTemas.length > 0 &&
            ultimoIndice === newTemas.length - 1 &&
            !empresaObjeto.dataFinalizacao &&
            !empresaObjeto.isOngoing;

          // Grava só os campos da esteira. `empresaObjeto` é o retrato do início do
          // salvar(): espalhá-lo aqui desfaria o que foi gravado mais acima neste
          // mesmo salvar() — suspensão, alerta, score e reduções temporárias.
          const alteracoesEsteira: Partial<Empresa> = {
            temaText: novoTemaText,
            dataText: novoDataText,
            currentPhase: Math.max(
              empresaObjeto.currentPhase ?? 0,
              ultimoIndice,
            ),
            ...(concluiuAgora ? { dataFinalizacao: dataRealizacaoStr } : {}),
          };
          const empresaAtualizadaEsteira: Empresa = {
            ...empresaObjeto,
            ...alteracoesEsteira,
          };

          await salvarEmpresas({ id: empresaObjeto.id, ...alteracoesEsteira });

          if (concluiuAgora) {
            obterDestinatariosGestao(empresaAtualizadaEsteira, "conclusao")
              .then(async ({ destinatarios, avisos }) => {
                if (destinatarios.length === 0) {
                  // Nenhum destinatário de gestão encontrado — registra a falha na
                  // ocorrência para que fique visível no Histórico, em vez de
                  // deixar o envio silenciosamente sem status.
                  try {
                    await salvarOcorrencia({
                      id: savedId,
                      whatsappStatus: "sem_destinatario",
                      whatsappEnviadoEm: Date.now(),
                      whatsappDestinatarios: [],
                    } as Ocorrencia);
                    await carregar();
                  } catch (error) {
                    console.error(
                      "Erro ao registrar falha de notificação de gestão (sem destinatários):",
                      error,
                    );
                  }
                }
                setGestaoConclusaoEmpresaId(empresaAtualizadaEsteira.id);
                setGestaoDestinatarios(destinatarios);
                setGestaoAvisos(avisos);
                setGestaoMensagem(
                  montarMensagemConclusaoEsteiraGestao(
                    empresaAtualizadaEsteira,
                    savedId,
                  ),
                );
                setGestaoOcorrenciaId(savedId);
                setGestaoOcorrenciaEvento("conclusao");
                setGestaoConfirmModalOpen(true);
              })
              .catch((err) => {
                console.error(
                  "[notificações] Falha ao montar destinatários de conclusão:",
                  err,
                );
                toast.error(
                  "Não foi possível preparar o aviso de conclusão. Reenvie pelos detalhes do cliente.",
                );
              });
          }
        }
      }
    }

    // Fluxo de Disparo do WhatsApp — só oferece o envio ao criar a ocorrência.
    // Em edições (ex.: apenas corrigir data/hora), não repete a oferta para não
    // sobrescrever o status de envio já registrado na criação original.
    // Registrar uma ocorrência reservada para CSAT conta como criação: o
    // registro ainda não teve essa oferta, mesmo abrindo em modo de edição.
    // A notificação inclui todos os temas realizados; apenas os novos avançam
    // a esteira. Usa a mesma regra do botão de envio nos detalhes da ocorrência.
    const temasValidos = treinamento.temaOcorrencia.filter(isTemaTreinamento);

    if ((!editandoId || reservaEditando) && podeNotificarTreinamento(base)) {
      const destinatarios = obterDestinatariosCliente(empresaObjeto);

      if (destinatarios.length === 0) {
        toast.warning(
          "Ocorrência registrada! No entanto, o cliente não possui telefone de contato cadastrado para envio do WhatsApp.",
        );
        try {
          await salvarOcorrencia({
            id: savedId,
            whatsappStatus: "sem_destinatario",
            whatsappEnviadoEm: Date.now(),
            whatsappDestinatarios: [],
          } as Ocorrencia);
        } catch (error) {
          console.error(
            "Erro ao registrar falha de envio do WhatsApp (sem telefone):",
            error,
          );
        }
        await carregar();
        setSalvando(false);
        cancelar({ skipConfirmacao: true });
        toast.success(
          editandoId && !reservaEditando
            ? "Ocorrência atualizada!"
            : "Ocorrência registrada!",
        );
      } else {
        // Encontra o novo temaText e dataText (que foram atualizados logo acima)
        let novoTemaText = empresaObjeto.temaText;
        let novoDataText = empresaObjeto.dataText;
        let ultimoIndice = empresaObjeto.currentPhase ?? 0;

        const normTema = (s: string) =>
          s
            .trim()
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
        const linhasTema = (empresaObjeto.temaText || "")
          .split("\n")
          .map((l) => l.trim());
        const linhasData = (empresaObjeto.dataText || "")
          .split("\n")
          .map((l) => l.trim());
        while (linhasData.length < linhasTema.length) linhasData.push("");

        let dataStr = "";
        if (dataRealizacaoStr) {
          const [, m, d] = dataRealizacaoStr.split("-");
          dataStr = `${d}/${m}`;
        } else {
          const now = new Date();
          const d = String(now.getDate()).padStart(2, "0");
          const m = String(now.getMonth() + 1).padStart(2, "0");
          dataStr = `${d}/${m}`;
        }

        const temasValidosNorm = treinamento.temasNovos.map(normTema);
        const indicesEnsinados: number[] = [];
        linhasTema.forEach((tema, idx) => {
          if (temasValidosNorm.includes(normTema(tema))) {
            indicesEnsinados.push(idx);
          }
        });

        if (indicesEnsinados.length > 0 && !temaForaEsteira) {
          const reordenado = reordenarTemasEnsinados(
            linhasTema,
            linhasData,
            indicesEnsinados,
            dataStr,
          );
          ultimoIndice = reordenado.ultimoIndice;
          novoTemaText = reordenado.newTemas.join("\n");
          novoDataText = reordenado.newDatas.join("\n");
        }

        const empresaAtualizada: Empresa = {
          ...empresaObjeto,
          ...(calculoScoreResult
            ? {
                score: calculoScoreResult.score,
                tipo: calculoScoreResult.tipo,
                scoreAnswers: calculoScoreResult.isNeutro
                  ? null
                  : respostasScore,
                scoreContadoresPerda: calculoScoreResult.isNeutro
                  ? undefined
                  : calculoScoreResult.contadores,
                duvidasTemasAnteriores: calculoScoreResult.isNeutro
                  ? empresaObjeto.duvidasTemasAnteriores
                  : duvidasTemasHistorico,
              }
            : {}),
          temaText: novoTemaText,
          dataText: novoDataText,
          currentPhase: Math.max(empresaObjeto.currentPhase ?? 0, ultimoIndice),
          updatedAt: Date.now(),
        };

        const [year, month, day] = dataRealizacaoStr.split("-");
        const dataCompleta = `${day}/${month}/${year}`;
        const temasParaMensagem = temasValidos.filter(
          (t) => normTema(t) !== "inicio" && normTema(t) !== "conclusao",
        );
        const plural = temasParaMensagem.length > 1;
        // O marcador {nome} é trocado pelo nome de cada contato no envio, de forma
        // que cada destinatário receba a saudação com o próprio nome.
        const textoMensagem = `Olá, *${PLACEHOLDER_NOME}*! 🚀\nSeu treinamento sobre ${plural ? "os temas" : "o tema"} *${temasParaMensagem.join(", ")}* foi registrado com sucesso em *${dataCompleta}*.\n\nConfira acima a sua esteira de evolução atualizada:`;

        setPendingWhatsAppMessage({
          ocorrenciaId: savedId,
          destinatarios,
          telefonesSelecionados: destinatarios.map((d) => d.telefone),
          empresaNome: empresaObjeto.nomeEmpresa,
          temas: temasValidos,
          dataStr: dataCompleta,
          empresaObjeto: empresaAtualizada,
        });
        setEditedWhatsAppText(textoMensagem);
        setSendConveyorImage(true);
        setWhatsappConfirmModalOpen(true);
        setSalvando(false);
      }
    } else {
      await carregar();
      setSalvando(false);
      cancelar({ skipConfirmacao: true });
      toast.success(
        editandoId && !reservaEditando
          ? "Ocorrência atualizada!"
          : "Ocorrência registrada!",
      );
    }
  }

  async function excluir(id: string) {
    toast("Deseja excluir esta ocorrência?", {
      action: {
        label: "Excluir",
        onClick: async () => {
          const oc = ocorrencias.find((o) => o.id === id);
          if (oc) {
            const ehMudancaScore = oc.tipo === "Mudança de score";
            const temScore = oc.scoreCalculado !== undefined;

            const empresaObjeto = empresasList.find(
              (e) => normalizar(e.nomeEmpresa) === normalizar(oc.empresa),
            );

            if ((ehMudancaScore || temScore) && empresaObjeto) {
              await salvarEmpresas({
                ...empresaObjeto,
                score: null as any,
                scoreAnswers: null as any,
                tipo: "",
                updatedAt: Date.now(),
              });
            }

            // Redução temporária de score vinculada a esta ocorrência (contato
            // com Suporte/Treinamento): excluir a ocorrência também retira a redução.
            if (
              empresaObjeto?.scoreAjustesTemporarios?.some(
                (a) => a.ocorrenciaId === id,
              )
            ) {
              try {
                await salvarEmpresas({
                  id: empresaObjeto.id,
                  scoreAjustesTemporarios:
                    empresaObjeto.scoreAjustesTemporarios.filter(
                      (a) => a.ocorrenciaId !== id,
                    ),
                });
              } catch (error) {
                console.error(
                  "Erro ao remover redução de score associada:",
                  error,
                );
              }
            }

            // Se for um alerta com resolução vinculada, limpa a referência na resolução
            if (oc.alerta && oc.alertaResolvidoPorId) {
              const resDoc = ocorrencias.find(
                (o) => o.id === oc.alertaResolvidoPorId,
              );
              if (resDoc) {
                await salvarOcorrencia({
                  ...resDoc,
                  alertaOriginalId: "",
                });
              }
            }

            // Se for uma resolução de alerta, limpa a referência no alerta original
            if (oc.retirarAlerta && oc.alertaOriginalId) {
              const origDoc = ocorrencias.find(
                (o) => o.id === oc.alertaOriginalId,
              );
              if (origDoc) {
                await salvarOcorrencia({
                  ...origDoc,
                  alertaResolvidoPorId: "",
                });
              }
            }

            if (oc.tipo === "Treinamento" && oc.gamificacaoPontoId) {
              try {
                await removerLancamentoPonto(oc.gamificacaoPontoId);
              } catch (error) {
                console.error(
                  "Erro ao remover ponto da gamificação associado:",
                  error,
                );
              }
            }

            // Desconto de pontos por contato com o Suporte: excluir a
            // ocorrência devolve o ponto ao treinador removendo o lançamento.
            if (oc.gamificacaoDescontoPontoId) {
              try {
                await removerLancamentoPonto(oc.gamificacaoDescontoPontoId);
              } catch (error) {
                console.error(
                  "Erro ao remover desconto de gamificação associado:",
                  error,
                );
              }
            }
          }
          await removerOcorrencia(id);
          await carregar();
          toast.success("Ocorrência removida.");
        },
      },
      cancel: { label: "Cancelar", onClick: () => {} },
      duration: 10000,
    });
  }

  async function removerReducaoAtiva(
    empresa: Empresa,
    ajuste: NonNullable<Empresa["scoreAjustesTemporarios"]>[number],
  ) {
    if (role !== "master") return;
    toast(
      "Remover apenas esta redução de score? A ocorrência não será excluída.",
      {
        action: {
          label: "Remover",
          onClick: async () => {
            try {
              await salvarEmpresas({
                id: empresa.id,
                scoreAjustesTemporarios: (
                  empresa.scoreAjustesTemporarios || []
                ).filter((a) => a.criadoEm !== ajuste.criadoEm),
              });
              await carregar();
              toast.success("Redução de score removida.");
            } catch (error) {
              console.error("Erro ao remover redução de score:", error);
              toast.error("Erro ao remover redução de score.");
            }
          },
        },
        cancel: { label: "Cancelar", onClick: () => {} },
        duration: 10000,
      },
    );
  }

  const getAllowedTypes = () => {
    const permitidos = tabulacoesTipos
      .filter((tema) => temaDisponivelParaPerfil(tema, role))
      .map((tema) => tema.nome);
    return editandoImportadaSsx
      ? permitidos.filter((tipo) =>
          ["Problema", "Dúvida", "Solicitação"].includes(tipo),
        )
      : permitidos;
  };

  const getAllowedDepartments = () => {
    if (editandoImportadaSsx) return ["Suporte"];
    if (role === "master") {
      return DEPARTAMENTO;
    }
    if (role === "treinador") {
      return ["Treinamento"];
    }
    if (role === "cs") {
      return ["CS"];
    }
    if (role === "suporte") {
      return ["Suporte"];
    }
    if (role === "hardware") {
      return ["Hardware"];
    }
    if (role === "comercial") {
      return ["Comercial"];
    }
    return DEPARTAMENTO;
  };

  const obterFiltradas = (ignoreTipo = false, ignoreDepto = false, ignoreAssuntoDuvida = false) => {
    return ocorrencias.filter((o) => {
      const texto = busca.toLowerCase();

      const textoSemEspacos = texto.trim();
      const matchesText =
        normalizar(o.empresa).includes(normalizar(texto)) ||
        o.tipo.toLowerCase().includes(texto) ||
        o.descricao.toLowerCase().includes(texto) ||
        o.responsavel.toLowerCase().includes(texto);

      let matchesId = false;
      if (o.idSeqFormatted) {
        const idLower = o.idSeqFormatted.toLowerCase();
        if (
          idLower === textoSemEspacos ||
          idLower.replace("#", "") === textoSemEspacos
        ) {
          matchesId = true;
        }
        if (textoSemEspacos.startsWith("#")) {
          const queryNum = textoSemEspacos.replace("#", "");
          const cleanId = idLower.replace("#", "");
          if (cleanId.length > 2) {
            const companyPrefix = cleanId.substring(0, cleanId.length - 2);
            if (companyPrefix === queryNum) {
              matchesId = true;
            }
          }
        }
      }

      const isIdQuery =
        textoSemEspacos.startsWith("#") &&
        /^\d+$/.test(textoSemEspacos.substring(1));
      const bateBusca = isIdQuery ? matchesId : matchesText || matchesId;

      const empresaOk =
        !empresaFiltro || normalizar(o.empresa) === normalizar(empresaFiltro);

      let tipoOk = ignoreTipo || !filtroTipo;

      if (!tipoOk) {
        if (filtroTipo === FILTRO_SEM_CLASSIFICACAO) {
          tipoOk = !o.tipo;
        } else if (filtroTipo === FILTRO_ALERTAS) {
          tipoOk = !!o.alerta;
        } else if (filtroTipo === FILTRO_SUSPENSOES) {
          tipoOk = !!o.suspenderCliente;
        } else if (filtroTipo === FILTRO_TREINAMENTO_CAN) {
          tipoOk =
            o.tipo === "Treinamento" &&
            (o.temaOcorrencia || []).some(
              (t) => t.trim().toLowerCase() === "cancelado",
            );
        } else if (filtroTipo === FILTRO_TREINAMENTO_AUS) {
          tipoOk =
            o.tipo === "Treinamento" &&
            (o.temaOcorrencia || []).some(
              (t) => t.trim().toLowerCase() === "ausente",
            );
        } else if (filtroTipo === FILTRO_TREINAMENTO_REA) {
          tipoOk =
            o.tipo === "Treinamento" &&
            !(o.temaOcorrencia || []).some(
              (t) =>
                t.trim().toLowerCase() === "cancelado" ||
                t.trim().toLowerCase() === "ausente",
            );
        } else {
          tipoOk = o.tipo === filtroTipo; // Funciona para pesquisa geral de "Treinamento" e outros tipos
        }
      }

      const deptoOk =
        ignoreDepto || !filtroDepto || o.departamento === filtroDepto;
      const assuntoDuvidaOk =
        ignoreAssuntoDuvida ||
        !filtroAssuntoDuvida ||
        (o.tipo === "Dúvida" && (o.temaOcorrencia ?? []).includes(filtroAssuntoDuvida));

      const timestamp = getOcorrenciaTimestamp(o);
      let dataOk = true;

      if (dataInicio && timestamp > 0) {
        const [y, m, d] = dataInicio.split("-").map(Number);
        const startOfDay = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
        dataOk = dataOk && timestamp >= startOfDay;
      } else if (dataInicio) {
        dataOk = false;
      }

      if (dataFim && timestamp > 0) {
        const [y, m, d] = dataFim.split("-").map(Number);
        const endOfDay = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
        dataOk = dataOk && timestamp <= endOfDay;
      } else if (dataFim) {
        dataOk = false;
      }

      let expedienteOk = true;
      if (expedienteFiltro && timestamp > 0) {
        const dateObj = new Date(timestamp);
        const hour = dateObj.getHours();
        const day = dateObj.getDay();
        const isWeekend = day === 0 || day === 6;
        const isFora = isWeekend || hour >= 18 || hour < 9;
        if (expedienteFiltro === "dentro") {
          expedienteOk = !isFora;
        } else if (expedienteFiltro === "fora") {
          expedienteOk = isFora;
        }
      }

      return (
        bateBusca &&
        empresaOk &&
        tipoOk &&
        assuntoDuvidaOk &&
        deptoOk &&
        dataOk &&
        expedienteOk &&
        (!filtroFavoritas || o.favorita === true)
      );
    });
  };

  const filtradas = useMemo(() => {
    return obterFiltradas(false, false).sort((a, b) => {
      const tA = getOcorrenciaTimestamp(a);
      const tB = getOcorrenciaTimestamp(b);
      return ordenacaoData === "desc" ? tB - tA : tA - tB;
    });
  }, [
    ocorrencias,
    busca,
    filtroTipo,
    filtroAssuntoDuvida,
    filtroDepto,
    dataInicio,
    dataFim,
    empresaFiltro,
    expedienteFiltro,
    filtroFavoritas,
    ordenacaoData,
  ]);

  const filtradasSemTipo = useMemo(
    () => obterFiltradas(true, false),
    [
      ocorrencias,
      busca,
      filtroAssuntoDuvida,
      filtroDepto,
      dataInicio,
      dataFim,
      empresaFiltro,
      expedienteFiltro,
      filtroFavoritas,
    ],
  );
  const filtradasSemDepto = useMemo(
    () => obterFiltradas(false, true),
    [
      ocorrencias,
      busca,
      filtroTipo,
      filtroAssuntoDuvida,
      dataInicio,
      dataFim,
      empresaFiltro,
      expedienteFiltro,
      filtroFavoritas,
    ],
  );

  // O gráfico de assuntos permite trocar de assunto sem restringir as colunas
  // às ocorrências que também continham o assunto anteriormente selecionado.
  const filtradasSemAssuntoDuvida = useMemo(
    () => obterFiltradas(true, false, true),
    [ocorrencias, busca, filtroDepto, dataInicio, dataFim, empresaFiltro, expedienteFiltro, filtroFavoritas],
  );

  const selectedEmpresaObj = empresasList.find(
    (e) => normalizar(e.nomeEmpresa) === normalizar(form.empresa),
  );
  const isSelectedEmpresaOngoing = selectedEmpresaObj?.isOngoing ?? false;
  const treinamentoIndisponivel = bloquearTreinamentoSuspenso(
    selectedEmpresaObj,
    { tipo: "Treinamento", empresa: form.empresa },
    editandoId && !reservaEditando ? ocorrencias.find((o) => o.id === editandoId) : null,
  );

  const tipoChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    tipos.forEach((t) => {
      counts[t] = 0;
    });

    filtradasSemTipo.forEach((o) => {
      if (counts[o.tipo] !== undefined) {
        counts[o.tipo]++;
      } else {
        counts[o.tipo] = (counts[o.tipo] || 0) + 1;
      }
    });

    return Object.entries(counts).map(([label, value]) => ({
      label: label || "Sem classificação",
      value,
      color: TIPO_CORES[label] || "#6b7280",
    }));
  }, [filtradasSemTipo, tipos]);

  const deptoChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    DEPARTAMENTO.forEach((d) => {
      counts[d] = 0;
    });

    filtradasSemDepto.forEach((o) => {
      if (counts[o.departamento] !== undefined) {
        counts[o.departamento]++;
      } else {
        counts[o.departamento] = (counts[o.departamento] || 0) + 1;
      }
    });

    return Object.entries(counts).map(([label, value]) => ({
      label,
      value,
      color: DEPARTAMENTO_CORES[label] || "#94a3b8",
    }));
  }, [filtradasSemDepto]);

  const duvidaTemasChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    duvidaOpcoes.forEach((op) => {
      counts[op] = 0;
    });

    filtradasSemAssuntoDuvida
      .filter((o) => o.tipo === "Dúvida")
      .forEach((o) => {
        (o.temaOcorrencia ?? []).forEach((tema) => {
          if (counts[tema] !== undefined) {
            counts[tema]++;
          }
        });
      });

    return Object.entries(counts)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtradasSemAssuntoDuvida, duvidaOpcoes]);

  const topClientesDuvidasChartData = useMemo(() => {
    const counts: Record<string, number> = {};

    filtradasSemTipo
      .filter((o) => o.tipo === "Dúvida")
      .forEach((o) => {
        const nome = (o.empresa || "").trim();
        if (!nome) return;
        counts[nome] = (counts[nome] || 0) + 1;
      });

    return Object.entries(counts)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [filtradasSemTipo]);

  function linkOcorrenciasDuvidas(filtro: { empresa?: string; assunto?: string }) {
    const params = new URLSearchParams();
    params.set("tipo", "Dúvida");
    const empresa = filtro.empresa ?? empresaFiltro;
    const assunto = filtro.assunto ?? filtroAssuntoDuvida;
    if (empresa) params.set("empresa", empresa);
    if (assunto) params.set("assuntoDuvida", assunto);
    if (busca) params.set("busca", busca);
    if (filtroDepto) params.set("depto", filtroDepto);
    if (dataInicio) params.set("dataInicio", dataInicio);
    if (dataFim) params.set("dataFim", dataFim);
    if (expedienteFiltro) params.set("expediente", expedienteFiltro);
    if (filtroFavoritas) params.set("favoritas", "1");
    return `/historico?${params.toString()}`;
  }

  function mostrarOcorrenciasDuvidas() {
    setDashboardAberto(false);
    setCurrentPage(1);
    listaOcorrenciasRef.current?.focus({ preventScroll: true });
    listaOcorrenciasRef.current?.scrollIntoView({ block: "start" });
  }

  function alterarFiltroTipo(tipo: string) {
    setFiltroTipo(tipo);
    if (tipo !== "Dúvida") setFiltroAssuntoDuvida("");
  }

  const totalItems = filtradas.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE) || 1;
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, totalItems);
  const filtradasExibidas = filtradas.slice(startIndex, endIndex);

  function exportarParaExcel() {
    if (filtradas.length === 0) {
      toast.error("Não há ocorrências para exportar.");
      return;
    }

    const idCentralPorEmpresa = new Map(
      empresasList.map((e) => [normalizar(e.nomeEmpresa), e.idCentral ?? ""]),
    );

    const linhas = filtradas.map((o) => {
      const timestamp = getOcorrenciaTimestamp(o);
      const data = timestamp ? new Date(timestamp) : null;
      return {
        Cliente: o.empresa,
        Data: data ? data.toLocaleDateString("pt-BR") : "",
        Hora: data
          ? data.toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "",
        Departamento: o.departamento,
        "Tipo de registro": obterInfoTipoOcorrencia(o).label,
        Responsável: o.responsavel,
        ID: o.id ?? "",
        "ID Central": idCentralPorEmpresa.get(normalizar(o.empresa)) ?? "",
        Descrição: o.descricao ?? "",
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(linhas);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ocorrências");
    XLSX.writeFile(
      workbook,
      `historico-ocorrencias-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  }

  return (
    <div className="hist-shell">
      {/* Header */}
      <header className="hist-header">
        <div className="hist-header-inner">
          <div>
            <h1 className="hist-title">Histórico de Ocorrências</h1>
            <p className="hist-subtitle">
              Registro e acompanhamento de ocorrências
            </p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" }}>
            {empresaFiltro && (
              <button
                className="btn-secondary"
                onClick={() => {
                  const emp = empresasList.find(
                    (e) =>
                      e.nomeEmpresa.trim().toLowerCase() ===
                      empresaFiltro.trim().toLowerCase(),
                  );
                  if (emp && emp.id) {
                    navigate(`/esteira/${emp.id}`);
                  } else {
                    navigate(`/esteira`);
                  }
                }}
                style={{
                  height: "46px",
                  padding: "0 18px",
                  borderRadius: "8px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Ver Esteira de {empresaFiltro}
              </button>
            )}
            {empresaFiltro && (
              <button
                className="btn-secondary"
                onClick={() => {
                  const emp = empresasList.find(
                    (e) =>
                      normalizar(e.nomeEmpresa) === normalizar(empresaFiltro),
                  );
                  const duvidasManuais = emp?.duvidasTemasAnteriores || [];
                  setDuvidasClienteModal(duvidasManuais);
                  setDuvidasClienteModalEmpresaId(emp?.id);
                  setRankingDuvidasCliente(
                    montarRankingDuvidas(
                      emp?.nomeEmpresa || empresaFiltro,
                      duvidasManuais,
                    ),
                  );
                  setModalDuvidasClienteAberto(true);
                }}
                style={{
                  height: "46px",
                  padding: "0 18px",
                  borderRadius: "8px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Ver Dúvidas de {empresaFiltro}
              </button>
            )}
            <button
              className={`btn-secondary btn-dashboard-toggle ${dashboardAberto ? "active" : ""}`}
              onClick={() => setDashboardAberto((prev) => !prev)}
              style={{
                background: dashboardAberto ? "var(--lt-fundo-475569, #475569)" : "var(--lt-fundo-0f2a5e, #0f2a5e)",
              }}
            >
              📊 {dashboardAberto ? "Ocultar Dashboard" : "Mostrar Dashboard"}
            </button>
            <button
              className={`btn-secondary btn-dashboard-toggle ${painelIaAberto ? "active" : ""}`}
              onClick={() => {
                setPainelIaAberto((prev) => !prev);
                if (!iaClienteSelecionado && empresaFiltro) {
                  setIaClienteSelecionado(empresaFiltro);
                }
              }}
              style={{
                background: painelIaAberto ? "var(--lt-fundo-4c1d95, #4c1d95)" : "var(--lt-fundo-2e1065, #2e1065)",
              }}
            >
              ✨ {painelIaAberto ? "Fechar Resumo IA" : "Resumir com IA"}
            </button>
            <button
              className="btn-secondary btn-dashboard-toggle"
              onClick={exportarParaExcel}
              title="Exportar ocorrências filtradas para Excel"
              style={{ background: "#107c41", color: "#ffffff" }}
            >
              📥 Exportar Excel
            </button>
            <button ref={novaOcorrenciaRef} className="btn-primary hist-btn-novo" onClick={abrirNovo}>
              + Nova ocorrência
            </button>
            {isTreinador && (
              <button
                type="button"
                className="btn-primary"
                disabled={
                  (gerandoCsat && !ultimaReservaCsat) ||
                  (!ultimaReservaCsat && loading && empresasList.length === 0) ||
                  carregandoReservasCsat ||
                  !!erroReservasCsat
                }
                onClick={abrirGeracaoCsat}
              >
                {gerandoCsat && !ultimaReservaCsat
                  ? "Gerando link..."
                  : ultimaReservaCsat
                    ? "Registrar ocorrência"
                    : carregandoReservasCsat
                      ? "Verificando CSAT pendente..."
                      : loading && empresasList.length === 0
                        ? "Carregando clientes..."
                        : "Gerar link CSAT"}
              </button>
            )}
          </div>
        </div>
      </header>
      {isTreinador && modalCsatAberto && (
        <GerarCsatModal
          empresas={empresasList}
          empresaInicialId={empresasList.find((e) => normalizar(e.nomeEmpresa) === normalizar(empresaFiltro))?.id}
          gerando={gerandoCsat}
          erro={erroGerarCsat}
          onGerar={gerarCsat}
          onFechar={() => setModalCsatAberto(false)}
        />
      )}
      {isTreinador && ultimaReservaCsat && (
        <p>
          Registre a ocorrência {ultimaReservaCsat.idSeqFormatted} de{" "}
          {ultimaReservaCsat.empresa} para liberar a geração de outro link do
          CSAT.
        </p>
      )}
      {erroGerarCsat && !modalCsatAberto && (
        <p role="alert">
          Não foi possível gerar o link do CSAT: {erroGerarCsat}
        </p>
      )}
      {isTreinador && erroReservasCsat && (
        <p role="alert">Reservas CSAT: {erroReservasCsat}</p>
      )}
      {isTreinador && reservasCsat.length > 0 && (
          <section
            className="hist-csat-reservas"
            aria-label="Minhas ocorrências reservadas para CSAT"
          >
            <h2>Minhas ocorrências reservadas para CSAT</h2>
            <p>
              Clique no ID para registrar o restante da ocorrência. Compartilhe
              o link com os participantes.
            </p>
            {reservasCsat
              .map((reserva) => (
                <div key={reserva.id} className="hist-csat-reserva">
                  <button
                    className="btn-secondary"
                    disabled={reservaDeClienteSuspenso(reserva)}
                    title={reservaDeClienteSuspenso(reserva) ? MENSAGEM_TREINAMENTO_SUSPENSO : undefined}
                    onClick={() =>
                      abrirEdicao({
                        ...reserva,
                        treinamentoResultados: reserva.respostas.map(
                          (r) => r.experiencia,
                        ),
                      })
                    }
                  >
                    {reserva.idSeqFormatted}
                  </button>
                  <span>
                    {reserva.empresa} · {reserva.respostas.length}{" "}
                    avaliação(ões)
                    {reservaDeClienteSuspenso(reserva) ? " · Cliente suspenso: registro pausado" : ""}
                  </span>
                  <input
                    aria-label={`Link CSAT ${reserva.idSeqFormatted}`}
                    readOnly
                    value={linkCsat(reserva.token)}
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    className="btn-secondary"
                    onClick={async () => {
                      if (await copiarTexto(linkCsat(reserva.token))) {
                        toast.success("Link copiado.");
                      } else {
                        toast.error(
                          "Selecione e copie o link no campo ao lado.",
                        );
                      }
                    }}
                  >
                    Copiar link
                  </button>
                  {reserva.respostas.map((r, index) => (
                    <p key={index}>
                      {r.nome}: {r.experiencia}
                      {r.opiniao && ` — ${r.opiniao}`}
                    </p>
                  ))}
                </div>
              ))}
            <button className="btn-secondary" onClick={() => carregar()}>
              Atualizar respostas
            </button>
          </section>
        )}

      {/* Popup do Dashboard */}
      {dashboardAberto && (
        <div
          className="dashboard-modal-overlay"
          onClick={() => setDashboardAberto(false)}
        >
          <div
            className="dashboard-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dashboard-modal-header">
              <h2>📊 Dashboard de Ocorrências</h2>
              <button
                className="dashboard-modal-fechar"
                onClick={() => setDashboardAberto(false)}
                aria-label="Fechar dashboard"
              >
                <X size={18} />
              </button>
            </div>

            <div className="dashboard-modal-body">
              <div className="dashboard-modal-grid">
                <DoughnutChart
                  title="Ocorrências por Tipo"
                  data={tipoChartData}
                  onItemClick={(tipo) => {
                    const filtro = tipo === "Sem classificação" ? FILTRO_SEM_CLASSIFICACAO : tipo;
                    alterarFiltroTipo(filtroTipo === filtro ? "" : filtro);
                  }}
                  selectedLabel={
                    filtroTipo === FILTRO_SEM_CLASSIFICACAO
                      ? "Sem classificação"
                      : filtroTipo
                  }
                />
                <DoughnutChart
                  title="Ocorrências por Departamento"
                  data={deptoChartData}
                  onItemClick={(depto) =>
                    setFiltroDepto((prev) => (prev === depto ? "" : depto))
                  }
                  selectedLabel={filtroDepto}
                />
              </div>

              <BarChart
                title="Top 10 Clientes com Mais Dúvidas"
                data={topClientesDuvidasChartData}
                getItemHref={(empresa) => linkOcorrenciasDuvidas({ empresa })}
                onItemClick={mostrarOcorrenciasDuvidas}
                selectedLabel={empresaFiltro}
              />

              <BarChart
                title="Assuntos das Dúvidas Registradas"
                data={duvidaTemasChartData}
                getItemHref={(assunto) => linkOcorrenciasDuvidas({ assunto })}
                onItemClick={mostrarOcorrenciasDuvidas}
                selectedLabel={filtroAssuntoDuvida}
              />
            </div>
          </div>
        </div>
      )}

      {/* Painel de Resumo com IA */}
      <div className={`hist-ia-panel ${painelIaAberto ? "open" : ""}`}>
        <div className="hist-ia-inner">
          <div className="hist-ia-header">
            <div className="hist-ia-title">
              <span className="hist-ia-icon">✨</span>
              <h3>Resumo Inteligente do Cliente</h3>
              <span className="hist-ia-badge">Gemini AI</span>
            </div>
            <p className="hist-ia-desc">
              Selecione um cliente e gere um resumo executivo de todo o
              histórico de ocorrências com insights acionáveis.
            </p>
          </div>

          <div className="hist-ia-controls">
            <input
              list="ia-clientes-datalist"
              className="hist-ia-select"
              value={iaClienteSelecionado}
              onChange={(e) => {
                setIaClienteSelecionado(e.target.value);
                setIaResumo("");
                setIaErro("");
              }}
              placeholder="Digite ou selecione um cliente..."
            />
            <datalist id="ia-clientes-datalist">
              {[...new Set(ocorrencias.map((o) => o.empresa))]
                .sort((a, b) => a.localeCompare(b, "pt-BR"))
                .map((nome) => (
                  <option key={nome} value={nome} />
                ))}
            </datalist>

            <button
              className="hist-ia-btn"
              disabled={!iaClienteSelecionado || iaCarregando}
              onClick={async () => {
                if (!iaClienteSelecionado) return;
                setIaCarregando(true);
                setIaResumo("");
                setIaErro("");
                try {
                  const ocCliente = ocorrencias.filter(
                    (o) =>
                      o.empresa.trim().toLowerCase() ===
                      iaClienteSelecionado.trim().toLowerCase(),
                  );
                  await resumirOcorrencias(
                    iaClienteSelecionado,
                    ocCliente,
                    (textoParcial) => {
                      setIaResumo(textoParcial);
                    },
                  );
                } catch (err: any) {
                  setIaErro(err.message || "Erro ao gerar resumo.");
                } finally {
                  setIaCarregando(false);
                }
              }}
            >
              {iaCarregando ? (
                <>
                  <span className="hist-ia-spinner" /> Gerando resumo...
                </>
              ) : (
                <>✨ Gerar Resumo</>
              )}
            </button>
          </div>

          {iaErro && <div className="hist-ia-erro">⚠️ {iaErro}</div>}

          {iaResumo && (
            <div className="hist-ia-resultado">
              <div className="hist-ia-resultado-header">
                <span>
                  Resumo: <strong>{iaClienteSelecionado}</strong>
                </span>
                <button
                  className="hist-ia-copy-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(iaResumo);
                  }}
                >
                  📋 Copiar
                </button>
              </div>
              <div className="hist-ia-texto">{renderMarkdown(iaResumo)}</div>
            </div>
          )}
        </div>
      </div>

      {/* Barra de filtros */}
      <div className="hist-filtros">
        <div className="hist-filtros-main">
          <input
            className="hist-busca"
            placeholder="Buscar por empresa, tipo, responsável..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />

          <label className="hist-filtro-favoritas">
            <input
              type="checkbox"
              checked={filtroFavoritas}
              onChange={(e) => setFiltroFavoritas(e.target.checked)}
            />
            <Star size={16} fill="#eab308" color="#eab308" />
            Somente com estrela
          </label>

          <select
            className="hist-select-filtro"
            value={filtroTipo}
            onChange={(e) => alterarFiltroTipo(e.target.value)}
          >
            <option value="">Todos os tipos</option>
            <option value={FILTRO_SEM_CLASSIFICACAO}>Sem classificação</option>
            <option value={FILTRO_ALERTAS}>Alertas 🔥</option>
            <option value={FILTRO_SUSPENSOES}>Suspensões ⏸️</option>
            {tipos
              .filter((t) => t !== "Gol" || isTreinador)
              .map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            {/* Opções específicas de Treinamento */}
            <option value={FILTRO_TREINAMENTO_REA}>Treinamento (Rea.)</option>
            <option value={FILTRO_TREINAMENTO_CAN}>Treinamento (Can.)</option>
            <option value={FILTRO_TREINAMENTO_AUS}>Treinamento (Aus.)</option>
          </select>

          {(filtroTipo === "Dúvida" || filtroAssuntoDuvida) && (
            <select
              className="hist-select-filtro"
              aria-label="Assunto da dúvida"
              value={filtroAssuntoDuvida}
              onChange={(event) => setFiltroAssuntoDuvida(event.target.value)}
            >
              <option value="">Todos os assuntos de dúvida</option>
              {Array.from(new Set([...duvidaOpcoes, filtroAssuntoDuvida].filter(Boolean)))
                .sort((a, b) => a.localeCompare(b, "pt-BR"))
                .map((assunto) => <option key={assunto} value={assunto}>{assunto}</option>)}
            </select>
          )}

          <select
            className="hist-select-filtro"
            value={filtroDepto}
            onChange={(e) => setFiltroDepto(e.target.value)}
          >
            <option value="">Todos os departamentos</option>
            {DEPARTAMENTO.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div className="hist-filtros-dates">
          <div className="hist-filtro-date-group">
            <label htmlFor="data-inicio-filtro">Início</label>
            <input
              id="data-inicio-filtro"
              type="date"
              className="hist-date-input"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
            />
          </div>

          <div className="hist-filtro-date-group">
            <label htmlFor="data-fim-filtro">Fim</label>
            <input
              id="data-fim-filtro"
              type="date"
              className="hist-date-input"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
            />
          </div>

          {(busca ||
            filtroTipo ||
            filtroAssuntoDuvida ||
            filtroFavoritas ||
            filtroDepto ||
            dataInicio ||
            dataFim ||
            empresaFiltro ||
            expedienteFiltro) && (
            <button
              className="btn-limpar-filtros"
              onClick={() => {
                setBusca("");
                setFiltroTipo("");
                setFiltroAssuntoDuvida("");
                setFiltroFavoritas(false);
                setFiltroDepto("");
                setDataInicio("");
                setDataFim("");
                if (
                  empresaFiltro ||
                  expedienteFiltro ||
                  searchParams.has("assuntoDuvida") ||
                  searchParams.has("busca") ||
                  searchParams.has("favoritas") ||
                  searchParams.get("ocorrencia")
                ) {
                  navigate("/historico");
                }
              }}
              title="Limpar todos os filtros"
            >
              Limpar Filtros
            </button>
          )}
        </div>
      </div>

      {/* Lista */}
      <div ref={listaOcorrenciasRef} className="hist-table-wrapper" tabIndex={-1} role="region" aria-label="Lista de ocorrências">
        <table className="hist-table">
          <thead>
            <tr>
              <th>Empresa</th>
              <th
                onClick={() =>
                  setOrdenacaoData((prev) => (prev === "desc" ? "asc" : "desc"))
                }
                style={{ cursor: "pointer", userSelect: "none" }}
                title="Clique para ordenar por data"
              >
                Data {ordenacaoData === "desc" ? "▼" : "▲"}
              </th>
              <th>Hora</th>
              <th>Departamento</th>
              <th>Tipo de registro</th>
              {role === "master" && <th>WhatsApp</th>}
              <th>Responsável</th>
              <th>ID</th>
            </tr>
          </thead>

          <tbody>
            {!loading &&
              filtradasExibidas.map((o) => {
                const timestamp = getOcorrenciaTimestamp(o);
                const data = timestamp ? new Date(timestamp) : null;

                return (
                  <tr
                    key={o.id}
                    className="hist-row-click"
                    onClick={() => setSelecionada(o)}
                  >
                    <td>
                      {o.empresa}
                      {o.favorita && (
                        <Star
                          className="hist-estrela-indicador"
                          size={15}
                          fill="#eab308"
                          color="#eab308"
                          aria-label="Ocorrência com estrela"
                        />
                      )}
                      {o.alerta &&
                        (o.alertaResolvidoPorId ? (
                          <span
                            style={{
                              color: "var(--lt-texto-16a34a, #16a34a)",
                              fontWeight: "bold",
                              marginLeft: "6px",
                            }}
                            title="Alerta Solucionado"
                          >
                            🚨
                          </span>
                        ) : (
                          <span
                            style={{
                              color: "#dc2626",
                              fontWeight: "bold",
                              marginLeft: "6px",
                            }}
                            title="Alerta Ativo"
                          >
                            🚨
                          </span>
                        ))}
                      {o.retirarAlerta && (
                        <span
                          style={{
                            color: "var(--lt-texto-16a34a, #16a34a)",
                            fontWeight: "bold",
                            marginLeft: "6px",
                          }}
                          title="Ocorrência de resolução de alerta"
                        >
                          ✅
                        </span>
                      )}
                      {o.suspenderCliente && (
                        <span
                          style={{
                            marginLeft: "6px",
                          }}
                          title="Ocorrência que suspendeu o cliente"
                        >
                          ⏸️
                        </span>
                      )}
                      {o.retornarEsteira && (
                        <span
                          style={{
                            marginLeft: "6px",
                          }}
                          title="Ocorrência que retornou o cliente à esteira"
                        >
                          ▶️
                        </span>
                      )}
                      {o.chamadoAberto && (
                        <span
                          style={{
                            marginLeft: "6px",
                          }}
                          title={`${o.chamadoDescricao || "—"}${o.chamadoLink ? `\nLink: ${o.chamadoLink}` : ""}`}
                        >
                          🎫
                        </span>
                      )}
                      {o.tipo === "Follow up final" && (
                        <span
                          style={{ marginLeft: "6px" }}
                          title={`Resultado: ${o.followUpResultadoAnalise || "—"}\nContato: ${o.followUpStatusContato || "—"}${o.followUpProximaAcao ? `\nPróxima ação: ${o.followUpProximaAcao}` : ""}${o.followUpEncaminharSuporte ? "\nEncaminhado para o Suporte" : ""}`}
                        >
                          {o.followUpStatusContato === "Aguardando retorno"
                            ? "⏳"
                            : o.followUpEncaminharSuporte
                              ? "✅"
                              : "🧭"}
                        </span>
                      )}
                    </td>

                    <td>{data ? data.toLocaleDateString("pt-BR") : "—"}</td>
                    <td>
                      {data
                        ? data.toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </td>

                    <td>
                      <span
                        className={`hist-item-departamento ${DEPARTAMENTO_CLASS[o.departamento] || ""}`}
                      >
                        <span className="departamento-icon">
                          {DEPARTAMENTO_ICONES[o.departamento]}
                        </span>

                        {o.departamento}
                      </span>
                    </td>

                    <td>
                      {(() => {
                        const tipoInfo = obterInfoTipoOcorrencia(o);
                        return (
                          <span
                            className={`hist-item-tipo ${tipoInfo.className}`}
                          >
                            {tipoInfo.label}
                          </span>
                        );
                      })()}
                    </td>

                    {role === "master" && (
                      <td>
                        {o.whatsappStatus === "enviado" && (
                          <span
                            style={{ color: "var(--lt-texto-16a34a, #16a34a)", fontWeight: "bold" }}
                            title={`Enviado${o.whatsappEnviadoEm ? " em " + new Date(o.whatsappEnviadoEm).toLocaleString("pt-BR") : ""}`}
                          >
                            ✅ Enviado
                          </span>
                        )}
                        {o.whatsappStatus === "parcial" && (
                          <span
                            style={{ color: "var(--lt-texto-d97706, #d97706)", fontWeight: "bold" }}
                            title={(o.whatsappDestinatarios || [])
                              .map(
                                (d) =>
                                  `${d.nome}: ${d.status}${d.erro ? " (" + d.erro + ")" : ""}`,
                              )
                              .join("\n")}
                          >
                            ⚠️ Parcial
                          </span>
                        )}
                        {o.whatsappStatus === "falhou" && (
                          <span
                            style={{ color: "#dc2626", fontWeight: "bold" }}
                            title={(o.whatsappDestinatarios || [])
                              .map((d) => d.erro || "")
                              .filter(Boolean)
                              .join("\n")}
                          >
                            ❌ Falhou
                          </span>
                        )}
                        {o.whatsappStatus === "nao_enviado" && (
                          <span
                            style={{ color: "#64748b" }}
                            title="O usuário optou por não enviar"
                          >
                            🚫 Não enviado
                          </span>
                        )}
                        {o.whatsappStatus === "sem_destinatario" && (
                          <span
                            style={{ color: "var(--lt-texto-d97706, #d97706)", fontWeight: "bold" }}
                            title="Nenhum destinatário encontrado (telefone do cliente ou destinatário de gestão não cadastrado)"
                          >
                            📵 Sem destinatário
                          </span>
                        )}
                        {!o.whatsappStatus && (
                          <span style={{ color: "#64748b" }}>—</span>
                        )}
                      </td>
                    )}

                    <td>👤 {formatarNome(o.responsavel) || "—"}</td>

                    <td style={{ fontWeight: "600", color: "#64748b" }}>
                      {o.idSeqFormatted || "—"}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>

        <div className="hist-footer-paginacao">
          <div className="hist-total-registros">
            Exibindo de <strong>{totalItems > 0 ? startIndex + 1 : 0}</strong> a{" "}
            <strong>{endIndex}</strong> de <strong>{totalItems}</strong>{" "}
            {totalItems === 1 ? "ocorrência" : "ocorrências"}
          </div>
          {totalPages > 1 && (
            <div className="hist-paginacao-controles">
              <button
                className="btn-paginacao"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
              >
                Anterior
              </button>
              <span className="hist-paginacao-info">
                Página <strong>{currentPage}</strong> de{" "}
                <strong>{totalPages}</strong>
              </span>
              <button
                className="btn-paginacao"
                disabled={currentPage === totalPages}
                onClick={() =>
                  setCurrentPage((prev) => Math.min(prev + 1, totalPages))
                }
              >
                Próxima
              </button>
            </div>
          )}
        </div>

        {selecionada && (
          <div className="hist-detail-overlay">
            <div className="hist-detail-card">
              <div className="hist-detail-header">
                <h2>
                  Detalhes da interação{" "}
                  {selecionada.idSeqFormatted
                    ? `(${selecionada.idSeqFormatted})`
                    : ""}
                </h2>

                <div
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                >
                  {podeFavoritar ? (
                    <button
                      type="button"
                      className={`hist-estrela-btn ${selecionada.favorita ? "hist-estrela-btn--ativa" : ""}`}
                      aria-pressed={selecionada.favorita === true}
                      aria-label={
                        selecionada.favorita
                          ? "Remover estrela"
                          : "Marcar ocorrência com estrela"
                      }
                      title={
                        selecionada.favorita
                          ? "Remover estrela"
                          : `Marcar com estrela (${ocorrencias.filter((o) => o.favorita && normalizar(o.empresa) === normalizar(selecionada.empresa)).length}/3 para este cliente)`
                      }
                      disabled={salvandoFavorita}
                      onClick={alternarFavorita}
                    >
                      <Star
                        size={20}
                        fill={selecionada.favorita ? "currentColor" : "none"}
                      />
                    </button>
                  ) : (
                    selecionada.favorita && (
                      <Star
                        size={20}
                        fill="#eab308"
                        color="#eab308"
                        aria-label="Ocorrência com estrela"
                      />
                    )
                  )}
                  <button
                    className="hist-detail-compartilhar"
                    title="Copiar link direto para esta ocorrência"
                    aria-label="Compartilhar ocorrência"
                    onClick={() => {
                      const url = `${window.location.origin}/historico?ocorrencia=${selecionada.id}`;
                      navigator.clipboard.writeText(url);
                      toast.success(
                        "Link copiado! Basta enviar para abrir direto nesta ocorrência.",
                      );
                    }}
                  >
                    <Share2 size={16} />
                  </button>
                  <button
                    className="hist-detail-fechar"
                    onClick={() => fecharDetalhe()}
                    aria-label="Fechar detalhes"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="hist-detail-grid">
                {(() => {
                  if (selecionada.alerta) {
                    if (selecionada.alertaResolvidoPorId) {
                      const resDoc = ocorrencias.find(
                        (o) => o.id === selecionada.alertaResolvidoPorId,
                      );
                      return (
                        <div
                          style={{ gridColumn: "span 2", marginBottom: "10px" }}
                        >
                          <span
                            style={{
                              color: "var(--lt-texto-16a34a, #16a34a)",
                              fontWeight: "bold",
                              fontSize: "0.85rem",
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                              flexWrap: "wrap",
                            }}
                          >
                            ✅🚨 Alerta Solucionado{" "}
                            {resDoc
                              ? `em ${new Date(getOcorrenciaTimestamp(resDoc)).toLocaleDateString("pt-BR")}`
                              : ""}
                            .
                            {resDoc && (
                              <button
                                style={{
                                  textDecoration: "underline",
                                  color: "#2563eb",
                                  background: "none",
                                  border: "none",
                                  padding: 0,
                                  cursor: "pointer",
                                  fontWeight: "bold",
                                  fontSize: "0.85rem",
                                  marginLeft: "5px",
                                }}
                                onClick={() => setSelecionada(resDoc)}
                              >
                                Ver ocorrência de resolução
                              </button>
                            )}
                          </span>
                        </div>
                      );
                    } else {
                      return (
                        <div
                          style={{ gridColumn: "span 2", marginBottom: "10px" }}
                        >
                          <span
                            style={{
                              color: "#dc2626",
                              fontWeight: "bold",
                              fontSize: "0.85rem",
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                            }}
                          >
                            🚨 Ocorrência marcada como Alerta Ativo
                          </span>
                        </div>
                      );
                    }
                  }
                  if (selecionada.retirarAlerta) {
                    const origDoc = ocorrencias.find(
                      (o) => o.id === selecionada.alertaOriginalId,
                    );
                    return (
                      <div
                        style={{ gridColumn: "span 2", marginBottom: "10px" }}
                      >
                        <span
                          style={{
                            color: "var(--lt-texto-16a34a, #16a34a)",
                            fontWeight: "bold",
                            fontSize: "0.85rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            flexWrap: "wrap",
                          }}
                        >
                          ✅ Ocorrência marcada como Resolução de Alerta.
                          {origDoc && (
                            <span
                              style={{
                                color: "#475569",
                                display: "flex",
                                alignItems: "center",
                                gap: "5px",
                                flexWrap: "wrap",
                              }}
                            >
                              Resolução do alerta criado em{" "}
                              {new Date(
                                getOcorrenciaTimestamp(origDoc),
                              ).toLocaleDateString("pt-BR")}
                              .
                              <button
                                style={{
                                  textDecoration: "underline",
                                  color: "#2563eb",
                                  background: "none",
                                  border: "none",
                                  padding: 0,
                                  cursor: "pointer",
                                  fontWeight: "bold",
                                  fontSize: "0.85rem",
                                }}
                                onClick={() => setSelecionada(origDoc)}
                              >
                                Ver ocorrência do alerta original
                              </button>
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  }
                  return null;
                })()}
                <div>
                  <span>Empresa</span>
                  <strong>{selecionada.empresa}</strong>
                </div>

                <div>
                  <span>Departamento</span>
                  <strong>{selecionada.departamento}</strong>
                </div>

                {selecionada.departamento === "Suporte" &&
                  selecionada.csatSuporte && (
                    <div>
                      <span>Nota CSAT</span>
                      <strong
                        className={`nota-treinamento-tag ${
                          selecionada.csatSuporte === "Bom"
                            ? "nota-treinamento-tag--bom"
                            : "nota-treinamento-tag--ruim"
                        }`}
                      >
                        {selecionada.csatSuporte}
                      </strong>
                    </div>
                  )}

                <div>
                  <span>Tipo</span>
                  {(() => {
                    const tipoInfo = obterInfoTipoOcorrencia(selecionada);
                    return (
                      <strong
                        className={`hist-item-tipo hist-item-tipo-detail ${tipoInfo.className}`}
                      >
                        {tipoInfo.label}
                      </strong>
                    );
                  })()}
                </div>

                <div>
                  <span>Responsável</span>
                  <strong>
                    {formatarNome(selecionada.responsavel) || "—"}
                  </strong>
                </div>

                <div>
                  <span>Data da ocorrência</span>
                  <strong>
                    {new Date(
                      getOcorrenciaTimestamp(selecionada),
                    ).toLocaleDateString("pt-BR")}{" "}
                    {new Date(
                      getOcorrenciaTimestamp(selecionada),
                    ).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </strong>
                </div>

                {selecionada.createdAt &&
                  selecionada.dataOcorrencia > 0 &&
                  selecionada.tipo !== "Problema" &&
                  selecionada.tipo !== "Dúvida" &&
                  selecionada.departamento !== "Suporte" && (
                    <div>
                      <span>
                        {selecionada.tipo === "Informativa" ||
                        selecionada.tipo === "Treinamento"
                          ? "Data do próximo treinamento"
                          : selecionada.tipo === "Checkpoint"
                            ? "Data do checkpoint"
                            : selecionada.tipo === "Gol"
                              ? "Data do gol ⚽"
                              : "Data do agendamento"}
                      </span>
                      <strong>
                        {new Date(
                          selecionada.dataOcorrencia,
                        ).toLocaleDateString("pt-BR")}{" "}
                        {new Date(
                          selecionada.dataOcorrencia,
                        ).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </strong>
                    </div>
                  )}

                {selecionada.tipo === "Follow up final" && (
                  <>
                    <div>
                      <span>Resultado da análise</span>
                      <strong>{selecionada.followUpResultadoAnalise || "—"}</strong>
                    </div>
                    <div>
                      <span>Status do contato</span>
                      <strong>{selecionada.followUpStatusContato || "—"}</strong>
                    </div>
                    {selecionada.followUpProximaAcao && (
                      <div>
                        <span>Próxima ação</span>
                        <strong>{selecionada.followUpProximaAcao}</strong>
                      </div>
                    )}
                    {selecionada.followUpEncaminharSuporte && (
                      <div>
                        <span>Encaminhamento</span>
                        <strong>Encaminhado para o Suporte ✅</strong>
                      </div>
                    )}
                  </>
                )}

                {selecionada.tipo === "Treinamento" && (
                  <>
                    {selecionada.validacaoTentativaId && (
                      <div>
                        <span>Validação do conhecimento</span>
                        <strong>
                          {selecionada.validacaoAprovada ? "Aprovado" : "Não aprovado"}
                          {typeof selecionada.validacaoPercentual === "number" &&
                            ` · ${selecionada.validacaoPercentual.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`}
                          {typeof selecionada.validacaoNota === "number" &&
                            ` · ${selecionada.validacaoNota.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}/10`}
                        </strong>
                        <button
                          type="button"
                          className="btn-link-template"
                          onClick={() => abrirValidacao(selecionada.empresa)}
                        >
                          Ver respostas na Validação do conhecimento
                        </button>
                      </div>
                    )}
                    {selecionada.treinamentoDataSolicitacao && (
                      <div>
                        <span>Data de solicitação</span>
                        <strong>
                          {(() => {
                            if (
                              selecionada.treinamentoDataSolicitacao.includes(
                                "-",
                              )
                            ) {
                              const [y, m, d] =
                                selecionada.treinamentoDataSolicitacao.split(
                                  "-",
                                );
                              return `${d}/${m}/${y}`;
                            }
                            return selecionada.treinamentoDataSolicitacao;
                          })()}
                        </strong>
                      </div>
                    )}
                    {selecionada.treinamentoTempoAgenda && (
                      <div>
                        <span>Tempo de agenda</span>
                        <strong>{selecionada.treinamentoTempoAgenda}</strong>
                      </div>
                    )}
                    {motivoEsperaValido(selecionada.treinamentoMotivoEspera) && (
                      <div>
                        <span>Motivo da espera</span>
                        <strong>{descreverMotivoEsperaTreinamento(selecionada.treinamentoMotivoEspera)}</strong>
                      </div>
                    )}
                    {selecionada.treinamentoSolicitante && (
                      <div>
                        <span>Solicitante</span>
                        <strong>{selecionada.treinamentoSolicitante}</strong>
                      </div>
                    )}
                    {/* Resumo em tags só aparece quando não há csatRespostas (registros
                        antigos, anteriores ao modelo com nome+opinião por participante) —
                        evita mostrar a mesma informação duas vezes em formatos diferentes. */}
                    {(!selecionada.csatRespostas ||
                      selecionada.csatRespostas.length === 0) &&
                      selecionada.treinamentoResultados &&
                      selecionada.treinamentoResultados.length > 0 && (
                        <div className="hist-detail-training-notes-wrapper">
                          <span>Resultado do CSAT</span>
                          <div className="hist-detail-training-notes-list">
                            {selecionada.treinamentoResultados.map(
                              (resultado, idx) => (
                                <span
                                  key={idx}
                                  className={`nota-treinamento-tag ${
                                    resultado === "Bom"
                                      ? "nota-treinamento-tag--bom"
                                      : "nota-treinamento-tag--ruim"
                                  }`}
                                >
                                  {resultado}
                                </span>
                              ),
                            )}
                          </div>
                        </div>
                      )}
                    {selecionada.csatRespostas &&
                      selecionada.csatRespostas.length > 0 && (
                        <div className="hist-detail-desc">
                          <span>
                            CSAT ({selecionada.csatRespostas.length}{" "}
                            participante
                            {selecionada.csatRespostas.length === 1 ? "" : "s"})
                          </span>
                        </div>
                      )}
                    {selecionada.csatRespostas?.map((resposta, index) => {
                      const isEditingCsat = editingCsatIdx === index;
                      return (
                        <div key={`csat-${index}`}>
                          {isEditingCsat ? (
                            <div className="hist-atualizacao-edit-container">
                              <span>{resposta.nome}</span>
                              <fieldset
                                style={{
                                  display: "flex",
                                  gap: "12px",
                                  border: "none",
                                  padding: 0,
                                  margin: 0,
                                }}
                              >
                                {["Bom", "Ruim"].map((valor) => (
                                  <label
                                    key={valor}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "4px",
                                    }}
                                  >
                                    <input
                                      type="radio"
                                      name={`csat-experiencia-${index}`}
                                      value={valor}
                                      checked={editingCsatExperiencia === valor}
                                      onChange={() =>
                                        setEditingCsatExperiencia(
                                          valor as "Bom" | "Ruim",
                                        )
                                      }
                                    />
                                    {valor}
                                  </label>
                                ))}
                              </fieldset>
                              <textarea
                                rows={2}
                                maxLength={100}
                                value={editingCsatOpiniao}
                                onChange={(e) =>
                                  setEditingCsatOpiniao(e.target.value)
                                }
                                className="hist-atualizacao-edit-textarea"
                              />
                              <div className="hist-atualizacao-edit-actions">
                                <button
                                  type="button"
                                  className="hist-atualizacao-edit-btn-save"
                                  onClick={() => salvarEdicaoCsat(index)}
                                  disabled={salvando}
                                >
                                  {salvando ? "Salvando..." : "Salvar"}
                                </button>
                                <button
                                  type="button"
                                  className="hist-atualizacao-edit-btn-cancel"
                                  onClick={() => {
                                    setEditingCsatIdx(null);
                                    setEditingCsatOpiniao("");
                                  }}
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "flex-start",
                                gap: "8px",
                              }}
                            >
                              <div>
                                <span>
                                  {resposta.nome} — {resposta.experiencia}
                                </span>
                                {resposta.opiniao && <p>{resposta.opiniao}</p>}
                                {resposta.editadoPor && resposta.editadoEm && (
                                  <p
                                    style={{
                                      fontSize: "0.75rem",
                                      opacity: 0.7,
                                      marginTop: "2px",
                                    }}
                                  >
                                    Editado por {formatarNome(resposta.editadoPor)} em{" "}
                                    {new Date(resposta.editadoEm).toLocaleDateString("pt-BR")}{" "}
                                    {new Date(resposta.editadoEm).toLocaleTimeString("pt-BR", {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </p>
                                )}
                              </div>
                              {role === "master" && (
                                <button
                                  type="button"
                                  className="btn-edit-atualizacao"
                                  onClick={() => {
                                    setEditingCsatIdx(index);
                                    setEditingCsatExperiencia(
                                      resposta.experiencia,
                                    );
                                    setEditingCsatOpiniao(
                                      resposta.opiniao || "",
                                    );
                                  }}
                                >
                                  Editar
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {selecionada.treinamentoNotas &&
                      selecionada.treinamentoNotas.length > 0 && (
                        <details className="hist-detail-training-notes-wrapper hist-detail-legacy-csat">
                          <summary>CSAT (modelo descontinuado)</summary>
                          <div className="hist-detail-training-notes-list">
                            {selecionada.treinamentoNotas.map((nota, idx) => (
                              <span key={idx} className="nota-treinamento-tag">
                                Nota {idx + 1}: {nota}
                              </span>
                            ))}
                            {selecionada.treinamentoNotaMedia !== undefined &&
                              selecionada.treinamentoNotaMedia !== null && (
                                <span className="nota-treinamento-media">
                                  Média: {selecionada.treinamentoNotaMedia}
                                </span>
                              )}
                          </div>
                        </details>
                      )}
                  </>
                )}

                {selecionada.temaOcorrencia &&
                  selecionada.temaOcorrencia.length > 0 && (
                    <div className="hist-detail-desc">
                      <span>
                        {selecionada.tipo === "Dúvida"
                          ? "Assunto da dúvida"
                          : selecionada.tipo === "Solicitação"
                            ? "Assunto da solicitação"
                            : "Temas abordados"}
                      </span>
                      <div className="temas-selecionados">
                        {selecionada.temaOcorrencia.map((tema) => (
                          <span
                            key={tema}
                            className={`tema-tag ${["Ausente", "Cancelado"].includes(tema) ? "tema-tag-alerta" : ""}`}
                          >
                            {tema}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
              </div>

              <div className="hist-detail-desc">
                <span>Descrição</span>
                <p style={{ whiteSpace: "pre-wrap" }}>
                  {selecionada.descricao}
                </p>
              </div>

              {selecionada.atualizacoes &&
                selecionada.atualizacoes.length > 0 && (
                  <div className="hist-atualizacoes">
                    {selecionada.atualizacoes.map((at, i) => {
                      const isEditingThis = editingUpdateIdx === i;
                      return (
                        <div key={i} className="hist-atualizacao-item">
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                            }}
                          >
                            <span className="hist-atualizacao-meta">
                              Atualização em{" "}
                              {new Date(at.updatedAt).toLocaleDateString(
                                "pt-BR",
                              )}{" "}
                              {new Date(at.updatedAt).toLocaleTimeString(
                                "pt-BR",
                                {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                },
                              )}
                              {at.responsavel
                                ? ` · ${formatarNome(at.responsavel)}`
                                : ""}
                            </span>
                            {!isEditingThis && role === "master" && (
                              <div style={{ display: "flex", gap: "8px" }}>
                                <button
                                  type="button"
                                  className="btn-edit-atualizacao"
                                  onClick={() => {
                                    setEditingUpdateIdx(i);
                                    setEditingUpdateText(at.descricao);
                                  }}
                                >
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  className="btn-delete-atualizacao"
                                  onClick={() => excluirAtualizacao(i)}
                                >
                                  Excluir
                                </button>
                              </div>
                            )}
                          </div>

                          {isEditingThis ? (
                            <div className="hist-atualizacao-edit-container">
                              <textarea
                                rows={3}
                                value={editingUpdateText}
                                onChange={(e) =>
                                  setEditingUpdateText(e.target.value)
                                }
                                className="hist-atualizacao-edit-textarea"
                              />
                              <div className="hist-atualizacao-edit-actions">
                                <button
                                  type="button"
                                  className="hist-atualizacao-edit-btn-save"
                                  onClick={() => salvarEdicaoAtualizacao(i)}
                                  disabled={salvando}
                                >
                                  {salvando ? "Salvando..." : "Salvar"}
                                </button>
                                <button
                                  type="button"
                                  className="hist-atualizacao-edit-btn-cancel"
                                  onClick={() => {
                                    setEditingUpdateIdx(null);
                                    setEditingUpdateText("");
                                  }}
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p
                              style={{
                                whiteSpace: "pre-wrap",
                                marginTop: "4px",
                              }}
                            >
                              {at.descricao}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

              {/* Formulário de nova atualização */}
              {novaAtualizacaoAberta && (
                <div className="hist-nova-atualizacao">
                  <div className="hist-campo">
                    <label>Nova descrição *</label>
                    <textarea
                      rows={4}
                      value={novaDescricaoAtual}
                      onChange={(e) => setNovaDescricaoAtual(e.target.value)}
                      placeholder="Descreva a atualização..."
                    />
                  </div>

                  <div className="botoes">
                    <button
                      className="btn-ghost btn-small"
                      onClick={() => {
                        setNovaAtualizacaoAberta(false);
                        setNovaDescricaoAtual("");
                        setNovoResponsavelAtual("");
                      }}
                    >
                      Cancelar
                    </button>
                    <button
                      className="btn-primary btn-small"
                      onClick={salvarNovaAtualizacao}
                      disabled={salvando}
                    >
                      {salvando ? "Salvando..." : "Confirmar atualização"}
                    </button>
                  </div>
                </div>
              )}

              {/* Bloco de status WhatsApp — para qualquer ocorrência com envio registrado,
                  ou que dispare notificação de gestão (alerta/suspensão, retirada do
                  alerta/retorno à esteira) ou treinamento realizado, mesmo sem envio registrado. */}
              {(selecionada.whatsappStatus ||
                selecionada.alerta ||
                selecionada.suspenderCliente ||
                selecionada.retirarAlerta ||
                selecionada.retornarEsteira ||
                podeNotificarTreinamento(selecionada)) && (
                <div
                  style={{
                    marginTop: "16px",
                    padding: "14px 16px",
                    borderRadius: "10px",
                    background: "var(--lt-fundo-ffffff08, rgba(255,255,255,0.03))",
                    border:
                      selecionada.whatsappStatus === "enviado"
                        ? "1px solid rgba(34,197,94,0.25)"
                        : selecionada.whatsappStatus === "falhou"
                          ? "1px solid rgba(239,68,68,0.3)"
                          : selecionada.whatsappStatus === "nao_enviado"
                            ? "1px solid var(--lt-borda-64748b4d, rgba(100,116,139,0.3))"
                            : selecionada.whatsappStatus === "sem_destinatario"
                              ? "1px solid rgba(217,119,6,0.3)"
                              : selecionada.whatsappStatus === "parcial"
                                ? "1px solid rgba(251,191,36,0.3)"
                                : "1px solid var(--lt-borda-64748b4d, rgba(100,116,139,0.3))",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "8px",
                      marginBottom:
                        (selecionada.whatsappDestinatarios ?? []).length > 0
                          ? "10px"
                          : 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.8rem",
                        fontWeight: 700,
                        color:
                          selecionada.whatsappStatus === "enviado"
                            ? "var(--lt-texto-22c55e, #22c55e)"
                            : selecionada.whatsappStatus === "falhou"
                              ? "var(--lt-texto-ef4444, #ef4444)"
                              : selecionada.whatsappStatus === "nao_enviado"
                                ? "var(--lt-texto-94a3b8, #94a3b8)"
                                : selecionada.whatsappStatus ===
                                    "sem_destinatario"
                                  ? "var(--lt-texto-d97706, #d97706)"
                                  : selecionada.whatsappStatus === "parcial"
                                    ? "var(--lt-texto-fbbf24, #fbbf24)"
                                    : "var(--lt-texto-94a3b8, #94a3b8)",
                      }}
                    >
                      {selecionada.whatsappStatus === "enviado"
                        ? "✅ Notificação WhatsApp enviada"
                        : selecionada.whatsappStatus === "falhou"
                          ? "❌ Falha ao enviar notificação WhatsApp"
                          : selecionada.whatsappStatus === "nao_enviado"
                            ? "🚫 Notificação WhatsApp não enviada"
                            : selecionada.whatsappStatus === "sem_destinatario"
                              ? "📵 Nenhum destinatário encontrado para envio"
                              : selecionada.whatsappStatus === "parcial"
                                ? "⚠️ Notificação WhatsApp enviada parcialmente"
                                : "🔔 Notificação de gestão ainda não registrada"}
                      {selecionada.whatsappEnviadoEm ? (
                        <span
                          style={{
                            fontWeight: 400,
                            color: "var(--text-muted, var(--lt-texto-94a3b8, #94a3b8))",
                            marginLeft: "6px",
                          }}
                        >
                          {"·"}{" "}
                          {new Date(
                            selecionada.whatsappEnviadoEm,
                          ).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      className="btn-primary btn-small"
                      onClick={() => {
                        if (
                          selecionada.alerta ||
                          selecionada.retirarAlerta ||
                          selecionada.suspenderCliente ||
                          selecionada.retornarEsteira
                        ) {
                          reabrirNotificacaoGestao(selecionada);
                        } else if (selecionada.tipo === "Treinamento") {
                          reabrirNotificacaoEsteira(selecionada);
                        } else {
                          // Fallback
                          reabrirNotificacaoEsteira(selecionada);
                        }
                      }}
                      style={{
                        background:
                          selecionada.whatsappStatus === "enviado"
                            ? "transparent"
                            : "var(--warning-color, #f59e0b)",
                        border:
                          selecionada.whatsappStatus === "enviado"
                            ? "1px solid var(--lt-borda-ffffff26, rgba(255,255,255,0.15))"
                            : "1px solid transparent",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      {selecionada.whatsappStatus === "nao_enviado" ||
                      selecionada.whatsappStatus === "sem_destinatario" ||
                      !selecionada.whatsappStatus
                        ? "Enviar agora"
                        : selecionada.whatsappStatus === "enviado"
                          ? "Enviar novamente"
                          : "Tentar novamente"}
                    </button>
                  </div>

                  {/* Lista detalhada por destinatário */}
                  {(selecionada.whatsappDestinatarios ?? []).length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "5px",
                      }}
                    >
                      {selecionada.whatsappDestinatarios!.map((d) => (
                        <div
                          key={d.telefone}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            padding: "7px 10px",
                            borderRadius: "7px",
                            background:
                              d.status === "falhou"
                                ? "rgba(239,68,68,0.08)"
                                : "rgba(34,197,94,0.06)",
                            border:
                              d.status === "falhou"
                                ? "1px solid rgba(239,68,68,0.2)"
                                : "1px solid rgba(34,197,94,0.15)",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                            }}
                          >
                            <span
                              style={{
                                fontSize: "0.82rem",
                                color: "var(--text-color, var(--lt-texto-ffffff, #fff))",
                                fontWeight: 500,
                              }}
                            >
                              {d.nome}
                            </span>
                            <span
                              style={{
                                fontSize: "0.78rem",
                                color:
                                  d.status === "enviado"
                                    ? "var(--lt-texto-22c55e, #22c55e)"
                                    : "var(--lt-texto-ef4444, #ef4444)",
                                fontWeight: 600,
                              }}
                            >
                              {d.status === "enviado"
                                ? "✅ Enviado"
                                : "❌ Falhou"}
                            </span>
                          </div>
                          {d.status === "falhou" && d.erro && (
                            <div
                              style={{
                                marginTop: "4px",
                                fontSize: "0.76rem",
                                color: "var(--lt-texto-fca5a5, #fca5a5)",
                                lineHeight: 1.4,
                              }}
                            >
                              {d.erro}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="botoes">
                {!novaAtualizacaoAberta &&
                  (role === "treinador" ||
                    role === "master" ||
                    (selecionada.responsavel &&
                      selecionada.responsavel.toLowerCase() ===
                        userName.toLowerCase())) && (
                    <button
                      className="btn-secondary btn-small"
                      onClick={() => setNovaAtualizacaoAberta(true)}
                    >
                      + Incluir nova atualização
                    </button>
                  )}

                {(role === "treinador" ||
                  role === "master" ||
                  (role === "suporte" && selecionada.origem === "ssx-desk") ||
                  (selecionada.responsavel &&
                    selecionada.responsavel.toLowerCase() ===
                      userName.toLowerCase())) && (
                  <button
                    className="btn-secondary btn-small"
                    onClick={() => {
                      fecharDetalhe();
                      abrirEdicao(selecionada);
                    }}
                  >
                    Editar
                  </button>
                )}

                {role === "master" && (
                  <button
                    className="btn-danger"
                    onClick={() => {
                      fecharDetalhe();
                      excluir(selecionada.id!);
                    }}
                  >
                    Excluir
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {!loading && filtradas.length === 0 && (
          <div className="hist-empty">
            <p className="hist-empty-icon">📋</p>
            <p>Nenhuma ocorrência encontrada.</p>
          </div>
        )}
      </div>

      {/* Painel lateral de formulário */}
      {painelAberto && (
        <div className="hist-overlay">
          <div className="hist-painel">
            <div className="hist-painel-header">
              <h2>{editandoId ? "Editar ocorrência" : "Nova ocorrência"}</h2>
              <button
                className="hist-fechar"
                onClick={() => cancelar()}
                aria-label="Fechar painel"
                disabled={salvando}
              >
                <X size={18} />
              </button>
            </div>

            <div className="hist-campo">
              <label>Empresa *</label>
              <input
                list="empresas-list"
                value={form.empresa}
                onChange={(e) => set("empresa", e.target.value)}
                placeholder="Digite para buscar..."
              />
              <datalist id="empresas-list">
                {empresasList
                  .sort((a, b) =>
                    a.nomeEmpresa.localeCompare(b.nomeEmpresa, "pt-BR"),
                  )
                  .map((e) => (
                    <option key={e.id} value={e.nomeEmpresa} />
                  ))}
              </datalist>
            </div>

            {(isTreinador ||
              form.departamento === "Suporte" ||
              form.tipo === "Problema" ||
              form.tipo === "Dúvida") && (
              <div className="hist-campo hist-campo-row">
                <div>
                  <label>
                    {(() => {
                      if (
                        form.departamento === "Suporte" ||
                        form.tipo === "Problema" ||
                        form.tipo === "Dúvida"
                      ) {
                        return "Data da ocorrência (não obrigatório)";
                      }
                      if (
                        form.tipo === "Informativa" ||
                        form.tipo === "Treinamento"
                      ) {
                        return "Data do próximo treinamento (não obrigatório)";
                      }
                      if (form.tipo === "Checkpoint") {
                        return "Data do checkpoint *";
                      }
                      if (form.tipo === "Gol") {
                        return "Data do gol ⚽";
                      }
                      return "Data do agendamento (não obrigatório)";
                    })()}
                  </label>
                  <input
                    type="date"
                    value={form.dataOcorrencia}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        dataOcorrencia: e.target.value,
                      })
                    }
                    required={form.tipo === "Checkpoint"}
                  />
                </div>

                <div>
                  <label>Hora (não obrigatório)</label>
                  <input
                    type="time"
                    value={form.horaOcorrencia ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, horaOcorrencia: e.target.value })
                    }
                  />
                </div>
              </div>
            )}

            {role === "master" && (
              <div className="hist-campo hist-campo-row">
                <div>
                  <label>Data de criação (apenas Master)</label>
                  <input
                    type="date"
                    value={form.createdAt ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        createdAt: e.target.value,
                        treinamentoMotivoEspera: null,
                      })
                    }
                  />
                </div>

                <div>
                  <label>Hora de criação (apenas Master)</label>
                  <input
                    type="time"
                    value={form.horaCriacao ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, horaCriacao: e.target.value })
                    }
                  />
                </div>
              </div>
            )}

            <div className="hist-campo hist-campo-row">
              <label>
                Tipo de ocorrência {editandoImportadaSsx ? "(opcional)" : "*"}
              </label>
              <select
                value={form.tipo}
                onChange={(e) => {
                  const valor = e.target.value;
                  if (
                    valor === "Follow up final" &&
                    !editandoId &&
                    form.empresa &&
                    obterUltimoFollowUpFinal(ocorrencias, form.empresa)
                      ?.followUpProximaAcao === "Reforço de treinamento"
                  ) {
                    setFollowUpGateAberto(true);
                    return;
                  }
                  set("tipo", valor);
                }}
              >
                <option value="">
                  {editandoImportadaSsx ? "Sem classificação" : "Selecione..."}
                </option>
                {getAllowedTypes().map((t) => (
                  <option key={t} value={t} disabled={t === "Treinamento" && treinamentoIndisponivel}>
                    {t}
                  </option>
                ))}
              </select>
              {treinamentoIndisponivel && (
                <small role="status">Cliente suspenso: Treinamento está indisponível. Os demais tipos continuam disponíveis.</small>
              )}
            </div>

            {(!editandoId || reservaEditando) &&
              isTreinador &&
              form.tipo === "Treinamento" &&
              !isSelectedEmpresaOngoing && (
                <div className="hist-campo score-btn-container">
                  <button
                    type="button"
                    className="btn-calcular-score"
                    onClick={() => {
                      setDuvidasTemasHistorico(
                        selectedEmpresaObj?.duvidasTemasAnteriores || [],
                      );
                      setNovaDuvidaTemaHistorico("");
                      setModalScoreAberto(true);
                    }}
                  >
                    📊 Calcular Score do Cliente
                  </button>
                  {calculoScoreResult &&
                    (calculoScoreResult.isNeutro ? (
                      <span className="score-result-badge--neutro">
                        Score: <strong>Neutro</strong> ✅
                      </span>
                    ) : (
                      <span
                        className={`score-result-badge ${calculoScoreResult.tipo === "Safety" ? "score-result-badge--safety" : "score-result-badge--fast"}`}
                        style={{ marginTop: "6px" }}
                      >
                        Score:{" "}
                        <strong>
                          {calculoScoreResult.score !== null
                            ? calculoScoreResult.score.toFixed(1)
                            : ""}
                        </strong>{" "}
                        ({calculoScoreResult.tipo}) ✅
                      </span>
                    ))}
                </div>
              )}

            <div className="hist-campo">
              <label>Departamento *</label>
              <select
                value={form.departamento}
                onChange={(e) => set("departamento", e.target.value)}
                disabled={getAllowedDepartments().length === 1}
              >
                <option value="">Selecione...</option>
                {getAllowedDepartments().map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {form.departamento === "Suporte" && (
              <div className="hist-campo">
                <label>Nota CSAT (Opcional)</label>
                <select
                  value={form.csatSuporte ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      csatSuporte: e.target.value as "Bom" | "Ruim" | "",
                    })
                  }
                >
                  <option value="">Não informado</option>
                  <option value="Bom">Bom</option>
                  <option value="Ruim">Ruim</option>
                </select>
              </div>
            )}

            {form.tipo === "Dúvida" && (
              <div className="hist-campo">
                <label>Assunto da dúvida *</label>
                <input
                  type="text"
                  className="temas-busca"
                  placeholder="Buscar assunto..."
                  value={buscaAssunto}
                  onChange={(e) => setBuscaAssunto(e.target.value)}
                />
                <div className="temas-lista">
                  {duvidaOpcoes
                    .filter((opcao) =>
                      opcao
                        .toLowerCase()
                        .includes(buscaAssunto.trim().toLowerCase()),
                    )
                    .map((opcao) => (
                      <label key={opcao} className="tema-opcao">
                        <input
                          type="checkbox"
                          checked={
                            form.temaOcorrencia?.includes(opcao) ?? false
                          }
                          onChange={(e) => {
                            const atual = form.temaOcorrencia ?? [];
                            const novoTema = e.target.checked
                              ? [...atual, opcao]
                              : atual.filter((t) => t !== opcao);
                            setForm({
                              ...form,
                              temaOcorrencia: novoTema,
                            });
                          }}
                        />
                        {opcao}
                      </label>
                    ))}
                </div>
              </div>
            )}

            {form.tipo === "Problema" && (
              <div className="hist-campo">
                <label
                  className="checkbox-label"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={form.chamadoAberto ?? false}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        chamadoAberto: e.target.checked,
                        ...(e.target.checked
                          ? {}
                          : { chamadoDescricao: "", chamadoLink: "" }),
                      })
                    }
                  />
                  Foi aberto um chamado para esse problema? 🎫
                </label>

                {form.chamadoAberto && (
                  <div
                    style={{
                      marginTop: "0.75rem",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.75rem",
                    }}
                  >
                    <div>
                      <label>Qual o problema que está sendo resolvido? *</label>
                      <textarea
                        rows={3}
                        value={form.chamadoDescricao ?? ""}
                        onChange={(e) =>
                          set("chamadoDescricao", e.target.value)
                        }
                        placeholder="Descreva o problema relacionado ao chamado..."
                      />
                    </div>
                    <div>
                      <label>Link relacionado ao chamado (opcional)</label>
                      <input
                        type="text"
                        value={form.chamadoLink ?? ""}
                        onChange={(e) => set("chamadoLink", e.target.value)}
                        placeholder="https://..."
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {form.tipo === "Follow up final" && (
              <div className="hist-campo">
                <label>Resultado da análise *</label>
                <div className="radio-group-score">
                  {(
                    ["Aplicado", "Sem evidência de aplicação", "Parcialmente aplicado"] as const
                  ).map((opcao) => (
                    <label key={opcao}>
                      <input
                        type="radio"
                        name="followUpResultadoAnalise"
                        value={opcao}
                        checked={form.followUpResultadoAnalise === opcao}
                        onChange={() => set("followUpResultadoAnalise", opcao)}
                      />
                      {opcao}
                    </label>
                  ))}
                </div>

                <label style={{ marginTop: "0.75rem", display: "block" }}>
                  Status do contato *
                </label>
                <div className="radio-group-score">
                  {(["Aguardando retorno", "Contato bem-sucedido"] as const).map(
                    (opcao) => (
                      <label key={opcao}>
                        <input
                          type="radio"
                          name="followUpStatusContato"
                          value={opcao}
                          checked={form.followUpStatusContato === opcao}
                          onChange={() =>
                            setForm({
                              ...form,
                              followUpStatusContato: opcao,
                              ...(opcao === "Aguardando retorno"
                                ? { followUpProximaAcao: "", followUpEncaminharSuporte: false }
                                : {}),
                            })
                          }
                        />
                        {opcao}
                      </label>
                    ),
                  )}
                </div>
                {form.followUpStatusContato === "Aguardando retorno" && (
                  <small role="status">
                    A ocorrência pode ser salva assim. Edite-a depois para registrar o
                    resultado do contato.
                  </small>
                )}

                {form.followUpStatusContato === "Contato bem-sucedido" && (
                  <>
                    <label style={{ marginTop: "0.75rem", display: "block" }}>
                      Próxima ação *
                    </label>
                    <div className="radio-group-score">
                      {(
                        [
                          "Nenhuma ação necessária",
                          "Orientação complementar",
                          "Reforço de treinamento",
                        ] as const
                      ).map((opcao) => (
                        <label key={opcao}>
                          <input
                            type="radio"
                            name="followUpProximaAcao"
                            value={opcao}
                            checked={form.followUpProximaAcao === opcao}
                            onChange={() =>
                              setForm({
                                ...form,
                                followUpProximaAcao: opcao,
                                ...(opcao === "Reforço de treinamento"
                                  ? { followUpEncaminharSuporte: false }
                                  : {}),
                              })
                            }
                          />
                          {opcao}
                        </label>
                      ))}
                    </div>

                    {form.followUpProximaAcao &&
                      form.followUpProximaAcao !== "Reforço de treinamento" && (
                        <label
                          className="checkbox-label"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            cursor: "pointer",
                            marginTop: "0.75rem",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={form.followUpEncaminharSuporte ?? false}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                followUpEncaminharSuporte: e.target.checked,
                              })
                            }
                          />
                          Encaminhar pro suporte (conclui o acompanhamento do cliente) ✅
                        </label>
                      )}
                    {form.followUpProximaAcao === "Reforço de treinamento" && (
                      <small role="status">
                        O cliente permanece na esteira até um novo follow up final.
                      </small>
                    )}
                  </>
                )}
              </div>
            )}

            {form.tipo === "Solicitação" && (
              <div className="hist-campo">
                <label>Assunto da solicitação</label>
                <div className="temas-lista">
                  {solicitacaoOpcoes.map((opcao) => (
                    <label key={opcao} className="tema-opcao">
                      <input
                        type="checkbox"
                        checked={form.temaOcorrencia?.includes(opcao) ?? false}
                        onChange={(e) => {
                          const atual = form.temaOcorrencia ?? [];
                          const novoTema = e.target.checked
                            ? [...atual, opcao]
                            : atual.filter((t) => t !== opcao);
                          setForm({
                            ...form,
                            temaOcorrencia: novoTema,
                          });
                        }}
                      />
                      {opcao}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {form.tipo === "Treinamento" && (
              <div className="hist-campo">
                <label>Temas abordados (obrigatório)</label>

                {/* Toggle de revisão */}
                {!isSelectedEmpresaOngoing && !temaForaEsteira && (
                  <label
                    className="checkbox-label revisao-toggle"
                    title="Revisões não avançam a posição na esteira"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "10px",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      background: isRevisao
                        ? "rgba(99,102,241,0.12)"
                        : "var(--lt-fundo-ffffff0a, rgba(255,255,255,0.04))",
                      border: isRevisao
                        ? "1px solid rgba(99,102,241,0.4)"
                        : "1px solid var(--lt-borda-ffffff14, rgba(255,255,255,0.08))",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                      fontWeight: isRevisao ? 600 : 400,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isRevisao}
                      onChange={(e) => {
                        setIsRevisao(e.target.checked);
                        // Desmarcar a revisão total também limpa as marcações
                        // individuais recuperadas ao abrir uma ocorrência.
                        if (!e.target.checked) setTemasRevisados([]);
                      }}
                      style={{ cursor: "pointer" }}
                    />
                    <span>📝 Todos os temas são revisão</span>
                    <small style={{ color: "var(--lt-texto-94a3b8, #94a3b8)", fontWeight: 400 }}>
                      {isRevisao
                        ? '(não avança a esteira — tags: "Revisão de...")'
                        : "(para revisão parcial, selecione os temas abaixo)"}
                    </small>
                  </label>
                )}

                {/* Toggle de tema fora da esteira */}
                {!isSelectedEmpresaOngoing && !isRevisao && (
                  <label
                    className="checkbox-label tema-fora-esteira-toggle"
                    title="Use para clientes que já concluíram a esteira (ou continuam além dela) e vão treinar um tema que não está na lista padrão"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "10px",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      background: temaForaEsteira
                        ? "rgba(16,185,129,0.12)"
                        : "var(--lt-fundo-ffffff0a, rgba(255,255,255,0.04))",
                      border: temaForaEsteira
                        ? "1px solid rgba(16,185,129,0.4)"
                        : "1px solid var(--lt-borda-ffffff14, rgba(255,255,255,0.08))",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                      fontWeight: temaForaEsteira ? 600 : 400,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={temaForaEsteira}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setTemaForaEsteira(checked);
                        if (checked) {
                          setTemasRevisados([]);
                          setTemaOcorrenciaOngoingText(
                            (form.temaOcorrencia ?? []).join(", "),
                          );
                        }
                      }}
                      style={{ cursor: "pointer" }}
                    />
                    <span>🆕 Tema fora da esteira</span>
                    <small style={{ color: "var(--lt-texto-94a3b8, #94a3b8)", fontWeight: 400 }}>
                      {temaForaEsteira
                        ? "(não avança a esteira — digite o tema livremente)"
                        : "(marque para treinar um tema que não está previsto na esteira)"}
                    </small>
                  </label>
                )}
                {isSelectedEmpresaOngoing || temaForaEsteira ? (
                  <input
                    type="text"
                    value={temaOcorrenciaOngoingText}
                    onChange={(e) => {
                      const val = e.target.value;
                      setTemaOcorrenciaOngoingText(val);
                      setForm((f) => ({
                        ...f,
                        temaOcorrencia: normalizarTemasTreinamento(
                          val.split(","),
                        ),
                      }));
                    }}
                    placeholder="Digite os temas separados por vírgula..."
                  />
                ) : (
                  <div className="temas-lista">
                    {(() => {
                      const empresaSelecionada = empresasList.find(
                        (e) =>
                          normalizar(e.nomeEmpresa) ===
                          normalizar(form.empresa),
                      );
                      const temaGolEmpresa =
                        empresaSelecionada?.temaGol?.trim();
                      const opcoes = normalizarTemasTreinamento([
                        "Ausente",
                        "Cancelado",
                        ...(empresaSelecionada?.temaText
                          ? empresaSelecionada.temaText
                              .trim()
                              .split(/\s{2,}|\n/)
                              .filter(Boolean)
                          : []),
                        // Mantém editáveis temas antigos que saíram da esteira.
                        ...(form.temaOcorrencia ?? []),
                      ]);

                      return opcoes.map((tema) => normalizar(tema) === normalizar("Validação do conhecimento") ? (
                        <label key={tema} className="tema-opcao tema-opcao-bloqueada" title="Registrado pelo módulo Validação do conhecimento">
                          <input type="checkbox" checked={false} disabled aria-describedby="hist-tema-validacao-ajuda" />
                          {tema}
                          <small id="hist-tema-validacao-ajuda">
                            Registre pelo menu Validação do conhecimento
                          </small>
                        </label>
                      ) : (
                        <label key={tema} className="tema-opcao">
                          <input
                            type="checkbox"
                            checked={
                              form.temaOcorrencia?.includes(tema) ?? false
                            }
                            onChange={(e) => {
                              const atual = form.temaOcorrencia ?? [];
                              if (!e.target.checked) {
                                setTemasRevisados((temas) =>
                                  temas.filter((t) => t !== tema),
                                );
                              }
                              const novoTema = e.target.checked
                                ? normalizarTemasTreinamento([...atual, tema])
                                : atual.filter((t) => t !== tema);
                              setForm({
                                ...form,
                                temaOcorrencia: novoTema,
                              });
                              setTemaOcorrenciaOngoingText(novoTema.join(", "));
                            }}
                          />
                          {tema}
                          {form.temaOcorrencia?.includes(tema) &&
                            (isRevisao || temasRevisados.includes(tema)) &&
                            !["ausente", "cancelado"].includes(
                              tema.trim().toLowerCase(),
                            ) && (
                              <small
                                style={{
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  background: "rgba(99, 102, 241, 0.15)",
                                  fontWeight: 600,
                                }}
                              >
                                Revisão
                              </small>
                            )}
                          {temaGolEmpresa && tema.trim() === temaGolEmpresa && (
                            <span
                              className="tema-gol-badge"
                              title="Tema marcado como Gol na Esteira"
                            >
                              ⚽
                            </span>
                          )}
                        </label>
                      ));
                    })()}
                  </div>
                )}
              </div>
            )}

            {form.tipo === "Treinamento" &&
              !isSelectedEmpresaOngoing &&
              !temaForaEsteira &&
              (form.temaOcorrencia ?? []).some(
                (tema) =>
                  !["ausente", "cancelado"].includes(tema.trim().toLowerCase()),
              ) && (
                <div className="hist-campo">
                  <label>Quais temas foram revisados?</label>
                  <div className="temas-lista">
                    {(form.temaOcorrencia ?? [])
                      .filter(
                        (tema) =>
                          !["ausente", "cancelado"].includes(
                            tema.trim().toLowerCase(),
                          ),
                      )
                      .map((tema) => (
                        <label key={tema} className="tema-opcao">
                          <input
                            type="checkbox"
                            checked={isRevisao || temasRevisados.includes(tema)}
                            onChange={(e) => {
                              const atual = isRevisao
                                ? (form.temaOcorrencia ?? []).filter(
                                    isTemaTreinamento,
                                  )
                                : temasRevisados;
                              setIsRevisao(false);
                              setTemasRevisados(
                                e.target.checked
                                  ? normalizarTemasTreinamento([...atual, tema])
                                  : atual.filter((t) => t !== tema),
                              );
                            }}
                          />
                          Revisão de {tema}
                        </label>
                      ))}
                  </div>
                  <small>
                    Marque manualmente os temas que forem revisão. Apenas os
                    temas não marcados como revisão avançam a esteira.
                  </small>
                </div>
              )}

            {form.tipo === "Treinamento" && (
              <>
                <div className="hist-campo hist-campo-row">
                  <div>
                    <label>Data de solicitação *</label>
                    <input
                      type="date"
                      value={form.treinamentoDataSolicitacao ?? ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          treinamentoDataSolicitacao: e.target.value,
                          treinamentoMotivoEspera: null,
                        })
                      }
                      required
                    />
                  </div>

                  <div>
                    <label>
                      Tempo de agenda{" "}
                      {(form.temaOcorrencia ?? []).some(
                        (t) =>
                          t.trim().toLowerCase() === "cancelado" ||
                          t.trim().toLowerCase() === "ausente",
                      )
                        ? ""
                        : "*"}
                    </label>
                    <input
                      type="time"
                      value={form.treinamentoTempoAgenda ?? ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          treinamentoTempoAgenda: e.target.value,
                        })
                      }
                      required={
                        !(form.temaOcorrencia ?? []).some(
                          (t) =>
                            t.trim().toLowerCase() === "cancelado" ||
                            t.trim().toLowerCase() === "ausente",
                        )
                      }
                    />
                  </div>
                </div>

                {motivoEsperaValido(form.treinamentoMotivoEspera) && (
                  <div className="hist-campo">
                    <label htmlFor="hist-motivo-espera">Motivo da espera</label>
                    <select id="hist-motivo-espera" value={form.treinamentoMotivoEspera}
                      onChange={(event) => {
                        if (motivoEsperaValido(event.target.value)) setForm({ ...form, treinamentoMotivoEspera: event.target.value });
                      }}>
                      <option value="cliente">Data distante a pedido do cliente</option>
                      <option value="agenda_treinador">Disponibilidade da agenda do treinador</option>
                    </select>
                    <small>A espera continua na média geral do relatório. Ao alterar as datas, o motivo será solicitado novamente.</small>
                  </div>
                )}

                <div className="hist-campo">
                  <label>Quem solicitou *</label>
                  <select
                    value={form.treinamentoSolicitante ?? "CS"}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        treinamentoSolicitante: e.target.value,
                      })
                    }
                    required
                  >
                    <option value="CS">CS</option>
                    <option value="Cliente">Cliente</option>
                    <option value="Suporte">Suporte</option>
                    <option value="Comercial">Comercial</option>
                    <option value="Hardware">Hardware</option>
                    <option value="Aplicações">Aplicações</option>
                  </select>
                </div>

                <div className="hist-campo training-notes-container">
                  <div className="training-notes-header">
                    <label>Resultado do CSAT (Opcional)</label>
                    <button
                      type="button"
                      className="btn-add-nota-icon"
                      onClick={handleAddResultado}
                    >
                      + Adicionar Resultado
                    </button>
                  </div>
                  {!form.treinamentoResultados ||
                  form.treinamentoResultados.length === 0 ? (
                    <span className="training-no-notes-text">
                      Nenhum resultado registrado (treinamento sem resposta
                      CSAT).
                    </span>
                  ) : (
                    <div className="training-notes-list">
                      {form.treinamentoResultados.map((resultado, idx) => (
                        <div key={idx} className="training-note-item">
                          <select
                            value={resultado}
                            onChange={(e) =>
                              handleUpdateResultado(idx, e.target.value)
                            }
                            required
                            className="training-note-input"
                          >
                            <option value="">Selecione...</option>
                            <option value="Bom">Bom</option>
                            <option value="Ruim">Ruim</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => handleRemoveResultado(idx)}
                            className="btn-remove-nota"
                            title="Remover resultado"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {form.treinamentoNotas &&
                    form.treinamentoNotas.length > 0 && (
                      <span className="training-no-notes-text">
                        Notas antigas (modelo 1 a 5) já registradas neste
                        treinamento: {form.treinamentoNotas.join(", ")}. Elas
                        são preservadas, mas não podem mais ser editadas.
                      </span>
                    )}
                </div>
              </>
            )}

            <div className="hist-campo hist-campo-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.alerta ?? false}
                  disabled={form.retirarAlerta ?? false}
                  onChange={(e) =>
                    setForm({ ...form, alerta: e.target.checked })
                  }
                />
                Definir como alerta 🔥
              </label>

              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.retirarAlerta ?? false}
                  disabled={form.alerta ?? false}
                  onChange={(e) =>
                    setForm({ ...form, retirarAlerta: e.target.checked })
                  }
                />
                Retirar do alerta ✅
              </label>
            </div>

            {(() => {
              const empresaObjetoForm = empresasList.find(
                (e) => normalizar(e.nomeEmpresa) === normalizar(form.empresa),
              );
              const isSuspended = empresaObjetoForm?.isSuspended ?? false;
              const canReactivate =
                role === "master" || role === "treinador" || role === "cs";
              if (!canReactivate) return null;

              if (isSuspended || form.retornarEsteira) {
                return (
                  <div className="hist-campo hist-campo-row">
                    <label
                      className="checkbox-label"
                      style={{ fontWeight: 600, color: "var(--lt-texto-6366f1, #6366f1)" }}
                    >
                      <input
                        type="checkbox"
                        checked={form.retornarEsteira ?? false}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            retornarEsteira: e.target.checked,
                          })
                        }
                      />
                      Retornar cliente à esteira principal 🔄 (remover
                      suspensão)
                    </label>
                  </div>
                );
              }

              return (
                <div className="hist-campo hist-campo-row">
                  <label
                    className="checkbox-label"
                    style={{ fontWeight: 600, color: "var(--lt-texto-ef4444, #ef4444)" }}
                  >
                    <input
                      type="checkbox"
                      checked={form.suspenderCliente ?? false}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          suspenderCliente: e.target.checked,
                        })
                      }
                    />
                    Suspender cliente temporariamente ⏸️
                  </label>
                </div>
              );
            })()}

            <div className="hist-campo">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "4px",
                }}
              >
                <label style={{ marginBottom: 0 }}>Descrição *</label>
                {form.tipo === "Treinamento" &&
                  (!editandoId || reservaEditando) &&
                  form.descricao !== templateTreinamentoAtual && (
                    <button
                      type="button"
                      className="btn-link-template"
                      onClick={() => {
                        setUsarTemplate(true);
                        setForm((f) => ({
                          ...f,
                          descricao: templateTreinamentoAtual,
                        }));
                      }}
                    >
                      ✨ Usar template de treinamento
                    </button>
                  )}
              </div>
              <textarea
                value={form.descricao}
                onChange={(e) => {
                  if (!editandoId || reservaEditando || role === "master") {
                    const val = e.target.value;
                    set("descricao", val);
                    if (!val.trim()) {
                      setUsarTemplate(false);
                    }
                  }
                }}
                readOnly={editandoId && !reservaEditando ? role !== "master" : false}
                placeholder="Descreva a ocorrência com detalhes..."
                rows={Math.max(6, form.descricao.split("\n").length + 2)}
                style={
                  editandoId && !reservaEditando && role !== "master"
                    ? { opacity: 0.5, cursor: "not-allowed", resize: "none" }
                    : {}
                }
              />
              {editandoId && !reservaEditando && role !== "master" && (
                <small style={{ color: "var(--text-muted)" }}>
                  Para adicionar uma nova descrição, use{" "}
                  <b>"Incluir nova atualização"</b> nos detalhes.
                </small>
              )}
            </div>

            <div className="hist-painel-actions">
              <button className="btn-ghost" onClick={() => cancelar()} disabled={salvando}>
                Cancelar
              </button>
              <button
                className="btn-primary"
                onClick={salvar}
                disabled={salvando || (form.tipo === "Treinamento" && treinamentoIndisponivel)}
              >
                {salvando
                  ? "Salvando..."
                  : editandoId && !reservaEditando
                    ? "Atualizar"
                    : "Registrar"}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmarDescarteAberto && (
        <ConfirmarDescarteModal
          onContinuar={() => setConfirmarDescarteAberto(false)}
          onDescartar={() => cancelar({ skipConfirmacao: true })}
        />
      )}
      {followUpGateAberto && (
        <ConfirmarNovoFollowUpModal
          onConcluiuAgora={() => {
            setFollowUpGateAberto(false);
            set("tipo", "Follow up final");
          }}
          onPrecisaDeMaisUmFollowUp={() => setFollowUpGateAberto(false)}
        />
      )}
      {diasConfirmacaoEspera !== null && (
        <MotivoEsperaTreinamentoModal dias={diasConfirmacaoEspera}
          onConfirmar={responderMotivoEspera} onCancelar={() => responderMotivoEspera(null)} />
      )}
      {modalScoreAberto && (
        <div className="score-modal-overlay">
          <div className="score-modal-card">
            <div className="score-modal-header">
              <h2>Calcular Score do Cliente</h2>
              <button
                className="score-modal-fechar"
                onClick={() => setModalScoreAberto(false)}
                aria-label="Fechar score"
              >
                <X size={18} />
              </button>
            </div>

            <div className="score-modal-body">
              {/* Pergunta 1 */}
              <div className="score-pergunta">
                <label>
                  Cliente entra pelo computador? *{" "}
                  <span className="score-hint">
                    (Sim = +1.0 e zera perda / Não: 1ª vez cancela o bônus, a
                    partir da 2ª = -1.0)
                  </span>
                </label>
                <div className="radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="entraComputador"
                      value="Sim"
                      checked={respostasScore.entraComputador === "Sim"}
                      onChange={() =>
                        setRespostasScore((prev) => ({
                          ...prev,
                          entraComputador: "Sim",
                        }))
                      }
                    />
                    Sim
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="entraComputador"
                      value="Não"
                      checked={respostasScore.entraComputador === "Não"}
                      onChange={() =>
                        setRespostasScore((prev) => ({
                          ...prev,
                          entraComputador: "Não",
                        }))
                      }
                    />
                    Não
                  </label>
                </div>
              </div>

              {/* Pergunta 2 */}
              <div className="score-pergunta">
                <label>
                  Cliente compartilha a tela? *{" "}
                  <span className="score-hint">
                    (Sim = +1.0 e zera perda / Não: 1ª vez cancela o bônus, a
                    partir da 2ª = -1.0)
                  </span>
                </label>
                <div className="radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="compartilhaTela"
                      value="Sim"
                      checked={respostasScore.compartilhaTela === "Sim"}
                      onChange={() =>
                        setRespostasScore((prev) => ({
                          ...prev,
                          compartilhaTela: "Sim",
                        }))
                      }
                    />
                    Sim
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="compartilhaTela"
                      value="Não"
                      checked={respostasScore.compartilhaTela === "Não"}
                      onChange={() =>
                        setRespostasScore((prev) => ({
                          ...prev,
                          compartilhaTela: "Não",
                        }))
                      }
                    />
                    Não
                  </label>
                </div>
              </div>

              {/* Pergunta 3 */}
              <div className="score-pergunta">
                <label>
                  Cliente faz perguntas? *{" "}
                  <span className="score-hint">(Sim = +2.0 / Não = 0)</span>
                </label>
                <div className="radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="fazPerguntas"
                      value="Sim"
                      checked={respostasScore.fazPerguntas === "Sim"}
                      onChange={() =>
                        setRespostasScore((prev) => ({
                          ...prev,
                          fazPerguntas: "Sim",
                        }))
                      }
                    />
                    Sim
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="fazPerguntas"
                      value="Não"
                      checked={respostasScore.fazPerguntas === "Não"}
                      onChange={() =>
                        setRespostasScore((prev) => ({
                          ...prev,
                          fazPerguntas: "Não",
                        }))
                      }
                    />
                    Não
                  </label>
                </div>
              </div>

              {/* Pergunta 4 */}
              <div className="score-pergunta">
                <label>
                  Cliente se recorda de temas anteriores? *{" "}
                  <span className="score-hint">
                    (Sim = +2.0 e zera perda / Não: 1ª vez cancela o bônus, a
                    partir da 2ª = -3.0)
                  </span>
                </label>
                {!!selectedEmpresaObj?.scoreContadoresPerda?.recordaTemas && (
                  <span className="score-hint" style={{ display: "block" }}>
                    Perda salva: -
                    {selectedEmpresaObj.scoreContadoresPerda.recordaTemas.toFixed(
                      1,
                    )}
                  </span>
                )}
                <div className="radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="recordaTemas"
                      value="Sim"
                      checked={respostasScore.recordaTemas === "Sim"}
                      onChange={() =>
                        setRespostasScore((prev) => ({
                          ...prev,
                          recordaTemas: "Sim",
                        }))
                      }
                    />
                    Sim
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="recordaTemas"
                      value="Não"
                      checked={respostasScore.recordaTemas === "Não"}
                      onChange={() =>
                        setRespostasScore((prev) => ({
                          ...prev,
                          recordaTemas: "Não",
                        }))
                      }
                    />
                    Não
                  </label>
                </div>
                {respostasScore.recordaTemas === "Não" && (
                  <div className="hist-duvidas-temas">
                    <label>Dúvidas do cliente sobre temas anteriores:</label>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <input
                        type="text"
                        value={novaDuvidaTemaHistorico}
                        onChange={(e) =>
                          setNovaDuvidaTemaHistorico(e.target.value)
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            adicionarDuvidaTemaHistorico();
                          }
                        }}
                        placeholder="Descreva a dúvida do cliente"
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={adicionarDuvidaTemaHistorico}
                      >
                        Adicionar
                      </button>
                    </div>
                    {duvidasTemasHistorico.length > 0 && (
                      <ul className="hist-duvidas-temas-lista">
                        {duvidasTemasHistorico.map((duvida, index) => (
                          <li key={index}>
                            {duvida}
                            <button
                              type="button"
                              className="hist-duvida-tema-remover"
                              onClick={() => removerDuvidaTemaHistorico(index)}
                              title="Remover"
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {/* Pergunta 5 */}
              <div className="score-pergunta">
                <label>
                  Cliente faltou 2 dias seguidos? *{" "}
                  <span className="score-hint">(Sim = -1.0 / Não = +1.0)</span>
                </label>
                <div className="radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="faltouDoisDias"
                      value="Sim"
                      checked={respostasScore.faltouDoisDias === "Sim"}
                      onChange={() =>
                        setRespostasScore((prev) => ({
                          ...prev,
                          faltouDoisDias: "Sim",
                        }))
                      }
                    />
                    Sim
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="faltouDoisDias"
                      value="Não"
                      checked={respostasScore.faltouDoisDias === "Não"}
                      onChange={() =>
                        setRespostasScore((prev) => ({
                          ...prev,
                          faltouDoisDias: "Não",
                        }))
                      }
                    />
                    Não
                  </label>
                </div>
              </div>

              {/* Pergunta 6 */}
              <div className="score-pergunta">
                <label>
                  Cliente possui estrutura necessária? *{" "}
                  <span className="score-hint">(Sim = +1.0 / Não = 0)</span>
                </label>
                <div className="radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="estruturaNecessaria"
                      value="Sim"
                      checked={respostasScore.estruturaNecessaria === "Sim"}
                      onChange={() =>
                        setRespostasScore((prev) => ({
                          ...prev,
                          estruturaNecessaria: "Sim",
                        }))
                      }
                    />
                    Sim
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="estruturaNecessaria"
                      value="Não"
                      checked={respostasScore.estruturaNecessaria === "Não"}
                      onChange={() =>
                        setRespostasScore((prev) => ({
                          ...prev,
                          estruturaNecessaria: "Não",
                        }))
                      }
                    />
                    Não
                  </label>
                </div>
              </div>

              {/* Pergunta 7 */}
              <div className="score-pergunta">
                <label>
                  Cliente reclama do sistema? *{" "}
                  <span className="score-hint">(Sim = -3.0 / Não = +2.0)</span>
                </label>
                <div className="radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="clienteReclamante"
                      value="Sim"
                      checked={respostasScore.clienteReclamante === "Sim"}
                      onChange={() =>
                        setRespostasScore((prev) => ({
                          ...prev,
                          clienteReclamante: "Sim",
                        }))
                      }
                    />
                    Sim
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="clienteReclamante"
                      value="Não"
                      checked={respostasScore.clienteReclamante === "Não"}
                      onChange={() =>
                        setRespostasScore((prev) => ({
                          ...prev,
                          clienteReclamante: "Não",
                        }))
                      }
                    />
                    Não
                  </label>
                </div>
              </div>

              {/* Pergunta 8 */}
              <div className="score-pergunta">
                <label>
                  Cliente sumiu? *{" "}
                  <span className="score-hint">(Sim = -5.0 / Não = 0)</span>
                </label>
                <div className="radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="clienteSumido"
                      value="Sim"
                      checked={respostasScore.clienteSumido === "Sim"}
                      onChange={() =>
                        setRespostasScore((prev) => ({
                          ...prev,
                          clienteSumido: "Sim",
                        }))
                      }
                    />
                    Sim
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="clienteSumido"
                      value="Não"
                      checked={respostasScore.clienteSumido === "Não"}
                      onChange={() =>
                        setRespostasScore((prev) => ({
                          ...prev,
                          clienteSumido: "Não",
                        }))
                      }
                    />
                    Não
                  </label>
                </div>
              </div>
            </div>

            {selectedEmpresaObj &&
              obterAjustesAtivos(selectedEmpresaObj).length > 0 && (
                <div className="score-deducoes-ativas">
                  <span className="score-deducoes-titulo">
                    Reduções ativas no score deste cliente:
                  </span>
                  <ul>
                    {obterAjustesAtivos(selectedEmpresaObj).map((a, idx) => {
                      const ocorrenciasDaEmpresa = ocorrencias.filter(
                        (o) =>
                          o.empresa.trim().toLowerCase() ===
                          selectedEmpresaObj.nomeEmpresa.trim().toLowerCase(),
                      );
                      const ocorrenciaRef = encontrarOcorrenciaDoAjuste(
                        a,
                        ocorrenciasDaEmpresa,
                      );
                      return (
                        <li key={idx}>
                          -{a.valor} ponto{a.valor !== 1 ? "s" : ""}
                          {ocorrenciaRef?.idSeqFormatted && (
                            <>
                              {" "}
                              (
                              <button
                                type="button"
                                className="score-deducao-ocorrencia-link"
                                onClick={() => {
                                  setModalScoreAberto(false);
                                  setSelecionada(ocorrenciaRef);
                                }}
                                title="Ver ocorrência"
                              >
                                {ocorrenciaRef.idSeqFormatted}
                              </button>
                              )
                            </>
                          )}{" "}
                          — {a.motivo}
                          {role === "master" && (
                            <button
                              type="button"
                              className="score-deducao-remover"
                              onClick={() =>
                                removerReducaoAtiva(selectedEmpresaObj, a)
                              }
                              title="Remover apenas esta redução (mantém a ocorrência)"
                            >
                              ×
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

            <div className="score-modal-footer">
              <div className="score-calculo-previo">
                {(() => {
                  const res = calcularPontuacaoScore(
                    respostasScore,
                    selectedEmpresaObj?.scoreContadoresPerda,
                  );
                  const ajustesAtivos = selectedEmpresaObj
                    ? obterAjustesAtivos(selectedEmpresaObj)
                    : [];
                  const deducaoAtiva = ajustesAtivos.reduce(
                    (soma, a) => soma + a.valor,
                    0,
                  );
                  const totalComDeducao = res.score - deducaoAtiva;
                  return (
                    <span>
                      Total Parcial:{" "}
                      <strong>{totalComDeducao.toFixed(1)}</strong> ({res.tipo})
                      {deducaoAtiva > 0 && (
                        <span className="score-deducao-inline">
                          {" "}
                          ({res.score.toFixed(1)} - {deducaoAtiva.toFixed(1)}{" "}
                          por {descreverMotivosReducaoAtiva(ajustesAtivos)})
                        </span>
                      )}
                    </span>
                  );
                })()}
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => {
                    setCalculoScoreResult({
                      score: null,
                      tipo: "",
                      isNeutro: true,
                    });
                    setModalScoreAberto(false);
                    toast.success("Score do cliente definido como Neutro!");
                  }}
                  className="btn-score-neutro"
                >
                  Neutro
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    const possuiPerguntasNaoRespondidas =
                      respostasScore.entraComputador === "" ||
                      respostasScore.compartilhaTela === "" ||
                      respostasScore.fazPerguntas === "" ||
                      respostasScore.recordaTemas === "" ||
                      respostasScore.faltouDoisDias === "" ||
                      respostasScore.estruturaNecessaria === "" ||
                      respostasScore.clienteReclamante === "" ||
                      respostasScore.clienteSumido === "";

                    if (possuiPerguntasNaoRespondidas) {
                      toast.error(
                        "Por favor, responda a todas as perguntas para confirmar o cálculo do score.",
                      );
                      return;
                    }

                    const res = calcularPontuacaoScore(
                      respostasScore,
                      selectedEmpresaObj?.scoreContadoresPerda,
                    );
                    setCalculoScoreResult(res);
                    setModalScoreAberto(false);
                    toast.success(
                      `Score calculado: ${res.score.toFixed(1)} (${res.tipo})`,
                    );
                  }}
                >
                  Confirmar Cálculo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalDuvidasClienteAberto && (
        <div className="score-modal-overlay">
          <div className="score-modal-card hist-duvidas-cliente-card">
            <div className="score-modal-header">
              <h2>Dúvidas de {empresaFiltro}</h2>
              <button
                className="score-modal-fechar"
                onClick={() => setModalDuvidasClienteAberto(false)}
                aria-label="Fechar dúvidas do cliente"
              >
                <X size={18} />
              </button>
            </div>

            <div className="score-modal-body">
              {rankingDuvidasCliente.length === 0 ? (
                <p className="score-hint">
                  Nenhuma dúvida registrada para este cliente.
                </p>
              ) : (
                <ul className="hist-duvidas-cliente-lista">
                  {rankingDuvidasCliente.map(
                    ({ tema, contagem, origemManual }) => {
                      const indexManual = origemManual
                        ? duvidasClienteModal.findIndex(
                            (d) => d.trim() === tema,
                          )
                        : -1;
                      return (
                        <li key={tema} className="hist-duvidas-cliente-item">
                          <span className="hist-duvidas-cliente-texto">
                            {tema}
                          </span>
                          <span className="hist-duvidas-cliente-contagem">
                            {contagem}
                          </span>
                          {indexManual !== -1 && (
                            <button
                              type="button"
                              className="hist-duvidas-cliente-remover"
                              onClick={() => removerDuvidaCliente(indexManual)}
                              disabled={removendoDuvidaCliente === indexManual}
                              title="Excluir dúvida manual registrada para este tema"
                              aria-label="Excluir dúvida manual"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </li>
                      );
                    },
                  )}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Popup de Confirmação de Envio do WhatsApp */}
      {whatsappConfirmModalOpen && pendingWhatsAppMessage && (
        <div
          className="score-modal-overlay animate-fade-in"
          style={{ zIndex: 2000 }}
        >
          <div
            className="score-modal-content"
            style={{ maxWidth: "550px", width: "90%" }}
          >
            <div
              className="score-modal-header"
              style={{ marginBottom: "16px" }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: "1.25rem",
                  color: "var(--text-color, var(--lt-texto-ffffff, #ffffff))",
                  fontWeight: "700",
                }}
              >
                💬 Enviar progresso pelo WhatsApp?
              </h3>
            </div>
            <div
              className="score-modal-body"
              style={{ color: "var(--text-color, var(--lt-texto-ffffff, #ffffff))" }}
            >
              <p
                style={{
                  fontSize: "0.9rem",
                  marginBottom: "16px",
                  color: "var(--text-muted, var(--lt-texto-94a3b8, #94a3b8))",
                  lineHeight: "1.4",
                }}
              >
                Deseja enviar uma notificação para o cliente com o status
                atualizado do progresso de onboarding dele?
              </p>

              <fieldset
                className="whatsapp-destinatarios"
                disabled={sendingWhatsApp}
              >
                <legend>Para quais números deseja enviar?</legend>
                <label className="whatsapp-destinatario-opcao">
                  <input
                    type="checkbox"
                    checked={
                      destinatariosWhatsAppSelecionados.length ===
                      pendingWhatsAppMessage.destinatarios.length
                    }
                    onChange={(e) => {
                      const selecionarTodos = e.target.checked;
                      setPendingWhatsAppMessage(
                        (atual) =>
                          atual && {
                            ...atual,
                            telefonesSelecionados: selecionarTodos
                              ? atual.destinatarios.map((d) => d.telefone)
                              : [],
                          },
                      );
                    }}
                  />
                  <strong>Selecionar todos</strong>
                </label>
                <div className="whatsapp-destinatarios-lista">
                  {pendingWhatsAppMessage.destinatarios.map((d) => (
                    <label
                      key={d.telefone}
                      className="whatsapp-destinatario-opcao"
                    >
                      <input
                        type="checkbox"
                        checked={pendingWhatsAppMessage.telefonesSelecionados.includes(
                          d.telefone,
                        )}
                        onChange={(e) => {
                          const selecionado = e.target.checked;
                          setPendingWhatsAppMessage(
                            (atual) =>
                              atual && {
                                ...atual,
                                telefonesSelecionados: selecionado
                                  ? [
                                      ...new Set([
                                        ...atual.telefonesSelecionados,
                                        d.telefone,
                                      ]),
                                    ]
                                  : atual.telefonesSelecionados.filter(
                                      (telefone) => telefone !== d.telefone,
                                    ),
                              },
                          );
                        }}
                      />
                      <span>
                        <strong>{d.nome}</strong>
                        <span className="whatsapp-destinatario-numero">
                          {formatarTelefoneExibicao(d.telefone) || d.telefone}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                <p aria-live="polite" className="whatsapp-destinatarios-resumo">
                  {destinatariosWhatsAppSelecionados.length === 0
                    ? "Selecione pelo menos um número para enviar."
                    : `${destinatariosWhatsAppSelecionados.length} de ${pendingWhatsAppMessage.destinatarios.length} número(s) selecionado(s). Apenas os selecionados receberão a mensagem.`}
                </p>
              </fieldset>

              <div style={{ marginBottom: "16px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.8rem",
                    fontWeight: "600",
                    marginBottom: "6px",
                    color: "var(--text-color, var(--lt-texto-ffffff, #ffffff))",
                  }}
                >
                  Texto da Mensagem (Você pode personalizar antes de enviar)
                </label>
                <textarea
                  rows={6}
                  value={editedWhatsAppText}
                  disabled={sendingWhatsApp}
                  onChange={(e) => setEditedWhatsAppText(e.target.value)}
                  className="whatsapp-textarea"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    background: "var(--lt-fundo-ffffff08, rgba(255, 255, 255, 0.03))",
                    border:
                      "1px solid var(--border-color, var(--lt-borda-ffffff14, rgba(255,255,255,0.08)))",
                    borderRadius: "8px",
                    color: "var(--text-color, var(--lt-texto-ffffff, #ffffff))",
                    padding: "10px 14px",
                  }}
                />
                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: "0.75rem",
                    color: "var(--text-muted, var(--lt-texto-94a3b8, #94a3b8))",
                    lineHeight: "1.4",
                  }}
                >
                  Use{" "}
                  <code
                    style={{
                      background: "var(--lt-fundo-ffffff12, rgba(255,255,255,0.07))",
                      padding: "1px 5px",
                      borderRadius: "4px",
                    }}
                  >
                    {PLACEHOLDER_NOME}
                  </code>{" "}
                  onde o nome do contato deve aparecer — cada destinatário
                  recebe uma mensagem com o próprio nome.
                </p>
              </div>

              {destinatariosWhatsAppSelecionados.length > 0 &&
                editedWhatsAppText.toLowerCase().includes(PLACEHOLDER_NOME) && (
                  <div style={{ marginBottom: "16px" }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        fontWeight: "600",
                        marginBottom: "6px",
                        color: "var(--text-color, var(--lt-texto-ffffff, #ffffff))",
                      }}
                    >
                      Prévia — {destinatariosWhatsAppSelecionados.length}{" "}
                      mensagem(ns)
                    </label>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                      }}
                    >
                      {destinatariosWhatsAppSelecionados.map((d, idx) => (
                        <div
                          key={`${d.telefone}-${idx}`}
                          style={{
                            background: "var(--lt-fundo-ffffff08, rgba(255, 255, 255, 0.03))",
                            border:
                              "1px solid var(--border-color, var(--lt-borda-ffffff14, rgba(255,255,255,0.08)))",
                            borderRadius: "8px",
                            padding: "8px 12px",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "0.7rem",
                              fontWeight: 600,
                              color: "var(--text-muted, var(--lt-texto-94a3b8, #94a3b8))",
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                              marginBottom: "4px",
                            }}
                          >
                            {d.nome} ·{" "}
                            {formatarTelefoneExibicao(d.telefone) || d.telefone}
                          </div>
                          <div
                            style={{
                              fontSize: "0.8rem",
                              color: "var(--text-color, var(--lt-texto-ffffff, #ffffff))",
                              whiteSpace: "pre-wrap",
                              lineHeight: "1.4",
                            }}
                          >
                            {aplicarNomeDestinatario(
                              editedWhatsAppText,
                              d.nome,
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginTop: "10px",
                }}
              >
                <label
                  className="checkbox-label"
                  style={{
                    fontSize: "0.85rem",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={sendConveyorImage}
                    disabled={sendingWhatsApp}
                    onChange={(e) => setSendConveyorImage(e.target.checked)}
                    className="whatsapp-checkbox"
                  />
                  <span className="checkbox-custom"></span>
                  <span className="checkbox-text">
                    Incluir imagem da esteira de evolução do cliente
                  </span>
                </label>
              </div>
            </div>

            <div
              className="score-modal-footer"
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
                marginTop: "24px",
              }}
            >
              <button
                type="button"
                className="btn-secondary"
                disabled={sendingWhatsApp}
                onClick={async () => {
                  try {
                    await salvarOcorrencia({
                      id: pendingWhatsAppMessage.ocorrenciaId,
                      whatsappStatus: "nao_enviado",
                    } as Ocorrencia);
                  } catch (error) {
                    console.error(
                      "Erro ao registrar recusa de envio do WhatsApp:",
                      error,
                    );
                  }
                  setWhatsappConfirmModalOpen(false);
                  setPendingWhatsAppMessage(null);
                  await carregar();
                  setSalvando(false);
                  cancelar({ skipConfirmacao: true });
                  toast.success(
                    editandoId && !reservaEditando
                      ? "Ocorrência atualizada!"
                      : "Ocorrência registrada!",
                  );
                }}
              >
                Não enviar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={
                  sendingWhatsApp ||
                  destinatariosWhatsAppSelecionados.length === 0
                }
                style={{ display: "flex", alignItems: "center", gap: "6px" }}
                onClick={async () => {
                  if (
                    sendingWhatsApp ||
                    destinatariosWhatsAppSelecionados.length === 0
                  )
                    return;
                  setSendingWhatsApp(true);
                  try {
                    let imageBase64: string | undefined = undefined;
                    if (sendConveyorImage) {
                      toast.info(
                        "Renderizando imagem da esteira em background...",
                      );
                      imageBase64 = await generateEsteiraImage(
                        pendingWhatsAppMessage.empresaObjeto,
                      );
                    }

                    toast.info("Disparando mensagem para o WhatsApp...");
                    const resultados = await Promise.allSettled(
                      destinatariosWhatsAppSelecionados.map((d) =>
                        enviarMensagemWhatsApp({
                          to: d.telefone,
                          message: aplicarNomeDestinatario(
                            editedWhatsAppText,
                            d.nome,
                          ),
                          imageBase64,
                          filename: `esteira_${pendingWhatsAppMessage.empresaNome}.png`,
                        }),
                      ),
                    );

                    const whatsappDestinatarios =
                      destinatariosWhatsAppSelecionados.map((d, idx) => {
                        const r = resultados[idx];
                        return r.status === "fulfilled"
                          ? {
                              nome: d.nome,
                              telefone: d.telefone,
                              status: "enviado" as const,
                            }
                          : {
                              nome: d.nome,
                              telefone: d.telefone,
                              status: "falhou" as const,
                              erro: String(
                                r.reason?.message ||
                                  r.reason ||
                                  "Erro desconhecido",
                              ),
                            };
                      });

                    const falhas = resultados.filter(
                      (r) => r.status === "rejected",
                    ).length;
                    const whatsappStatus: Ocorrencia["whatsappStatus"] =
                      falhas === 0
                        ? "enviado"
                        : falhas < resultados.length
                          ? "parcial"
                          : "falhou";

                    try {
                      await salvarOcorrencia({
                        id: pendingWhatsAppMessage.ocorrenciaId,
                        whatsappStatus,
                        whatsappEnviadoEm: Date.now(),
                        whatsappDestinatarios,
                      } as Ocorrencia);
                    } catch (error) {
                      console.error(
                        "Erro ao registrar status de envio do WhatsApp:",
                        error,
                      );
                    }

                    if (falhas === 0) {
                      toast.success(
                        "Mensagem do WhatsApp enviada com sucesso!",
                      );
                    } else if (falhas < resultados.length) {
                      toast.warning(
                        `Mensagem enviada, mas falhou para ${falhas} de ${resultados.length} destinatário(s).`,
                      );
                    } else {
                      throw new Error(
                        "Falha ao enviar a mensagem para todos os destinatários.",
                      );
                    }
                  } catch (err: any) {
                    console.error(
                      "Erro ao enviar mensagem pelo WhatsApp:",
                      err,
                    );
                    toast.error(
                      `Erro ao enviar WhatsApp: ${err.message || err}`,
                    );
                  } finally {
                    setSendingWhatsApp(false);
                    setWhatsappConfirmModalOpen(false);
                    setPendingWhatsAppMessage(null);
                    await carregar();
                    setSalvando(false);
                    cancelar({ skipConfirmacao: true });
                    toast.success(
                      editandoId && !reservaEditando
                        ? "Ocorrência atualizada!"
                        : "Ocorrência registrada!",
                    );
                  }
                }}
              >
                {sendingWhatsApp
                  ? "Enviando..."
                  : `Enviar para ${destinatariosWhatsAppSelecionados.length} número(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      <GestaoNotificacaoModal
        open={gestaoConfirmModalOpen}
        titulo={
          gestaoOcorrenciaEvento === "suspenso"
            ? "⏸️ Notificar Supervisor, CS e Comercial sobre a suspensão?"
            : gestaoOcorrenciaEvento === "conclusao"
              ? "🎉 Notificar Supervisor, CS e Comercial sobre a conclusão da esteira?"
              : gestaoOcorrenciaEvento === "retorno"
                ? "🔄 Notificar Supervisor, CS e Comercial sobre o retorno à esteira?"
                : gestaoOcorrenciaEvento === "alerta_retirado"
                  ? "✅ Notificar Supervisor, CS e Comercial sobre a retirada do alerta?"
                  : "⚠️ Notificar Supervisor, CS e Comercial sobre o alerta?"
        }
        destinatarios={gestaoDestinatarios}
        avisos={gestaoAvisos}
        mensagem={gestaoMensagem}
        onChangeMensagem={setGestaoMensagem}
        onResultado={async ({ status, enviadoEm, destinatarios }) => {
          if (!gestaoOcorrenciaId) return;
          try {
            if (
              gestaoOcorrenciaEvento === "conclusao" &&
              gestaoConclusaoEmpresaId
            ) {
              await salvarEmpresas({
                id: gestaoConclusaoEmpresaId,
                ...camposResultadoConclusao({
                  status,
                  enviadoEm,
                  destinatarios,
                }),
              });
            }
            await salvarOcorrencia({
              id: gestaoOcorrenciaId,
              whatsappStatus: status,
              whatsappEnviadoEm: enviadoEm,
              whatsappDestinatarios: destinatarios,
            } as Ocorrencia);
            await carregar();
          } catch (error) {
            console.error(
              "Erro ao registrar status de envio do alerta:",
              error,
            );
            throw error;
          }
        }}
        onClose={() => {
          setGestaoConfirmModalOpen(false);
          setGestaoDestinatarios([]);
          setGestaoMensagem("");
          setGestaoOcorrenciaId(undefined);
          setGestaoConclusaoEmpresaId(undefined);
        }}
      />

      <GestaoNotificacaoModal
        open={chamadoConfirmModalOpen}
        titulo="🎫 Notificar CS sobre o chamado aberto?"
        destinatarios={chamadoDestinatarios}
        avisos={chamadoAvisos}
        mensagem={chamadoMensagem}
        onChangeMensagem={setChamadoMensagem}
        onResultado={async ({ status, enviadoEm, destinatarios }) => {
          if (!chamadoOcorrenciaId) return;
          try {
            await salvarOcorrencia({
              id: chamadoOcorrenciaId,
              chamadoWhatsappStatus: status,
              chamadoWhatsappEnviadoEm: enviadoEm,
              chamadoWhatsappDestinatarios: destinatarios,
            } as Ocorrencia);
            await carregar();
          } catch (error) {
            console.error(
              "Erro ao registrar status de envio da notificação de chamado:",
              error,
            );
            throw error;
          }
        }}
        onClose={() => {
          setChamadoConfirmModalOpen(false);
          setChamadoDestinatarios([]);
          setChamadoMensagem("");
          setChamadoOcorrenciaId(undefined);
        }}
      />
    </div>
  );
}
