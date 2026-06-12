import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  salvarOcorrencia,
  listarOcorrencias,
  removerOcorrencia,
} from "../../services/ocorrencias";
import { listarEmpresas, salvarEmpresas } from "../../services/empresas";
import type { Ocorrencia, Empresa, OcorrenciaForm } from "../../types";
import "./Historico.css";
import {
  Star,
  GraduationCap,
  Wrench,
  TrendingUp,
  Code,
  Cpu,
} from "lucide-react";

const TIPOS = [
  "Informativa",
  "Financeira",
  "Comercial",
  "Treinamento",
  "Checkpoint",
  "Mudança de score",
];

const DEPARTAMENTO = [
  "Treinamento",
  "CS",
  "Suporte",
  "Hardware",
  "Comercial",
  "Desenvolvimento",
];

const DEPARTAMENTO_CLASS: Record<string, string> = {
  Treinamento: "departamento-treinamento",
  CS: "departamento-cs",
  Suporte: "departamento-suporte",
  Hardware: "departamento-hardware",
  Comercial: "departamento-comercial",
  Desenvolvimento: "departamento-desenvolvimento",
};

const DEPARTAMENTO_ICONES: Record<string, React.ReactNode> = {
  Treinamento: <GraduationCap size={14} />,
  CS: <Star size={14} />,
  Suporte: <Wrench size={14} />,
  Hardware: <Cpu size={14} />,
  Comercial: <TrendingUp size={14} />,
  Desenvolvimento: <Code size={14} />,
};

const TIPO_CLASS: Record<string, string> = {
  Informativa: "tipo--informativa",
  Financeira: "tipo--financeira",
  Comercial: "tipo--comercial",
  Treinamento: "tipo--treinamento",
  Checkpoint: "tipo--checkpoint",
  "Mudança de score": "tipo--mudanca-score",
};

const TEMPLATE_TREINAMENTO = `Participantes: \nNOTA: \n\nRelatório de treinamento:\n• Cliente se manteve atento? \n• Cliente absorveu o conteúdo aplicado?\n• Cliente foi participativo?\n• Houve alguma interrupção?\n• Ambiente favorável (Som)?\n• Manifestou alguma insatisfação?\n• Treinamento foi gravado?\n\nRelatório do atendimento:\n\nE-mail: \nNota:\nTexto: `;

const EMPTY: OcorrenciaForm = {
  empresa: "",
  tipo: "",
  descricao: "",
  departamento: "",
  responsavel: "",
  dataOcorrencia: "",
  horaOcorrencia: "",
  temaOcorrencia: [],
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

  return [
    `- Contato com o cliente: "${descreverFacilContato(respostas.facilContato)}"`,
    `- Cliente entra pelo computador: "${descreverEntraComputador(respostas.entraComputador)}"`,
    `- Cliente compartilha a tela: "${descreverSimNao(respostas.compartilhaTela)}"`,
    `- Cliente faz perguntas: "${descreverSimNao(respostas.fazPerguntas)}"`,
    `- Cliente se recorda de temas anteriores: "${descreverSimNao(respostas.recordaTemas)}"`,
    `- Cliente faltou 2 dias seguidos: "${descreverFaltouDoisDias(respostas.faltouDoisDias)}"`,
    `- Cliente possui estrutura necessária: "${descreverEstrutura(respostas.estruturaNecessaria)}"`,
    `- Cliente é reclamante: "${descreverReclamante(respostas.clienteReclamante)}"`
  ];
}

export function Historico() {
  const [modalScoreAberto, setModalScoreAberto] = useState(false);
  const [respostasScore, setRespostasScore] = useState<ScoreFormAnswers>({ ...INITIAL_SCORE_ANSWERS });
  const [calculoScoreResult, setCalculoScoreResult] = useState<{ score: number; tipo: "Fast" | "Safety" } | null>(null);
  const [novaAtualizacaoAberta, setNovaAtualizacaoAberta] = useState(false);
  const [novaDescricaoAtual, setNovaDescricaoAtual] = useState("");
  const [novoResponsavelAtual, setNovoResponsavelAtual] = useState("");
  const [empresasList, setEmpresasList] = useState<Empresa[]>([]);
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([]);
  const [selecionada, setSelecionada] = useState<Ocorrencia | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroDepto, setFiltroDepto] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [painelAberto, setPainelAberto] = useState(false);
  const [usarTemplate, setUsarTemplate] = useState(true);

  const [searchParams] = useSearchParams();

  const empresaFiltro = searchParams.get("empresa") || "";

  const temAusenteOuCancelado = form.temaOcorrencia?.some(t => t === "Ausente" || t === "Cancelado") ?? false;
  const temOutrosTemas = form.temaOcorrencia?.some(t => t !== "Ausente" && t !== "Cancelado") ?? false;
  const temTemaValido = temOutrosTemas && !temAusenteOuCancelado;

  async function carregar() {
    setLoading(true);
    const [ocLista, empLista] = await Promise.all([
      listarOcorrencias(),
      listarEmpresas(),
    ]);
    setOcorrencias(ocLista);
    setEmpresasList(empLista);
    setLoading(false);
  }

  async function salvarNovaAtualizacao() {
    if (!novaDescricaoAtual.trim() || !novoResponsavelAtual.trim()) {
      toast.error("Preencha a descrição e o responsável da atualização.");
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
          responsavel: novoResponsavelAtual.trim(),
        },
      ],
    };

    setSalvando(true);
    await salvarOcorrencia(atualizado);
    await carregar();
    setSalvando(false);
    setNovaAtualizacaoAberta(false);
    setNovaDescricaoAtual("");
    setNovoResponsavelAtual("");
    setSelecionada(atualizado); // atualiza o modal com os novos dados
    toast.success("Atualização incluída!");
  }

  function fecharDetalhe() {
    setSelecionada(null);
    setNovaAtualizacaoAberta(false);
    setNovaDescricaoAtual("");
    setNovoResponsavelAtual("");
  }

  useEffect(() => {
    async function carregar() {
      setLoading(true);
      const [ocLista, empLista] = await Promise.all([
        listarOcorrencias(),
        listarEmpresas(),
      ]);
      setOcorrencias(ocLista);
      setEmpresasList(empLista);
      setLoading(false);
    }
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

    if (form.tipo === "Treinamento" && temTemaValido) {
      if (usarTemplate && !form.descricao.trim()) {
        setForm(f => ({ ...f, descricao: TEMPLATE_TREINAMENTO }));
      }
    } else {
      if (form.descricao === TEMPLATE_TREINAMENTO) {
        setForm(f => ({ ...f, descricao: "" }));
      }
    }
  }, [form.tipo, temTemaValido, form.descricao, editandoId, usarTemplate]);

  useEffect(() => {
    if (editandoId) return;

    if (form.tipo !== "Treinamento") {
      setUsarTemplate(true);
    }
  }, [form.tipo, editandoId]);

  function set(campo: keyof typeof EMPTY, valor: string) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  function abrirNovo() {
    setForm({ ...EMPTY, empresa: empresaFiltro || "" });
    setEditandoId(null);
    setUsarTemplate(true);
    setCalculoScoreResult(null);
    setRespostasScore({ ...INITIAL_SCORE_ANSWERS });
    setPainelAberto(true);
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
    });
    setEditandoId(o.id ?? null);
    setCalculoScoreResult(null);
    setRespostasScore({ ...INITIAL_SCORE_ANSWERS });
    setPainelAberto(true);
  }

  function cancelar() {
    setPainelAberto(false);
    setForm({ ...EMPTY });
    setEditandoId(null);
    setUsarTemplate(true);
    setCalculoScoreResult(null);
    setRespostasScore({ ...INITIAL_SCORE_ANSWERS });
  }

  function normalizar(str: string) {
    return str.trim().toLowerCase().replace(/&amp;/g, "&").replace(/\s+/g, " ");
  }

  async function salvar() {
    if (
      !form.empresa.trim() ||
      !form.tipo ||
      !form.departamento ||
      !form.descricao.trim() ||
      !form.responsavel.trim()
    ) {
      toast.error("Preencha empresa, tipo, departamento, descrição e responsável.");
      return;
    }

    if ((form.tipo === "Informativa" || form.tipo === "Treinamento") && !calculoScoreResult) {
      toast.error("O cálculo de score é obrigatório para ocorrências do tipo Informativa ou Treinamento.");
      return;
    }

    const empresaObjeto = empresasList.find(
      (e) => normalizar(e.nomeEmpresa) === normalizar(form.empresa)
    );

    if (!empresaObjeto) {
      toast.error("A empresa especificada não foi encontrada. Selecione uma empresa cadastrada válida.");
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
    const descricaoMudou =
      ocorrenciaOriginal && novaDescricao !== ocorrenciaOriginal.descricao;

    const atualizacoesAntigas = ocorrenciaOriginal?.atualizacoes ?? [];

    const atualizacoes = descricaoMudou
      ? [
        ...atualizacoesAntigas,
        {
          descricao: novaDescricao,
          updatedAt: Date.now(),
          responsavel: form.responsavel || undefined,
        },
      ]
      : atualizacoesAntigas;

    const base = {
      ...form,
      // mantém a descrição original intacta
      descricao: ocorrenciaOriginal?.descricao ?? form.descricao,
      dataOcorrencia: timestamp,
      atualizacoes,
      scoreCalculado: calculoScoreResult ? calculoScoreResult.score : ocorrenciaOriginal?.scoreCalculado,
      scoreAnswers: calculoScoreResult ? respostasScore : ocorrenciaOriginal?.scoreAnswers,
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
        let descMudanca = "";
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
          responsavel: form.responsavel,
          departamento: form.departamento || "CS",
          dataOcorrencia: 0
        });
      }
    }

    await salvarOcorrencia(editandoId ? { ...base, id: editandoId } : base);
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

  const filtradas = ocorrencias.filter((o) => {
    const texto = busca.toLowerCase();

    const bateBusca =
      normalizar(o.empresa).includes(normalizar(texto)) ||
      o.tipo.toLowerCase().includes(texto) ||
      o.descricao.toLowerCase().includes(texto) ||
      o.responsavel.toLowerCase().includes(texto);

    const empresaOk =
      !empresaFiltro || normalizar(o.empresa) === normalizar(empresaFiltro);

    const tipoOk = !filtroTipo || o.tipo === filtroTipo;
    const deptoOk = !filtroDepto || o.departamento === filtroDepto;

    const timestamp = o.createdAt ?? o.dataOcorrencia ?? 0;
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
  });
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
          <button className="btn-primary hist-btn-novo" onClick={abrirNovo}>
            + Nova ocorrência
          </button>
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
              <th>Data</th>
              <th>Hora</th>
              <th>Departamento</th>
              <th>Tipo de registro</th>
              <th>Responsável</th>
              <th>Ações</th>
            </tr>
          </thead>

          <tbody>
            {!loading &&
              filtradas.map((o) => {
                const timestamp = o.createdAt ?? o.dataOcorrencia ?? 0;
                const data = timestamp ? new Date(timestamp) : null;

                return (
                  <tr
                    key={o.id}
                    className="hist-row-click"
                    onClick={() => setSelecionada(o)}
                  >
                    <td>{o.empresa}</td>

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

                    <td>👤 {o.responsavel || "—"}</td>

                    <td className="hist-arrow-cell">
                      <span className="hist-arrow">›</span>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>

        {selecionada && (
          <div className="hist-detail-overlay" onClick={() => fecharDetalhe()}>
            <div
              className="hist-detail-card"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="hist-detail-header">
                <h2>Detalhes da interação</h2>

                <button onClick={() => fecharDetalhe()}>✕</button>
              </div>

              <div className="hist-detail-grid">
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
                  <strong>{selecionada.responsavel || "—"}</strong>
                </div>

                <div>
                  <span>Data da ocorrência</span>
                  <strong>
                    {new Date(
                      selecionada.createdAt ?? selecionada.dataOcorrencia ?? Date.now()
                    ).toLocaleDateString("pt-BR")}{" "}
                    {new Date(
                      selecionada.createdAt ?? selecionada.dataOcorrencia ?? Date.now()
                    ).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </strong>
                </div>

                {selecionada.createdAt && selecionada.dataOcorrencia > 0 && (
                  <div>
                    <span>Data do agendamento</span>
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
                    {selecionada.atualizacoes.map((at, i) => (
                      <div key={i} className="hist-atualizacao-item">
                        <span className="hist-atualizacao-meta">
                          Atualização em{" "}
                          {new Date(at.updatedAt).toLocaleDateString("pt-BR")}{" "}
                          {new Date(at.updatedAt).toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {at.responsavel ? ` · ${at.responsavel}` : ""}
                        </span>
                        <p style={{ whiteSpace: "pre-wrap" }}>{at.descricao}</p>
                      </div>
                    ))}
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
                  <div className="hist-campo">
                    <label>Responsável *</label>
                    <input
                      value={novoResponsavelAtual}
                      onChange={(e) => setNovoResponsavelAtual(e.target.value)}
                      placeholder="Nome do responsável"
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
                {!novaAtualizacaoAberta && (
                  <button
                    className="btn-secondary btn-small"
                    onClick={() => setNovaAtualizacaoAberta(true)}
                  >
                    + Incluir nova atualização
                  </button>
                )}

                <button
                  className="btn-secondary btn-small"
                  onClick={() => {
                    fecharDetalhe();
                    abrirEdicao(selecionada);
                  }}
                >
                  Editar
                </button>

                <button
                  className="btn-danger"
                  onClick={() => {
                    fecharDetalhe();
                    excluir(selecionada.id!);
                  }}
                >
                  Excluir
                </button>
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
        <div className="hist-overlay" onClick={cancelar}>
          <div className="hist-painel" onClick={(e) => e.stopPropagation()}>
            <div className="hist-painel-header">
              <h2>{editandoId ? "Editar ocorrência" : "Nova ocorrência"}</h2>
              <button className="hist-fechar" onClick={cancelar}>
                ✕
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

            <div className="hist-campo hist-campo-row">
              <div>
                <label>Data do agendamento (não obrigatório)</label>
                <input
                  type="date"
                  value={form.dataOcorrencia}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      dataOcorrencia: e.target.value,
                    })
                  }
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

            <div className="hist-campo hist-campo-row">
              <label>Tipo de ocorrência *</label>
              <select
                value={form.tipo}
                onChange={(e) => set("tipo", e.target.value)}
              >
                <option value="">Selecione...</option>
                {TIPOS.filter((t) => t !== "Mudança de score").map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {(form.tipo === "Informativa" || form.tipo === "Treinamento") && (
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
              >
                <option value="">Selecione...</option>
                {DEPARTAMENTO.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {form.tipo === "Treinamento" && (
              <div className="hist-campo">
                <label>Temas abordados</label>
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
                          setForm({
                            ...form,
                            temaOcorrencia: e.target.checked
                              ? [...atual, tema]
                              : atual.filter((t) => t !== tema),
                          });
                        }}
                      />
                      {tema}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="hist-campo">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <label style={{ marginBottom: 0 }}>Descrição *</label>
                {form.tipo === "Treinamento" && !editandoId && temTemaValido && form.descricao !== TEMPLATE_TREINAMENTO && (
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
                  if (!editandoId) {
                    const val = e.target.value;
                    set("descricao", val);
                    if (!val.trim()) {
                      setUsarTemplate(false);
                    }
                  }
                }}
                readOnly={!!editandoId}
                placeholder="Descreva a ocorrência com detalhes..."
                rows={Math.max(6, form.descricao.split("\n").length + 2)}
                style={
                  editandoId
                    ? { opacity: 0.5, cursor: "not-allowed", resize: "none" }
                    : {}
                }
              />
              {editandoId && (
                <small style={{ color: "var(--text-muted)" }}>
                  Para adicionar uma nova descrição, use{" "}
                  <b>"Incluir nova atualização"</b> nos detalhes.
                </small>
              )}
            </div>

            <div className="hist-campo">
              <label>Responsável *</label>
              <input
                value={form.responsavel}
                onChange={(e) =>
                  !editandoId && set("responsavel", e.target.value)
                }
                readOnly={!!editandoId}
                placeholder="Nome do responsável"
                style={
                  editandoId ? { opacity: 0.5, cursor: "not-allowed" } : {}
                }
              />
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
              <button className="score-modal-fechar" onClick={() => setModalScoreAberto(false)}>✕</button>
            </div>

            <div className="score-modal-body">
              {/* Pergunta 1 */}
              <div className="score-pergunta">
                <label>Contato com o cliente é fácil? <span className="score-hint">(Sim = +0.5 / Não = 0)</span></label>
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
                <label>Cliente entra pelo computador? <span className="score-hint">(Sim = +1.0 / Não = -1.0)</span></label>
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
                <label>Cliente compartilha a tela? <span className="score-hint">(Sim = +1.0 / Não = 0)</span></label>
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
                <label>Cliente faz perguntas? <span className="score-hint">(Sim = +1.5 / Não = 0)</span></label>
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
                <label>Cliente se recorda de temas anteriores? <span className="score-hint">(Sim = +2.0 / Não = 0)</span></label>
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
                <label>Cliente faltou 2 dias seguidos? <span className="score-hint">(Sim = -1.0 / Não = +1.0)</span></label>
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
                <label>Cliente possui estrutura necessária? <span className="score-hint">(Sim = +1.0 / Não = 0)</span></label>
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
                <label>Cliente é reclamante? <span className="score-hint">(Sim = -3.0 / Não = +2.0)</span></label>
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
                disabled={
                  respostasScore.facilContato === "" ||
                  respostasScore.entraComputador === "" ||
                  respostasScore.compartilhaTela === "" ||
                  respostasScore.fazPerguntas === "" ||
                  respostasScore.recordaTemas === "" ||
                  respostasScore.faltouDoisDias === "" ||
                  respostasScore.estruturaNecessaria === "" ||
                  respostasScore.clienteReclamante === ""
                }
                onClick={() => {
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
