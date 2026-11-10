import { elegivelFilaDistribuicao } from "../../utils/filaDistribuicao";
import React, { useEffect, useMemo, useState, useRef } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  UserCheck,
  PlusCircle,
  Trash2,
  AlertTriangle,
  History,
  TrendingUp,
  User,
  Star,
  Shield,
  FileText,
  Settings,
  AlertOctagon,
  Edit2,
  Eye,
  Shuffle,
  BarChart3,
  X,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { formatarNome } from "../../utils/formatarNome";
import { atuaComoTreinador } from "../../utils/perfis";
import { calcularScoreEfetivo } from "../../utils/score";
import { calcularDiasEsperaTreinamento } from "../../utils/esperaTreinamento";
import { listarUsuarios } from "../../services/auth";
import type { UsuarioDocument } from "../../services/auth";
import {
  listarLancamentosPontos,
  removerLancamentoPonto,
  removerPontoTreinamentoExcedente,
  salvarLancamentoPonto,
  atualizarLancamentoPonto,
} from "../../services/gamificacao";
import type { LancamentoPonto, Empresa, Ocorrencia } from "../../types";
import { listarEmpresas } from "../../services/empresas";
import {
  listarMetasIndicadores,
  salvarMetasIndicadores,
} from "../../services/metasIndicadores";
import type { MetasIndicadores } from "../../services/metasIndicadores";
import { listarOcorrencias } from "../../services/ocorrencias";
import { calcularProgressoPorFases } from "../../utils/monitoramento/calcularProgresso";
import { calcularTotalFases } from "../../utils/monitoramento/calcularTotalFases";
import { calcularDiasNaEsteira } from "../../utils/monitoramento/calcularDiasNaEsteira";
import { calcularDiasCongeladosPorCheckpoint } from "../../utils/monitoramento/calcularDiasCongeladosPorCheckpoint";
import { calcularRankingGamificacao } from "../../utils/rankingGamificacao";
import { PainelGamificacao } from "./PainelGamificacao";
import { listarFotosPerfil } from "../../services/profilePhotos";
import "./Gamificacao.css";

const ACOES_DISPONIVEIS = [
  {
    tipo: "treinamento",
    label: "Treinamento realizado",
    pontos: 1,
    descricao: "Realização de treinamento para a equipe ou clientes.",
    icon: Star,
    colorClass: "ponto-positivo",
  },
  {
    tipo: "nova_doc",
    label: "Nova documentação aprovada",
    pontos: 3,
    descricao: "Criação de novos artigos, playbooks ou bases de conhecimento.",
    icon: FileText,
    colorClass: "ponto-destaque",
  },
  {
    tipo: "att_doc",
    label: "Atualização relevante de documentação",
    pontos: 1,
    descricao:
      "Melhorias ou correções significativas em documentos existentes.",
    icon: FileText,
    colorClass: "ponto-positivo",
  },
  {
    tipo: "ferramenta_aut",
    label: "Ferramenta ou automação aprovada",
    pontos: 5,
    descricao:
      "Desenvolvimento e aprovação de scripts, automações ou ferramentas internas.",
    icon: Settings,
    colorClass: "ponto-premium",
  },
  {
    tipo: "chamado_falha",
    label: "Chamado decorrente de falha de treinamento comprovada",
    pontos: -1,
    descricao:
      "Incidente ou problema gerado por gap direto de treinamento comprovado.",
    icon: AlertOctagon,
    colorClass: "ponto-negativo",
  },
] as const;

/**
 * Rótulos de ações lançadas automaticamente pelo sistema (não aparecem no seletor
 * manual de {@link ACOES_DISPONIVEIS}), usados apenas para exibir um texto amigável
 * no histórico de lançamentos.
 */
const LABELS_TIPO_ACAO_SISTEMA: Partial<Record<string, string>> = {
  desconto_suporte: "Desconto por contato do cliente com o Suporte",
};

// Parâmetros do sistema de distribuição de próximos clientes entre treinadores.
// O peso de um treinamento decai conforme ele envelhece.
const FAIXAS_PESO_TREINAMENTO = [
  { ateDias: 10, peso: 1.5 },
  { ateDias: 15, peso: 1 },
  { ateDias: 30, peso: 0.5 },
] as const;
const DIAS_JANELA_TREINAMENTOS =
  FAIXAS_PESO_TREINAMENTO[FAIXAS_PESO_TREINAMENTO.length - 1].ateDias;
// Usado quando o treinador não tem fator de capacidade configurado no cadastro
const FATOR_CAPACIDADE_PADRAO = 1;

// Peso de um cliente na esteira conforme o progresso já concluído: quanto mais
// perto do fim, menos trabalho ele ainda representa para o treinador.
const FAIXAS_PESO_PROGRESSO = [
  { ateProgresso: 40, peso: 4 },
  { ateProgresso: 80, peso: 0.5 },
  { ateProgresso: 99, peso: 0.2 },
] as const;

const pesoDoProgresso = (progresso: number) =>
  FAIXAS_PESO_PROGRESSO.find((faixa) => progresso <= faixa.ateProgresso)
    ?.peso ?? 0;

// Peso de um treinamento a partir da sua idade em dias (0 depois da janela)
const pesoDoTreinamento = (idadeEmDias: number) =>
  FAIXAS_PESO_TREINAMENTO.find((faixa) => idadeEmDias <= faixa.ateDias)?.peso ??
  0;

const DIACRITICOS = new RegExp("[\\u0300-\\u036f]", "g");

/** Compara nomes ignorando caixa, acentos e espaços nas pontas. */
const normalizarNomeComparacao = (s: string) =>
  s.trim().toLowerCase().normalize("NFD").replace(DIACRITICOS, "");

/**
 * Primeiro nome normalizado de `Empresa.responsavel`. A convenção é guardar só
 * o primeiro nome, mas o cadastro em Home.tsx oferece o nome completo do
 * treinador no seletor — se alguém salvar com sobrenome (ex.: "Thayna
 * Santos"), a comparação direta com o primeiro nome do treinador nunca bate e
 * o cliente some de tudo que depende desse vínculo (Próximo Cliente,
 * indicadores, dedução de pontos). Extrair sempre a primeira palavra cobre os
 * dois formatos sem exigir correção manual dos registros já salvos.
 */
const primeiroNomeResponsavel = (responsavel: string) =>
  normalizarNomeComparacao(responsavel.trim().split(/\s+/)[0] || "");

/** Temas de um lançamento de treinamento, normalizados para comparação. */
const temasDoLancamento = (entry: LancamentoPonto) =>
  (entry.treinamentoTema || "")
    .split(",")
    .map((tema) => tema.trim().toLowerCase());

/** "Tempo de agenda" é gravado por um <input type="time">, ou seja, "HH:MM". */
const minutosDoTempoAgenda = (tempo?: string) => {
  if (!tempo) return 0;
  const [horas, minutos] = tempo.split(":").map(Number);
  if (!Number.isFinite(horas) || !Number.isFinite(minutos)) return 0;
  return horas * 60 + minutos;
};

const formatarDuracaoMinutos = (totalMinutos: number) => {
  if (totalMinutos <= 0) return "0h";
  const horas = Math.floor(totalMinutos / 60);
  const minutos = Math.round(totalMinutos % 60);
  if (horas === 0) return `${minutos}min`;
  if (minutos === 0) return `${horas}h`;
  return `${horas}h ${minutos}min`;
};

const media = (valores: number[]) =>
  valores.length === 0
    ? null
    : valores.reduce((acc, v) => acc + v, 0) / valores.length;

/**
 * Colunas do relatório de indicadores, na ordem em que aparecem na tabela.
 *
 * `unidade` é o sufixo mostrado no campo de meta, e `menorEhMelhor` inverte a
 * cor do desvio para os indicadores em que crescer é ruim (ausências,
 * cancelamentos, tempos de espera e contatos de Suporte): neles, ficar abaixo
 * da meta é que conta como resultado positivo.
 *
 * `passo` é a menor variação visível na coluna (1 para contagens, 0,1 para a
 * nota, um minuto para as horas). O desvio é calculado sobre o valor
 * arredondado a esse passo, senão um total de 4,874 exibido como "4.9"
 * apareceria abaixo de uma meta de 4,9.
 */
const UM_MINUTO_EM_HORAS = 1 / 60;

const COLUNAS_INDICADORES = [
  {
    chave: "taxaCsat",
    titulo: "Taxa CSAT",
    unidade: "%",
    menorEhMelhor: false,
    passo: 1,
    ajuda:
      "Treinamentos realizados que receberam alguma marcação de CSAT (Bom ou Ruim), sobre o total de realizados",
  },
  {
    chave: "treinamentosBons",
    titulo: "Treinamentos Bom",
    unidade: "",
    menorEhMelhor: false,
    passo: 1,
    ajuda: "Quantidade de resultados 'Bom' no CSAT dos treinamentos realizados",
  },
  {
    chave: "treinamentosRuins",
    titulo: "Treinamentos Ruim",
    unidade: "",
    menorEhMelhor: true,
    passo: 1,
    ajuda: "Quantidade de resultados 'Ruim' no CSAT dos treinamentos realizados",
  },
  {
    chave: "treinamentosRealizados",
    titulo: "Treinamentos realizados",
    unidade: "",
    menorEhMelhor: false,
    passo: 1,
    ajuda:
      "Lançamentos de treinamento, excluindo os marcados como Cancelado ou Ausente",
  },
  {
    chave: "treinamentosAusentes",
    titulo: "Treinamentos ausentes",
    unidade: "",
    menorEhMelhor: true,
    passo: 1,
    ajuda: "Treinamentos com o tema Ausente",
  },
  {
    chave: "treinamentosCancelados",
    titulo: "Treinamentos cancelados",
    unidade: "",
    menorEhMelhor: true,
    passo: 1,
    ajuda: "Treinamentos com o tema Cancelado",
  },
  {
    chave: "tempoMedioEspera",
    titulo: "Tempo médio de espera",
    unidade: "dias úteis",
    menorEhMelhor: true,
    passo: 0.1,
    ajuda:
      "Média de dias úteis (segunda a sexta) entre a solicitação e a realização do treinamento, considerando clientes ativos na esteira e ongoing (exclui suspensos e cancelados)",
  },
  {
    chave: "horasEmTreinamento",
    titulo: "Horas em treinamento",
    unidade: "h",
    menorEhMelhor: false,
    passo: UM_MINUTO_EM_HORAS,
    ajuda: "Soma do tempo de agenda dos treinamentos realizados",
  },
  {
    chave: "contatosSuporte",
    titulo: "Contatos Suporte",
    unidade: "",
    menorEhMelhor: true,
    passo: 1,
    ajuda:
      "Ocorrências do departamento Suporte em clientes do treinador, independentemente de quem registrou",
  },
  {
    chave: "atendimentosWhatsApp",
    titulo: "Atendimentos WhatsApp",
    unidade: "",
    menorEhMelhor: false,
    passo: 1,
    ajuda:
      "Ocorrências do treinador no departamento Treinamento e do tipo Dúvida",
  },
  {
    chave: "tempoMedioEsteira",
    titulo: "Tempo médio na esteira",
    unidade: "dias",
    menorEhMelhor: true,
    passo: 1,
    ajuda: "Média de dias na esteira dos clientes do treinador",
  },
  {
    chave: "clientesAtendidos",
    titulo: "Clientes atendidos",
    unidade: "",
    menorEhMelhor: false,
    passo: 1,
    ajuda:
      "Total de clientes da esteira sob responsabilidade do treinador (exceto cancelados e onboarding/ongoing)",
  },
  {
    chave: "clientesCancelados",
    titulo: "Clientes cancelados",
    unidade: "",
    menorEhMelhor: true,
    passo: 1,
    ajuda: "Clientes cancelados sob responsabilidade do treinador",
  },
  {
    chave: "clientesEmAndamento",
    titulo: "Clientes em andamento",
    unidade: "",
    menorEhMelhor: false,
    passo: 1,
    ajuda: "Clientes ativos com a esteira iniciada e ainda não concluída",
  },
  {
    chave: "clientesSuspensos",
    titulo: "Clientes suspensos",
    unidade: "",
    menorEhMelhor: true,
    passo: 1,
    ajuda: "Clientes marcados como suspensos",
  },
  {
    chave: "clientesEmAlerta",
    titulo: "Clientes em alerta",
    unidade: "",
    menorEhMelhor: true,
    passo: 1,
    ajuda: "Clientes com alerta em aberto",
  },
  {
    chave: "scoreClientes",
    titulo: "Média Score clientes",
    unidade: "",
    menorEhMelhor: false,
    passo: 0.1,
    ajuda:
      "Média do Score (Fast/Safety) dos clientes ativos sob responsabilidade do treinador (exclui cancelados e clientes sem score registrado)",
  },
] as const;

const TEMAS_GAMIFICACAO = [
  "Cancelado",
  "Ausente",
  "Follow-Up",
  "Visão Geral de Rastreamento",
  "Cadastrar Gateway",
  "Debug",
  "Cadastrar Rastreador",
  "Cadastrar Cliente",
  "Cadastrar Veículo",
  "Tela operacional",
  "Calculadora",
  "Cadastrar Pessoas",
  "Cadastrar APN e SIM cards",
  "Template de Cliente",
  "Template de perfis de acesso",
  "Perfis de acesso administrador",
  "Perfis de acesso dos usuários",
  "Template de Rastreador",
  "Áreas e Rotas",
  "Regras",
  "Template de Regras",
  "BI Viewer",
  "Velocidade na Via",
  "Jornada de Trabalho",
  "Gestão de Multas",
  "Videotelemetria",
  "Performance",
  "Logistics",
  "Fretamento",
  "Abastecimento",
  "Manutenção",
  "Relatórios",
  "Identificação de mototista",
  "Bloqueio Agendado",
  "SSX Mobile",
  "Check List",
  "Tratamento de alerta",
  "Home",
  "Embarque de Motoristas",
  "Unidade Organizacional",
  "SSX Onboard",
  "Cobrança SSX",
  "Comunicado aos clientes",
  "Quick Service",
  "Rastreamento mobile",
  "Importação de arquivo",
  "Configurações de rastreador",
  "Configurações do menu Geral",
];

interface SearchableSelectProps {
  value: string[];
  onChange: (value: string[]) => void;
  options: string[];
  placeholder: string;
  disabled?: boolean;
}

const SearchableSelect: React.FC<SearchableSelectProps> = ({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    return options.filter((opt) =>
      opt.toLowerCase().includes(searchTerm.toLowerCase().trim()),
    );
  }, [options, searchTerm]);

  const handleToggleOption = (opt: string) => {
    if (value.includes(opt)) {
      onChange(value.filter((val) => val !== opt));
    } else {
      onChange([...value, opt]);
    }
  };

  return (
    <div className="searchable-select-container" ref={containerRef}>
      <button
        type="button"
        className={`searchable-select-trigger ${isOpen ? "active" : ""}`}
        onClick={() => {
          if (!disabled) {
            setIsOpen(!isOpen);
            setSearchTerm("");
          }
        }}
        disabled={disabled}
        style={{ height: "auto", minHeight: "48px", padding: "6px 12px" }}
      >
        <div className="searchable-select-selected-wrapper">
          {value.length > 0 ? (
            value.map((val) => (
              <span
                key={val}
                className="selected-pill"
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleOption(val);
                }}
              >
                {val}
                <span className="remove-pill-x">×</span>
              </span>
            ))
          ) : (
            <span className="placeholder-value">{placeholder}</span>
          )}
        </div>
        <span
          className={`select-arrow ${isOpen ? "open" : ""}`}
          style={{ alignSelf: "center" }}
        >
          ▼
        </span>
      </button>

      {isOpen && (
        <div className="searchable-select-dropdown">
          <div className="searchable-select-search-wrapper">
            <input
              ref={searchInputRef}
              type="text"
              className="searchable-select-search-input"
              placeholder="Pesquisar tema..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="searchable-select-options-list">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => {
                const isSelected = value.includes(opt);
                return (
                  <div
                    key={opt}
                    className={`searchable-select-option ${
                      isSelected ? "selected" : ""
                    }`}
                    onClick={() => {
                      handleToggleOption(opt);
                    }}
                  >
                    <span>{opt}</span>
                    {isSelected && <span className="selected-check">✓</span>}
                  </div>
                );
              })
            ) : (
              <div className="searchable-select-no-options">
                Nenhum tema encontrado
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface SearchableSingleSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
  disabled?: boolean;
}

const SearchableSingleSelect: React.FC<SearchableSingleSelectProps> = ({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    return options.filter((opt) =>
      opt.toLowerCase().includes(searchTerm.toLowerCase().trim()),
    );
  }, [options, searchTerm]);

  return (
    <div className="searchable-select-container" ref={containerRef}>
      <button
        type="button"
        className={`searchable-select-trigger ${isOpen ? "active" : ""}`}
        onClick={() => {
          if (!disabled) {
            setIsOpen(!isOpen);
            setSearchTerm("");
          }
        }}
        disabled={disabled}
        style={{ height: "auto", minHeight: "48px", padding: "6px 12px" }}
      >
        <div className="searchable-select-selected-wrapper">
          {value ? (
            <span style={{ color: "var(--lt-texto-cbd5e1, #cbd5e1)" }}>{value}</span>
          ) : (
            <span className="placeholder-value">{placeholder}</span>
          )}
        </div>
        <span
          className={`select-arrow ${isOpen ? "open" : ""}`}
          style={{ alignSelf: "center" }}
        >
          ▼
        </span>
      </button>

      {isOpen && (
        <div className="searchable-select-dropdown">
          <div className="searchable-select-search-wrapper">
            <input
              ref={searchInputRef}
              type="text"
              className="searchable-select-search-input"
              placeholder="Pesquisar empresa..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="searchable-select-options-list">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => {
                const isSelected = value === opt;
                return (
                  <div
                    key={opt}
                    className={`searchable-select-option ${isSelected ? "selected" : ""}`}
                    onClick={() => {
                      onChange(opt);
                      setIsOpen(false);
                    }}
                  >
                    <span>{opt}</span>
                    {isSelected && <span className="selected-check">✓</span>}
                  </div>
                );
              })
            ) : (
              <div className="searchable-select-no-options">
                Nenhuma empresa encontrada
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const Gamificacao: React.FC = () => {
  const navigate = useNavigate();
  const { user, userName, role } = useAuth();
  const { theme } = useTheme();
  const [trainers, setTrainers] = useState<UsuarioDocument[]>([]);
  const [fotosPerfil, setFotosPerfil] = useState<Record<string, string>>({});
  const [entries, setEntries] = useState<LancamentoPonto[]>([]);
  const [empresas, setEmpresas] = useState<string[]>([]);
  const [empresasCompletas, setEmpresasCompletas] = useState<Empresa[]>([]);
  const [showDistribuicaoModal, setShowDistribuicaoModal] = useState(false);
  const [showIndicadoresModal, setShowIndicadoresModal] = useState(false);
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([]);
  // `metas` é o que está na tela; `metasSalvas` é o que está no banco. A
  // diferença entre os dois habilita o botão de salvar.
  const [metas, setMetas] = useState<MetasIndicadores>({});
  const [metasSalvas, setMetasSalvas] = useState<MetasIndicadores>({});
  const [metasCarregadas, setMetasCarregadas] = useState(false);
  const [salvandoMetas, setSalvandoMetas] = useState(false);

  // Filtros internos do modal de Indicadores (independentes dos filtros da página principal)
  // A análise é feita semanalmente, então o padrão é a semana atual (Domingo a Sábado),
  // igual ao critério usado na página de Relatórios.
  const [indicadoresDataInicio, setIndicadoresDataInicio] = useState(() => {
    const now = new Date();
    const inicio = new Date(now);
    inicio.setDate(now.getDate() - now.getDay());
    return `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, "0")}-${String(inicio.getDate()).padStart(2, "0")}`;
  });
  const [indicadoresDataFim, setIndicadoresDataFim] = useState(() => {
    const now = new Date();
    const fim = new Date(now);
    fim.setDate(now.getDate() - now.getDay() + 6);
    return `${fim.getFullYear()}-${String(fim.getMonth() + 1).padStart(2, "0")}-${String(fim.getDate()).padStart(2, "0")}`;
  });
  const [pontoOcorrenciaMap, setPontoOcorrenciaMap] = useState<
    Record<string, { id: string; alerta?: boolean }>
  >({});
  const [loading, setLoading] = useState(true);
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const historicoRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let ativo = true;
    listarFotosPerfil()
      .then((fotos) => { if (ativo) setFotosPerfil(fotos); })
      .catch((error) => {
        console.error("Erro ao carregar fotos de perfil da equipe:", error);
        if (ativo) toast.error("Não foi possível carregar as fotos de perfil; o ranking continua disponível com iniciais.");
      });
    return () => { ativo = false; };
  }, []);

  // Filtro de data
  const [filtroDataInicio, setFiltroDataInicio] = useState(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}-01`;
  });
  const [filtroDataFim, setFiltroDataFim] = useState(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const monthStr = String(month + 1).padStart(2, "0");
    return `${year}-${monthStr}-${String(lastDay).padStart(2, "0")}`;
  });

  // Filtro por treinador e motivo do lançamento
  const [filtroTreinadorId, setFiltroTreinadorId] = useState("");
  const [filtroTipoAcao, setFiltroTipoAcao] = useState("");

  const acoesFiltradas = useMemo(() => {
    const baseList = ACOES_DISPONIVEIS.filter((a) => a.tipo !== "treinamento");
    if (role === "treinador") {
      return [];
    }
    return baseList;
  }, [role]);

  // Form states
  const [selectedTrainerUid, setSelectedTrainerUid] = useState("");
  const [selectedActionType, setSelectedActionType] = useState<
    | "treinamento"
    | "nova_doc"
    | "att_doc"
    | "ferramenta_aut"
    | "chamado_falha"
    | ""
  >("");

  useEffect(() => {
    if (acoesFiltradas.length > 0) {
      setSelectedActionType(acoesFiltradas[0].tipo);
    } else {
      setSelectedActionType("");
    }
  }, [acoesFiltradas]);

  const [descricao, setDescricao] = useState("");

  // Treinamento extra states
  const [treinamentoEmpresa, setTreinamentoEmpresa] = useState("");
  const [treinamentoTemas, setTreinamentoTemas] = useState<string[]>([]);
  const [treinamentoDataSolicitacao, setTreinamentoDataSolicitacao] =
    useState("");
  const [treinamentoDataRealizacao, setTreinamentoDataRealizacao] =
    useState("");
  const [treinamentoTempoAgenda, setTreinamentoTempoAgenda] = useState("");
  const [treinamentoSolicitante, setTreinamentoSolicitante] = useState("CS");
  const [treinamentoNotas, setTreinamentoNotas] = useState<string[]>([]);

  // Edit states
  const [editingEntry, setEditingEntry] = useState<LancamentoPonto | null>(
    null,
  );
  const [editEmpresa, setEditEmpresa] = useState("");
  const [editTemas, setEditTemas] = useState<string[]>([]);
  const [editDataSolicitacao, setEditDataSolicitacao] = useState("");
  const [editDataRealizacao, setEditDataRealizacao] = useState("");
  const [editTempoAgenda, setEditTempoAgenda] = useState("");
  const [editSolicitante, setEditSolicitante] = useState("CS");
  // Modelo antigo (nota 1-10): preservado apenas para exibição, não é mais editável.
  const [editNotas, setEditNotas] = useState<string[]>([]);
  // Modelo atual (Bom/Ruim)
  const [editResultados, setEditResultados] = useState<string[]>([]);
  const [editDescricao, setEditDescricao] = useState("");

  // Helper functions for dynamic notes (Create)
  const handleAddNota = () => setTreinamentoNotas([...treinamentoNotas, ""]);
  const handleUpdateNota = (index: number, val: string) => {
    const copy = [...treinamentoNotas];
    copy[index] = val;
    setTreinamentoNotas(copy);
  };
  const handleRemoveNota = (index: number) =>
    setTreinamentoNotas(treinamentoNotas.filter((_, i) => i !== index));

  // Helper functions for dynamic resultados Bom/Ruim (Edit)
  const handleAddEditResultado = () =>
    setEditResultados([...editResultados, ""]);
  const handleUpdateEditResultado = (index: number, val: string) => {
    const copy = [...editResultados];
    copy[index] = val;
    setEditResultados(copy);
  };
  const handleRemoveEditResultado = (index: number) =>
    setEditResultados(editResultados.filter((_, i) => i !== index));

  // Delete modal state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmarExclusaoId, setConfirmarExclusaoId] = useState<string | null>(
    null,
  );
  const exclusaoModalRef = useRef<HTMLDivElement>(null);
  const exclusaoEmAndamentoRef = useRef(false);

  useEffect(() => {
    if (!confirmarExclusaoId) return;
    const origemFoco = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    exclusaoModalRef.current?.querySelector<HTMLButtonElement>(".btn-cancelar-confirm")?.focus();
    return () => {
      document.body.style.overflow = overflowAnterior;
      if (origemFoco?.isConnected) origemFoco.focus();
      else historicoRef.current?.focus();
    };
  }, [confirmarExclusaoId]);

  const carregarDados = async () => {
    try {
      setLoading(true);
      setErroCarregamento(null);
      const [listaUsuarios, listaPontos, listaEmpresas, listaOcorrencias] =
        await Promise.all([
          listarUsuarios(true),
          // Sem `forceRefresh`: estas duas coleções passaram a usar
          // sincronização incremental, que já devolve dado fresco consultando
          // apenas o que mudou. Forçar a releitura aqui descartava o cache e
          // relia as duas coleções inteiras a cada abertura da página.
          listarLancamentosPontos(),
          listarEmpresas(),
          listarOcorrencias().catch((err) => {
            console.error("Erro ao listar ocorrências para mapeamento:", err);
            return [];
          }),
        ]);

      // Filter only users who act as trainers and completed their first access
      const apenasTreinadores = listaUsuarios.filter(
        (u) =>
          atuaComoTreinador(u.role) &&
          !u.needsPasswordChange &&
          u.nome.trim().toLowerCase() !== "painel" &&
          !u.email.toLowerCase().includes("painel"),
      );
      setTrainers(apenasTreinadores);
      setEntries(listaPontos);
      setEmpresasCompletas(listaEmpresas);
      setOcorrencias(listaOcorrencias);

      const nomesEmpresas = Array.from(
        new Set(
          listaEmpresas.map((e) => e.nomeEmpresa?.trim()).filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b));
      setEmpresas(nomesEmpresas);

      // Build mapping of gamificacaoPontoId -> occurrence details
      const mapping: Record<string, { id: string; alerta?: boolean }> = {};
      listaOcorrencias.forEach((oc) => {
        if (oc.gamificacaoPontoId) {
          mapping[oc.gamificacaoPontoId] = {
            id: oc.id || "",
            alerta: oc.alerta,
          };
        }
      });
      setPontoOcorrenciaMap(mapping);

      // Default the selected trainer in the form
      if (user && apenasTreinadores.some((t) => t.uid === user.uid)) {
        setSelectedTrainerUid(user.uid);
      } else if (apenasTreinadores.length > 0) {
        setSelectedTrainerUid(apenasTreinadores[0].uid);
      }
    } catch (error: any) {
      console.error("Erro ao carregar dados de gamificação:", error);
      setErroCarregamento("Não foi possível carregar a gamificação. Tente novamente para consultar os pontos.");
      toast.error(`Erro ao carregar dados: ${error?.message || error}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, [user, role]);

  // Opções de motivo (tipo de ação) disponíveis para filtro, com base nas ações conhecidas
  // e em quaisquer tipos que já existam nos lançamentos (garante que nada fique de fora).
  const motivoOptions = useMemo(() => {
    const map = new Map<string, string>();
    ACOES_DISPONIVEIS.forEach((a) => map.set(a.tipo, a.label));
    entries.forEach((e) => {
      if (e.tipoAcao && !map.has(e.tipoAcao))
        map.set(e.tipoAcao, LABELS_TIPO_ACAO_SISTEMA[e.tipoAcao] || e.tipoAcao);
    });
    return Array.from(map.entries()).map(([tipo, label]) => ({ tipo, label }));
  }, [entries]);

  // Filtro de lançamentos por período (usado no cálculo do ranking, que deve
  // sempre considerar todos os treinadores e motivos do período selecionado)
  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      // Excluir lançamentos do usuário Painel
      const isPainel =
        entry.treinadorNome?.trim().toLowerCase() === "painel" ||
        entry.treinadorNome?.toLowerCase().includes("painel");
      if (isPainel) return false;

      if (filtroDataInicio) {
        const startTimestamp = new Date(
          filtroDataInicio + "T00:00:00",
        ).getTime();
        if (entry.dataLancamento < startTimestamp) return false;
      }
      if (filtroDataFim) {
        const endTimestamp = new Date(
          filtroDataFim + "T23:59:59.999",
        ).getTime();
        if (entry.dataLancamento > endTimestamp) return false;
      }
      return true;
    });
  }, [entries, filtroDataInicio, filtroDataFim]);

  // Filtro adicional por treinador e motivo, aplicado apenas na tabela de
  // Atividades Recentes (não deve afetar o cálculo do ranking/score).
  const historyEntries = useMemo(() => {
    return filteredEntries.filter((entry) => {
      if (filtroTreinadorId && entry.treinadorId !== filtroTreinadorId)
        return false;
      if (filtroTipoAcao && entry.tipoAcao !== filtroTipoAcao) return false;
      return true;
    });
  }, [filteredEntries, filtroTreinadorId, filtroTipoAcao]);

  const rankedTrainers = useMemo(
    () => calcularRankingGamificacao(trainers, filteredEntries),
    [trainers, filteredEntries],
  );

  // Ranking de distribuição do próximo cliente: baseado nos treinamentos dos
  // últimos 30 dias (com peso decrescente conforme envelhecem) e nos clientes
  // ativos na esteira sob responsabilidade do treinador, cada um valendo o peso
  // da sua faixa de progresso multiplicado pelo fator de capacidade do
  // treinador. Vence quem tiver a MENOR carga.
  const distribuicaoRanking = useMemo(() => {
    const agora = Date.now();
    const inicioJanela = agora - DIAS_JANELA_TREINAMENTOS * 24 * 60 * 60 * 1000;

    // Cada cliente ativo carrega o peso da faixa de progresso em que está, em
    // vez de valer sempre 1: quem está quase concluindo pesa menos.
    const clientesAtivos = empresasCompletas
      .filter((emp) => {
        if (emp.isOngoing || emp.isSuspended || emp.isCancelled) return false;
        const totalFases = calcularTotalFases(emp.temaText || "");
        const progresso = calcularProgressoPorFases(
          emp.currentPhase,
          totalFases,
        );
        return progresso < 100;
      })
      .map((emp) => {
        const totalFases = calcularTotalFases(emp.temaText || "");
        const progresso = calcularProgressoPorFases(
          emp.currentPhase,
          totalFases,
        );
        return {
          responsavel: emp.responsavel || "",
          progresso,
          pesoProgresso: pesoDoProgresso(progresso),
        };
      });

    // Inclusão e suspensão (férias) são definidas no cadastro do usuário.
    const treinadoresElegiveis = trainers.filter(elegivelFilaDistribuicao);

    return treinadoresElegiveis
      .map((t) => {
        const nomeFormatado = formatarNome(t.nome);
        const primeiroNome = nomeFormatado.split(" ")[0] || "";

        const treinamentosNaJanela = entries.filter((entry) => {
          const isPainel =
            entry.treinadorNome?.trim().toLowerCase() === "painel" ||
            entry.treinadorNome?.toLowerCase().includes("painel");
          if (isPainel) return false;
          if (entry.treinadorId !== t.uid) return false;
          if (entry.tipoAcao !== "treinamento" || !entry.treinamentoTema)
            return false;
          if (entry.dataLancamento < inicioJanela) return false;
          const temas = entry.treinamentoTema
            .split(",")
            .map((tema) => tema.trim().toLowerCase());
          return !temas.includes("cancelado") && !temas.includes("ausente");
        });

        // Quantos treinamentos caem em cada faixa de peso e a soma resultante
        const treinamentosPorFaixa = FAIXAS_PESO_TREINAMENTO.map(() => 0);
        let cargaTreinamentos = 0;
        treinamentosNaJanela.forEach((entry) => {
          const idadeEmDias =
            (agora - entry.dataLancamento) / (24 * 60 * 60 * 1000);
          const peso = pesoDoTreinamento(idadeEmDias);
          if (peso === 0) return;
          const indiceFaixa = FAIXAS_PESO_TREINAMENTO.findIndex(
            (faixa) => idadeEmDias <= faixa.ateDias,
          );
          treinamentosPorFaixa[indiceFaixa] += 1;
          cargaTreinamentos += peso;
        });

        const clientesDoTreinador = clientesAtivos.filter(
          (emp) =>
            primeiroNomeResponsavel(emp.responsavel) ===
            normalizarNomeComparacao(primeiroNome),
        );
        const clientesEsteira = clientesDoTreinador.length;
        const pesoProgresso = clientesDoTreinador.reduce(
          (soma, emp) => soma + emp.pesoProgresso,
          0,
        );

        // Quantos clientes caem em cada faixa de progresso
        const clientesPorFaixa = FAIXAS_PESO_PROGRESSO.map(() => 0);
        clientesDoTreinador.forEach((emp) => {
          const indiceFaixa = FAIXAS_PESO_PROGRESSO.findIndex(
            (faixa) => emp.progresso <= faixa.ateProgresso,
          );
          if (indiceFaixa >= 0) clientesPorFaixa[indiceFaixa] += 1;
        });

        const fatorCapacidade =
          typeof t.fatorCapacidade === "number" && t.fatorCapacidade > 0
            ? t.fatorCapacidade
            : FATOR_CAPACIDADE_PADRAO;

        const cargaClientes = pesoProgresso * fatorCapacidade;

        const cargaDistribuicao = parseFloat(
          (cargaTreinamentos + cargaClientes).toFixed(2),
        );

        return {
          ...t,
          treinamentosRecentes: treinamentosNaJanela.length,
          treinamentosPorFaixa,
          cargaTreinamentos,
          clientesEsteira,
          clientesPorFaixa,
          pesoProgresso,
          fatorCapacidade,
          cargaClientes,
          cargaDistribuicao,
        };
      })
      .sort(
        (a, b) =>
          a.cargaDistribuicao - b.cargaDistribuicao ||
          a.nome.localeCompare(b.nome),
      );
  }, [trainers, entries, empresasCompletas]);

  const podeDistribuir = role === "treinador" || role === "master";
  // Master vê os indicadores de toda a equipe; o treinador vê só os próprios,
  // e sem poder alterar as metas (definidas centralmente pelo Master).
  const podeVerIndicadores = role === "master" || role === "treinador";
  const podeEditarMetas = role === "master";

  // As metas só interessam a quem abre o relatório, então a leitura acontece
  // na primeira abertura do modal em vez de no carregamento da página.
  useEffect(() => {
    if (!showIndicadoresModal || !podeVerIndicadores || metasCarregadas) return;

    listarMetasIndicadores()
      .then((salvas) => {
        setMetas(salvas);
        setMetasSalvas(salvas);
        setMetasCarregadas(true);
      })
      .catch((err) => {
        console.error("Erro ao carregar metas dos indicadores:", err);
        toast.error("Não foi possível carregar as metas salvas.");
      });
  }, [showIndicadoresModal, podeVerIndicadores, metasCarregadas]);

  // Lançamentos filtrados pelo período interno do modal de Indicadores
  const filteredEntriesIndicadores = useMemo(() => {
    return entries.filter((entry) => {
      const isPainel =
        entry.treinadorNome?.trim().toLowerCase() === "painel" ||
        entry.treinadorNome?.toLowerCase().includes("painel");
      if (isPainel) return false;
      if (indicadoresDataInicio) {
        const startTimestamp = new Date(indicadoresDataInicio + "T00:00:00").getTime();
        if (entry.dataLancamento < startTimestamp) return false;
      }
      if (indicadoresDataFim) {
        const endTimestamp = new Date(indicadoresDataFim + "T23:59:59.999").getTime();
        if (entry.dataLancamento > endTimestamp) return false;
      }
      return true;
    });
  }, [entries, indicadoresDataInicio, indicadoresDataFim]);

  // Ocorrências dentro do período selecionado, para os indicadores que vêm do
  // histórico (contatos de Suporte e atendimentos por WhatsApp).
  const ocorrenciasNoPeriodo = useMemo(() => {
    const inicio = indicadoresDataInicio
      ? new Date(indicadoresDataInicio + "T00:00:00").getTime()
      : null;
    const fim = indicadoresDataFim
      ? new Date(indicadoresDataFim + "T23:59:59.999").getTime()
      : null;

    return ocorrencias.filter((o) => {
      const data = o.dataOcorrencia || o.createdAt;
      if (!data) return false;
      if (inicio !== null && data < inicio) return false;
      if (fim !== null && data > fim) return false;
      return true;
    });
  }, [ocorrencias, indicadoresDataInicio, indicadoresDataFim]);

  /**
   * Empresas com alerta em aberto, pela mesma regra do Radar: vale a ocorrência
   * mais recente que abriu ou retirou o alerta, e só na ausência dela é que se
   * usa a flag gravada na empresa (que pode ter ficado defasada).
   */
  const empresasComAlerta = useMemo(() => {
    const ultimaPorEmpresa = new Map<string, Ocorrencia>();

    ocorrencias.forEach((o) => {
      if (!o.alerta && !o.retirarAlerta) return;
      const chave = normalizarNomeComparacao(o.empresa || "");
      if (!chave) return;
      const data = o.dataOcorrencia || o.createdAt || 0;
      const atual = ultimaPorEmpresa.get(chave);
      const dataAtual = atual
        ? atual.dataOcorrencia || atual.createdAt || 0
        : -1;
      if (data >= dataAtual) ultimaPorEmpresa.set(chave, o);
    });

    const comAlerta = new Set<string>();
    empresasCompletas.forEach((emp) => {
      const chave = normalizarNomeComparacao(emp.nomeEmpresa || "");
      const ultima = ultimaPorEmpresa.get(chave);
      const ativo = ultima ? ultima.alerta === true : !!emp.alerta;
      if (ativo) comAlerta.add(chave);
    });

    return comAlerta;
  }, [ocorrencias, empresasCompletas]);

  /**
   * Primeiro nome do treinador responsável por cada cliente, indexado pelo
   * nome da empresa. Permite atribuir uma ocorrência ao dono do cliente em vez
   * de a quem a registrou.
   */
  const responsavelPorEmpresa = useMemo(() => {
    const mapa = new Map<string, string>();
    empresasCompletas.forEach((emp) => {
      const chave = normalizarNomeComparacao(emp.nomeEmpresa || "");
      if (chave)
        mapa.set(chave, primeiroNomeResponsavel(emp.responsavel || ""));
    });
    return mapa;
  }, [empresasCompletas]);

  /**
   * Clientes considerados no tempo médio de espera: os ativos na esteira e os
   * ongoing, que também solicitam e recebem treinamentos. Cancelado e suspenso
   * têm agendamentos represados por motivo alheio ao treinador e distorceriam
   * a média.
   */
  const empresasConsideradasNaEspera = useMemo(() => {
    const ativas = new Set<string>();
    empresasCompletas.forEach((emp) => {
      if (emp.isCancelled || emp.isSuspended) return;
      const chave = normalizarNomeComparacao(emp.nomeEmpresa || "");
      if (chave) ativas.add(chave);
    });
    return ativas;
  }, [empresasCompletas]);

  /**
   * Consolida os indicadores de cada treinador cruzando as três fontes:
   * lançamentos de pontos (treinamentos e CSAT), ocorrências do histórico
   * (Suporte e WhatsApp) e a carteira de clientes.
   *
   * Atenção às janelas de tempo: lançamentos e ocorrências respeitam o filtro
   * de período da tela, mas os números de clientes são a foto de agora — a
   * empresa não guarda histórico de suspensão/alerta para reconstruir o
   * passado.
   */
  const indicadoresPorTreinador = useMemo(() => {
    return trainers
      .map((t) => {
        const nomeFormatado = formatarNome(t.nome) || t.email;
        const primeiroNome = normalizarNomeComparacao(
          nomeFormatado.split(" ")[0] || "",
        );
        const nomeCompleto = normalizarNomeComparacao(nomeFormatado);

        // ── Lançamentos de pontos ──
        const lancamentos = filteredEntriesIndicadores.filter(
          (e) => e.treinadorId === t.uid,
        );
        const treinamentos = lancamentos.filter(
          (e) => e.tipoAcao === "treinamento" && e.treinamentoTema,
        );

        const treinamentosAusentes = treinamentos.filter((e) =>
          temasDoLancamento(e).includes("ausente"),
        ).length;
        const treinamentosCancelados = treinamentos.filter((e) =>
          temasDoLancamento(e).includes("cancelado"),
        ).length;

        // Mesma definição de "realizado" usada no ranking, para os dois
        // números não se contradizerem na mesma tela.
        const realizados = treinamentos.filter((e) => {
          const temas = temasDoLancamento(e);
          return !temas.includes("cancelado") && !temas.includes("ausente");
        });

        // CSAT (Bom/Ruim): taxa conta treinamentos com alguma marcação, os
        // totais de Bom/Ruim contam por resultado individual.
        const comResultado = realizados.filter(
          (e) => e.treinamentoResultados && e.treinamentoResultados.length > 0,
        );
        const taxaCsat =
          realizados.length > 0 ? comResultado.length / realizados.length : null;

        const todosOsResultados = realizados.flatMap(
          (e) => e.treinamentoResultados || [],
        );
        const treinamentosBons = todosOsResultados.filter(
          (r) => r === "Bom",
        ).length;
        const treinamentosRuins = todosOsResultados.filter(
          (r) => r === "Ruim",
        ).length;

        const esperas = realizados
          .filter((e) =>
            empresasConsideradasNaEspera.has(
              normalizarNomeComparacao(e.treinamentoEmpresa || ""),
            ),
          )
          .map((e) =>
            calcularDiasEsperaTreinamento(
              e.treinamentoDataSolicitacao,
              e.treinamentoDataRealizacao,
            ),
          )
          .filter((d): d is number => d !== null);
        const tempoMedioEspera = media(esperas);

        const minutosEmTreinamento = realizados.reduce(
          (acc, e) => acc + minutosDoTempoAgenda(e.treinamentoTempoAgenda),
          0,
        );

        // ── Ocorrências do histórico ──
        // Contatos de Suporte medem a carga do cliente, então contam para o
        // treinador dono do cliente, não para quem registrou a ocorrência.
        const contatosSuporte = ocorrenciasNoPeriodo.filter((o) => {
          if (o.departamento !== "Suporte") return false;
          const dono = responsavelPorEmpresa.get(
            normalizarNomeComparacao(o.empresa || ""),
          );
          return !!dono && dono === primeiroNome;
        }).length;

        // Atendimento é trabalho executado, então segue o responsável gravado
        // na ocorrência (nome completo de quem registrou).
        const atendimentosWhatsApp = ocorrenciasNoPeriodo.filter(
          (o) =>
            normalizarNomeComparacao(o.responsavel || "") === nomeCompleto &&
            o.departamento === "Treinamento" &&
            o.tipo === "Dúvida",
        ).length;

        // ── Carteira de clientes ──
        // A empresa deveria guardar só o primeiro nome do responsável, mas o
        // cadastro salva o que foi selecionado no seletor (que lista o nome
        // completo) — ver primeiroNomeResponsavel.
        const clientes = empresasCompletas.filter(
          (emp) => primeiroNomeResponsavel(emp.responsavel || "") === primeiroNome,
        );
        const clientesAtivos = clientes.filter((emp) => !emp.isCancelled);
        const clientesCancelados = clientes.filter(
          (emp) => !!emp.isCancelled,
        ).length;

        const clientesEmAndamento = clientesAtivos.filter((emp) => {
          if (emp.isOngoing || emp.isSuspended) return false;
          const progresso = calcularProgressoPorFases(
            emp.currentPhase,
            calcularTotalFases(emp.temaText || ""),
          );
          return progresso > 0 && progresso < 100;
        }).length;

        const clientesSuspensos = clientesAtivos.filter(
          (emp) => !!emp.isSuspended,
        ).length;
        const clientesEmAlerta = clientesAtivos.filter((emp) =>
          empresasComAlerta.has(
            normalizarNomeComparacao(emp.nomeEmpresa || ""),
          ),
        ).length;

        const diasNaEsteira = clientesAtivos
          .filter((emp) => !!emp.dataEntrada)
          .map((emp) =>
            calcularDiasNaEsteira(
              emp.dataEntrada,
              calcularProgressoPorFases(
                emp.currentPhase,
                calcularTotalFases(emp.temaText || ""),
              ),
              undefined,
              emp.dataFinalizacao,
              emp.isSuspended,
              emp.dataSuspensao,
              emp.diasSuspensoAcumulado,
              calcularDiasCongeladosPorCheckpoint(ocorrencias, emp.nomeEmpresa || ""),
            ),
          );
        const tempoMedioEsteira = media(diasNaEsteira);

        // ── Score médio dos clientes (Fast/Safety) ──
        // Só entram clientes em esteira e suspensos — onboarding e
        // cancelados não contam para a média.
        const scoresClientes = clientesAtivos
          .filter((emp) => !emp.isOngoing && typeof emp.score === "number")
          .map((emp) => calcularScoreEfetivo(emp) as number);
        const scoreClientes = media(scoresClientes);

        return {
          uid: t.uid,
          nome: nomeFormatado,
          taxaCsat,
          treinamentosBons,
          treinamentosRuins,
          treinamentosRealizados: realizados.length,
          treinamentosAusentes,
          treinamentosCancelados,
          tempoMedioEspera,
          minutosEmTreinamento,
          contatosSuporte,
          atendimentosWhatsApp,
          tempoMedioEsteira,
          clientesAtendidos: clientesAtivos.filter((emp) => !emp.isOngoing)
            .length,
          clientesCancelados,
          clientesEmAndamento,
          clientesSuspensos,
          clientesEmAlerta,
          scoreClientes,
          // Guardados para poder somar/ponderar corretamente na linha de total
          _realizadosComResultado: comResultado.length,
          _esperas: esperas,
          _diasNaEsteira: diasNaEsteira,
          _scoresClientes: scoresClientes,
        };
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [
    trainers,
    filteredEntriesIndicadores,
    ocorrenciasNoPeriodo,
    ocorrencias,
    empresasCompletas,
    empresasComAlerta,
    responsavelPorEmpresa,
    empresasConsideradasNaEspera,
  ]);

  // Colunas de treinador exibidas no modal: o Master vê a equipe inteira, o
  // treinador só a própria coluna.
  const indicadoresExibidos = useMemo(() => {
    if (role === "master") return indicadoresPorTreinador;
    return indicadoresPorTreinador.filter((t) => t.uid === user?.uid);
  }, [indicadoresPorTreinador, role, user?.uid]);

  /**
   * Linha de total da equipe. As médias (CSAT, espera, esteira) são
   * recalculadas sobre o conjunto completo de amostras — somar e dividir pelo
   * número de treinadores daria peso igual a quem fez 1 e a quem fez 50.
   */
  const totalIndicadores = useMemo(() => {
    const soma = (
      selecionar: (i: (typeof indicadoresPorTreinador)[number]) => number,
    ) => indicadoresPorTreinador.reduce((acc, i) => acc + selecionar(i), 0);

    const realizados = soma((i) => i.treinamentosRealizados);
    const realizadosComResultado = soma((i) => i._realizadosComResultado);
    const todasAsEsperas = indicadoresPorTreinador.flatMap((i) => i._esperas);
    const todosOsDias = indicadoresPorTreinador.flatMap(
      (i) => i._diasNaEsteira,
    );
    const todosOsScores = indicadoresPorTreinador.flatMap(
      (i) => i._scoresClientes,
    );

    return {
      taxaCsat: realizados > 0 ? realizadosComResultado / realizados : null,
      treinamentosBons: soma((i) => i.treinamentosBons),
      treinamentosRuins: soma((i) => i.treinamentosRuins),
      treinamentosRealizados: realizados,
      treinamentosAusentes: soma((i) => i.treinamentosAusentes),
      treinamentosCancelados: soma((i) => i.treinamentosCancelados),
      tempoMedioEspera: media(todasAsEsperas),
      minutosEmTreinamento: soma((i) => i.minutosEmTreinamento),
      contatosSuporte: soma((i) => i.contatosSuporte),
      atendimentosWhatsApp: soma((i) => i.atendimentosWhatsApp),
      tempoMedioEsteira: media(todosOsDias),
      clientesAtendidos: soma((i) => i.clientesAtendidos),
      clientesCancelados: soma((i) => i.clientesCancelados),
      clientesEmAndamento: soma((i) => i.clientesEmAndamento),
      clientesSuspensos: soma((i) => i.clientesSuspensos),
      clientesEmAlerta: soma((i) => i.clientesEmAlerta),
      scoreClientes: media(todosOsScores),
    };
  }, [indicadoresPorTreinador]);

  /** Formata cada indicador para exibição, com "—" quando não há amostra. */
  const celulasIndicadores = (linha: {
    taxaCsat: number | null;
    treinamentosBons: number;
    treinamentosRuins: number;
    treinamentosRealizados: number;
    treinamentosAusentes: number;
    treinamentosCancelados: number;
    tempoMedioEspera: number | null;
    minutosEmTreinamento: number;
    contatosSuporte: number;
    atendimentosWhatsApp: number;
    tempoMedioEsteira: number | null;
    clientesAtendidos: number;
    clientesCancelados: number;
    clientesEmAndamento: number;
    clientesSuspensos: number;
    clientesEmAlerta: number;
    scoreClientes: number | null;
  }) => [
    linha.taxaCsat === null ? "—" : `${Math.round(linha.taxaCsat * 100)}%`,
    String(linha.treinamentosBons),
    String(linha.treinamentosRuins),
    String(linha.treinamentosRealizados),
    String(linha.treinamentosAusentes),
    String(linha.treinamentosCancelados),
    linha.tempoMedioEspera === null
      ? "—"
      : `${linha.tempoMedioEspera.toFixed(1)} dias úteis`,
    formatarDuracaoMinutos(linha.minutosEmTreinamento),
    String(linha.contatosSuporte),
    String(linha.atendimentosWhatsApp),
    linha.tempoMedioEsteira === null
      ? "—"
      : `${Math.round(linha.tempoMedioEsteira)} dias`,
    String(linha.clientesAtendidos),
    String(linha.clientesCancelados),
    String(linha.clientesEmAndamento),
    String(linha.clientesSuspensos),
    String(linha.clientesEmAlerta),
    linha.scoreClientes === null ? "—" : linha.scoreClientes.toFixed(1),
  ];

  /**
   * Mesma ordem de `celulasIndicadores`, mas com os valores crus para comparar
   * com a meta. As unidades acompanham o que é exibido: taxa em pontos
   * percentuais e tempo de treinamento em horas decimais.
   */
  const valoresIndicadores = (linha: {
    taxaCsat: number | null;
    treinamentosBons: number;
    treinamentosRuins: number;
    treinamentosRealizados: number;
    treinamentosAusentes: number;
    treinamentosCancelados: number;
    tempoMedioEspera: number | null;
    minutosEmTreinamento: number;
    contatosSuporte: number;
    atendimentosWhatsApp: number;
    tempoMedioEsteira: number | null;
    clientesAtendidos: number;
    clientesCancelados: number;
    clientesEmAndamento: number;
    clientesSuspensos: number;
    clientesEmAlerta: number;
    scoreClientes: number | null;
  }): (number | null)[] => [
    linha.taxaCsat === null ? null : linha.taxaCsat * 100,
    linha.treinamentosBons,
    linha.treinamentosRuins,
    linha.treinamentosRealizados,
    linha.treinamentosAusentes,
    linha.treinamentosCancelados,
    linha.tempoMedioEspera,
    linha.minutosEmTreinamento / 60,
    linha.contatosSuporte,
    linha.atendimentosWhatsApp,
    linha.tempoMedioEsteira,
    linha.clientesAtendidos,
    linha.clientesCancelados,
    linha.clientesEmAndamento,
    linha.clientesSuspensos,
    linha.clientesEmAlerta,
    linha.scoreClientes,
  ];

  // Valores já formatados, indexados pelo treinador. Como a tabela é
  // transposta, cada célula é lida por [treinador][índice do indicador].
  const celulasPorTreinador = useMemo(() => {
    const mapa: Record<string, string[]> = {};
    indicadoresPorTreinador.forEach((t) => {
      mapa[t.uid] = celulasIndicadores(t);
    });
    return mapa;
  }, [indicadoresPorTreinador]);

  const celulasDoTotal = useMemo(
    () => celulasIndicadores(totalIndicadores),
    [totalIndicadores],
  );

  const valoresDoTotal = useMemo(
    () => valoresIndicadores(totalIndicadores),
    [totalIndicadores],
  );

  /**
   * Desvio do total da equipe em relação à meta. `positivo` já leva em conta a
   * direção do indicador — nos que "menos é melhor", ficar abaixo da meta é o
   * resultado desejado.
   *
   * O valor é arredondado ao passo da coluna antes de comparar, para o desvio
   * refletir o número que está na tela e não a casa decimal escondida.
   */
  const desvioDaMeta = (indice: number) => {
    const coluna = COLUNAS_INDICADORES[indice];
    const meta = metas[coluna.chave];
    const bruto = valoresDoTotal[indice];

    if (typeof meta !== "number" || bruto === null) return null;

    const valor = Math.round(bruto / coluna.passo) * coluna.passo;
    let diferenca = valor - meta;
    // Resíduo de ponto flutuante menor que meio passo não é diferença real
    if (Math.abs(diferenca) < coluna.passo / 2) diferenca = 0;

    const positivo = coluna.menorEhMelhor ? diferenca <= 0 : diferenca >= 0;

    // Percentual exige uma base diferente de zero; com meta zerada mostra a
    // diferença absoluta, que é a única leitura possível ("+3" acima da meta).
    if (meta === 0) {
      const casas = coluna.passo >= 1 ? 0 : coluna.passo === 0.1 ? 1 : 2;
      return {
        texto: `${diferenca > 0 ? "+" : ""}${diferenca.toFixed(casas)}`,
        positivo,
      };
    }

    let desvio = (diferenca / Math.abs(meta)) * 100;
    if (Math.abs(desvio) < 0.05) desvio = 0;

    return {
      texto: `${desvio > 0 ? "+" : ""}${desvio.toFixed(1)}%`,
      positivo,
    };
  };

  const handleMetaChange = (chave: string, texto: string) => {
    setMetas((anterior) => {
      const proximo = { ...anterior };
      if (texto.trim() === "") {
        delete proximo[chave];
      } else {
        const valor = Number(texto);
        if (!Number.isFinite(valor)) return anterior;
        proximo[chave] = valor;
      }
      return proximo;
    });
  };

  const handleSalvarMetas = async () => {
    try {
      setSalvandoMetas(true);
      await salvarMetasIndicadores(metas);
      setMetasSalvas(metas);
      toast.success("Metas salvas com sucesso!");
    } catch (error: any) {
      console.error("Erro ao salvar metas dos indicadores:", error);
      toast.error(`Erro ao salvar as metas: ${error?.message || error}`);
    } finally {
      setSalvandoMetas(false);
    }
  };

  const metasAlteradas = JSON.stringify(metas) !== JSON.stringify(metasSalvas);

  const formatarNumeroCarga = (valor: number) =>
    valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

  // "até 10 dias", "11 a 15 dias"... a partir das faixas configuradas
  const rotuloFaixa = (indice: number) => {
    const faixa = FAIXAS_PESO_TREINAMENTO[indice];
    if (indice === 0) return `até ${faixa.ateDias} dias`;
    const inicio = FAIXAS_PESO_TREINAMENTO[indice - 1].ateDias + 1;
    return `${inicio} a ${faixa.ateDias} dias`;
  };

  // "0% a 40%", "41% a 80%"... a partir das faixas de progresso configuradas
  const rotuloFaixaProgresso = (indice: number) => {
    const faixa = FAIXAS_PESO_PROGRESSO[indice];
    const inicio =
      indice === 0 ? 0 : FAIXAS_PESO_PROGRESSO[indice - 1].ateProgresso + 1;
    return `${inicio}% a ${faixa.ateProgresso}%`;
  };

  // Memória de cálculo da carga, para deixar claro de onde vem cada ponto
  const MemoriaCarga = ({
    item,
  }: {
    item: {
      treinamentosPorFaixa: number[];
      cargaTreinamentos: number;
      clientesEsteira: number;
      clientesPorFaixa: number[];
      pesoProgresso: number;
      fatorCapacidade: number;
      cargaClientes: number;
    };
  }) => (
    <div className="carga-memoria">
      <div className="carga-linha">
        <span className="carga-rotulo">Treinos</span>
        <div className="carga-parcelas">
          {FAIXAS_PESO_TREINAMENTO.map((faixa, indice) => {
            const qtd = item.treinamentosPorFaixa[indice] ?? 0;
            return (
              <span
                key={faixa.ateDias}
                className={`carga-chip ${qtd === 0 ? "carga-chip-vazio" : ""}`}
                title={`${qtd} ${qtd === 1 ? "treinamento" : "treinamentos"} de ${rotuloFaixa(
                  indice,
                )} atrás, valendo ${formatarNumeroCarga(faixa.peso)} cada`}
              >
                <strong>{qtd}</strong> {qtd === 1 ? "treino" : "treinos"}{" "}
                <span className="carga-chip-faixa">
                  ({rotuloFaixa(indice)})
                </span>{" "}
                × {formatarNumeroCarga(faixa.peso)}
              </span>
            );
          })}
        </div>
        <span className="carga-subtotal">
          = {formatarNumeroCarga(parseFloat(item.cargaTreinamentos.toFixed(2)))}
        </span>
      </div>
      <div className="carga-linha">
        <span className="carga-rotulo">Clientes</span>
        <div className="carga-parcelas">
          {FAIXAS_PESO_PROGRESSO.map((faixa, indice) => {
            const qtd = item.clientesPorFaixa[indice] ?? 0;
            return (
              <span
                key={faixa.ateProgresso}
                className={`carga-chip ${qtd === 0 ? "carga-chip-vazio" : ""}`}
                title={`${qtd} ${qtd === 1 ? "cliente" : "clientes"} com progresso de ${rotuloFaixaProgresso(
                  indice,
                )}, valendo ${formatarNumeroCarga(faixa.peso)} cada`}
              >
                <strong>{qtd}</strong> {qtd === 1 ? "cliente" : "clientes"}{" "}
                <span className="carga-chip-faixa">
                  ({rotuloFaixaProgresso(indice)})
                </span>{" "}
                × {formatarNumeroCarga(faixa.peso)}
              </span>
            );
          })}
          <span
            className="carga-chip carga-chip-vazio"
            title="O total dos clientes é multiplicado pelo fator de capacidade do treinador."
          >
            × fator {formatarNumeroCarga(item.fatorCapacidade)}
          </span>
        </div>
        <span className="carga-subtotal">
          = {formatarNumeroCarga(parseFloat(item.cargaClientes.toFixed(2)))}
        </span>
      </div>
    </div>
  );

  const handleLancar = async (e: React.FormEvent) => {
    e.preventDefault();

    const CanceladoOuAusente = treinamentoTemas.some(
      (t) =>
        t.trim().toLocaleLowerCase() === "cancelado" ||
        t.trim().toLocaleLowerCase() === "ausente",
    );

    if (!selectedTrainerUid || !selectedActionType) {
      toast.error("Preencha todos os campos do lançamento.");
      return;
    }

    if (role === "treinador" && selectedTrainerUid !== user?.uid) {
      toast.error("Você só pode lançar pontos para si mesmo.");
      return;
    }

    if (selectedActionType === "treinamento") {
      if (!treinamentoEmpresa) {
        toast.error("Selecione a empresa.");
        return;
      }
      if (treinamentoTemas.length === 0) {
        toast.error("Selecione pelo menos um tema do treinamento.");
        return;
      }
      if (!treinamentoDataSolicitacao || !treinamentoDataRealizacao) {
        toast.error("Preencha as datas de solicitação e realização.");
        return;
      }
      if (!CanceladoOuAusente && !treinamentoTempoAgenda.trim()) {
        toast.error("Preencha o tempo de agenda.");
        return;
      }
    }

    const trainer = trainers.find((t) => t.uid === selectedTrainerUid);
    const actionConfig = acoesFiltradas.find(
      (a) => a.tipo === selectedActionType,
    );

    if (!trainer || !actionConfig) {
      toast.error("Treinador ou ação inválida.");
      return;
    }

    setSubmitting(true);
    try {
      const criadoPorNome = userName || user?.email || "Sistema";

      let finalDescricao = "";
      let pontosAAplicar = actionConfig.pontos;
      let validNotas: number[] = [];
      let computedMedia: number | null = null;

      if (selectedActionType === "treinamento") {
        const normalizedTemas = treinamentoTemas.map((t) =>
          t.trim().toLowerCase(),
        );
        const isZeroPoints =
          normalizedTemas.includes("cancelado") ||
          normalizedTemas.includes("ausente");

        if (isZeroPoints) {
          pontosAAplicar = 0;
        }

        const formatarDataInput = (dataStr: string) => {
          if (!dataStr) return "";
          const [y, m, d] = dataStr.split("-");
          return `${d}/${m}/${y}`;
        };

        const dataSol = formatarDataInput(treinamentoDataSolicitacao);
        const dataReal = formatarDataInput(treinamentoDataRealizacao);

        validNotas = treinamentoNotas
          .map((n) => parseInt(n, 10))
          .filter((n) => !isNaN(n));

        if (validNotas.some((n) => n < 0 || n > 10)) {
          toast.error("As notas devem ser valores inteiros entre 0 e 10.");
          setSubmitting(false);
          return;
        }

        computedMedia =
          validNotas.length > 0
            ? parseFloat(
                (
                  validNotas.reduce((sum, n) => sum + n, 0) / validNotas.length
                ).toFixed(2),
              )
            : null;

        finalDescricao = `Empresa: ${treinamentoEmpresa} | Tema: ${treinamentoTemas.join(", ")} | Solicitado: ${dataSol} | Realizado: ${dataReal} | Tempo: ${treinamentoTempoAgenda.trim()} | Solicitante: ${treinamentoSolicitante}`;

        if (validNotas.length > 0) {
          finalDescricao += ` | Notas: [${validNotas.join(", ")}] (Média: ${computedMedia})`;
        }

        if (descricao.trim()) {
          finalDescricao += ` | Obs: ${descricao.trim()}`;
        }
      } else {
        finalDescricao = descricao.trim();
      }

      await salvarLancamentoPonto({
        treinadorId: trainer.uid,
        treinadorNome: formatarNome(trainer.nome) || trainer.email,
        tipoAcao: selectedActionType,
        pontos: pontosAAplicar,
        descricao: finalDescricao,
        criadoPorId: user?.uid || "",
        criadoPorNome,
        ...(selectedActionType === "treinamento"
          ? {
              treinamentoEmpresa,
              treinamentoTema: treinamentoTemas.join(", "),
              treinamentoDataSolicitacao,
              treinamentoDataRealizacao,
              treinamentoTempoAgenda: treinamentoTempoAgenda.trim(),
              treinamentoSolicitante,
              treinamentoNotas: validNotas,
              treinamentoNotaMedia: computedMedia,
            }
          : {}),
      });

      toast.success("Pontuação registrada com sucesso!");
      setDescricao("");
      setTreinamentoEmpresa("");
      setTreinamentoTemas([]);
      setTreinamentoDataSolicitacao("");
      setTreinamentoDataRealizacao("");
      setTreinamentoTempoAgenda("");
      setTreinamentoSolicitante("CS");
      setTreinamentoNotas([]);

      // Reload points list
      const novaLista = await listarLancamentosPontos();
      setEntries(novaLista);
    } catch (error: any) {
      console.error("Erro ao registrar lançamento:", error);
      toast.error("Erro ao salvar os pontos.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartEdit = (entry: LancamentoPonto) => {
    setEditingEntry(entry);
    setEditEmpresa(entry.treinamentoEmpresa || "");
    setEditTemas(
      entry.treinamentoTema
        ? entry.treinamentoTema.split(",").map((t) => t.trim())
        : [],
    );
    setEditDataSolicitacao(entry.treinamentoDataSolicitacao || "");
    setEditDataRealizacao(entry.treinamentoDataRealizacao || "");
    setEditTempoAgenda(entry.treinamentoTempoAgenda || "");
    setEditSolicitante(entry.treinamentoSolicitante || "CS");
    setEditNotas(
      entry.treinamentoNotas ? entry.treinamentoNotas.map(String) : [],
    );
    setEditResultados(entry.treinamentoResultados ?? []);

    let obs = "";
    if (entry.tipoAcao === "treinamento" && entry.descricao) {
      const parts = entry.descricao.split(" | Obs: ");
      if (parts.length > 1) {
        obs = parts[1];
      }
    } else {
      obs = entry.descricao || "";
    }
    setEditDescricao(obs);
  };

  const handleSalvarEdicao = async (e: React.FormEvent) => {
    e.preventDefault();
    const CanceladoOuAusente = editTemas.some(
      (t) =>
        t.trim().toLocaleLowerCase() === "cancelado" ||
        t.trim().toLocaleLowerCase() === "ausente",
    );

    if (!editingEntry || !editingEntry.id) return;

    setSubmitting(true);
    try {
      let finalDescricao = "";
      let pontosAAplicar = editingEntry.pontos;
      let extraData: Partial<LancamentoPonto> = {};

      if (editingEntry.tipoAcao === "treinamento") {
        if (!editEmpresa) {
          toast.error("Preencha a empresa.");
          setSubmitting(false);
          return;
        }
        if (editTemas.length === 0) {
          toast.error("Selecione pelo menos um tema.");
          setSubmitting(false);
          return;
        }
        if (!editDataSolicitacao || !editDataRealizacao) {
          toast.error("Preencha as datas.");
          setSubmitting(false);
          return;
        }
        if (!CanceladoOuAusente && !editTempoAgenda.trim()) {
          toast.error("Preencha o tempo de agenda.");
          setSubmitting(false);
          return;
        }

        const normalizedEditTemas = editTemas.map((t) =>
          t.trim().toLowerCase(),
        );
        const isZeroPoints =
          normalizedEditTemas.includes("cancelado") ||
          normalizedEditTemas.includes("ausente");

        const actionConfig = ACOES_DISPONIVEIS.find(
          (a) => a.tipo === "treinamento",
        );
        pontosAAplicar = isZeroPoints ? 0 : (actionConfig?.pontos ?? 1);

        const formatarDataInput = (dataStr: string) => {
          if (!dataStr) return "";
          const [y, m, d] = dataStr.split("-");
          return `${d}/${m}/${y}`;
        };

        const dataSol = formatarDataInput(editDataSolicitacao);
        const dataReal = formatarDataInput(editDataRealizacao);

        const validNotas = editNotas
          .map((n) => parseInt(n, 10))
          .filter((n) => !isNaN(n));

        if (validNotas.some((n) => n < 0 || n > 10)) {
          toast.error("As notas devem ser valores inteiros entre 0 e 10.");
          setSubmitting(false);
          return;
        }

        const computedMedia =
          validNotas.length > 0
            ? parseFloat(
                (
                  validNotas.reduce((sum, n) => sum + n, 0) / validNotas.length
                ).toFixed(2),
              )
            : null;

        const validResultados = editResultados.filter(
          (r) => r === "Bom" || r === "Ruim",
        );
        if (editResultados.some((r) => r !== "" && r !== "Bom" && r !== "Ruim")) {
          toast.error("Cada resultado deve ser 'Bom' ou 'Ruim'.");
          setSubmitting(false);
          return;
        }

        finalDescricao = `Empresa: ${editEmpresa} | Tema: ${editTemas.join(", ")} | Solicitado: ${dataSol} | Realizado: ${dataReal} | Tempo: ${editTempoAgenda.trim()} | Solicitante: ${editSolicitante}`;

        if (validNotas.length > 0) {
          finalDescricao += ` | Notas: [${validNotas.join(", ")}] (Média: ${computedMedia})`;
        }
        if (validResultados.length > 0) {
          const bons = validResultados.filter((r) => r === "Bom").length;
          const ruins = validResultados.filter((r) => r === "Ruim").length;
          finalDescricao += ` | Resultados: [${validResultados.join(", ")}] (Bons: ${bons}, Ruins: ${ruins})`;
        }
        if (editDescricao.trim()) {
          finalDescricao += ` | Obs: ${editDescricao.trim()}`;
        }

        extraData = {
          treinamentoEmpresa: editEmpresa,
          treinamentoTema: editTemas.join(", "),
          treinamentoDataSolicitacao: editDataSolicitacao,
          treinamentoDataRealizacao: editDataRealizacao,
          treinamentoTempoAgenda: editTempoAgenda.trim(),
          treinamentoSolicitante: editSolicitante,
          treinamentoNotas: validNotas,
          treinamentoNotaMedia: computedMedia,
          treinamentoResultados: validResultados,
        };
      } else {
        finalDescricao = editDescricao.trim();
      }

      await atualizarLancamentoPonto(editingEntry.id, {
        descricao: finalDescricao,
        pontos: pontosAAplicar,
        ...extraData,
      });

      toast.success("Lançamento atualizado com sucesso!");
      setEditingEntry(null);
      // Reload points list
      const novaLista = await listarLancamentosPontos();
      setEntries(novaLista);
    } catch (error) {
      console.error("Erro ao atualizar lançamento:", error);
      toast.error("Erro ao salvar alterações.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleExcluir = async (id: string) => {
    if (exclusaoEmAndamentoRef.current) return;
    const entry = entries.find(e => e.id === id);
    if (!entry) return;
    if (entry.tipoAcao === "treinamento" && (role !== "master" || pontoOcorrenciaMap[id])) {
      toast.error("Este ponto de treinamento não pode ser removido por aqui.");
      return;
    }
    exclusaoEmAndamentoRef.current = true;
    setDeletingId(id);
    try {
      if (entry.tipoAcao === "treinamento") await removerPontoTreinamentoExcedente(id);
      else await removerLancamentoPonto(id);
      toast.success("Lançamento cancelado com sucesso!");
      setConfirmarExclusaoId(null);
      setEntries(atual => atual.filter(e => e.id !== id));
    } catch (error) {
      console.error("Erro ao excluir lançamento:", error);
      toast.error(error instanceof Error ? error.message : "Erro ao remover o lançamento.");
    } finally {
      exclusaoEmAndamentoRef.current = false;
      setDeletingId(null);
    }
  };

  const formatarData = (timestamp: number) => {
    return new Date(timestamp).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const entryParaExcluir = entries.find((e) => e.id === confirmarExclusaoId);

  return (
    <div className="gamificacao-page">
      <div className="gamificacao-glow"></div>

      <header className="gamificacao-header">
        <div className="gamificacao-header-top">
          <div>
            <h1>Gamificação dos Treinadores</h1>
            <p>
              Acompanhe sua evolução, entenda seus pontos e reconheça as entregas
              da equipe.
            </p>
          </div>
          <div className="gamificacao-header-acoes">
            {podeVerIndicadores && (
              <button
                type="button"
                className={`btn-indicadores ${theme === "light" ? "btn-indicadores-light" : ""}`}
                onClick={() => setShowIndicadoresModal(true)}
              >
                <BarChart3 size={18} />
                Indicadores
              </button>
            )}
            {podeDistribuir && (
              <button
                type="button"
                className={`btn-distribuir-cliente ${theme === "light" ? "btn-distribuir-cliente-light" : ""}`}
                onClick={() => setShowDistribuicaoModal(true)}
              >
                <Shuffle size={18} />
                Próximo Cliente
              </button>
            )}
          </div>
        </div>
      </header>

      {loading ? (
        <div className="page-loader">
          <div className="spinner"></div>
          <p>Carregando dados da gamificação...</p>
        </div>
      ) : erroCarregamento ? (
        <div className="gp-carregamento-erro" role="alert">
          <p>{erroCarregamento}</p>
          <button type="button" className="gp-ver-atividades" onClick={carregarDados}>Tentar novamente</button>
        </div>
      ) : (
        <>
          {/* Barra de Filtros de Período */}
          <div className="gamificacao-filtros-bar">
            <div className="filtro-titulo-wrapper">
              <h3>Período do ranking</h3>
              <p className="gp-periodo-ajuda">Aplica-se ao pódio, ao desempenho e às atividades.</p>
            </div>
            <div className="filtro-inputs-wrapper">
              <div className="filtros-data-grupo">
                <label htmlFor="filtro-data-inicio">De</label>
                <input
                  id="filtro-data-inicio"
                  type="date"
                  value={filtroDataInicio}
                  onChange={(e) => setFiltroDataInicio(e.target.value)}
                />
              </div>
              <div className="filtros-data-grupo">
                <label htmlFor="filtro-data-fim">Até</label>
                <input
                  id="filtro-data-fim"
                  type="date"
                  value={filtroDataFim}
                  onChange={(e) => setFiltroDataFim(e.target.value)}
                />
              </div>
              {(filtroDataInicio || filtroDataFim) && (
                <button
                  type="button"
                  className="btn-limpar-filtros"
                  onClick={() => {
                    setFiltroDataInicio("");
                    setFiltroDataFim("");
                  }}
                >
                  Todo o período
                </button>
              )}
            </div>
          </div>

          <PainelGamificacao
            ranking={rankedTrainers}
            fotosPerfil={fotosPerfil}
            usuarioId={user?.uid}
            periodo={filtroDataInicio || filtroDataFim
              ? `${filtroDataInicio ? filtroDataInicio.split("-").reverse().join("/") : "Início"} a ${filtroDataFim ? filtroDataFim.split("-").reverse().join("/") : "hoje"}`
              : "Todo o período"}
            rotulosAcoes={{ ...Object.fromEntries(ACOES_DISPONIVEIS.map((acao) => [acao.tipo, acao.label])), ...LABELS_TIPO_ACAO_SISTEMA }}
            onVerAtividades={(treinadorId) => {
              setFiltroTreinadorId(treinadorId);
              setFiltroTipoAcao("");
              historicoRef.current?.focus({ preventScroll: true });
              historicoRef.current?.scrollIntoView({
                block: "start",
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
              });
            }}
          />

          <div className="gamificacao-grid gamificacao-operacao-grid">
            {/* Coluna da Direita: Lançar e Histórico */}
            <div className="actions-column">
              {/* Bloco 1: Lançar Pontos */}
              {acoesFiltradas.length === 0 ? (
                <section className="gamificacao-card lancar-section">
                  <h2>
                    <PlusCircle size={20} className="card-icon" />
                    Registrar Nova Ação
                  </h2>
                  <div
                    style={{
                      padding: "16px",
                      color: "var(--text-secondary, var(--lt-texto-a0aec0, #a0aec0))",
                      fontSize: "14px",
                      lineHeight: "1.6",
                    }}
                  >
                    <p style={{ marginBottom: "12px" }}>
                      O registro de treinamentos agora deve ser realizado
                      através da aba <strong>Histórico</strong>, registrando a
                      ocorrência correspondente.
                    </p>
                    <p>
                      Dessa forma, seus pontos serão computados e exibidos aqui
                      na Gamificação de maneira <strong>100% automática</strong>
                      .
                    </p>
                  </div>
                </section>
              ) : (
                <section className="gamificacao-card lancar-section">
                  <h2>
                    <PlusCircle size={20} className="card-icon" />
                    Registrar Nova Ação
                  </h2>

                  <form onSubmit={handleLancar} className="lancar-form">
                    <div className="input-group">
                      <label
                        htmlFor={
                          role === "master" ? "trainer-select" : "trainer-input"
                        }
                      >
                        Treinador
                      </label>
                      <div className="input-wrapper">
                        <User className="input-icon" size={18} />
                        {role === "master" ? (
                          <select
                            id="trainer-select"
                            value={selectedTrainerUid}
                            onChange={(e) =>
                              setSelectedTrainerUid(e.target.value)
                            }
                            required
                            disabled={submitting}
                          >
                            {trainers.map((t) => (
                              <option key={t.uid} value={t.uid}>
                                {formatarNome(t.nome) || t.email}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            id="trainer-input"
                            value={userName || user?.email || ""}
                            readOnly
                            disabled
                            className="input-disabled"
                          />
                        )}
                      </div>
                    </div>

                    <div className="input-group">
                      <label>Ação Realizada</label>
                      <div className="acoes-radio-group">
                        {acoesFiltradas.map((acao) => {
                          const Icon = acao.icon;
                          const isSelected = selectedActionType === acao.tipo;
                          return (
                            <React.Fragment key={acao.tipo}>
                              <label
                                className={`acao-radio-card ${isSelected ? "selected" : ""} ${acao.colorClass}`}
                              >
                                <input
                                  type="radio"
                                  name="acao-tipo"
                                  value={acao.tipo}
                                  checked={isSelected}
                                  onChange={() =>
                                    setSelectedActionType(acao.tipo)
                                  }
                                  disabled={submitting}
                                />
                                <div className="acao-radio-content">
                                  <div className="acao-radio-left">
                                    <Icon className="acao-icon" size={18} />
                                    <div className="acao-radio-text">
                                      <span className="acao-label">
                                        {acao.label}
                                      </span>
                                      <span className="acao-desc">
                                        {acao.descricao}
                                      </span>
                                    </div>
                                  </div>
                                  <span className="acao-points-badge">
                                    {acao.pontos > 0
                                      ? `+${acao.pontos}`
                                      : acao.pontos}
                                  </span>
                                </div>
                              </label>
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>

                    <div className="input-group">
                      <label htmlFor="descricao-input">
                        Descrição / Detalhes (Opcional)
                      </label>
                      <textarea
                        id="descricao-input"
                        placeholder="Ex: Documentação de onboarding revisada, playbook criado..."
                        value={descricao}
                        onChange={(e) => setDescricao(e.target.value)}
                        disabled={submitting}
                        maxLength={150}
                        rows={2}
                      />
                    </div>

                    <button
                      type="submit"
                      className="btn-primary lancar-submit-btn"
                      disabled={submitting}
                    >
                      {submitting ? (
                        <div className="spinner"></div>
                      ) : (
                        "Lançar Pontuação"
                      )}
                    </button>
                  </form>
                </section>
              )}

              {/* Bloco 2: Histórico Recente */}
              <section className="gamificacao-card historico-section gp-historico" ref={historicoRef} tabIndex={-1} aria-label="Atividades recentes">
                <div className="section-header">
                  <h2>
                    <History size={20} className="card-icon" />
                    Atividades Recentes
                  </h2>
                </div>
                <div className="gp-historico-filtros">
                  <p>Filtros exclusivos das atividades. A classificação da equipe permanece baseada em todos os lançamentos do período.</p>
                  <div className="filtro-inputs-wrapper">
                    <div className="filtros-data-grupo">
                      <label htmlFor="filtro-treinador">Treinador</label>
                      <select
                        id="filtro-treinador"
                        value={filtroTreinadorId}
                        onChange={(e) => setFiltroTreinadorId(e.target.value)}
                      >
                        <option value="">Todos</option>
                        {trainers.map((t) => (
                          <option key={t.uid} value={t.uid}>
                            {formatarNome(t.nome) || t.email}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="filtros-data-grupo">
                      <label htmlFor="filtro-motivo">Motivo</label>
                      <select
                        id="filtro-motivo"
                        value={filtroTipoAcao}
                        onChange={(e) => setFiltroTipoAcao(e.target.value)}
                      >
                        <option value="">Todos</option>
                        {motivoOptions.map((m) => (
                          <option key={m.tipo} value={m.tipo}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {(filtroTreinadorId || filtroTipoAcao) && (
                      <button type="button" className="btn-limpar-filtros" onClick={() => {
                        setFiltroTreinadorId("");
                        setFiltroTipoAcao("");
                      }}>Limpar filtros do histórico</button>
                    )}
                  </div>
                </div>

                {historyEntries.length === 0 ? (
                  <p className="no-data-msg">
                    {entries.length === 0
                      ? "Nenhum lançamento de pontos registrado ainda."
                      : "Nenhum lançamento encontrado para os filtros selecionados."}
                  </p>
                ) : (
                  <div className="table-responsive">
                    <table className="gamificacao-table">
                      <thead>
                        <tr>
                          <th>Treinador</th>
                          <th>Ação</th>
                          <th>Detalhes</th>
                          <th>Data</th>
                          <th className="points-col">Pontos</th>
                          <th className="action-col"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {historyEntries.map((entry) => {
                          const actionConfig = ACOES_DISPONIVEIS.find(
                            (a) => a.tipo === entry.tipoAcao,
                          );
                          const ocInfo = pontoOcorrenciaMap[entry.id || ""];
                          const ocorrenciaId = ocInfo?.id || entry.ocorrenciaId;
                          const isAlerta = ocInfo?.alerta || entry.isAlerta;
                          const isCurrentUser = entry.treinadorId === user?.uid;
                          const perdeuPonto = entry.pontos < 0;
                          const isUserLostPoints = isCurrentUser && perdeuPonto;

                          return (
                            <tr
                              key={entry.id}
                              className={
                                isUserLostPoints ? "user-lost-points-row" : ""
                              }
                            >
                              <td className="trainer-cell">
                                {entry.treinadorNome}
                              </td>
                              <td className="action-cell">
                                <span className="action-label-text">
                                  {actionConfig
                                    ? actionConfig.label
                                    : LABELS_TIPO_ACAO_SISTEMA[entry.tipoAcao] ||
                                      entry.tipoAcao}
                                </span>
                              </td>
                              <td className="desc-cell" title={entry.descricao}>
                                {entry.descricao || "—"}
                              </td>
                              <td className="date-cell">
                                {formatarData(entry.dataLancamento)}
                              </td>
                              <td className="points-cell">
                                <span
                                  className={`points-tag ${
                                    entry.pontos > 0
                                      ? "tag-positive"
                                      : "tag-negative"
                                  }`}
                                >
                                  {entry.pontos > 0
                                    ? `+${entry.pontos}`
                                    : entry.pontos}
                                </span>
                              </td>
                              <td className="action-col">
                                <div className="action-buttons-wrapper">
                                  {ocorrenciaId && (
                                    <button
                                      className={`btn-view-occurrence ${isAlerta ? "alerta-ativo" : ""}`}
                                      onClick={() =>
                                        navigate(
                                          `/historico?ocorrencia=${ocorrenciaId}`,
                                        )
                                      }
                                      title={
                                        isAlerta
                                          ? "Ver ocorrência de treinamento (Alerta Ativo 🔥)"
                                          : "Ver ocorrência de treinamento"
                                      }
                                    >
                                      <Eye size={14} />
                                    </button>
                                  )}
                                  {entry.tipoAcao !== "treinamento" &&
                                    (role === "master" ||
                                      (entry.treinadorId === user?.uid &&
                                        entry.criadoPorId === user?.uid)) && (
                                      <button
                                        className="btn-edit-entry"
                                        onClick={() => handleStartEdit(entry)}
                                        title="Editar lançamento"
                                      >
                                        <Edit2 size={14} />
                                      </button>
                                    )}
                                  {(entry.tipoAcao === "treinamento"
                                    ? role === "master" && !ocInfo
                                    : (role === "master" ||
                                      (entry.tipoAcao !== "desconto_suporte" &&
                                        entry.tipoAcao !== "chamado_falha" &&
                                        entry.criadoPorId === user?.uid))) && (
                                      <button
                                        className="btn-delete-entry"
                                        onClick={() =>
                                          setConfirmarExclusaoId(
                                            entry.id || null,
                                          )
                                        }
                                        title={entry.tipoAcao === "treinamento" ? "Remover ponto excedente" : "Remover lançamento"}
                                        aria-label={entry.tipoAcao === "treinamento" ? "Remover ponto excedente" : "Remover lançamento"}
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </div>
        </>
      )}

      {/* Modal de Confirmação de Exclusão de Lançamento */}
      {confirmarExclusaoId && entryParaExcluir && (
        <div
          className="confirm-overlay"
          onClick={() => { if (!exclusaoEmAndamentoRef.current) setConfirmarExclusaoId(null); }}
        >
          <div ref={exclusaoModalRef} className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="exclusao-ponto-titulo" aria-describedby="exclusao-ponto-descricao" onClick={(e) => e.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !exclusaoEmAndamentoRef.current) setConfirmarExclusaoId(null);
              if (event.key !== "Tab") return;
              const botoes = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
              const primeiro = botoes[0], ultimo = botoes[botoes.length - 1];
              if (!primeiro) { event.preventDefault(); return; }
              if (event.shiftKey && document.activeElement === primeiro) { event.preventDefault(); ultimo.focus(); }
              else if (!event.shiftKey && document.activeElement === ultimo) { event.preventDefault(); primeiro.focus(); }
            }}>
            <div className="confirm-modal-header">
              <AlertTriangle className="confirm-modal-icon warning" size={24} />
              <h2 id="exclusao-ponto-titulo">{entryParaExcluir.tipoAcao === "treinamento" ? "Remover ponto excedente" : "Confirmar Cancelamento"}</h2>
            </div>
            <p id="exclusao-ponto-descricao" className="confirm-modal-text">
              Deseja realmente cancelar o lançamento de{" "}
              <strong>
                {entryParaExcluir.pontos > 0
                  ? `+${entryParaExcluir.pontos}`
                  : entryParaExcluir.pontos}{" "}
                pontos
              </strong>{" "}
              para <strong>{entryParaExcluir.treinadorNome}</strong>? A
              pontuação será ajustada no ranking imediatamente.
            </p>
            {entryParaExcluir.tipoAcao === "treinamento" && (
              <p className="confirm-modal-text">
                Empresa: <strong>{entryParaExcluir.treinamentoEmpresa || "—"}</strong>.
                Apenas este lançamento de pontos será excluído. O treinamento e as respostas do CSAT serão preservados. Esta ação não pode ser desfeita.
              </p>
            )}
            <div className="confirm-modal-actions">
              <button
                className="btn-excluir-confirm"
                onClick={() => handleExcluir(entryParaExcluir.id!)}
                disabled={deletingId !== null}
              >
                {deletingId ? (
                  <div className="spinner"></div>
                ) : (
                  "Confirmar exclusão"
                )}
              </button>
              <button
                className="btn-cancelar-confirm"
                onClick={() => setConfirmarExclusaoId(null)}
                disabled={deletingId !== null}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Edição de Lançamento */}
      {editingEntry && (
        <div className="confirm-overlay" onClick={() => setEditingEntry(null)}>
          <form
            className="edit-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSalvarEdicao}
          >
            <div className="edit-modal-header">
              <Edit2 className="card-icon" size={22} />
              <h2>Editar Lançamento</h2>
            </div>

            <div className="edit-modal-body">
              {editingEntry.tipoAcao === "treinamento" ? (
                <>
                  <div className="form-grid-2">
                    <div className="input-group">
                      <label htmlFor="edit-treinamento-empresa">
                        Nome da Empresa *
                      </label>
                      <SearchableSingleSelect
                        value={editEmpresa}
                        onChange={setEditEmpresa}
                        options={empresas}
                        placeholder="Selecione a empresa..."
                        disabled={submitting}
                      />
                    </div>

                    <div className="input-group">
                      <label>Temas *</label>
                      <SearchableSelect
                        value={editTemas}
                        onChange={setEditTemas}
                        options={TEMAS_GAMIFICACAO}
                        placeholder="Selecione ou pesquise os temas..."
                        disabled={submitting}
                      />
                    </div>
                  </div>

                  <div className="form-grid-2">
                    <div className="input-group">
                      <label htmlFor="edit-treinamento-data-solicitacao">
                        Data de Solicitação *
                      </label>
                      <input
                        type="date"
                        id="edit-treinamento-data-solicitacao"
                        value={editDataSolicitacao}
                        onChange={(e) => setEditDataSolicitacao(e.target.value)}
                        required
                      />
                    </div>

                    <div className="input-group">
                      <label htmlFor="edit-treinamento-data-realizacao">
                        Data da Realização *
                      </label>
                      <input
                        type="date"
                        id="edit-treinamento-data-realizacao"
                        value={editDataRealizacao}
                        onChange={(e) => setEditDataRealizacao(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-grid-2">
                    <div className="input-group">
                      <label htmlFor="edit-treinamento-tempo-agenda">
                        Tempo de Agenda{" "}
                        {editTemas.some(
                          (t) =>
                            t.trim().toLowerCase() === "cancelado" ||
                            t.trim().toLowerCase() === "ausente",
                        )
                          ? ""
                          : "*"}
                      </label>
                      <input
                        type="time"
                        id="edit-treinamento-tempo-agenda"
                        value={editTempoAgenda}
                        onChange={(e) => setEditTempoAgenda(e.target.value)}
                        required={
                          !editTemas.some(
                            (t) =>
                              t.trim().toLowerCase() === "cancelado" ||
                              t.trim().toLowerCase() === "ausente",
                          )
                        }
                      />
                    </div>

                    <div className="input-group">
                      <label htmlFor="edit-treinamento-solicitante">
                        Quem Solicitou *
                      </label>
                      <select
                        id="edit-treinamento-solicitante"
                        value={editSolicitante}
                        onChange={(e) => setEditSolicitante(e.target.value)}
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
                  </div>

                  <div className="treinamento-notas-section">
                    <div className="notas-section-header">
                      <label>Resultado do CSAT (Opcional)</label>
                      <button
                        type="button"
                        className="btn-add-nota-icon"
                        onClick={handleAddEditResultado}
                        title="Adicionar Resultado"
                      >
                        + Adicionar Resultado
                      </button>
                    </div>
                    {editResultados.length === 0 ? (
                      <span className="no-notas-msg">
                        Nenhum resultado registrado (treinamento sem resposta
                        CSAT).
                      </span>
                    ) : (
                      <div className="notas-inputs-grid">
                        {editResultados.map((resultado, idx) => (
                          <div key={idx} className="nota-input-row">
                            <select
                              className="nota-input-field"
                              value={resultado}
                              onChange={(e) =>
                                handleUpdateEditResultado(idx, e.target.value)
                              }
                              required
                            >
                              <option value="">Selecione...</option>
                              <option value="Bom">Bom</option>
                              <option value="Ruim">Ruim</option>
                            </select>
                            <button
                              type="button"
                              className="btn-remove-nota-icon"
                              onClick={() => handleRemoveEditResultado(idx)}
                              title="Remover resultado"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {editNotas.length > 0 && (
                      <span className="no-notas-msg">
                        Notas antigas (modelo 0 a 10) já registradas neste
                        treinamento: {editNotas.join(", ")}. Elas são
                        preservadas, mas não podem mais ser editadas.
                      </span>
                    )}
                  </div>

                  <div className="input-group">
                    <label htmlFor="edit-descricao-input">
                      Observações (Opcional)
                    </label>
                    <textarea
                      id="edit-descricao-input"
                      placeholder="Ex: Treinamento avançado de APIs..."
                      value={editDescricao}
                      onChange={(e) => setEditDescricao(e.target.value)}
                      maxLength={150}
                      rows={2}
                    />
                  </div>
                </>
              ) : (
                <div className="input-group">
                  <label htmlFor="edit-descricao-geral">
                    Descrição / Detalhes *
                  </label>
                  <textarea
                    id="edit-descricao-geral"
                    placeholder="Ex: Documentação de onboarding revisada..."
                    value={editDescricao}
                    onChange={(e) => setEditDescricao(e.target.value)}
                    required
                    maxLength={150}
                    rows={4}
                  />
                </div>
              )}
            </div>

            <div className="edit-modal-actions">
              <button
                type="submit"
                className="btn-edit-confirm"
                disabled={submitting}
              >
                {submitting ? (
                  <div className="spinner"></div>
                ) : (
                  "Salvar Alterações"
                )}
              </button>
              <button
                type="button"
                className="btn-cancelar-confirm"
                onClick={() => setEditingEntry(null)}
                disabled={submitting}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal de Distribuição do Próximo Cliente */}
      {showIndicadoresModal && podeVerIndicadores && (
        <div
          className="confirm-overlay"
          onClick={() => setShowIndicadoresModal(false)}
        >
          <div
            className="indicadores-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="indicadores-modal-header">
              <div className="indicadores-modal-title">
                <BarChart3 className="card-icon" size={22} />
                <div>
                  <h2>Indicadores por Treinador</h2>
                  <p className="indicadores-periodo-texto">
                    Período:{" "}
                    <strong>
                      {indicadoresDataInicio
                        ? new Date(indicadoresDataInicio + "T00:00:00").toLocaleDateString("pt-BR")
                        : "início"}
                      {" — "}
                      {indicadoresDataFim
                        ? new Date(indicadoresDataFim + "T00:00:00").toLocaleDateString("pt-BR")
                        : "hoje"}
                    </strong>
                  </p>
                </div>
              </div>
              <div className="indicadores-modal-header-actions">
                <div className="indicadores-filtros-periodo">
                  <div className="indicadores-filtro-grupo">
                    <label htmlFor="ind-data-inicio">De</label>
                    <input
                      id="ind-data-inicio"
                      type="date"
                      value={indicadoresDataInicio}
                      onChange={(e) => setIndicadoresDataInicio(e.target.value)}
                    />
                  </div>
                  <div className="indicadores-filtro-grupo">
                    <label htmlFor="ind-data-fim">Até</label>
                    <input
                      id="ind-data-fim"
                      type="date"
                      value={indicadoresDataFim}
                      onChange={(e) => setIndicadoresDataFim(e.target.value)}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-fechar-modal"
                  onClick={() => setShowIndicadoresModal(false)}
                  title="Fechar"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="indicadores-tabela-wrapper">
              {indicadoresExibidos.length === 0 ? (
                <p className="indicadores-vazio">
                  Nenhum treinador encontrado.
                </p>
              ) : (
                /* Indicadores nas linhas e treinadores nas colunas: são
                   indicadores fixos (poucos, ainda que crescentes) contra
                   poucos treinadores, então essa orientação cabe na largura
                   do modal sem rolagem lateral. */
                <table className="gamificacao-table indicadores-tabela">
                  <thead>
                    <tr>
                      <th className="indicadores-col-rotulo">Indicador</th>
                      {indicadoresExibidos.map((t) => (
                        <th key={t.uid}>{t.nome}</th>
                      ))}
                      <th className="indicadores-col-total">Total</th>
                      <th className="indicadores-col-meta">Meta</th>
                      <th className="indicadores-col-desvio">vs. meta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COLUNAS_INDICADORES.map((indicador, idx) => {
                      const comparacao = desvioDaMeta(idx);
                      return (
                        <tr key={indicador.chave}>
                          <td
                            className="indicadores-col-rotulo"
                            title={indicador.ajuda}
                          >
                            {indicador.titulo}
                          </td>
                          {indicadoresExibidos.map((t) => (
                            <td key={t.uid}>
                              {celulasPorTreinador[t.uid][idx]}
                            </td>
                          ))}
                          <td className="indicadores-col-total">
                            {celulasDoTotal[idx]}
                          </td>
                          <td className="indicadores-col-meta">
                            <div className="indicadores-meta-campo">
                              <input
                                type="number"
                                step="any"
                                inputMode="decimal"
                                placeholder="—"
                                aria-label={`Meta de ${indicador.titulo}`}
                                value={metas[indicador.chave] ?? ""}
                                onChange={(e) =>
                                  handleMetaChange(
                                    indicador.chave,
                                    e.target.value,
                                  )
                                }
                                readOnly={!podeEditarMetas}
                                disabled={!podeEditarMetas}
                              />
                              {indicador.unidade && (
                                <span className="indicadores-meta-unidade">
                                  {indicador.unidade}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="indicadores-col-desvio">
                            {comparacao === null ? (
                              <span className="indicadores-desvio-vazio">
                                —
                              </span>
                            ) : (
                              <span
                                className={`indicadores-desvio ${
                                  comparacao.positivo
                                    ? "indicadores-desvio-positivo"
                                    : "indicadores-desvio-negativo"
                                }`}
                                title={
                                  indicador.menorEhMelhor
                                    ? "Neste indicador, ficar abaixo da meta é o resultado desejado"
                                    : undefined
                                }
                              >
                                {comparacao.texto}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {podeEditarMetas && indicadoresExibidos.length > 0 && (
              <div className="indicadores-modal-footer">
                <button
                  type="button"
                  className="btn-salvar-metas"
                  onClick={handleSalvarMetas}
                  disabled={!metasAlteradas || salvandoMetas}
                >
                  {salvandoMetas ? "Salvando..." : "Salvar metas"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showDistribuicaoModal && (
        <div
          className="confirm-overlay"
          onClick={() => setShowDistribuicaoModal(false)}
        >
          <div
            className="distribuicao-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="distribuicao-modal-header">
              <div className="distribuicao-modal-title">
                <Shuffle className="card-icon" size={22} />
                <h2>Próximo Cliente</h2>
              </div>
              <button
                type="button"
                className="btn-fechar-modal"
                onClick={() => setShowDistribuicaoModal(false)}
                title="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            {distribuicaoRanking.length === 0 ? (
              <p className="no-data-msg">
                Nenhum treinador disponível para distribuição.
              </p>
            ) : (
              <>
                <p className="distribuicao-vencedor-label">
                  <UserCheck size={14} aria-hidden="true" />
                  Indicado para o próximo cliente:{" "}
                  <strong>
                    {formatarNome(distribuicaoRanking[0].nome) ||
                      distribuicaoRanking[0].email}
                  </strong>
                </p>

                <div className="distribuicao-lista">
                  {distribuicaoRanking.map((t, index) => (
                    <div
                      key={t.uid}
                      className={`distribuicao-item ${index === 0 ? "distribuicao-item-vencedor" : ""}`}
                    >
                      <div className="distribuicao-item-header">
                        <span className="distribuicao-posicao">
                          {index + 1}
                        </span>
                        <span className="distribuicao-nome">
                          {formatarNome(t.nome) || t.email}
                          {t.uid === user?.uid && (
                            <span className="me-badge">Você</span>
                          )}
                        </span>
                        <span className="distribuicao-score">
                          Carga: {formatarNumeroCarga(t.cargaDistribuicao)}
                        </span>
                      </div>
                      <MemoriaCarga item={t} />
                    </div>
                  ))}
                </div>

                <p className="distribuicao-modal-text">
                  Só entram treinamentos realizados nos últimos{" "}
                  <strong>{DIAS_JANELA_TREINAMENTOS} dias</strong>, com peso
                  decrescente conforme envelhecem: até 10 dias valem{" "}
                  <strong>1,5</strong>, de 11 a 15 dias <strong>1</strong>, de
                  16 a 30 dias <strong>0,5</strong> e, depois de 30 dias,{" "}
                  <strong>0</strong>. Cada cliente ativo vale o trabalho que
                  ainda falta na esteira (quem está quase concluindo pesa
                  menos), multiplicado pelo fator de capacidade definido no
                  cadastro do treinador.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
