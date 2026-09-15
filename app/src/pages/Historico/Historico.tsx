import { useState, useEffect, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  salvarOcorrencia,
  listarOcorrencias,
  removerOcorrencia,
} from "../../services/ocorrencias";
import {
  listarEmpresas,
  salvarEmpresas,
  isEmpresaInterna,
} from "../../services/empresas";
import {
  normalizarTelefoneWhatsApp,
  formatarTelefoneExibicao,
} from "../../utils/telefone";
import { listarUsuarios } from "../../services/auth";
import type { UsuarioDocument } from "../../services/auth";
import { enviarMensagemWhatsApp } from "../../services/whatsapp";
import {
  obterDestinatariosGestao,
  montarMensagemAlertaGestao,
  montarMensagemConclusaoEsteiraGestao,
  montarMensagemSuspensaoGestao,
  aplicarNomeDestinatario,
  PLACEHOLDER_NOME,
} from "../../services/notificacoes";
import type { DestinatarioGestao } from "../../services/notificacoes";
import { resumirOcorrencias } from "../../services/ia";
import { listarTemas, TIPOS_PADRAO_SISTEMA } from "../../services/temasOcorrencia";
import { generateEsteiraImage } from "../../utils/generateEsteiraImage";
import { GestaoNotificacaoModal } from "../../components/GestaoNotificacaoModal";

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
} from "../../types";
import "./Historico.css";
import { DoughnutChart } from "../../components/DoughnutChart";
import { BarChart } from "../../components/BarChart";
import { useAuth } from "../../context/AuthContext";
import { formatarNome } from "../../utils/formatarNome";
import {
  MOTIVO_REDUCAO_SCORE_SUPORTE,
  VALOR_REDUCAO_SCORE_SUPORTE,
  DIAS_REDUCAO_SCORE_SUPORTE,
  calcularPontuacaoScore,
  obterAjustesAtivos,
  encontrarOcorrenciaDoAjuste,
} from "../../utils/score";
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
const FILTRO_SUSPENSOES = "__suspensoes__";

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

const normalizarTema = (s: string) =>
  s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Reordena a esteira de temas: qualquer tema recém-ensinado que esteja "fora
// de sequência" (mais à frente que o próximo tema pendente) é puxado para
// ficar logo após o último tema já ensinado — mantendo os temas ensinados
// sempre como um prefixo contíguo, mesmo quando são ensinados em ocorrências
// separadas (uma por vez), e não só quando vários são marcados de uma vez na
// mesma ocorrência.
// Ex.: temas ensinados hoje = [Videotelemetria], já ensinados antes = [0,1] →
// Videotelemetria (originalmente na posição 6) é movido para a posição 2.
//
// "Início" e "Conclusão" são âncoras fixas: independentemente de onde estejam
// cadastradas na esteira, "Início" é sempre tratada como o primeiro tema e
// "Conclusão" como o último — nunca entram no embaralhamento acima, e nenhum
// outro tema pode ser puxado para antes de "Início" ou para depois de "Conclusão".
function reordenarTemasEnsinados(
  linhasTema: string[],
  linhasData: string[],
  indicesEnsinados: number[],
  dataStr: string,
): { newTemas: string[]; newDatas: string[]; ultimoIndice: number } {
  const idxInicio = linhasTema.findIndex((t) => normalizarTema(t) === "inicio");
  const idxConclusao = linhasTema.findIndex(
    (t) => normalizarTema(t) === "conclusao",
  );

  const inicioItem =
    idxInicio !== -1
      ? { tema: linhasTema[idxInicio], data: linhasData[idxInicio] ?? "" }
      : null;
  const conclusaoItem =
    idxConclusao !== -1
      ? { tema: linhasTema[idxConclusao], data: linhasData[idxConclusao] ?? "" }
      : null;

  // "Meio": todos os temas exceto as âncoras fixas — é nele que a reordenação por sequência ocorre
  const newTemas = linhasTema.filter(
    (_, idx) => idx !== idxInicio && idx !== idxConclusao,
  );
  const newDatas = linhasTema
    .map((_, idx) => idx)
    .filter((idx) => idx !== idxInicio && idx !== idxConclusao)
    .map((idx) => linhasData[idx] ?? "");

  // Fronteira atual: primeiro índice (dentro do meio) ainda sem data
  let frontIndex = 0;
  while (frontIndex < newDatas.length && newDatas[frontIndex].trim() !== "") {
    frontIndex++;
  }

  // Processa os temas ensinados nesta ocorrência em ordem crescente de índice original
  const indicesOrdenados = [...indicesEnsinados].sort((a, b) => a - b);

  for (const idxOriginal of indicesOrdenados) {
    const temaAlvo = linhasTema[idxOriginal];
    const normalizado = normalizarTema(temaAlvo);

    if (normalizado === "inicio") {
      if (inicioItem && inicioItem.data.trim() === "")
        inicioItem.data = dataStr;
      continue;
    }
    if (normalizado === "conclusao") {
      if (conclusaoItem && conclusaoItem.data.trim() === "")
        conclusaoItem.data = dataStr;
      continue;
    }

    const posAtual = newTemas.findIndex(
      (t) => normalizarTema(t) === normalizado,
    );

    if (posAtual === -1 || posAtual < frontIndex) {
      // Já processado/ensinado antes (ou tema duplicado) — não retrocede a fronteira
      continue;
    }

    newDatas[posAtual] = dataStr;

    if (posAtual > frontIndex) {
      const [tRemovido] = newTemas.splice(posAtual, 1);
      const [dRemovido] = newDatas.splice(posAtual, 1);
      newTemas.splice(frontIndex, 0, tRemovido);
      newDatas.splice(frontIndex, 0, dRemovido);
    }

    frontIndex++;
  }

  const temasFinais = [
    ...(inicioItem ? [inicioItem.tema] : []),
    ...newTemas,
    ...(conclusaoItem ? [conclusaoItem.tema] : []),
  ];
  const datasFinais = [
    ...(inicioItem ? [inicioItem.data] : []),
    ...newDatas,
    ...(conclusaoItem ? [conclusaoItem.data] : []),
  ];

  // Última posição (no array final) que faz parte do progresso já concluído.
  // "Início" conta como concluída assim que ocupa a posição fixa (não trava o
  // progresso dos demais temas por falta da própria data — empresas antigas
  // podem nunca ter tido essa data preenchida). "Conclusão" só conta quando
  // todos os temas do meio já estiverem preenchidos E ela própria tiver data.
  let ultimoIndice = (inicioItem ? 1 : 0) + frontIndex - 1;
  if (
    conclusaoItem &&
    conclusaoItem.data.trim() !== "" &&
    frontIndex === newTemas.length
  ) {
    ultimoIndice = temasFinais.length - 1;
  }

  return { newTemas: temasFinais, newDatas: datasFinais, ultimoIndice };
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
          <span style={{ color: "#a5b4fc" }}>•</span>
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

const TEMPLATE_TREINAMENTO = `Participantes: \n\nNOTA: \n\nRelatório de treinamento:\n\n• Cliente se manteve atento? \n• Cliente absorveu o conteúdo aplicado?\n• Cliente foi participativo?\n• Houve alguma interrupção?\n• Ambiente favorável (Som)?\n• Manifestou alguma insatisfação?\n• Treinamento foi gravado?\n\nRelatório do atendimento:\n\nE-mail: \nExperiência boa ou ruim?:\nTexto: `;

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
  treinamentoTempoAgenda: "",
  treinamentoSolicitante: "CS",
  treinamentoNotas: [],
  treinamentoResultados: [],
  createdAt: "",
  horaCriacao: "",
  retornarEsteira: false,
  suspenderCliente: false,
  temaForaEsteira: false,
};

interface ScoreFormAnswers {
  facilContato: "Sim" | "Não" | "";
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
  facilContato: "",
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

  const descreverFacilContato = (val: string) => {
    if (val === "Sim") return "Contato fácil";
    if (val === "Não") return "Difícil contato";
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
    if (val === "Sim") return "Cliente é reclamante";
    if (val === "Não") return "Cliente não é reclamante";
    return "Não respondido";
  };

  const descreverSumico = (val: string) => {
    if (val === "Sim") return "Cliente sumiu";
    if (val === "Não") return "Cliente não sumiu";
    return "Não respondido";
  };

  if (antigo.facilContato !== novo.facilContato) {
    mudancas.push(
      `- Contato com o cliente: de "${descreverFacilContato(antigo.facilContato)}" para "${descreverFacilContato(novo.facilContato)}"`,
    );
  }
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
      `- Cliente é reclamante: de "${descreverReclamante(antigo.clienteReclamante)}" para "${descreverReclamante(novo.clienteReclamante)}"`,
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

  const descreverFacilContato = (val: string) => {
    if (val === "Sim") return "Contato fácil";
    if (val === "Não") return "Difícil contato";
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
    if (val === "Sim") return "Cliente é reclamante";
    if (val === "Não") return "Cliente não é reclamante";
    return "Não respondido";
  };

  const descreverSumico = (val: string) => {
    if (val === "Sim") return "Cliente sumiu";
    if (val === "Não") return "Cliente não sumiu";
    return "Não respondido";
  };

  return [
    `- Contato com o cliente: "${descreverFacilContato(respostas.facilContato)}"`,
    `- Cliente entra pelo computador: "${descreverEntraComputador(respostas.entraComputador)}"`,
    `- Cliente compartilha a tela: "${descreverSimNao(respostas.compartilhaTela)}"`,
    `- Cliente faz perguntas: "${descreverSimNao(respostas.fazPerguntas)}"`,
    `- Cliente se recorda de temas anteriores: "${descreverSimNao(respostas.recordaTemas)}"`,
    `- Cliente faltou 2 dias seguidos: "${descreverFaltouDoisDias(respostas.faltouDoisDias)}"`,
    `- Cliente possui estrutura necessária: "${descreverEstrutura(respostas.estruturaNecessaria)}"`,
    `- Cliente é reclamante: "${descreverReclamante(respostas.clienteReclamante)}"`,
    `- Cliente sumiu: "${descreverSumico(respostas.clienteSumido)}"`,
  ];
}

export function Historico() {
  const { role, userName, user } = useAuth();
  const isTreinador = role === "treinador" || role === "master";
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
  const [duvidaOpcoes, setDuvidaOpcoes] = useState<string[]>(
    DUVIDA_OPCOES_PADRAO,
  );
  const [solicitacaoOpcoes, setSolicitacaoOpcoes] = useState<string[]>(
    SOLICITACAO_OPCOES_PADRAO,
  );
  // Lista completa de tipos de ocorrência, vinda do Firestore (coleção
  // "temasOcorrencia", categoria "tipo"). Inclui tanto os tipos originais do
  // sistema quanto os personalizados — todos livremente editáveis/excluíveis
  // em /tipos-ocorrencia. TIPOS_PADRAO serve só de valor inicial (antes do
  // primeiro carregamento) para a tela não aparecer vazia.
  const [tipos, setTipos] = useState<string[]>(TIPOS_PADRAO);

  useEffect(() => {
    listarTemas("duvida")
      .then((lista) => setDuvidaOpcoes(lista.map((t) => t.nome)))
      .catch((error) =>
        console.error("Erro ao carregar assuntos de dúvida:", error),
      );
    listarTemas("solicitacao")
      .then((lista) => setSolicitacaoOpcoes(lista.map((t) => t.nome)))
      .catch((error) =>
        console.error("Erro ao carregar assuntos de solicitação:", error),
      );
    listarTemas("tipo")
      .then((lista) => setTipos(lista.map((t) => t.nome)))
      .catch((error) =>
        console.error("Erro ao carregar tipos de ocorrência:", error),
      );
  }, []);

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
    empresaNome: string;
    temas: string[];
    dataStr: string;
    empresaObjeto: Empresa;
  } | null>(null);
  const [editedWhatsAppText, setEditedWhatsAppText] = useState("");
  const [sendConveyorImage, setSendConveyorImage] = useState(true);
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);

  // Notificação de Gestão (Alerta -> Supervisor + CS Responsável) via WhatsApp
  const [gestaoConfirmModalOpen, setGestaoConfirmModalOpen] = useState(false);
  const [gestaoDestinatarios, setGestaoDestinatarios] = useState<
    DestinatarioGestao[]
  >([]);
  const [gestaoAvisos, setGestaoAvisos] = useState<string[]>([]);
  const [gestaoMensagem, setGestaoMensagem] = useState("");
  const [gestaoOcorrenciaId, setGestaoOcorrenciaId] = useState<
    string | undefined
  >(undefined);

  const [novaAtualizacaoAberta, setNovaAtualizacaoAberta] = useState(false);
  const [novaDescricaoAtual, setNovaDescricaoAtual] = useState("");
  const [editingUpdateIdx, setEditingUpdateIdx] = useState<number | null>(null);
  const [editingUpdateText, setEditingUpdateText] = useState("");
  const [novoResponsavelAtual, setNovoResponsavelAtual] = useState("");
  const [empresasList, setEmpresasList] = useState<Empresa[]>([]);
  const [usuariosList, setUsuariosList] = useState<UsuarioDocument[]>([]);
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([]);
  const [selecionada, setSelecionada] = useState<Ocorrencia | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [buscaAssunto, setBuscaAssunto] = useState("");
  const [filtroTipo, setFiltroTipo] = useState(
    () => searchParams.get("tipo") || "",
  );
  const [filtroDepto, setFiltroDepto] = useState("");
  const [dataInicio, setDataInicio] = useState(
    () => searchParams.get("dataInicio") || "",
  );
  const [dataFim, setDataFim] = useState(
    () => searchParams.get("dataFim") || "",
  );
  const [ordenacaoData, setOrdenacaoData] = useState<"desc" | "asc">("desc");
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [painelAberto, setPainelAberto] = useState(false);
  const [usarTemplate, setUsarTemplate] = useState(true);
  const [temaOcorrenciaOngoingText, setTemaOcorrenciaOngoingText] =
    useState("");
  const [isRevisao, setIsRevisao] = useState(false);
  const [temaForaEsteira, setTemaForaEsteira] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 50;

  useEffect(() => {
    const tipo = searchParams.get("tipo") || "";
    const start = searchParams.get("dataInicio") || "";
    const end = searchParams.get("dataFim") || "";
    setFiltroTipo(tipo);
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
  const ocorrenciaIdFiltro = searchParams.get("ocorrencia") || "";
  const expedienteFiltro = searchParams.get("expediente") || "";

  useEffect(() => {
    setCurrentPage(1);
  }, [
    busca,
    filtroTipo,
    filtroDepto,
    dataInicio,
    dataFim,
    empresaFiltro,
    expedienteFiltro,
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

  async function carregar() {
    setLoading(true);
    const [ocLista, empLista, usrLista] = await Promise.all([
      listarOcorrencias(),
      listarEmpresas(),
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
    return enriquecidas;
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
    copy[index] = {
      ...copy[index],
      descricao: editingUpdateText.trim(),
      updatedAt: Date.now(),
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

  useEffect(() => {
    carregar();
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
        setTemaOcorrenciaOngoingText("");
      }
      if (
        campo === "tipo" &&
        f.tipo !== valor &&
        (f.tipo === "Treinamento" || f.tipo === "Dúvida")
      ) {
        next.temaOcorrencia = [];
        setTemaOcorrenciaOngoingText("");
      }
      return next;
    });
  }

  function abrirNovo() {
    const deptos = getAllowedDepartments();
    const deptoPadrao = deptos.length === 1 ? deptos[0] : "";
    setForm({
      ...EMPTY,
      empresa: empresaFiltro || "",
      responsavel: userName,
      departamento: deptoPadrao,
    });
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
    setTemaForaEsteira(false);
  }

  function abrirEdicao(o: Ocorrencia) {
    let dataFormatada = "";
    let hora = "";

    if (o.dataOcorrencia && o.dataOcorrencia > 0 && !isNaN(o.dataOcorrencia)) {
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

    setForm({
      empresa: o.empresa,
      tipo: o.tipo,
      descricao: o.descricao,
      responsavel: o.responsavel,
      departamento: o.departamento ?? "",
      dataOcorrencia: dataFormatada,
      horaOcorrencia: hora,
      temaOcorrencia: o.temaOcorrencia ?? [],
      alerta: o.alerta ?? false,
      retirarAlerta: o.retirarAlerta ?? false,
      alertaResolvidoPorId: o.alertaResolvidoPorId || "",
      alertaOriginalId: o.alertaOriginalId || "",
      gamificacaoPontoId: o.gamificacaoPontoId || "",
      treinamentoDataSolicitacao: o.treinamentoDataSolicitacao || "",
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
    });
    setTemaOcorrenciaOngoingText(o.temaOcorrencia?.join(", ") ?? "");
    setBuscaAssunto("");
    setEditandoId(o.id ?? null);
    setCalculoScoreResult(null);
    setRespostasScore({ ...INITIAL_SCORE_ANSWERS });
    setDuvidasTemasHistorico([]);
    setNovaDuvidaTemaHistorico("");
    setPainelAberto(true);
    setIsRevisao(o.isRevisao ?? false);
    setTemaForaEsteira(o.temaForaEsteira ?? false);
  }

  function cancelar() {
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
  }

  function normalizar(str: string) {
    return str.trim().toLowerCase().replace(/&amp;/g, "&").replace(/\s+/g, " ");
  }

  async function salvar() {
    const responsavelFinal = formatarNome(
      editandoId ? form.responsavel : userName,
    );

    if (
      !form.empresa.trim() ||
      !form.tipo ||
      !form.departamento ||
      !form.descricao.trim()
    ) {
      toast.error("Preencha empresa, tipo, departamento e descrição.");
      return;
    }

    const empresaObjeto = empresasList.find(
      (e) => normalizar(e.nomeEmpresa) === normalizar(form.empresa),
    );

    if (!empresaObjeto) {
      toast.error(
        "A empresa especificada não foi encontrada. Selecione uma empresa cadastrada válida.",
      );
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

    const ocorrenciaOriginal = editandoId
      ? ocorrencias.find((o) => o.id === editandoId)
      : null;

    const novaDescricao = form.descricao.trim();

    let dataRealizacaoStr = "";
    // Dado antigo (modelo de nota 1 a 5): preservado como está no registro
    // original quando em edição, já que o formulário não permite mais editá-lo.
    const computedMedia: number | null =
      ocorrenciaOriginal?.treinamentoNotaMedia ?? null;
    const validNotas: number[] = ocorrenciaOriginal?.treinamentoNotas ?? [];
    // Dado atual (modelo Bom/Ruim)
    const validResultados = (form.treinamentoResultados ?? []).filter(
      (r): r is "Bom" | "Ruim" => r === "Bom" || r === "Ruim",
    );

    if (form.tipo === "Treinamento") {
      let d: Date;
      if (editandoId && ocorrenciaOriginal?.createdAt) {
        d = new Date(ocorrenciaOriginal.createdAt);
      } else {
        d = new Date();
      }
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      dataRealizacaoStr = `${year}-${month}-${day}`;
    }

    // Quando for revisão, os temas recebem prefixo "Revisão de" (exceto Ausente/Cancelado)
    const temaOcorrenciaFinal =
      form.tipo === "Treinamento" && isRevisao
        ? (form.temaOcorrencia ?? []).map((t) =>
            t.trim().toLowerCase() === "ausente" ||
            t.trim().toLowerCase() === "cancelado"
              ? t
              : `Revisão de ${t}`,
          )
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
    }

    const base: Ocorrencia = {
      ...form,
      createdAt: finalCreatedAt,
      empresa: form.empresa.trim(),
      descricao: novaDescricao,
      responsavel: responsavelFinal,
      dataOcorrencia: timestamp,
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
      isRevisao: form.tipo === "Treinamento" ? isRevisao : undefined,
      temaForaEsteira:
        form.tipo === "Treinamento" ? temaForaEsteira : undefined,
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

    setSalvando(true);

    if (calculoScoreResult) {
      const antigoScore = empresaObjeto.score;
      const antigoTipo = empresaObjeto.tipo;
      const novoScore = calculoScoreResult.score;
      const novoTipo = calculoScoreResult.tipo;

      // Atualiza a empresa
      await salvarEmpresas({
        ...empresaObjeto,
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
        treinamentoDataRealizacao: dataRealizacaoStr,
        treinamentoTempoAgenda: (form.treinamentoTempoAgenda || "").trim(),
        treinamentoSolicitante: form.treinamentoSolicitante || "",
        treinamentoNotas: validNotas,
        treinamentoNotaMedia: computedMedia,
        treinamentoResultados: validResultados,
      };

      if (pontoId) {
        try {
          await atualizarLancamentoPonto(pontoId, {
            ...lancamentoDados,
            ...(finalCreatedAt !== undefined
              ? { dataLancamento: finalCreatedAt }
              : {}),
          });
        } catch (error) {
          console.error("Erro ao atualizar lançamento de ponto:", error);
          pontoId = await salvarLancamentoPonto({
            ...lancamentoDados,
            ...(finalCreatedAt !== undefined
              ? { dataLancamento: finalCreatedAt }
              : {}),
          });
        }
      } else {
        pontoId = await salvarLancamentoPonto({
          ...lancamentoDados,
          ...(finalCreatedAt !== undefined
            ? { dataLancamento: finalCreatedAt }
            : {}),
        });
      }

      base.gamificacaoPontoId = pontoId;
    } else if (ocorrenciaOriginal?.gamificacaoPontoId) {
      try {
        await removerLancamentoPonto(ocorrenciaOriginal.gamificacaoPontoId);
      } catch (error) {
        console.error("Erro ao remover lançamento de ponto anterior:", error);
      }
      base.gamificacaoPontoId = "";
    }

    const savedId = await salvarOcorrencia(
      editandoId ? { ...base, id: editandoId } : base,
    );

    // Notificações automáticas (best-effort — erros não bloqueiam o fluxo)
    // Alerta: notifica quando a ocorrência *vira* alerta, seja ao criar ou ao editar.
    // Comparar com o estado anterior evita renotificar a cada salvamento de uma
    // ocorrência que já era alerta.
    if (form.alerta && !ocorrenciaOriginal?.alerta && !empresaInterna) {
      const empresaObjetoAlerta = empresasList.find(
        (e) => normalizar(e.nomeEmpresa) === normalizar(form.empresa),
      );
      if (empresaObjetoAlerta) {
        obterDestinatariosGestao(empresaObjetoAlerta)
          .then(({ destinatarios, avisos }) => {
            if (destinatarios.length === 0) return;
            setGestaoDestinatarios(destinatarios);
            setGestaoAvisos(avisos);
            setGestaoMensagem(
              montarMensagemAlertaGestao(empresaObjetoAlerta, savedId),
            );
            setGestaoOcorrenciaId(savedId);
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

    // Contato com o Suporte para tirar dúvida reduz temporariamente o score do
    // cliente (best-effort — não bloqueia o fluxo, e só na criação, para não
    // reaplicar a redução a cada edição da mesma ocorrência).
    if (
      !editandoId &&
      !empresaInterna &&
      form.departamento === "Suporte" &&
      form.tipo === "Dúvida" &&
      empresaObjeto
    ) {
      try {
        const agora = Date.now();
        const ajustesAtivos = (
          empresaObjeto.scoreAjustesTemporarios || []
        ).filter((a) => a.expiraEm > agora);
        await salvarEmpresas({
          id: empresaObjeto.id,
          scoreAjustesTemporarios: [
            ...ajustesAtivos,
            {
              motivo: MOTIVO_REDUCAO_SCORE_SUPORTE,
              valor: VALOR_REDUCAO_SCORE_SUPORTE,
              criadoEm: agora,
              expiraEm:
                agora + DIAS_REDUCAO_SCORE_SUPORTE * 24 * 60 * 60 * 1000,
              ocorrenciaId: savedId,
            },
          ],
        });
      } catch (error) {
        console.error("Erro ao aplicar redução temporária de score:", error);
      }
    }

    if (form.retornarEsteira) {
      try {
        // Ao retornar da esteira Suspensos, soma o tempo congelado ao acumulado
        // para que os dias suspensos não voltem a contar em calcularDiasNaEsteira.
        let diasSuspensoAcumulado = empresaObjeto.diasSuspensoAcumulado || 0;
        if (empresaObjeto.dataSuspensao) {
          const [sYear, sMonth, sDay] = empresaObjeto.dataSuspensao
            .split("-")
            .map(Number);
          const inicio = new Date(sYear, sMonth - 1, sDay);
          const hoje = new Date();
          diasSuspensoAcumulado += Math.max(
            0,
            Math.floor(
              (hoje.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24),
            ),
          );
        }

        await salvarEmpresas({
          ...empresaObjeto,
          ...(!!form.alerta !== !!empresaObjeto.alerta || form.retirarAlerta
            ? { alerta: !!form.alerta }
            : {}),
          isSuspended: false,
          dataSuspensao: undefined,
          diasSuspensoAcumulado,
          updatedAt: Date.now(),
        });
      } catch (error) {
        console.error("Erro ao remover suspensão da empresa:", error);
      }
    } else if (form.suspenderCliente && !empresaObjeto.isSuspended) {
      try {
        const hoje = new Date();
        const dataSuspensao = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;

        const empresaSuspensa: Empresa = {
          ...empresaObjeto,
          ...(!!form.alerta !== !!empresaObjeto.alerta || form.retirarAlerta
            ? { alerta: !!form.alerta }
            : {}),
          isSuspended: true,
          dataSuspensao,
          updatedAt: Date.now(),
        };

        await salvarEmpresas(empresaSuspensa);

        // Notifica Supervisor + CS Responsável sobre a suspensão originada pela ocorrência
        obterDestinatariosGestao(empresaSuspensa)
          .then(({ destinatarios, avisos }) => {
            if (destinatarios.length === 0) return;
            setGestaoDestinatarios(destinatarios);
            setGestaoAvisos(avisos);
            setGestaoMensagem(montarMensagemSuspensaoGestao(empresaSuspensa));
            setGestaoOcorrenciaId(savedId);
            setGestaoConfirmModalOpen(true);
          })
          .catch((err) =>
            console.error(
              "[notificações] Falha ao montar destinatários de suspensão:",
              err,
            ),
          );
      } catch (error) {
        console.error("Erro ao suspender empresa a partir da ocorrência:", error);
      }
    } else if (!!form.alerta !== !!empresaObjeto.alerta || form.retirarAlerta) {
      try {
        await salvarEmpresas({
          ...empresaObjeto,
          alerta: !!form.alerta,
          updatedAt: Date.now(),
        });
      } catch (error) {
        console.error(
          "Erro ao sincronizar status de alerta na empresa:",
          error,
        );
      }
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

    // Avança a esteira automaticamente quando o treinamento tem temas válidos e não é uma revisão
    if (
      form.tipo === "Treinamento" &&
      !isRevisao &&
      !isSelectedEmpresaOngoing &&
      !temaForaEsteira &&
      !empresaInterna &&
      empresaObjeto
    ) {
      const temasValidos = (form.temaOcorrencia ?? []).filter(
        (t) =>
          t.trim().toLowerCase() !== "ausente" &&
          t.trim().toLowerCase() !== "cancelado",
      );

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
            ultimoIndice === linhasTema.length - 1 &&
            !empresaObjeto.dataFinalizacao &&
            !empresaObjeto.isOngoing;

          const empresaAtualizadaEsteira: Empresa = {
            ...empresaObjeto,
            // Preserva o score/tipo que possa ter sido atualizado mais cedo neste mesmo salvar()
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
            currentPhase: Math.max(
              empresaObjeto.currentPhase ?? 0,
              ultimoIndice,
            ),
            ...(concluiuAgora ? { dataFinalizacao: dataRealizacaoStr } : {}),
            updatedAt: Date.now(),
          };

          await salvarEmpresas(empresaAtualizadaEsteira);

          if (concluiuAgora) {
            obterDestinatariosGestao(empresaAtualizadaEsteira)
              .then(({ destinatarios, avisos }) => {
                if (destinatarios.length === 0) return;
                setGestaoDestinatarios(destinatarios);
                setGestaoAvisos(avisos);
                setGestaoMensagem(
                  montarMensagemConclusaoEsteiraGestao(
                    empresaAtualizadaEsteira,
                    savedId,
                  ),
                );
                setGestaoConfirmModalOpen(true);
              })
              .catch((err) =>
                console.error(
                  "[notificações] Falha ao montar destinatários de conclusão:",
                  err,
                ),
              );
          }
        }
      }
    }

    // Fluxo de Disparo do WhatsApp — só oferece o envio ao criar a ocorrência.
    // Em edições (ex.: apenas corrigir data/hora), não repete a oferta para não
    // sobrescrever o status de envio já registrado na criação original.
    const temasValidos =
      !editandoId &&
      form.tipo === "Treinamento" &&
      !isRevisao &&
      empresaObjeto &&
      !empresaInterna
        ? (form.temaOcorrencia ?? []).filter(
            (t) =>
              t.trim().toLowerCase() !== "ausente" &&
              t.trim().toLowerCase() !== "cancelado",
          )
        : [];

    if (
      !editandoId &&
      form.tipo === "Treinamento" &&
      !isRevisao &&
      !temaForaEsteira &&
      empresaObjeto &&
      !empresaObjeto.isOngoing &&
      !empresaInterna &&
      temasValidos.length > 0
    ) {
      const contatosBase =
        empresaObjeto.contatos && empresaObjeto.contatos.length > 0
          ? empresaObjeto.contatos
          : empresaObjeto.telefone || empresaObjeto.contato
            ? [
                {
                  nome: empresaObjeto.contato || "",
                  telefone: empresaObjeto.telefone || "",
                },
              ]
            : [];

      const destinatarios = contatosBase
        .map((c) => ({
          nome: c.nome || "Cliente",
          telefone: normalizarTelefoneWhatsApp(c.telefone),
        }))
        .filter((c) => c.telefone);

      if (destinatarios.length === 0) {
        toast.warning(
          "Ocorrência registrada! No entanto, o cliente não possui telefone de contato cadastrado para envio do WhatsApp.",
        );
        await carregar();
        setSalvando(false);
        cancelar();
        toast.success(
          editandoId ? "Ocorrência atualizada!" : "Ocorrência registrada!",
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

        const temasValidosNorm = temasValidos.map(normTema);
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
      cancelar();
      toast.success(
        editandoId ? "Ocorrência atualizada!" : "Ocorrência registrada!",
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

            if (ehMudancaScore || temScore) {
              const empresaObjeto = empresasList.find(
                (e) => normalizar(e.nomeEmpresa) === normalizar(oc.empresa),
              );
              if (empresaObjeto) {
                await salvarEmpresas({
                  ...empresaObjeto,
                  score: null as any,
                  scoreAnswers: null as any,
                  tipo: "",
                  updatedAt: Date.now(),
                });
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

  const getAllowedTypes = () => {
    const base = (() => {
      if (role === "master") {
        return [
          "Informativa",
          "Financeira",
          "Comercial",
          "Treinamento",
          "Checkpoint",
          "Problema",
          "Dúvida",
          "Solicitação",
          "Gol",
        ];
      }
      if (role === "treinador") {
        return [
          "Informativa",
          "Treinamento",
          "Checkpoint",
          "Dúvida",
          "Solicitação",
          "Gol",
        ];
      }
      if (role === "suporte") {
        return ["Informativa", "Problema", "Dúvida", "Solicitação"];
      }
      if (role === "hardware") {
        return ["Informativa"];
      }
      if (role === "comercial") {
        return ["Comercial", "Informativa"];
      }
      if (role === "financeiro") {
        return ["Financeira", "Informativa"];
      }
      if (role === "cs") {
        return ["Informativa", "Financeira", "Comercial"];
      }
      return [];
    })();

    if (base.length === 0) return [];

    // "tipos" reflete o que está cadastrado em /tipos-ocorrencia agora (pode
    // ter itens renomeados/excluídos desde a curadoria acima). Mantemos só os
    // nomes ainda existentes e acrescentamos qualquer tipo que não faça parte
    // da lista original do sistema (novo ou renomeado) — esses ficam
    // disponíveis para qualquer perfil que já tenha acesso ao Histórico.
    const baseDisponivel = base.filter((t) => tipos.includes(t));
    const extras = tipos.filter((t) => !TIPOS_PADRAO_SISTEMA.includes(t));
    return [...baseDisponivel, ...extras];
  };

  const getAllowedDepartments = () => {
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

  const obterFiltradas = (ignoreTipo = false, ignoreDepto = false) => {
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

      const tipoOk =
        ignoreTipo ||
        !filtroTipo ||
        (filtroTipo === FILTRO_ALERTAS
          ? !!o.alerta
          : filtroTipo === FILTRO_SUSPENSOES
            ? !!o.suspenderCliente
            : o.tipo === filtroTipo);
      const deptoOk =
        ignoreDepto || !filtroDepto || o.departamento === filtroDepto;

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
        bateBusca && empresaOk && tipoOk && deptoOk && dataOk && expedienteOk
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
    filtroDepto,
    dataInicio,
    dataFim,
    empresaFiltro,
    expedienteFiltro,
    ordenacaoData,
  ]);

  const filtradasSemTipo = useMemo(
    () => obterFiltradas(true, false),
    [
      ocorrencias,
      busca,
      filtroDepto,
      dataInicio,
      dataFim,
      empresaFiltro,
      expedienteFiltro,
    ],
  );
  const filtradasSemDepto = useMemo(
    () => obterFiltradas(false, true),
    [
      ocorrencias,
      busca,
      filtroTipo,
      dataInicio,
      dataFim,
      empresaFiltro,
      expedienteFiltro,
    ],
  );

  const selectedEmpresaObj = empresasList.find(
    (e) => normalizar(e.nomeEmpresa) === normalizar(form.empresa),
  );
  const isSelectedEmpresaOngoing = selectedEmpresaObj?.isOngoing ?? false;

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
      label,
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

    filtradasSemTipo
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
  }, [filtradasSemTipo, duvidaOpcoes]);

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
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
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
                background: dashboardAberto ? "#475569" : "#0f2a5e",
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
                background: painelIaAberto ? "#4c1d95" : "#2e1065",
              }}
            >
              ✨ {painelIaAberto ? "Fechar Resumo IA" : "Resumir com IA"}
            </button>
            <button
              className="btn-secondary btn-dashboard-toggle"
              onClick={exportarParaExcel}
              title="Exportar ocorrências filtradas para Excel"
              style={{ background: "#107c41" }}
            >
              📥 Exportar Excel
            </button>
            <button className="btn-primary hist-btn-novo" onClick={abrirNovo}>
              + Nova ocorrência
            </button>
          </div>
        </div>
      </header>

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
                  onItemClick={(tipo) =>
                    setFiltroTipo((prev) => (prev === tipo ? "" : tipo))
                  }
                  selectedLabel={filtroTipo}
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
              />

              <BarChart
                title="Assuntos das Dúvidas Registradas"
                data={duvidaTemasChartData}
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

          <select
            className="hist-select-filtro"
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
          >
            <option value="">Todos os tipos</option>
            <option value={FILTRO_ALERTAS}>Alertas 🔥</option>
            <option value={FILTRO_SUSPENSOES}>Suspensões ⏸️</option>
            {tipos.filter((t) => t !== "Gol" || isTreinador).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

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
                setFiltroDepto("");
                setDataInicio("");
                setDataFim("");
                if (
                  empresaFiltro ||
                  expedienteFiltro ||
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
      <div className="hist-table-wrapper">
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
                      {o.alerta &&
                        (o.alertaResolvidoPorId ? (
                          <span
                            style={{
                              color: "#16a34a",
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
                            color: "#16a34a",
                            fontWeight: "bold",
                            marginLeft: "6px",
                          }}
                          title="Ocorrência de resolução de alerta"
                        >
                          ✅
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
                            style={{ color: "#16a34a", fontWeight: "bold" }}
                            title={`Enviado${o.whatsappEnviadoEm ? " em " + new Date(o.whatsappEnviadoEm).toLocaleString("pt-BR") : ""}`}
                          >
                            ✅ Enviado
                          </span>
                        )}
                        {o.whatsappStatus === "parcial" && (
                          <span
                            style={{ color: "#d97706", fontWeight: "bold" }}
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
                              color: "#16a34a",
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
                            color: "#16a34a",
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
                  selecionada.tipo !== "Dúvida" && (
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

                {selecionada.tipo === "Treinamento" && (
                  <>
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
                    {selecionada.treinamentoSolicitante && (
                      <div>
                        <span>Solicitante</span>
                        <strong>{selecionada.treinamentoSolicitante}</strong>
                      </div>
                    )}
                    {selecionada.treinamentoResultados &&
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
                    {selecionada.treinamentoNotas &&
                      selecionada.treinamentoNotas.length > 0 && (
                        <div className="hist-detail-training-notes-wrapper">
                          <span>
                            Notas do Treinamento (CSAT, modelo antigo)
                          </span>
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
                        </div>
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
                onClick={cancelar}
                aria-label="Fechar painel"
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
              form.tipo === "Problema" ||
              form.tipo === "Dúvida") && (
              <div className="hist-campo hist-campo-row">
                <div>
                  <label>
                    {(() => {
                      if (form.tipo === "Problema" || form.tipo === "Dúvida") {
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
              <label>Tipo de ocorrência *</label>
              <select
                value={form.tipo}
                onChange={(e) => set("tipo", e.target.value)}
              >
                <option value="">Selecione...</option>
                {getAllowedTypes().map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {!editandoId &&
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
                  {duvidaOpcoes.filter((opcao) =>
                    opcao
                      .toLowerCase()
                      .includes(buscaAssunto.trim().toLowerCase()),
                  ).map((opcao) => (
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
                <label>Temas abordados</label>

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
                        : "rgba(255,255,255,0.04)",
                      border: isRevisao
                        ? "1px solid rgba(99,102,241,0.4)"
                        : "1px solid rgba(255,255,255,0.08)",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                      fontWeight: isRevisao ? 600 : 400,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isRevisao}
                      onChange={(e) => setIsRevisao(e.target.checked)}
                      style={{ cursor: "pointer" }}
                    />
                    <span>📝 Treinamento de revisão</span>
                    <small style={{ color: "#94a3b8", fontWeight: 400 }}>
                      {isRevisao
                        ? '(não avança a esteira — tags: "Revisão de...")'
                        : "(marque se for revisão de temas anteriores)"}
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
                        : "rgba(255,255,255,0.04)",
                      border: temaForaEsteira
                        ? "1px solid rgba(16,185,129,0.4)"
                        : "1px solid rgba(255,255,255,0.08)",
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
                          setTemaOcorrenciaOngoingText(
                            (form.temaOcorrencia ?? []).join(", "),
                          );
                        }
                      }}
                      style={{ cursor: "pointer" }}
                    />
                    <span>🆕 Tema fora da esteira</span>
                    <small style={{ color: "#94a3b8", fontWeight: 400 }}>
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
                        temaOcorrencia: val
                          ? val
                              .split(",")
                              .map((t) => t.trim())
                              .filter(Boolean)
                          : [],
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
                      const opcoes = [
                        "Ausente",
                        "Cancelado",
                        ...(empresaSelecionada?.temaText
                          ? empresaSelecionada.temaText
                              .trim()
                              .split(/\s{2,}|\n/)
                              .filter(Boolean)
                          : []),
                      ];

                      return opcoes.map((tema) => (
                        <label key={tema} className="tema-opcao">
                          <input
                            type="checkbox"
                            checked={
                              form.temaOcorrencia?.includes(tema) ?? false
                            }
                            onChange={(e) => {
                              const atual = form.temaOcorrencia ?? [];
                              const novoTema = e.target.checked
                                ? [...atual, tema]
                                : atual.filter((t) => t !== tema);
                              setForm({
                                ...form,
                                temaOcorrencia: novoTema,
                              });
                              setTemaOcorrenciaOngoingText(novoTema.join(", "));
                            }}
                          />
                          {tema}
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
                      style={{ fontWeight: 600, color: "#6366f1" }}
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
                    style={{ fontWeight: 600, color: "#ef4444" }}
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
                  !editandoId &&
                  form.descricao !== TEMPLATE_TREINAMENTO && (
                    <button
                      type="button"
                      className="btn-link-template"
                      onClick={() => {
                        setUsarTemplate(true);
                        setForm((f) => ({
                          ...f,
                          descricao: TEMPLATE_TREINAMENTO,
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
                  if (!editandoId || role === "master") {
                    const val = e.target.value;
                    set("descricao", val);
                    if (!val.trim()) {
                      setUsarTemplate(false);
                    }
                  }
                }}
                readOnly={editandoId ? role !== "master" : false}
                placeholder="Descreva a ocorrência com detalhes..."
                rows={Math.max(6, form.descricao.split("\n").length + 2)}
                style={
                  editandoId && role !== "master"
                    ? { opacity: 0.5, cursor: "not-allowed", resize: "none" }
                    : {}
                }
              />
              {editandoId && role !== "master" && (
                <small style={{ color: "var(--text-muted)" }}>
                  Para adicionar uma nova descrição, use{" "}
                  <b>"Incluir nova atualização"</b> nos detalhes.
                </small>
              )}
            </div>

            <div className="hist-painel-actions">
              <button className="btn-ghost" onClick={cancelar}>
                Cancelar
              </button>
              <button
                className="btn-primary"
                onClick={salvar}
                disabled={salvando}
              >
                {salvando
                  ? "Salvando..."
                  : editandoId
                    ? "Atualizar"
                    : "Registrar"}
              </button>
            </div>
          </div>
        </div>
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
                  Contato com o cliente é fácil? *{" "}
                  <span className="score-hint">
                    (Sim = +0.5 e zera perda / Não: 1ª vez cancela o bônus, a
                    partir da 2ª = -0.5)
                  </span>
                </label>
                <div className="radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="facilContato"
                      value="Sim"
                      checked={respostasScore.facilContato === "Sim"}
                      onChange={() =>
                        setRespostasScore((prev) => ({
                          ...prev,
                          facilContato: "Sim",
                        }))
                      }
                    />
                    Sim
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="facilContato"
                      value="Não"
                      checked={respostasScore.facilContato === "Não"}
                      onChange={() =>
                        setRespostasScore((prev) => ({
                          ...prev,
                          facilContato: "Não",
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

              {/* Pergunta 3 */}
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

              {/* Pergunta 4 */}
              <div className="score-pergunta">
                <label>
                  Cliente faz perguntas? *{" "}
                  <span className="score-hint">(Sim = +1.5 / Não = 0)</span>
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

              {/* Pergunta 5 */}
              <div className="score-pergunta">
                <label>
                  Cliente se recorda de temas anteriores? *{" "}
                  <span className="score-hint">
                    (Sim = +2.0 sem perda pendente, ou recupera 2.0 na 1ª vez e
                    3.0 na 2ª / Não: 1ª vez = -2.0, 2ª vez seguida = -3.0)
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

              {/* Pergunta 6 */}
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

              {/* Pergunta 7 */}
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

              {/* Pergunta 8 */}
              <div className="score-pergunta">
                <label>
                  Cliente é reclamante? *{" "}
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

              {/* Pergunta 9 */}
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
                  const deducaoAtiva = selectedEmpresaObj
                    ? obterAjustesAtivos(selectedEmpresaObj).reduce(
                        (soma, a) => soma + a.valor,
                        0,
                      )
                    : 0;
                  const totalComDeducao = res.score - deducaoAtiva;
                  return (
                    <span>
                      Total Parcial:{" "}
                      <strong>{totalComDeducao.toFixed(1)}</strong> ({res.tipo})
                      {deducaoAtiva > 0 && (
                        <span className="score-deducao-inline">
                          {" "}
                          ({res.score.toFixed(1)} - {deducaoAtiva.toFixed(1)}{" "}
                          por contato com Suporte)
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
                      respostasScore.facilContato === "" ||
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
                  {rankingDuvidasCliente.map(({ tema, contagem, origemManual }) => {
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
                  })}
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
                  color: "var(--text-color, #ffffff)",
                  fontWeight: "700",
                }}
              >
                💬 Enviar progresso pelo WhatsApp?
              </h3>
            </div>
            <div
              className="score-modal-body"
              style={{ color: "var(--text-color, #ffffff)" }}
            >
              <p
                style={{
                  fontSize: "0.9rem",
                  marginBottom: "16px",
                  color: "var(--text-muted, #94a3b8)",
                  lineHeight: "1.4",
                }}
              >
                Deseja enviar uma notificação para o cliente com o status
                atualizado do progresso de onboarding dele?
              </p>

              <div style={{ marginBottom: "16px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.8rem",
                    fontWeight: "600",
                    marginBottom: "6px",
                    color: "var(--text-color, #ffffff)",
                  }}
                >
                  Destinatários (WhatsApp do cliente)
                </label>
                <div
                  style={{
                    fontSize: "0.85rem",
                    color: "var(--text-muted, #94a3b8)",
                  }}
                >
                  {pendingWhatsAppMessage.destinatarios
                    .map(
                      (d) =>
                        `${d.nome} (${formatarTelefoneExibicao(d.telefone) || d.telefone})`,
                    )
                    .join(", ")}
                </div>
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.8rem",
                    fontWeight: "600",
                    marginBottom: "6px",
                    color: "var(--text-color, #ffffff)",
                  }}
                >
                  Texto da Mensagem (Você pode personalizar antes de enviar)
                </label>
                <textarea
                  rows={6}
                  value={editedWhatsAppText}
                  onChange={(e) => setEditedWhatsAppText(e.target.value)}
                  className="whatsapp-textarea"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    background: "rgba(255, 255, 255, 0.03)",
                    border:
                      "1px solid var(--border-color, rgba(255,255,255,0.08))",
                    borderRadius: "8px",
                    color: "var(--text-color, #ffffff)",
                    padding: "10px 14px",
                  }}
                />
                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: "0.75rem",
                    color: "var(--text-muted, #94a3b8)",
                    lineHeight: "1.4",
                  }}
                >
                  Use{" "}
                  <code
                    style={{
                      background: "rgba(255,255,255,0.07)",
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

              {pendingWhatsAppMessage.destinatarios.length > 1 &&
                editedWhatsAppText.toLowerCase().includes(PLACEHOLDER_NOME) && (
                  <div style={{ marginBottom: "16px" }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        fontWeight: "600",
                        marginBottom: "6px",
                        color: "var(--text-color, #ffffff)",
                      }}
                    >
                      Preview — serão enviadas{" "}
                      {pendingWhatsAppMessage.destinatarios.length} mensagens
                    </label>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                      }}
                    >
                      {pendingWhatsAppMessage.destinatarios.map((d, idx) => (
                        <div
                          key={`${d.telefone}-${idx}`}
                          style={{
                            background: "rgba(255, 255, 255, 0.03)",
                            border:
                              "1px solid var(--border-color, rgba(255,255,255,0.08))",
                            borderRadius: "8px",
                            padding: "8px 12px",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "0.7rem",
                              fontWeight: 600,
                              color: "var(--text-muted, #94a3b8)",
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                              marginBottom: "4px",
                            }}
                          >
                            {d.nome}
                          </div>
                          <div
                            style={{
                              fontSize: "0.8rem",
                              color: "var(--text-color, #ffffff)",
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
                  cancelar();
                  toast.success(
                    editandoId
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
                disabled={sendingWhatsApp}
                style={{ display: "flex", alignItems: "center", gap: "6px" }}
                onClick={async () => {
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
                      pendingWhatsAppMessage.destinatarios.map((d) =>
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
                      pendingWhatsAppMessage.destinatarios.map((d, idx) => {
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
                    cancelar();
                    toast.success(
                      editandoId
                        ? "Ocorrência atualizada!"
                        : "Ocorrência registrada!",
                    );
                  }
                }}
              >
                {sendingWhatsApp ? "Enviando..." : "Sim, enviar"}
              </button>
            </div>
          </div>
        </div>
      )}

      <GestaoNotificacaoModal
        open={gestaoConfirmModalOpen}
        titulo="⚠️ Notificar Supervisor e CS Responsável sobre o alerta?"
        destinatarios={gestaoDestinatarios}
        avisos={gestaoAvisos}
        mensagem={gestaoMensagem}
        onChangeMensagem={setGestaoMensagem}
        onResultado={async ({ status, enviadoEm, destinatarios }) => {
          if (!gestaoOcorrenciaId) return;
          try {
            await salvarOcorrencia({
              id: gestaoOcorrenciaId,
              whatsappStatus: status,
              whatsappEnviadoEm: enviadoEm,
              whatsappDestinatarios: destinatarios,
            } as Ocorrencia);
          } catch (error) {
            console.error(
              "Erro ao registrar status de envio do alerta:",
              error,
            );
          }
        }}
        onClose={() => {
          setGestaoConfirmModalOpen(false);
          setGestaoDestinatarios([]);
          setGestaoMensagem("");
          setGestaoOcorrenciaId(undefined);
        }}
      />
    </div>
  );
}
