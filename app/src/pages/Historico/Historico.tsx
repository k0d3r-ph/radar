import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  salvarOcorrencia,
  listarOcorrencias,
  removerOcorrencia,
} from "../../services/ocorrencias";
import { listarEmpresas, salvarEmpresas } from "../../services/empresas";
import { listarUsuarios } from "../../services/auth";
import type { UsuarioDocument } from "../../services/auth";
import {
  salvarLancamentoPonto,
  atualizarLancamentoPonto,
  removerLancamentoPonto,
} from "../../services/gamificacao";
import type { Ocorrencia, Empresa, OcorrenciaForm } from "../../types";
import "./Historico.css";
import { useAuth } from "../../context/AuthContext";
import { formatarNome } from "../../utils/formatarNome";
import { atribuirIdsOcorrencias } from "../../utils/empresaUtils";
import {
  Star,
  GraduationCap,
  Wrench,
  TrendingUp,
  Code,
  Cpu,
  Trash2,
  X,
} from "lucide-react";

const TIPOS = [
  "Informativa",
  "Financeira",
  "Comercial",
  "Treinamento",
  "Checkpoint",
  "Mudança de score",
  "Problema",
  "Dúvida",
];

const DEPARTAMENTO = [
  "Treinamento",
  "CS",
  "Suporte",
  "Hardware",
  "Comercial",
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
};

function getOcorrenciaTimestamp(o: Ocorrencia): number {
  if ((o.tipo === "Problema" || o.tipo === "Dúvida" || o.departamento === "Suporte") && o.dataOcorrencia && o.dataOcorrencia > 0) {
    return o.dataOcorrencia;
  }
  return o.createdAt ?? o.dataOcorrencia ?? 0;
}

const TEMPLATE_TREINAMENTO = `Participantes: \n\nNOTA: \n\nRelatório de treinamento:\n\n• Cliente se manteve atento? \n• Cliente absorveu o conteúdo aplicado?\n• Cliente foi participativo?\n• Houve alguma interrupção?\n• Ambiente favorável (Som)?\n• Manifestou alguma insatisfação?\n• Treinamento foi gravado?\n\nRelatório do atendimento:\n\nE-mail: \nNota:\nTexto: `;

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

function calcularPontuacao(respostas: ScoreFormAnswers): { score: number; tipo: "Fast" | "Safety" } {
  let score = 0;

  if (respostas.facilContato === "Sim") score += 0.5;

  if (respostas.entraComputador === "Sim") {
    score += 1.0;
  } else if (respostas.entraComputador === "Não") {
    score -= 1.0;
  }

  if (respostas.compartilhaTela === "Sim") score += 1.0;
  if (respostas.fazPerguntas === "Sim") score += 1.5;
  if (respostas.recordaTemas === "Sim") score += 2.0;

  if (respostas.faltouDoisDias === "Sim") {
    score -= 1.0;
  } else if (respostas.faltouDoisDias === "Não") {
    score += 1.0;
  }

  if (respostas.estruturaNecessaria === "Sim") score += 1.0;

  if (respostas.clienteReclamante === "Sim") {
    score -= 3.0;
  } else if (respostas.clienteReclamante === "Não") {
    score += 2.0;
  }

  if (respostas.clienteSumido === "Sim") score -= 5.0;

  const tipo = score >= 6 ? "Fast" : "Safety";
  return { score, tipo };
}

function descreverMudancas(antigo: ScoreFormAnswers, novo: ScoreFormAnswers): string[] {
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
    mudancas.push(`- Contato com o cliente: de "${descreverFacilContato(antigo.facilContato)}" para "${descreverFacilContato(novo.facilContato)}"`);
  }
  if (antigo.entraComputador !== novo.entraComputador) {
    mudancas.push(`- Cliente entra pelo computador: de "${descreverEntraComputador(antigo.entraComputador)}" para "${descreverEntraComputador(novo.entraComputador)}"`);
  }
  if (antigo.compartilhaTela !== novo.compartilhaTela) {
    mudancas.push(`- Cliente compartilha a tela: de "${descreverSimNao(antigo.compartilhaTela)}" para "${descreverSimNao(novo.compartilhaTela)}"`);
  }
  if (antigo.fazPerguntas !== novo.fazPerguntas) {
    mudancas.push(`- Cliente faz perguntas: de "${descreverSimNao(antigo.fazPerguntas)}" para "${descreverSimNao(novo.fazPerguntas)}"`);
  }
  if (antigo.recordaTemas !== novo.recordaTemas) {
    mudancas.push(`- Cliente se recorda de temas anteriores: de "${descreverSimNao(antigo.recordaTemas)}" para "${descreverSimNao(novo.recordaTemas)}"`);
  }
  if (antigo.faltouDoisDias !== novo.faltouDoisDias) {
    mudancas.push(`- Cliente faltou 2 dias seguidos: de "${descreverFaltouDoisDias(antigo.faltouDoisDias)}" para "${descreverFaltouDoisDias(novo.faltouDoisDias)}"`);
  }
  if (antigo.estruturaNecessaria !== novo.estruturaNecessaria) {
    mudancas.push(`- Cliente possui estrutura necessária: de "${descreverEstrutura(antigo.estruturaNecessaria)}" para "${descreverEstrutura(novo.estruturaNecessaria)}"`);
  }
  if (antigo.clienteReclamante !== novo.clienteReclamante) {
    mudancas.push(`- Cliente é reclamante: de "${descreverReclamante(antigo.clienteReclamante)}" para "${descreverReclamante(novo.clienteReclamante)}"`);
  }
  if (antigo.clienteSumido !== novo.clienteSumido) {
    mudancas.push(`- Cliente sumiu: de "${descreverSumico(antigo.clienteSumido)}" para "${descreverSumico(novo.clienteSumido)}"`);
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
    `- Cliente sumiu: "${descreverSumico(respostas.clienteSumido)}"`
  ];
}


export function Historico() {
  const { role, userName, user } = useAuth();
  const isTreinador = role === "treinador" || role === "master";
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [modalScoreAberto, setModalScoreAberto] = useState(false);
  const [respostasScore, setRespostasScore] = useState<ScoreFormAnswers>({ ...INITIAL_SCORE_ANSWERS });
  const [calculoScoreResult, setCalculoScoreResult] = useState<{ score: number; tipo: "Fast" | "Safety" } | null>(null);
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
  const [filtroTipo, setFiltroTipo] = useState(() => searchParams.get("tipo") || "");
  const [filtroDepto, setFiltroDepto] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [ordenacaoData, setOrdenacaoData] = useState<"desc" | "asc">("desc");
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [painelAberto, setPainelAberto] = useState(false);
  const [usarTemplate, setUsarTemplate] = useState(true);
  const [temaOcorrenciaOngoingText, setTemaOcorrenciaOngoingText] = useState("");
  const [isRevisao, setIsRevisao] = useState(false);

  const handleAddNota = () => {
    setForm((f) => ({
      ...f,
      treinamentoNotas: [...(f.treinamentoNotas ?? []), ""],
    }));
  };

  const handleUpdateNota = (index: number, val: string) => {
    setForm((f) => {
      const copy = [...(f.treinamentoNotas ?? [])];
      copy[index] = val;
      return { ...f, treinamentoNotas: copy };
    });
  };

  const handleRemoveNota = (index: number) => {
    setForm((f) => ({
      ...f,
      treinamentoNotas: (f.treinamentoNotas ?? []).filter((_, i) => i !== index),
    }));
  };
  const empresaFiltro = searchParams.get("empresa") || "";
  const ocorrenciaIdFiltro = searchParams.get("ocorrencia") || "";

  useEffect(() => {
    if (!loading && ocorrenciaIdFiltro && ocorrencias.length > 0) {
      const encontrada = ocorrencias.find((o) => o.id === ocorrenciaIdFiltro);
      if (encontrada) {
        setSelecionada(encontrada);
      }
    }
  }, [loading, ocorrenciaIdFiltro, ocorrencias]);


  const temAusenteOuCancelado = form.temaOcorrencia?.some(t => t === "Ausente" || t === "Cancelado") ?? false;
  const temOutrosTemas = form.temaOcorrencia?.some(t => t !== "Ausente" && t !== "Cancelado") ?? false;
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
    const updatedSelected = novasOcs.find(o => o.id === selecionada!.id);
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
      const updatedSelected = novasOcs.find(o => o.id === selecionada!.id);
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
            const updatedSelected = novasOcs.find(o => o.id === selecionada.id);
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
        setForm(f => ({ ...f, descricao: TEMPLATE_TREINAMENTO }));
      }
    } else {
      if (form.descricao === TEMPLATE_TREINAMENTO) {
        setForm(f => ({ ...f, descricao: "" }));
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
      return next;
    });
  }

  function abrirNovo() {
    const deptos = getAllowedDepartments();
    const deptoPadrao = deptos.length === 1 ? deptos[0] : "";
    setForm({ ...EMPTY, empresa: empresaFiltro || "", responsavel: userName, departamento: deptoPadrao });
    setTemaOcorrenciaOngoingText("");
    setEditandoId(null);
    setUsarTemplate(true);
    setCalculoScoreResult(null);
    setRespostasScore({ ...INITIAL_SCORE_ANSWERS });
    setPainelAberto(true);
    setIsRevisao(false);
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
      treinamentoNotas: o.treinamentoNotas ? o.treinamentoNotas.map(String) : [],
    });
    setTemaOcorrenciaOngoingText(o.temaOcorrencia?.join(", ") ?? "");
    setEditandoId(o.id ?? null);
    setCalculoScoreResult(null);
    setRespostasScore({ ...INITIAL_SCORE_ANSWERS });
    setPainelAberto(true);
    setIsRevisao(o.isRevisao ?? false);
  }

  function cancelar() {
    setPainelAberto(false);
    setForm({ ...EMPTY });
    setTemaOcorrenciaOngoingText("");
    setEditandoId(null);
    setUsarTemplate(true);
    setCalculoScoreResult(null);
    setRespostasScore({ ...INITIAL_SCORE_ANSWERS });
    setIsRevisao(false);
  }

  function normalizar(str: string) {
    return str.trim().toLowerCase().replace(/&amp;/g, "&").replace(/\s+/g, " ");
  }

  async function salvar() {
    const responsavelFinal = formatarNome(editandoId ? form.responsavel : userName);

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
      (e) => normalizar(e.nomeEmpresa) === normalizar(form.empresa)
    );

    if (!empresaObjeto) {
      toast.error("A empresa especificada não foi encontrada. Selecione uma empresa cadastrada válida.");
      return;
    }

    if (form.tipo === "Treinamento") {
      const CanceladoOuAusente = (form.temaOcorrencia ?? []).some(
        (t) => t.trim().toLowerCase() === "cancelado" || t.trim().toLowerCase() === "ausente"
      );

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

      const rawNotas = form.treinamentoNotas ?? [];
      const hasInvalidNota = rawNotas.some(
        (n) => n.trim() === "" || isNaN(parseInt(n, 10)) || parseInt(n, 10) < 1 || parseInt(n, 10) > 5
      );
      if (hasInvalidNota) {
        toast.error("As notas preenchidas devem ser valores inteiros entre 1 e 5.");
        return;
      }
    }

    if (form.tipo === "Checkpoint" && !form.dataOcorrencia) {
      toast.error("A data do checkpoint é obrigatória.");
      return;
    }

    const isOngoing = empresaObjeto.isOngoing ?? false;

    if (isTreinador && !editandoId && (form.tipo === "Informativa" || form.tipo === "Treinamento") && !calculoScoreResult && !isOngoing) {
      toast.error("O cálculo de score é obrigatório para ocorrências do tipo Informativa ou Treinamento.");
      return;
    }

    let timestamp = 0;
    if (form.dataOcorrencia) {
      const [year, month, day] = form.dataOcorrencia.split("-").map(Number);
      const [hours, minutes] = (form.horaOcorrencia || "00:00")
        .split(":")
        .map(Number);
      timestamp = new Date(year, month - 1, day, hours, minutes).getTime();
    }

    const ocorrenciaOriginal = editandoId
      ? ocorrencias.find((o) => o.id === editandoId)
      : null;

    const novaDescricao = form.descricao.trim();

    let dataRealizacaoStr = "";
    let computedMedia: number | null = null;
    let validNotas: number[] = [];

    if (form.tipo === "Treinamento") {
      validNotas = (form.treinamentoNotas ?? [])
        .map((n) => parseInt(n, 10))
        .filter((n) => !isNaN(n));
      computedMedia = validNotas.length > 0
        ? parseFloat((validNotas.reduce((sum, n) => sum + n, 0) / validNotas.length).toFixed(2))
        : null;

      let d: Date;
      if (form.dataOcorrencia) {
        const [year, month, day] = form.dataOcorrencia.split("-").map(Number);
        d = new Date(year, month - 1, day);
      } else {
        d = new Date();
      }
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      dataRealizacaoStr = `${year}-${month}-${day}`;
    }

    // Quando for revisão, os temas recebem prefixo "Revisão de" (exceto Ausente/Cancelado)
    const temaOcorrenciaFinal = form.tipo === "Treinamento" && isRevisao
      ? (form.temaOcorrencia ?? []).map((t) =>
          t.trim().toLowerCase() === "ausente" || t.trim().toLowerCase() === "cancelado"
            ? t
            : `Revisão de ${t}`
        )
      : (form.temaOcorrencia ?? []);

    const base: Ocorrencia = {
      ...form,
      empresa: form.empresa.trim(),
      descricao: novaDescricao,
      responsavel: responsavelFinal,
      dataOcorrencia: timestamp,
      atualizacoes: ocorrenciaOriginal?.atualizacoes ?? [],
      scoreCalculado: calculoScoreResult ? calculoScoreResult.score : ocorrenciaOriginal?.scoreCalculado,
      scoreAnswers: calculoScoreResult ? respostasScore : ocorrenciaOriginal?.scoreAnswers,
      temaOcorrencia: temaOcorrenciaFinal,
      isRevisao: form.tipo === "Treinamento" ? isRevisao : undefined,
      ...(form.tipo === "Treinamento" ? {
        treinamentoDataSolicitacao: form.treinamentoDataSolicitacao,
        treinamentoTempoAgenda: form.treinamentoTempoAgenda,
        treinamentoSolicitante: form.treinamentoSolicitante,
        treinamentoNotas: validNotas,
        treinamentoNotaMedia: computedMedia,
      } : {
        treinamentoDataSolicitacao: undefined,
        treinamentoTempoAgenda: undefined,
        treinamentoSolicitante: undefined,
        treinamentoNotas: undefined,
        treinamentoNotaMedia: undefined,
        gamificacaoPontoId: undefined,
      })
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
        scoreAnswers: respostasScore,
        updatedAt: Date.now()
      });

      // Gera a ocorrência se for o primeiro cálculo OU se o tipo mudou.
      const isPrimeiroCalculo = typeof antigoScore !== "number";
      const tipoMudou = antigoTipo !== novoTipo;
      const deveGerarOcorrencia = isPrimeiroCalculo || tipoMudou;

      if (deveGerarOcorrencia) {
        let descMudanca: string;
        if (isPrimeiroCalculo) {
          const marcadas = descreverRespostas(respostasScore);
          const marcadasTexto = marcadas.length > 0 ? "\n\nRespostas marcadas:\n" + marcadas.join("\n") : "";
          descMudanca = `Cálculo inicial de score: ${novoTipo}

Score atual: ${novoScore}${marcadasTexto}`;
        } else {
          let mudancasTexto = "";
          if (empresaObjeto.scoreAnswers) {
            const mudancas = descreverMudancas(empresaObjeto.scoreAnswers, respostasScore);
            if (mudancas.length > 0) {
              mudancasTexto = "\n\nAlterações detalhadas:\n" + mudancas.join("\n");
            }
          }

          descMudanca = `Mudança de score de ${antigoTipo || "Sem tipo"} para ${novoTipo}

Score antigo: ${antigoScore}
Score atual: ${novoScore}${mudancasTexto}`;
        }

        await salvarOcorrencia({
          empresa: form.empresa,
          tipo: "Mudança de score",
          descricao: descMudanca,
          responsavel: responsavelFinal,
          departamento: form.departamento || "CS",
          dataOcorrencia: 0
        });
      }
    }

    // Se a ocorrência foi desmarcada como retirarAlerta mas tinha um alertaOriginalId vinculado
    if (editandoId && !form.retirarAlerta && ocorrenciaOriginal?.alertaOriginalId) {
      const origDoc = ocorrencias.find((o) => o.id === ocorrenciaOriginal.alertaOriginalId);
      if (origDoc) {
        await salvarOcorrencia({
          ...origDoc,
          alertaResolvidoPorId: "",
        });
      }
      base.alertaOriginalId = "";
    }

    // Se a ocorrência foi desmarcada como alerta mas tinha um alertaResolvidoPorId vinculado
    if (editandoId && !form.alerta && ocorrenciaOriginal?.alertaResolvidoPorId) {
      const resDoc = ocorrencias.find((o) => o.id === ocorrenciaOriginal.alertaResolvidoPorId);
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
        (t) => t.trim().toLowerCase() === "cancelado" || t.trim().toLowerCase() === "ausente"
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

      if (novaDescricao) {
        finalDescricao += ` | Obs: ${novaDescricao}`;
      }

      let finalTreinadorId = user.uid;
      let finalTreinadorNome = formatarNome(userName) || user.email || "Treinador";

      if (usuariosList.length > 0 && responsavelFinal) {
        const trainerObj = usuariosList.find(
          (u) => formatarNome(u.nome).toLowerCase() === formatarNome(responsavelFinal).toLowerCase()
        );
        if (trainerObj) {
          finalTreinadorId = trainerObj.uid;
          finalTreinadorNome = formatarNome(trainerObj.nome) || trainerObj.email || "Treinador";
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
      };

      if (pontoId) {
        try {
          await atualizarLancamentoPonto(pontoId, lancamentoDados);
        } catch (error) {
          console.error("Erro ao atualizar lançamento de ponto:", error);
          pontoId = await salvarLancamentoPonto(lancamentoDados);
        }
      } else {
        pontoId = await salvarLancamentoPonto(lancamentoDados);
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

    const savedId = await salvarOcorrencia(editandoId ? { ...base, id: editandoId } : base);

    if (pontoId) {
      try {
        await atualizarLancamentoPonto(pontoId, {
          ocorrenciaId: savedId,
          isAlerta: form.alerta || false,
        });
      } catch (error) {
        console.error("Erro ao vincular ocorrência ao ponto de gamificação:", error);
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
            o.id !== savedId
        )
        .sort((a, b) => (b.dataOcorrencia || b.createdAt || 0) - (a.dataOcorrencia || a.createdAt || 0))[0];

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
      empresaObjeto
    ) {
      const temasValidos = (form.temaOcorrencia ?? []).filter(
        (t) => t.trim().toLowerCase() !== "ausente" && t.trim().toLowerCase() !== "cancelado"
      );

      if (temasValidos.length > 0) {
        const normTema = (s: string) =>
          s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        const linhasTema = (empresaObjeto.temaText || "").split("\n").map((l) => l.trim());
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
          // Cópias mutáveis para reordenar sem afetar as originais
          const newTemas = [...linhasTema];
          const newDatas = [...linhasData];

          // Marca a data nos temas ensinados (posições originais nos arrays copiados)
          indicesEnsinados.forEach((idx) => {
            newDatas[idx] = dataStr;
          });

          // Reordena: temas ensinados "fora de sequência" (com gap) são puxados
          // para ficarem contíguos logo após o último tema ensinado consecutivo.
          // Ex: [Gateway(2), Rastreador(3), Videotelemetria(6)]
          //  → Videotelemetria é movido para posição 4; Tema4 e Tema5 vão para 5 e 6.
          let lastInsertedAt = indicesEnsinados[0];

          for (let i = 1; i < indicesEnsinados.length; i++) {
            const temaAlvo = linhasTema[indicesEnsinados[i]];

            // Procura a posição atual desse tema no array já em mutação
            const posAtual = newTemas.findIndex(
              (t, pos) => pos > lastInsertedAt && normTema(t) === normTema(temaAlvo)
            );

            if (posAtual === lastInsertedAt + 1) {
              // Já é contíguo — sem mover
              lastInsertedAt = posAtual;
            } else if (posAtual > lastInsertedAt + 1) {
              // Há gap → puxa para logo após o último ensinado consecutivo
              const [tRemovido] = newTemas.splice(posAtual, 1);
              const [dRemovido] = newDatas.splice(posAtual, 1);
              newTemas.splice(lastInsertedAt + 1, 0, tRemovido);
              newDatas.splice(lastInsertedAt + 1, 0, dRemovido);
              lastInsertedAt = lastInsertedAt + 1;
            }
          }

          const ultimoIndice = lastInsertedAt;
          const novoTemaText = newTemas.join("\n");
          const novoDataText = newDatas.join("\n");

          await salvarEmpresas({
            ...empresaObjeto,
            // Preserva o score/tipo que possa ter sido atualizado mais cedo neste mesmo salvar()
            ...(calculoScoreResult ? {
              score: calculoScoreResult.score,
              tipo: calculoScoreResult.tipo,
              scoreAnswers: respostasScore,
            } : {}),
            temaText: novoTemaText,
            dataText: novoDataText,
            currentPhase: Math.max(empresaObjeto.currentPhase ?? 0, ultimoIndice),
            updatedAt: Date.now(),
          });
        }
      }
    }

    await carregar();
    setSalvando(false);
    cancelar();
    toast.success(
      editandoId ? "Ocorrência atualizada!" : "Ocorrência registrada!",
    );
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
                (e) => normalizar(e.nomeEmpresa) === normalizar(oc.empresa)
              );
              if (empresaObjeto) {
                await salvarEmpresas({
                  ...empresaObjeto,
                  score: null as any,
                  scoreAnswers: null as any,
                  tipo: "",
                  updatedAt: Date.now()
                });
              }
            }

            // Se for um alerta com resolução vinculada, limpa a referência na resolução
            if (oc.alerta && oc.alertaResolvidoPorId) {
              const resDoc = ocorrencias.find((o) => o.id === oc.alertaResolvidoPorId);
              if (resDoc) {
                await salvarOcorrencia({
                  ...resDoc,
                  alertaOriginalId: "",
                });
              }
            }

            // Se for uma resolução de alerta, limpa a referência no alerta original
            if (oc.retirarAlerta && oc.alertaOriginalId) {
              const origDoc = ocorrencias.find((o) => o.id === oc.alertaOriginalId);
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
                console.error("Erro ao remover ponto da gamificação associado:", error);
              }
            }
          }
          await removerOcorrencia(id);
          await carregar();
          toast.success("Ocorrência removida.");
        },
      },
      cancel: { label: "Cancelar", onClick: () => { } },
      duration: 10000,
    });
  }

  const getAllowedTypes = () => {
    if (role === "master") {
      return ["Informativa", "Financeira", "Comercial", "Treinamento", "Checkpoint", "Problema", "Dúvida"];
    }
    if (role === "treinador") {
      return ["Informativa", "Treinamento", "Checkpoint", "Dúvida"];
    }
    if (role === "suporte") {
      return ["Informativa", "Problema", "Dúvida"];
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

  const filtradas = ocorrencias.filter((o) => {
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
      if (idLower === textoSemEspacos || idLower.replace("#", "") === textoSemEspacos) {
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

    const bateBusca = matchesText || matchesId;

    const empresaOk =
      !empresaFiltro || normalizar(o.empresa) === normalizar(empresaFiltro);

    const tipoOk = !filtroTipo || o.tipo === filtroTipo;
    const deptoOk = !filtroDepto || o.departamento === filtroDepto;

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

    return bateBusca && empresaOk && tipoOk && deptoOk && dataOk;
  }).sort((a, b) => {
    const tA = getOcorrenciaTimestamp(a);
    const tB = getOcorrenciaTimestamp(b);
    return ordenacaoData === "desc" ? tB - tA : tA - tB;
  });

  const selectedEmpresaObj = empresasList.find(
    (e) => normalizar(e.nomeEmpresa) === normalizar(form.empresa)
  );
  const isSelectedEmpresaOngoing = selectedEmpresaObj?.isOngoing ?? false;

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
                    (e) => e.nomeEmpresa.trim().toLowerCase() === empresaFiltro.trim().toLowerCase()
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
            <button className="btn-primary hist-btn-novo" onClick={abrirNovo}>
              + Nova ocorrência
            </button>
          </div>
        </div>
      </header>

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
            {TIPOS.map((t) => (
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

          {(busca || filtroTipo || filtroDepto || dataInicio || dataFim) && (
            <button
              className="btn-limpar-filtros"
              onClick={() => {
                setBusca("");
                setFiltroTipo("");
                setFiltroDepto("");
                setDataInicio("");
                setDataFim("");
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
                onClick={() => setOrdenacaoData((prev) => (prev === "desc" ? "asc" : "desc"))}
                style={{ cursor: "pointer", userSelect: "none" }}
                title="Clique para ordenar por data"
              >
                Data {ordenacaoData === "desc" ? "▼" : "▲"}
              </th>
              <th>Hora</th>
              <th>Departamento</th>
              <th>Tipo de registro</th>
              <th>Responsável</th>
              <th>ID</th>
            </tr>
          </thead>

          <tbody>
            {!loading &&
              filtradas.map((o) => {
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
                      {o.alerta && (
                        o.alertaResolvidoPorId ? (
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
                        )
                      )}
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
                      <span
                        className={`hist-item-tipo ${TIPO_CLASS[o.tipo] || ""}`}
                      >
                        {o.tipo}
                      </span>
                    </td>

                    <td>👤 {formatarNome(o.responsavel) || "—"}</td>

                    <td style={{ fontWeight: "600", color: "#64748b" }}>
                      {o.idSeqFormatted || "—"}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>

        <div className="hist-total-registros">
          Total: <strong>{filtradas.length}</strong> {filtradas.length === 1 ? "ocorrência" : "ocorrências"}
        </div>

        {selecionada && (

          <div className="hist-detail-overlay">
            <div
              className="hist-detail-card"
            >
              <div className="hist-detail-header">
                <h2>Detalhes da interação {selecionada.idSeqFormatted ? `(${selecionada.idSeqFormatted})` : ""}</h2>

                <button className="hist-detail-fechar" onClick={() => fecharDetalhe()} aria-label="Fechar detalhes">
                  <X size={18} />
                </button>
              </div>

              <div className="hist-detail-grid">
                {(() => {
                  if (selecionada.alerta) {
                    if (selecionada.alertaResolvidoPorId) {
                      const resDoc = ocorrencias.find((o) => o.id === selecionada.alertaResolvidoPorId);
                      return (
                        <div style={{ gridColumn: "span 2", marginBottom: "10px" }}>
                          <span style={{ color: "#16a34a", fontWeight: "bold", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                            ✅🚨 Alerta Solucionado {resDoc ? `em ${new Date(getOcorrenciaTimestamp(resDoc)).toLocaleDateString("pt-BR")}` : ""}.
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
                        <div style={{ gridColumn: "span 2", marginBottom: "10px" }}>
                          <span style={{ color: "#dc2626", fontWeight: "bold", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "6px" }}>
                            🚨 Ocorrência marcada como Alerta Ativo
                          </span>
                        </div>
                      );
                    }
                  }
                  if (selecionada.retirarAlerta) {
                    const origDoc = ocorrencias.find((o) => o.id === selecionada.alertaOriginalId);
                    return (
                      <div style={{ gridColumn: "span 2", marginBottom: "10px" }}>
                        <span style={{ color: "#16a34a", fontWeight: "bold", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                          ✅ Ocorrência marcada como Resolução de Alerta.
                          {origDoc && (
                            <span style={{ color: "#475569", display: "flex", alignItems: "center", gap: "5px", flexWrap: "wrap" }}>
                              Resolução do alerta criado em {new Date(getOcorrenciaTimestamp(origDoc)).toLocaleDateString("pt-BR")}.
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
                  <strong
                    className={`hist-item-tipo hist-item-tipo-detail ${TIPO_CLASS[selecionada.tipo]}`}
                  >
                    {selecionada.tipo}
                  </strong>
                </div>

                <div>
                  <span>Responsável</span>
                  <strong>{formatarNome(selecionada.responsavel) || "—"}</strong>
                </div>

                <div>
                  <span>Data da ocorrência</span>
                  <strong>
                    {new Date(
                      getOcorrenciaTimestamp(selecionada)
                    ).toLocaleDateString("pt-BR")}{" "}
                    {new Date(
                      getOcorrenciaTimestamp(selecionada)
                    ).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </strong>
                </div>

                {selecionada.createdAt && selecionada.dataOcorrencia > 0 && selecionada.tipo !== "Problema" && selecionada.tipo !== "Dúvida" && (
                  <div>
                    <span>
                      {selecionada.tipo === "Informativa" || selecionada.tipo === "Treinamento"
                        ? "Data do próximo treinamento"
                        : selecionada.tipo === "Checkpoint"
                        ? "Data do checkpoint"
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
                            if (selecionada.treinamentoDataSolicitacao.includes("-")) {
                              const [y, m, d] = selecionada.treinamentoDataSolicitacao.split("-");
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
                    {selecionada.treinamentoNotas && selecionada.treinamentoNotas.length > 0 && (
                      <div className="hist-detail-training-notes-wrapper">
                        <span>Notas do Treinamento (CSAT)</span>
                        <div className="hist-detail-training-notes-list">
                          {selecionada.treinamentoNotas.map((nota, idx) => (
                            <span key={idx} className="nota-treinamento-tag">
                              Nota {idx + 1}: {nota}
                            </span>
                          ))}
                          {selecionada.treinamentoNotaMedia !== undefined && selecionada.treinamentoNotaMedia !== null && (
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
                      <span>Temas abordados</span>
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
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span className="hist-atualizacao-meta">
                              Atualização em{" "}
                              {new Date(at.updatedAt).toLocaleDateString("pt-BR")}{" "}
                              {new Date(at.updatedAt).toLocaleTimeString("pt-BR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                              {at.responsavel ? ` · ${formatarNome(at.responsavel)}` : ""}
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
                                onChange={(e) => setEditingUpdateText(e.target.value)}
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
                            <p style={{ whiteSpace: "pre-wrap", marginTop: "4px" }}>{at.descricao}</p>
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
                {!novaAtualizacaoAberta && (role === "treinador" || role === "master" || (selecionada.responsavel && selecionada.responsavel.toLowerCase() === userName.toLowerCase())) && (
                  <button
                    className="btn-secondary btn-small"
                    onClick={() => setNovaAtualizacaoAberta(true)}
                  >
                    + Incluir nova atualização
                  </button>
                )}

                {(role === "treinador" || role === "master" || (selecionada.responsavel && selecionada.responsavel.toLowerCase() === userName.toLowerCase())) && (
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
              <button className="hist-fechar" onClick={cancelar} aria-label="Fechar painel">
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

            {(isTreinador || form.tipo === "Problema" || form.tipo === "Dúvida") && (
              <div className="hist-campo hist-campo-row">
                <div>
                  <label>
                    {(() => {
                      if (form.tipo === "Problema" || form.tipo === "Dúvida") {
                        return "Data da ocorrência (não obrigatório)";
                      }
                      if (form.tipo === "Informativa" || form.tipo === "Treinamento") {
                        return "Data do próximo treinamento (não obrigatório)";
                      }
                      if (form.tipo === "Checkpoint") {
                        return "Data do checkpoint *";
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

            {!editandoId && isTreinador && (form.tipo === "Informativa" || form.tipo === "Treinamento") && !isSelectedEmpresaOngoing && (
              <div className="hist-campo score-btn-container">
                <button
                  type="button"
                  className="btn-calcular-score"
                  onClick={() => setModalScoreAberto(true)}
                >
                  📊 Calcular Score do Cliente
                </button>
                {calculoScoreResult && (
                  <span className={`score-result-badge ${calculoScoreResult.tipo === "Safety" ? "score-result-badge--safety" : "score-result-badge--fast"}`}>
                    Score: <strong>{calculoScoreResult.score.toFixed(1)}</strong> ({calculoScoreResult.tipo}) ✅
                  </span>
                )}
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

            {form.tipo === "Treinamento" && (
              <div className="hist-campo">
                <label>Temas abordados</label>

                {/* Toggle de revisão */}
                {!isSelectedEmpresaOngoing && (
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
                      background: isRevisao ? "rgba(99,102,241,0.12)" : "rgba(255,255,255,0.04)",
                      border: isRevisao ? "1px solid rgba(99,102,241,0.4)" : "1px solid rgba(255,255,255,0.08)",
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
                      {isRevisao ? "(não avança a esteira — tags: \"Revisão de...\")" : "(marque se for revisão de temas anteriores)"}
                    </small>
                  </label>
                )}
                {isSelectedEmpresaOngoing ? (
                  <input
                    type="text"
                    value={temaOcorrenciaOngoingText}
                    onChange={(e) => {
                      const val = e.target.value;
                      setTemaOcorrenciaOngoingText(val);
                      setForm((f) => ({
                        ...f,
                        temaOcorrencia: val
                          ? val.split(",").map((t) => t.trim()).filter(Boolean)
                          : [],
                      }));
                    }}
                    placeholder="Digite os temas separados por vírgula..."
                  />
                ) : (
                  <div className="temas-lista">
                    {[
                      "Ausente",
                      "Cancelado",
                      ...(() => {
                        const empresa = empresasList.find(
                          (e) =>
                            normalizar(e.nomeEmpresa) ===
                            normalizar(form.empresa),
                        );
                        return empresa?.temaText
                          ? empresa.temaText
                            .trim()
                            .split(/\s{2,}|\n/)
                            .filter(Boolean)
                          : [];
                      })(),
                    ].map((tema) => (
                      <label key={tema} className="tema-opcao">
                        <input
                          type="checkbox"
                          checked={form.temaOcorrencia?.includes(tema) ?? false}
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
                      </label>
                    ))}
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
                      Tempo de agenda {
                        (form.temaOcorrencia ?? []).some(
                          (t) => t.trim().toLowerCase() === "cancelado" || t.trim().toLowerCase() === "ausente"
                        ) ? "" : "*"
                      }
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
                          (t) => t.trim().toLowerCase() === "cancelado" || t.trim().toLowerCase() === "ausente"
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
                    <label>Notas dos Participantes (CSAT Opcional)</label>
                    <button
                      type="button"
                      className="btn-add-nota-icon"
                      onClick={handleAddNota}
                    >
                      + Adicionar Nota
                    </button>
                  </div>
                  {(!form.treinamentoNotas || form.treinamentoNotas.length === 0) ? (
                    <span className="training-no-notes-text">
                      Nenhuma nota registrada (treinamento sem resposta CSAT).
                    </span>
                  ) : (
                    <div className="training-notes-list">
                      {form.treinamentoNotas.map((nota, idx) => (
                        <div key={idx} className="training-note-item">
                          <input
                            type="number"
                            placeholder={`Nota ${idx + 1} (1 a 5)`}
                            min="1"
                            max="5"
                            step="1"
                            value={nota}
                            onChange={(e) => handleUpdateNota(idx, e.target.value)}
                            required
                            className="training-note-input"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveNota(idx)}
                            className="btn-remove-nota"
                            title="Remover nota"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
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

            <div className="hist-campo">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <label style={{ marginBottom: 0 }}>Descrição *</label>
                {form.tipo === "Treinamento" && !editandoId && form.descricao !== TEMPLATE_TREINAMENTO && (
                  <button
                    type="button"
                    className="btn-link-template"
                    onClick={() => {
                      setUsarTemplate(true);
                      setForm(f => ({ ...f, descricao: TEMPLATE_TREINAMENTO }));
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
              <button className="score-modal-fechar" onClick={() => setModalScoreAberto(false)} aria-label="Fechar score">
                <X size={18} />
              </button>
            </div>

            <div className="score-modal-body">
              {/* Pergunta 1 */}
              <div className="score-pergunta">
                <label>Contato com o cliente é fácil? * <span className="score-hint">(Sim = +0.5 / Não = 0)</span></label>
                <div className="radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="facilContato"
                      value="Sim"
                      checked={respostasScore.facilContato === "Sim"}
                      onChange={() => setRespostasScore(prev => ({ ...prev, facilContato: "Sim" }))}
                    />
                    Sim
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="facilContato"
                      value="Não"
                      checked={respostasScore.facilContato === "Não"}
                      onChange={() => setRespostasScore(prev => ({ ...prev, facilContato: "Não" }))}
                    />
                    Não
                  </label>
                </div>
              </div>

              {/* Pergunta 2 */}
              <div className="score-pergunta">
                <label>Cliente entra pelo computador? * <span className="score-hint">(Sim = +1.0 / Não = -1.0)</span></label>
                <div className="radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="entraComputador"
                      value="Sim"
                      checked={respostasScore.entraComputador === "Sim"}
                      onChange={() => setRespostasScore(prev => ({ ...prev, entraComputador: "Sim" }))}
                    />
                    Sim
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="entraComputador"
                      value="Não"
                      checked={respostasScore.entraComputador === "Não"}
                      onChange={() => setRespostasScore(prev => ({ ...prev, entraComputador: "Não" }))}
                    />
                    Não
                  </label>
                </div>
              </div>

              {/* Pergunta 3 */}
              <div className="score-pergunta">
                <label>Cliente compartilha a tela? * <span className="score-hint">(Sim = +1.0 / Não = 0)</span></label>
                <div className="radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="compartilhaTela"
                      value="Sim"
                      checked={respostasScore.compartilhaTela === "Sim"}
                      onChange={() => setRespostasScore(prev => ({ ...prev, compartilhaTela: "Sim" }))}
                    />
                    Sim
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="compartilhaTela"
                      value="Não"
                      checked={respostasScore.compartilhaTela === "Não"}
                      onChange={() => setRespostasScore(prev => ({ ...prev, compartilhaTela: "Não" }))}
                    />
                    Não
                  </label>
                </div>
              </div>

              {/* Pergunta 4 */}
              <div className="score-pergunta">
                <label>Cliente faz perguntas? * <span className="score-hint">(Sim = +1.5 / Não = 0)</span></label>
                <div className="radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="fazPerguntas"
                      value="Sim"
                      checked={respostasScore.fazPerguntas === "Sim"}
                      onChange={() => setRespostasScore(prev => ({ ...prev, fazPerguntas: "Sim" }))}
                    />
                    Sim
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="fazPerguntas"
                      value="Não"
                      checked={respostasScore.fazPerguntas === "Não"}
                      onChange={() => setRespostasScore(prev => ({ ...prev, fazPerguntas: "Não" }))}
                    />
                    Não
                  </label>
                </div>
              </div>

              {/* Pergunta 5 */}
              <div className="score-pergunta">
                <label>Cliente se recorda de temas anteriores? * <span className="score-hint">(Sim = +2.0 / Não = 0)</span></label>
                <div className="radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="recordaTemas"
                      value="Sim"
                      checked={respostasScore.recordaTemas === "Sim"}
                      onChange={() => setRespostasScore(prev => ({ ...prev, recordaTemas: "Sim" }))}
                    />
                    Sim
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="recordaTemas"
                      value="Não"
                      checked={respostasScore.recordaTemas === "Não"}
                      onChange={() => setRespostasScore(prev => ({ ...prev, recordaTemas: "Não" }))}
                    />
                    Não
                  </label>
                </div>
              </div>

              {/* Pergunta 6 */}
              <div className="score-pergunta">
                <label>Cliente faltou 2 dias seguidos? * <span className="score-hint">(Sim = -1.0 / Não = +1.0)</span></label>
                <div className="radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="faltouDoisDias"
                      value="Sim"
                      checked={respostasScore.faltouDoisDias === "Sim"}
                      onChange={() => setRespostasScore(prev => ({ ...prev, faltouDoisDias: "Sim" }))}
                    />
                    Sim
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="faltouDoisDias"
                      value="Não"
                      checked={respostasScore.faltouDoisDias === "Não"}
                      onChange={() => setRespostasScore(prev => ({ ...prev, faltouDoisDias: "Não" }))}
                    />
                    Não
                  </label>
                </div>
              </div>

              {/* Pergunta 7 */}
              <div className="score-pergunta">
                <label>Cliente possui estrutura necessária? * <span className="score-hint">(Sim = +1.0 / Não = 0)</span></label>
                <div className="radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="estruturaNecessaria"
                      value="Sim"
                      checked={respostasScore.estruturaNecessaria === "Sim"}
                      onChange={() => setRespostasScore(prev => ({ ...prev, estruturaNecessaria: "Sim" }))}
                    />
                    Sim
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="estruturaNecessaria"
                      value="Não"
                      checked={respostasScore.estruturaNecessaria === "Não"}
                      onChange={() => setRespostasScore(prev => ({ ...prev, estruturaNecessaria: "Não" }))}
                    />
                    Não
                  </label>
                </div>
              </div>

              {/* Pergunta 8 */}
              <div className="score-pergunta">
                <label>Cliente é reclamante? * <span className="score-hint">(Sim = -3.0 / Não = +2.0)</span></label>
                <div className="radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="clienteReclamante"
                      value="Sim"
                      checked={respostasScore.clienteReclamante === "Sim"}
                      onChange={() => setRespostasScore(prev => ({ ...prev, clienteReclamante: "Sim" }))}
                    />
                    Sim
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="clienteReclamante"
                      value="Não"
                      checked={respostasScore.clienteReclamante === "Não"}
                      onChange={() => setRespostasScore(prev => ({ ...prev, clienteReclamante: "Não" }))}
                    />
                    Não
                  </label>
                </div>
              </div>

              {/* Pergunta 9 */}
              <div className="score-pergunta">
                <label>Cliente sumiu? * <span className="score-hint">(Sim = -5.0 / Não = 0)</span></label>
                <div className="radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="clienteSumido"
                      value="Sim"
                      checked={respostasScore.clienteSumido === "Sim"}
                      onChange={() => setRespostasScore(prev => ({ ...prev, clienteSumido: "Sim" }))}
                    />
                    Sim
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="clienteSumido"
                      value="Não"
                      checked={respostasScore.clienteSumido === "Não"}
                      onChange={() => setRespostasScore(prev => ({ ...prev, clienteSumido: "Não" }))}
                    />
                    Não
                  </label>
                </div>
              </div>
            </div>

            <div className="score-modal-footer">
              <div className="score-calculo-previo">
                {(() => {
                  const res = calcularPontuacao(respostasScore);
                  return (
                    <span>
                      Total Parcial: <strong>{res.score.toFixed(1)}</strong> ({res.tipo})
                    </span>
                  );
                })()}
              </div>
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
                    toast.error("Por favor, responda a todas as perguntas para confirmar o cálculo do score.");
                    return;
                  }

                  const res = calcularPontuacao(respostasScore);
                  setCalculoScoreResult(res);
                  setModalScoreAberto(false);
                  toast.success(`Score calculado: ${res.score.toFixed(1)} (${res.tipo})`);
                }}
              >
                Confirmar Cálculo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
