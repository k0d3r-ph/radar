import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { RotateCw } from "lucide-react";

import "./Home.css";

import ProgressBar from "../../components/ProgressBar";
import StatusFarol from "../../components/StatusFarol";

import {
  listarOcorrencias,
  salvarOcorrencia,
} from "../../services/ocorrencias";

import {
  listarEmpresas,
  removerEmpresa,
  salvarEmpresas,
  isEmpresaInterna,
} from "../../services/empresas";

import {
  calcularDiasNaEsteira,
  calcularDiasCongeladosPorCheckpoint,
  calcularFarol,
  calcularProgressoPorFases,
  calcularTME,
  calcularTotalFases,
  obterUltimoTreinamento,
} from "../../utils/monitoramento";
import type { Empresa, Ocorrencia } from "../../types";
import { useAuth } from "../../context/AuthContext";
import { formatarNome } from "../../utils/formatarNome";
import { BASE_CS_LIST, normalizarNomeCS, compararCS } from "../../utils/cs";
import {
  calcularScoreEfetivo,
  calcularPontuacaoScore,
  obterAjustesAtivos,
  obterTipoEfetivo,
  encontrarOcorrenciaDoAjuste,
  descreverMotivosReducaoAtiva,
} from "../../utils/score";
import { atribuirIdsOcorrencias } from "../../utils/empresaUtils";
import {
  consolidarListaComerciais,
  normalizarNomeComercial,
  compararComercial,
} from "../../utils/comercial";
import {
  analisarTelefoneWhatsApp,
  formatarTelefoneExibicao,
  normalizarContatoCliente,
  obterTelefonesContato,
  obterDestinatariosCliente,
} from "../../utils/telefone";
import { listarUsuarios } from "../../services/auth";
import { toast } from "sonner";
import {
  obterDestinatariosGestao,
  montarMensagemSuspensaoGestao,
  montarMensagemCanceladoGestao,
  montarMensagemRetornoEsteiraGestao,
  montarMensagemConclusaoEsteiraGestao,
} from "../../services/notificacoes";
import type { DestinatarioGestao } from "../../services/notificacoes";
import { podeNotificarConclusao, camposResultadoConclusao } from "../../utils/notificacaoConclusao";
import { GestaoNotificacaoModal } from "../../components/GestaoNotificacaoModal";
import { ColumnSelector } from "../../components/ColumnSelector";
import { buscarIdCentralPorNome } from "../../services/centrais";
import { listarTemas, temaDisponivelParaPerfil } from "../../services/temasOcorrencia";
import type { TemaOcorrencia } from "../../services/temasOcorrencia";
import { usePendenciasClock } from "../../hooks/usePendenciasClock";
import { vencimentoPendencia } from "../../utils/pendencias";
import {
  useColumnPreferences,
  iniciarRedimensionamentoColuna,
  reordenarColunaPorArraste,
  type ColumnDef,
} from "../../hooks/useColumnPreferences";

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

/** Cor do selo de produto na listagem, do plano mais simples ao mais completo. */
const CORES_PRODUTO: Record<string, string> = {
  Start: "#64748b",
  Lite: "#0ea5e9",
  Pro: "#6366f1",
};

export default function Home() {
  const navigate = useNavigate();
  const { role, user } = useAuth();

  const [clienteSelecionado, setClienteSelecionado] = useState<Empresa | null>(
    null,
  );

  const [modalScoreHomeAberto, setModalScoreHomeAberto] = useState(false);
  const [respostasScoreHome, setRespostasScoreHome] =
    useState<ScoreFormAnswers>(INITIAL_SCORE_ANSWERS);
  const [duvidasTemasHome, setDuvidasTemasHome] = useState<string[]>([]);
  const [novaDuvidaTemaHome, setNovaDuvidaTemaHome] = useState("");

  function abrirModalScoreHome() {
    if (clienteSelecionado) {
      setRespostasScoreHome(
        clienteSelecionado.scoreAnswers || INITIAL_SCORE_ANSWERS,
      );
      setDuvidasTemasHome(clienteSelecionado.duvidasTemasAnteriores || []);
      setNovaDuvidaTemaHome("");
      setModalScoreHomeAberto(true);
    }
  }

  function adicionarDuvidaTemaHome() {
    const texto = novaDuvidaTemaHome.trim();
    if (!texto) return;
    setDuvidasTemasHome((prev) => [...prev, texto]);
    setNovaDuvidaTemaHome("");
  }

  function removerDuvidaTemaHome(index: number) {
    setDuvidasTemasHome((prev) => prev.filter((_, i) => i !== index));
  }

  async function removerReducaoAtivaHome(
    ajuste: NonNullable<Empresa["scoreAjustesTemporarios"]>[number],
  ) {
    if (role !== "master" || !clienteSelecionado) return;
    toast(
      "Remover apenas esta redução de score? A ocorrência não será excluída.",
      {
        action: {
          label: "Remover",
          onClick: async () => {
            try {
              const empresaAtualizada: Empresa = {
                ...clienteSelecionado,
                scoreAjustesTemporarios: (
                  clienteSelecionado.scoreAjustesTemporarios || []
                ).filter((a) => a.criadoEm !== ajuste.criadoEm),
              };
              await salvarEmpresas(empresaAtualizada);
              const lista = await listarEmpresas();
              setEmpresas(lista);
              setClienteSelecionado(empresaAtualizada);
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

  async function confirmarScoreNeutroHome() {
    if (!clienteSelecionado) return;
    try {
      const empresaAtualizada: Empresa = {
        ...clienteSelecionado,
        score: null as any,
        scoreAnswers: null,
        scoreContadoresPerda: undefined,
        tipo: "",
        updatedAt: Date.now(),
      };

      await salvarEmpresas(empresaAtualizada);

      const lista = await listarEmpresas();
      setEmpresas(lista);
      setClienteSelecionado(empresaAtualizada);
      setModalScoreHomeAberto(false);
      toast.success("Score do cliente marcado como Neutro!");
    } catch (error) {
      console.error("Erro ao salvar score neutro do cliente:", error);
      toast.error("Erro ao registrar score neutro do cliente.");
    }
  }

  async function confirmarCalculoScoreHome() {
    if (!clienteSelecionado) return;

    const possuiPerguntasNaoRespondidas =
      respostasScoreHome.entraComputador === "" ||
      respostasScoreHome.compartilhaTela === "" ||
      respostasScoreHome.fazPerguntas === "" ||
      respostasScoreHome.recordaTemas === "" ||
      respostasScoreHome.faltouDoisDias === "" ||
      respostasScoreHome.estruturaNecessaria === "" ||
      respostasScoreHome.clienteReclamante === "" ||
      respostasScoreHome.clienteSumido === "";

    if (possuiPerguntasNaoRespondidas) {
      toast.error(
        "Por favor, responda a todas as perguntas para confirmar o cálculo do score.",
      );
      return;
    }

    try {
      const res = calcularPontuacaoScore(
        respostasScoreHome,
        clienteSelecionado.scoreContadoresPerda,
      );
      const empresaAtualizada: Empresa = {
        ...clienteSelecionado,
        score: res.score,
        scoreAnswers: respostasScoreHome,
        scoreContadoresPerda: res.contadores,
        duvidasTemasAnteriores: duvidasTemasHome,
        tipo: res.tipo,
        updatedAt: Date.now(),
      };

      await salvarEmpresas(empresaAtualizada);

      const lista = await listarEmpresas();
      setEmpresas(lista);
      setClienteSelecionado(empresaAtualizada);
      setModalScoreHomeAberto(false);
      toast.success(
        `Score registrado com sucesso: ${res.score.toFixed(1)} (${res.tipo})`,
      );
    } catch (error) {
      console.error("Erro ao salvar score do cliente:", error);
      toast.error("Erro ao registrar score do cliente.");
    }
  }

  const [filtroCliente, setFiltroCliente] = useState(
    () => sessionStorage.getItem("filtroCliente") || "",
  );
  const [filtroResponsavel, setFiltroResponsavel] = useState(
    () => sessionStorage.getItem("filtroResponsavel") || "",
  );
  const [filtroCs, setFiltroCs] = useState(
    () => sessionStorage.getItem("filtroCs") || "",
  );
  const [filtroComercial, setFiltroComercial] = useState(
    () => sessionStorage.getItem("filtroComercial") || "",
  );
  const [filtroProgresso, setFiltroProgresso] = useState(
    () => sessionStorage.getItem("filtroProgresso") || "",
  );
  const [filtroProduto, setFiltroProduto] = useState(
    () => sessionStorage.getItem("filtroProduto") || "",
  );
  const [filtroCardStatus, setFiltroCardStatus] = useState<
    "concluidos" | "andamento" | ""
  >(() => (sessionStorage.getItem("filtroCardStatus") as any) || "");
  const [filtroCardTipo, setFiltroCardTipo] = useState<"safety" | "fast" | "">(
    () => (sessionStorage.getItem("filtroCardTipo") as any) || "",
  );
  const [filtroCardAlerta, setFiltroCardAlerta] = useState<"alerta" | "">(
    () => (sessionStorage.getItem("filtroCardAlerta") as any) || "",
  );
  // Visível apenas para Treinamento e Master: mostra só clientes marcados como
  // elegíveis para dedução de pontos do treinador por contato com o Suporte.
  const [filtroElegivelDeducao, setFiltroElegivelDeducao] = useState<boolean>(
    () => sessionStorage.getItem("filtroElegivelDeducao") === "true",
  );
  // Mostra só clientes com data de follow up final preenchida (ver Empresa.dataFollowUpFinal).
  const [filtroComFollowUpFinal, setFiltroComFollowUpFinal] = useState<boolean>(
    () => sessionStorage.getItem("filtroComFollowUpFinal") === "true",
  );
  const [modalFiltrosAberto, setModalFiltrosAberto] = useState(false);
  const botaoFiltrosRef = useRef<HTMLButtonElement>(null);
  const modalFiltrosRef = useRef<HTMLDivElement>(null);
  const [ordenacaoContrato, setOrdenacaoContrato] = useState<
    "" | "maior" | "menor"
  >(() => (sessionStorage.getItem("ordenacaoContrato") as any) || "");
  const [ordenacaoScore, setOrdenacaoScore] = useState<"" | "maior" | "menor">(
    () => (sessionStorage.getItem("ordenacaoScore") as any) || "",
  );
  const [ordenacaoPrincipal, setOrdenacaoPrincipal] = useState<
    "contrato" | "score" | ""
  >(() => (sessionStorage.getItem("ordenacaoPrincipal") as any) || "");

  const [empresas, setEmpresas] = useState<Empresa[]>([]);

  const [historico, setHistorico] = useState<Ocorrencia[]>([]);
  const agora = usePendenciasClock(empresas);

  const historicoComIds = useMemo(
    () => atribuirIdsOcorrencias(historico, empresas),
    [historico, empresas],
  );

  const [listaCS, setListaCS] = useState<string[]>(() => {
    return [...BASE_CS_LIST].sort((a, b) => a.localeCompare(b, "pt-BR"));
  });

  const [comerciaisUsuarios, setComerciaisUsuarios] = useState<string[]>([]);

  const { lista: listaComercial, mapaCanonical: mapaComerciais } =
    useMemo(() => {
      const todosBrutos = [
        ...comerciaisUsuarios,
        ...empresas.map((e) => e.comercialResponsavel).filter(Boolean),
      ];
      return consolidarListaComerciais(todosBrutos);
    }, [comerciaisUsuarios, empresas]);

  const [loading, setLoading] = useState(true);

  const EMPTY_CLIENTE: Empresa = {
    nomeEmpresa: "",
    responsavel: "",
    tipo: "",
    dataEntrada: "",
    temaText: "",
    dataText: "",
    currentPhase: 0,
    updatedAt: 0,
    isOngoing: false,
    isSuspended: false,
    isCancelled: false,
    valorContrato: undefined,
    produto: "",
    dataFinalizacao: "",
    dataFollowUpFinal: "",
    contatos: [],
    emails: [],
    exibirAvisosSuporte: true,
  };

  const [clienteForm, setClienteForm] = useState<Empresa>(EMPTY_CLIENTE);
  const [buscandoIdCentral, setBuscandoIdCentral] = useState(false);

  const [modalClienteAberto, setModalClienteAberto] = useState(false);
  const [tiposPendencia, setTiposPendencia] = useState<TemaOcorrencia[]>([]);
  const [carregandoPendencias, setCarregandoPendencias] = useState(true);
  useEffect(() => {
    let ativo = true;
    setCarregandoPendencias(true);
    listarTemas("pendencia")
      .then((lista) => {
        if (ativo) setTiposPendencia(lista.filter((tema) => temaDisponivelParaPerfil(tema, role)));
      })
      .catch(() => {
        if (ativo)
          toast.error("Não foi possível carregar os tipos de pendência.");
      })
      .finally(() => {
        if (ativo) setCarregandoPendencias(false);
      });
    return () => {
      ativo = false;
    };
  }, [modalClienteAberto, role]);
  const [confirmarExclusaoAberto, setConfirmarExclusaoAberto] = useState(false);

  const [editandoClienteId, setEditandoClienteId] = useState<string | null>(
    null,
  );

  const [gestaoConfirmModalOpen, setGestaoConfirmModalOpen] = useState(false);
  const [gestaoDestinatarios, setGestaoDestinatarios] = useState<
    DestinatarioGestao[]
  >([]);
  const [gestaoAvisos, setGestaoAvisos] = useState<string[]>([]);
  const [gestaoMensagem, setGestaoMensagem] = useState("");
  const [gestaoEmpresaId, setGestaoEmpresaId] = useState<string | undefined>(
    undefined,
  );
  const [gestaoEmpresaEvento, setGestaoEmpresaEvento] = useState<
    "suspenso" | "cancelado" | "retorno" | "conclusao"
  >("suspenso");
  const [carregandoConclusao, setCarregandoConclusao] = useState(false);

  async function abrirNotificacaoConclusao(empresa: Empresa) {
    if (!empresa.id || !podeNotificarConclusao(empresa, role) || carregandoConclusao) return;
    setCarregandoConclusao(true);
    try {
      const { destinatarios, avisos } = await obterDestinatariosGestao(empresa, "conclusao");
      setGestaoDestinatarios(destinatarios);
      setGestaoAvisos(avisos);
      setGestaoMensagem(montarMensagemConclusaoEsteiraGestao(empresa));
      setGestaoEmpresaId(empresa.id);
      setGestaoEmpresaEvento("conclusao");
      setGestaoConfirmModalOpen(true);
    } catch (error) {
      console.error("Erro ao preparar aviso de conclusão:", error);
      toast.error("Não foi possível preparar o aviso de conclusão. Tente novamente.");
    } finally {
      setCarregandoConclusao(false);
    }
  }

  const [tabelaAtivaAberta, setTabelaAtivaAberta] = useState(false);
  const [tabelaOngoingAberta, setTabelaOngoingAberta] = useState(false);
  const [tabelaSuspensaAberta, setTabelaSuspensaAberta] = useState(false);
  const [tabelaCanceladosAberta, setTabelaCanceladosAberta] = useState(false);

  async function excluirCliente(id: string) {
    await removerEmpresa(id);
    const lista = await listarEmpresas();
    setEmpresas(lista);
    setClienteSelecionado(null);
  }

  function formatarData(data?: string | number) {
    if (!data) return "-";

    // Se for string no formato yyyy-mm-dd, adiciona o horário local pra evitar UTC
    if (typeof data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data)) {
      const [year, month, day] = data.split("-").map(Number);
      return new Date(year, month - 1, day).toLocaleDateString("pt-BR");
    }

    const d = new Date(data);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("pt-BR");
  }

  function nomesContatos(empresa: Empresa) {
    const contatos =
      empresa.contatos && empresa.contatos.length > 0
        ? empresa.contatos
        : empresa.contato
          ? [{ nome: empresa.contato, telefone: empresa.telefone || "" }]
          : [];

    if (contatos.length === 0) return "-";
    return contatos.map((c) => c.nome || "-").join(", ");
  }

  function abrirCliente(empresa: Empresa) {
    setClienteSelecionado(empresa);
  }

  function novoCliente() {
    setClienteForm({
      ...EMPTY_CLIENTE,
      updatedAt: Date.now(),
    });

    setEditandoClienteId(null);

    setModalClienteAberto(true);
  }

  function editarCliente(empresa: Empresa) {
    const temContatos = empresa.contatos && empresa.contatos.length > 0;
    const contatosMigrados =
      !temContatos && (empresa.telefone || empresa.contato)
        ? [{ nome: empresa.contato || "", telefone: empresa.telefone || "" }]
        : empresa.contatos || [];

    setClienteForm({
      ...empresa,
      exibirAvisosSuporte: empresa.exibirAvisosSuporte ?? true,
      contatos: contatosMigrados.map(normalizarContatoCliente),
    });

    setEditandoClienteId(empresa.id || null);

    setModalClienteAberto(true);
  }

  async function salvarCliente() {
    if (!clienteForm.nomeEmpresa.trim()) {
      return;
    }

    if (clienteForm.pendencia?.ativa) {
      if (
        !clienteForm.pendencia.tipoId ||
        !clienteForm.pendencia.tipoNome.trim()
      ) {
        toast.error("Selecione um tipo de pendência.");
        return;
      }
      if (
        clienteForm.pendencia.venceEm &&
        !Number.isFinite(vencimentoPendencia(clienteForm.pendencia.venceEm))
      ) {
        toast.error("Informe uma data de vencimento válida.");
        return;
      }
    }

    // Garante a busca do idCentral mesmo que o usuário tenha clicado em "Salvar"
    // rápido demais, antes do onBlur do nome da empresa terminar de buscar — sem
    // isso o salvamento corria em paralelo com a busca assíncrona e às vezes
    // gravava o cliente sem o idCentral mesmo quando a planilha tinha o dado.
    let idCentralFinal = clienteForm.idCentral?.trim() || "";
    if (!idCentralFinal && clienteForm.nomeEmpresa.trim()) {
      setBuscandoIdCentral(true);
      try {
        idCentralFinal =
          (await buscarIdCentralPorNome(clienteForm.nomeEmpresa)) || "";
        if (!idCentralFinal) {
          toast.warning(
            "Não encontrei essa central na planilha do CS. Preencha o ID Central manualmente.",
          );
        }
      } finally {
        setBuscandoIdCentral(false);
      }
    }

    const comercialFormatted = clienteForm.comercialResponsavel
      ? formatarNome(clienteForm.comercialResponsavel)
      : "";

    let nomeFinal = clienteForm.nomeEmpresa.trim();
    let idNumericToSave = clienteForm.idNumeric;

    const matchTypedId = nomeFinal.match(/\(#(\d+)\)/);
    if (matchTypedId) {
      idNumericToSave = parseInt(matchTypedId[1], 10);
      nomeFinal = nomeFinal.replace(/\s*\(#\d+\)/, "").trim();
    }

    if (typeof idNumericToSave !== "number") {
      let highest = 0;
      empresas.forEach((e) => {
        if (e.idNumeric && e.idNumeric > highest) {
          highest = e.idNumeric;
        }
      });
      idNumericToSave = highest + 1;
    }

    const empresaExistente = editandoClienteId
      ? empresas.find((e) => e.id === editandoClienteId)
      : null;

    const antigoNome = empresaExistente?.nomeEmpresa || null;

    const contatoInvalido = (clienteForm.contatos || []).find((c) =>
      obterTelefonesContato(c).some(
        (telefone) => !analisarTelefoneWhatsApp(telefone).valido,
      ),
    );
    if (contatoInvalido) {
      toast.error(
        `Corrija os telefones de ${contatoInvalido.nome || "contato sem nome"} antes de salvar.`,
      );
      return;
    }

    const contatosValidos = (clienteForm.contatos || [])
      .filter((c) => c.nome.trim() || obterTelefonesContato(c).length > 0)
      .map(normalizarContatoCliente);

    const emailsValidos = (clienteForm.emails || [])
      .map((e) => e.trim())
      .filter((e) => e.length > 0);

    // Congela a contagem de dias na esteira ao suspender o cliente, registrando
    // a data da suspensão para uso em calcularDiasNaEsteira. Ao retornar (checkbox
    // desmarcado por aqui), acumula os dias que ficaram congelados.
    let dataSuspensao = clienteForm.dataSuspensao;
    let diasSuspensoAcumulado = clienteForm.diasSuspensoAcumulado || 0;
    if (clienteForm.isSuspended && !empresaExistente?.isSuspended) {
      const hoje = new Date();
      dataSuspensao = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
    } else if (!clienteForm.isSuspended && empresaExistente?.isSuspended) {
      if (dataSuspensao) {
        const [sYear, sMonth, sDay] = dataSuspensao.split("-").map(Number);
        const inicio = new Date(sYear, sMonth - 1, sDay);
        const hoje = new Date();
        diasSuspensoAcumulado += Math.max(
          0,
          Math.floor(
            (hoje.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24),
          ),
        );
      }
      dataSuspensao = undefined;
    }

    // Se o treinador esquecer de preencher a data de entrada, assume hoje —
    // esse campo é a base do cálculo de dias na esteira e do Aging.
    let dataEntradaFinal = clienteForm.dataEntrada;
    if (!dataEntradaFinal) {
      const hoje = new Date();
      dataEntradaFinal = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
    }

    const empresaSalva: Empresa = {
      ...clienteForm,
      nomeEmpresa: nomeFinal,
      idCentral: idCentralFinal || undefined,
      idNumeric: idNumericToSave,
      comercialResponsavel: comercialFormatted,
      id: editandoClienteId || undefined,
      updatedAt: Date.now(),
      contatos: contatosValidos,
      contato: contatosValidos[0]?.nome || "",
      telefone: contatosValidos[0]?.telefone || "",
      emails: emailsValidos,
      dataEntrada: dataEntradaFinal,
      dataSuspensao,
      diasSuspensoAcumulado,
      gamificacaoDeducaoSuporte: role === "master" ? clienteForm.gamificacaoDeducaoSuporte : empresaExistente?.gamificacaoDeducaoSuporte,
    };

    empresaSalva.id = await salvarEmpresas(empresaSalva);

    if (!empresaSalva.isSuspended && !empresaSalva.isCancelled && podeNotificarConclusao(empresaSalva, role) &&
      (!empresaExistente || !podeNotificarConclusao(empresaExistente, role))) {
      await abrirNotificacaoConclusao(empresaSalva);
    }

    // Cliente acabou de ser suspenso agora (não estava suspenso antes): notifica Supervisor + CS + Comercial
    if (empresaSalva.isSuspended && !empresaExistente?.isSuspended) {
      obterDestinatariosGestao(empresaSalva, "suspenso")
        .then(({ destinatarios, avisos }) => {
          if (destinatarios.length === 0) return;
          setGestaoDestinatarios(destinatarios);
          setGestaoAvisos(avisos);
          setGestaoMensagem(montarMensagemSuspensaoGestao(empresaSalva));
          setGestaoEmpresaId(empresaSalva.id);
          setGestaoEmpresaEvento("suspenso");
          setGestaoConfirmModalOpen(true);
        })
        .catch((err) =>
          console.error(
            "[notificações] Falha ao montar destinatários de suspensão:",
            err,
          ),
        );
    }

    // Cliente acabou de sair da suspensão (retornou à esteira): notifica Supervisor + CS + Comercial
    if (
      !empresaSalva.isSuspended &&
      empresaExistente?.isSuspended &&
      !empresaSalva.isCancelled
    ) {
      obterDestinatariosGestao(empresaSalva, "retorno")
        .then(({ destinatarios, avisos }) => {
          if (destinatarios.length === 0) return;
          setGestaoDestinatarios(destinatarios);
          setGestaoAvisos(avisos);
          setGestaoMensagem(montarMensagemRetornoEsteiraGestao(empresaSalva));
          setGestaoEmpresaId(empresaSalva.id);
          setGestaoEmpresaEvento("retorno");
          setGestaoConfirmModalOpen(true);
        })
        .catch((err) =>
          console.error(
            "[notificações] Falha ao montar destinatários de retorno à esteira:",
            err,
          ),
        );
    }

    // Cliente acabou de ser cancelado agora (não estava cancelado antes): notifica Supervisor + CS + Comercial
    if (empresaSalva.isCancelled && !empresaExistente?.isCancelled) {
      obterDestinatariosGestao(empresaSalva, "cancelado")
        .then(({ destinatarios, avisos }) => {
          if (destinatarios.length === 0) return;
          setGestaoDestinatarios(destinatarios);
          setGestaoAvisos(avisos);
          setGestaoMensagem(montarMensagemCanceladoGestao(empresaSalva));
          setGestaoEmpresaId(empresaSalva.id);
          setGestaoEmpresaEvento("cancelado");
          setGestaoConfirmModalOpen(true);
        })
        .catch((err) =>
          console.error(
            "[notificações] Falha ao montar destinatários de cancelamento:",
            err,
          ),
        );
    }

    if (
      antigoNome &&
      antigoNome.trim().toLowerCase() !== nomeFinal.trim().toLowerCase()
    ) {
      const ocsParaAtualizar = historico.filter(
        (o) =>
          o.empresa.trim().toLowerCase() === antigoNome.trim().toLowerCase(),
      );
      for (let j = 0; j < ocsParaAtualizar.length; j++) {
        const oc = ocsParaAtualizar[j];
        await salvarOcorrencia({
          ...oc,
          empresa: nomeFinal,
        });
      }
    }

    const [lista, ocsLista] = await Promise.all([
      listarEmpresas(),
      listarOcorrencias(),
    ]);

    setEmpresas(lista);
    setHistorico(ocsLista);

    setModalClienteAberto(false);
    setClienteSelecionado(null);
  }

  async function toggleOngoing(empresa: Empresa, e?: React.MouseEvent) {
    if (e) {
      e.stopPropagation();
    }
    const novoStatus = !empresa.isOngoing;
    await salvarEmpresas({
      ...empresa,
      isOngoing: novoStatus,
      updatedAt: Date.now(),
    });
    const lista = await listarEmpresas();
    setEmpresas(lista);
    if (clienteSelecionado?.id === empresa.id) {
      setClienteSelecionado({ ...clienteSelecionado, isOngoing: novoStatus });
    }
  }

  useEffect(() => {
    async function carregarDados() {
      setLoading(true);

      let [empresasLista, ocorrenciasLista, usersList] = await Promise.all([
        listarEmpresas(),
        listarOcorrencias(),
        listarUsuarios().catch(() => [] as any[]),
      ]);

      const csFromUsers = usersList
        .filter(
          (u) =>
            (u.role?.toLowerCase() === "cs" ||
              u.cargo?.toLowerCase() === "analista" ||
              u.cargo?.toLowerCase() === "cs") &&
            u.nome?.trim(),
        )
        .map((u) => normalizarNomeCS(u.nome.trim()));

      const comercialFromUsers = usersList
        .filter(
          (u) =>
            (u.role?.toLowerCase() === "comercial" ||
              u.cargo?.toLowerCase() === "comercial") &&
            u.nome?.trim(),
        )
        .map((u) => formatarNome(u.nome.trim()));

      setComerciaisUsuarios(comercialFromUsers);

      const todosComerciaisBrutos = [
        ...comercialFromUsers,
        ...empresasLista.map((e) => e.comercialResponsavel).filter(Boolean),
      ];
      const { mapaCanonical: mapaComerciaisInicial } =
        consolidarListaComerciais(todosComerciaisBrutos);

      let mudouAlguma = false;

      // Migra empresas com nomes curtos ou variações de CS e Comercial para o nome completo padronizado
      for (let i = 0; i < empresasLista.length; i++) {
        const empresa = empresasLista[i];
        let mudouEmpresa = false;

        if (empresa.csResponsavel) {
          const csNormalizado = normalizarNomeCS(empresa.csResponsavel);
          if (csNormalizado && csNormalizado !== empresa.csResponsavel) {
            empresa.csResponsavel = csNormalizado;
            mudouEmpresa = true;
          }
        }

        if (empresa.comercialResponsavel) {
          const comercialNormalizado = normalizarNomeComercial(
            empresa.comercialResponsavel,
            mapaComerciaisInicial,
          );
          if (
            comercialNormalizado &&
            comercialNormalizado !== empresa.comercialResponsavel
          ) {
            empresa.comercialResponsavel = comercialNormalizado;
            mudouEmpresa = true;
          }
        }

        if (mudouEmpresa) {
          await salvarEmpresas({
            ...empresa,
            csResponsavel: empresa.csResponsavel,
            comercialResponsavel: empresa.comercialResponsavel,
          });
          mudouAlguma = true;
        }
      }

      let highest = 0;
      empresasLista.forEach((e) => {
        if (e.idNumeric && e.idNumeric > highest) {
          highest = e.idNumeric;
        }
        const match = e.nomeEmpresa.match(/\(#(\d+)\)/);
        if (match) {
          const val = parseInt(match[1], 10);
          if (val > highest) highest = val;
        }
      });

      for (let i = 0; i < empresasLista.length; i++) {
        const empresa = empresasLista[i];
        const match = empresa.nomeEmpresa.match(/\(#(\d+)\)/);

        if (match) {
          const idNum = parseInt(match[1], 10);
          const antigoNome = empresa.nomeEmpresa;
          const novoNome = antigoNome.replace(/\s*\(#\d+\)/, "").trim();

          await salvarEmpresas({
            ...empresa,
            nomeEmpresa: novoNome,
            idNumeric: idNum,
          });
          mudouAlguma = true;

          const ocsParaAtualizar = ocorrenciasLista.filter(
            (o) =>
              o.empresa.trim().toLowerCase() ===
              antigoNome.trim().toLowerCase(),
          );
          for (let j = 0; j < ocsParaAtualizar.length; j++) {
            const oc = ocsParaAtualizar[j];
            await salvarOcorrencia({
              ...oc,
              empresa: novoNome,
            });
          }
        } else if (typeof empresa.idNumeric !== "number") {
          highest++;
          await salvarEmpresas({
            ...empresa,
            idNumeric: highest,
          });
          mudouAlguma = true;
        }
      }

      if (mudouAlguma) {
        [empresasLista, ocorrenciasLista] = await Promise.all([
          listarEmpresas(),
          listarOcorrencias(),
        ]);
      }

      setEmpresas(empresasLista);
      setHistorico(ocorrenciasLista);

      const csFromEmpresas = empresasLista
        .map((e) => normalizarNomeCS(e.csResponsavel))
        .filter(Boolean);

      const allDiscoveredCS = [
        ...BASE_CS_LIST,
        ...csFromEmpresas,
        ...csFromUsers,
      ];

      setListaCS(() => {
        const uniqueNames = new Set<string>();
        allDiscoveredCS.forEach((nome) => {
          const norm = normalizarNomeCS(nome);
          if (norm) {
            uniqueNames.add(norm);
          }
        });
        return Array.from(uniqueNames).sort((a, b) =>
          a.localeCompare(b, "pt-BR"),
        );
      });

      setLoading(false);
    }

    carregarDados().catch(error => {
      console.error('Erro ao sincronizar os dados da Home:', error);
      toast.error('Não foi possível sincronizar os dados. Tente atualizar a página.');
    }).finally(() => setLoading(false));
  }, []);

  // A Home carrega o histórico só uma vez, no mount — sem isto, o painel de
  // avisos de Suporte (e o badge de Alerta) só refletiriam uma ocorrência nova
  // depois de um F5. Com `forceRefresh`, a consulta só lê do servidor o que
  // mudou (sincronização incremental), então repeti-la a cada minuto é barato.
  useEffect(() => {
    const intervalo = setInterval(() => {
      listarOcorrencias(true)
        .then(setHistorico)
        .catch((err) =>
          console.error("Erro ao atualizar histórico em segundo plano:", err),
        );
    }, 60000); // 1 minuto
    return () => clearInterval(intervalo);
  }, []);

  useEffect(() => {
    sessionStorage.setItem("filtroCliente", filtroCliente);
    sessionStorage.setItem("filtroResponsavel", filtroResponsavel);
    sessionStorage.setItem("filtroCs", filtroCs);
    sessionStorage.setItem("filtroComercial", filtroComercial);
    sessionStorage.setItem("filtroProgresso", filtroProgresso);
    sessionStorage.setItem("filtroProduto", filtroProduto);
    sessionStorage.setItem("filtroCardStatus", filtroCardStatus);
    sessionStorage.setItem("filtroCardTipo", filtroCardTipo);
    sessionStorage.setItem("filtroCardAlerta", filtroCardAlerta);
    sessionStorage.setItem(
      "filtroElegivelDeducao",
      String(filtroElegivelDeducao),
    );
    sessionStorage.setItem(
      "filtroComFollowUpFinal",
      String(filtroComFollowUpFinal),
    );
    sessionStorage.setItem("ordenacaoContrato", ordenacaoContrato);
    sessionStorage.setItem("ordenacaoScore", ordenacaoScore);
    sessionStorage.setItem("ordenacaoPrincipal", ordenacaoPrincipal);
  }, [
    filtroCliente,
    filtroResponsavel,
    filtroCs,
    filtroComercial,
    filtroProgresso,
    filtroProduto,
    filtroCardStatus,
    filtroCardTipo,
    filtroCardAlerta,
    filtroElegivelDeducao,
    filtroComFollowUpFinal,
    ordenacaoContrato,
    ordenacaoScore,
    ordenacaoPrincipal,
  ]);

  const dados = useMemo(() => {
    return empresas
      .filter((empresa) => !isEmpresaInterna(empresa))
      .map((empresa) => {
        const historicoEmpresa = historico.filter(
          (o) =>
            o.empresa.trim().toLowerCase() ===
            empresa.nomeEmpresa.trim().toLowerCase(),
        );
        const ultimoTreinamento = obterUltimoTreinamento(
          historico,
          empresa.nomeEmpresa,
        );

        const dataBase =
          ultimoTreinamento?.dataOcorrencia || ultimoTreinamento?.createdAt;

        const tme = calcularTME(dataBase);

        const totalFases = calcularTotalFases(empresa.temaText);

        const progresso = calcularProgressoPorFases(
          empresa.currentPhase,
          totalFases,
        );

        // Encontra a ocorrência mais recente da empresa que define ou resolve um alerta.
        // Ordena por `createdAt` (momento em que foi registrada) e não por `dataOcorrencia`
        // (data agendada), pois a data agendada do alerta original pode ser futura e fazer
        // com que ele apareça como mais recente do que a resolução.
        const ocsAlertaEmpresa = historicoEmpresa.filter(
          (o) => o.alerta === true || o.retirarAlerta === true,
        );

        // Última ocorrência de alerta (por createdAt)
        const ultimoAlerta = ocsAlertaEmpresa
          .filter((o) => o.alerta === true)
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];

        // Última resolução de alerta (por createdAt)
        const ultimaResolucao = ocsAlertaEmpresa
          .filter((o) => o.retirarAlerta === true)
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];

        let temAlerta = false;
        let ocorrenciaAlertaId = undefined;

        if (ultimoAlerta) {
          const tsAlerta = ultimoAlerta.createdAt || 0;
          const tsResolucao = ultimaResolucao?.createdAt || 0;
          // O alerta está ativo somente se não houver resolução posterior
          if (tsResolucao > tsAlerta) {
            temAlerta = false;
          } else {
            temAlerta = true;
            ocorrenciaAlertaId = ultimoAlerta.id;
          }
        } else if (ultimaResolucao) {
          // Só existe resolução, sem alerta registrado → não está em alerta
          temAlerta = false;
        } else {
          // Nenhuma ocorrência de alerta/resolução: usa a flag salva na empresa
          temAlerta = !!empresa.alerta;
        }

        const farol = calcularFarol({
          progresso,
          tme,
          alerta: temAlerta,
          dataFinalizacao: empresa.dataFinalizacao,
          dataFollowUpFinal: empresa.dataFollowUpFinal,
          pendencia: empresa.pendencia,
          agora,
        });

        return {
          ...empresa,
          alerta: temAlerta,
          ocorrenciaAlertaId: ocorrenciaAlertaId,
          tme,
          progresso,
          farol,
          dias: calcularDiasNaEsteira(
            empresa.dataEntrada,
            progresso,
            dataBase,
            empresa.dataFinalizacao,
            empresa.isSuspended,
            empresa.dataSuspensao,
            empresa.diasSuspensoAcumulado,
            calcularDiasCongeladosPorCheckpoint(historico, empresa.nomeEmpresa),
          ),
        };
      });
  }, [empresas, historico, agora]);

  type LinhaEsteira = (typeof dados)[number];

  const dadosAtivos = useMemo(() => {
    return dados.filter(
      (e) => !e.isOngoing && !e.isSuspended && !e.isCancelled,
    );
  }, [dados]);

  // Janela de exibição do aviso: depois de alguns dias sem ninguém marcar como
  // contatado, o aviso some por conta própria — segue sendo pendência, mas não
  // vale mais a pena empilhar na Home um follow-up que já perdeu a urgência.
  const DIAS_AVISO_SUPORTE_TREINAMENTO = 3;

  /**
   * Dúvidas de Suporte ainda não acompanhadas pelo Treinamento, para clientes
   * que estão na esteira ativa (ver pedido do supervisor: ao concluir um
   * atendimento de Suporte com cliente em treinamento, o Treinamento precisa
   * saber para sondar se a dúvida foi sanada).
   */
  const avisosSuporte = useMemo(() => {
    const limite = agora - DIAS_AVISO_SUPORTE_TREINAMENTO * 24 * 60 * 60 * 1000;
    const empresasAtivasPorNome = new Map(
      dadosAtivos
        .filter((e) => e.exibirAvisosSuporte !== false)
        .map((e) => [e.nomeEmpresa.trim().toLowerCase(), e]),
    );
    return historico
      .filter(
        (o) =>
          o.departamento === "Suporte" &&
          o.tipo === "Dúvida" &&
          !o.avisoTreinamentoResolvidoPorId &&
          o.dataOcorrencia >= limite,
      )
      .map((o) => {
        const empresa = empresasAtivasPorNome.get(
          o.empresa.trim().toLowerCase(),
        );
        return empresa ? { ocorrencia: o, empresa } : null;
      })
      .filter(
        (item): item is { ocorrencia: Ocorrencia; empresa: LinhaEsteira } =>
          !!item,
      )
      .sort(
        (a, b) => b.ocorrencia.dataOcorrencia - a.ocorrencia.dataOcorrencia,
      );
  }, [historico, dadosAtivos, agora]);

  const [avisosSuporteAbertos, setAvisosSuporteAbertos] = useState(false);

  async function marcarAvisoSuporteContatado(ocorrenciaId?: string) {
    if (!ocorrenciaId) return;
    const resolvidoPorId = user?.uid || "";
    const resolvidoEm = Date.now();
    try {
      await salvarOcorrencia({
        id: ocorrenciaId,
        avisoTreinamentoResolvidoPorId: resolvidoPorId,
        avisoTreinamentoResolvidoEm: resolvidoEm,
      } as Ocorrencia);
      // Atualiza o estado local: o memo de avisosSuporte é derivado de `historico`,
      // então sem isso o item só sairia da lista num próximo carregamento da página.
      setHistorico((prev) =>
        prev.map((o) =>
          o.id === ocorrenciaId
            ? {
                ...o,
                avisoTreinamentoResolvidoPorId: resolvidoPorId,
                avisoTreinamentoResolvidoEm: resolvidoEm,
              }
            : o,
        ),
      );
    } catch (error) {
      console.error("Erro ao marcar aviso de Suporte como contatado:", error);
      toast.error("Não foi possível marcar o aviso como contatado.");
    }
  }

  const dadosOngoing = useMemo(() => {
    return dados.filter(
      (e) => !!e.isOngoing && !e.isSuspended && !e.isCancelled,
    );
  }, [dados]);

  const dadosSuspensos = useMemo(() => {
    return dados.filter((e) => !!e.isSuspended && !e.isCancelled);
  }, [dados]);

  const dadosCancelados = useMemo(() => {
    return dados.filter((e) => !!e.isCancelled);
  }, [dados]);

  const stats = useMemo(() => {
    const total = dadosAtivos.length;
    const concluidos = dadosAtivos.filter((e) => e.progresso >= 100).length;
    const emAndamento = dadosAtivos.filter(
      (e) => e.progresso > 0 && e.progresso < 100,
    ).length;
    const safety = dadosAtivos.filter(
      (e) => obterTipoEfetivo(e) === "Safety",
    ).length;
    const fast = dadosAtivos.filter(
      (e) => obterTipoEfetivo(e) === "Fast",
    ).length;
    const alerta = dadosAtivos.filter((e) => e.alerta).length;
    return { total, concluidos, emAndamento, safety, fast, alerta };
  }, [dadosAtivos]);

  const handleStatusCardClick = (status: "concluidos" | "andamento") => {
    setFiltroCardStatus((prev) => (prev === status ? "" : status));
  };

  const handleTipoCardClick = (tipo: "safety" | "fast") => {
    setFiltroCardTipo((prev) => (prev === tipo ? "" : tipo));
  };

  const handleAlertaCardClick = () => {
    setFiltroCardAlerta((prev) => (prev === "alerta" ? "" : "alerta"));
  };

  // Quantidade de filtros ativos dentro do modal "Filtros", para o selo no botão
  // que abre o modal — sem isso o usuário não saberia que há um filtro escondido
  // sem precisar abrir o modal pra checar.
  const filtrosAtivosCount = [
    filtroResponsavel,
    filtroCs,
    filtroComercial,
    filtroProgresso,
    filtroProduto,
    filtroCardStatus,
    filtroCardTipo,
    filtroCardAlerta,
    ordenacaoContrato,
    ordenacaoScore,
    filtroElegivelDeducao,
    filtroComFollowUpFinal,
  ].filter(Boolean).length;

  // Esc fecha o modal, clique fora fecha, e o foco volta pro botão "Filtros" ao
  // fechar — mesmo contrato dos outros modais do app (ver CLAUDE.md do usuário).
  useEffect(() => {
    if (!modalFiltrosAberto) return;

    modalFiltrosRef.current?.focus();

    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setModalFiltrosAberto(false);
    }

    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("keydown", handleEsc);
      botaoFiltrosRef.current?.focus();
    };
  }, [modalFiltrosAberto]);

  const compararScore = (a: any, b: any) => {
    if (ordenacaoScore === "maior") {
      const scoreA = calcularScoreEfetivo(a) ?? -999;
      const scoreB = calcularScoreEfetivo(b) ?? -999;
      return scoreB - scoreA;
    }
    if (ordenacaoScore === "menor") {
      const scoreA = calcularScoreEfetivo(a) ?? 999;
      const scoreB = calcularScoreEfetivo(b) ?? 999;
      return scoreA - scoreB;
    }
    return 0;
  };

  const compararContrato = (a: any, b: any) => {
    if (ordenacaoContrato === "maior") {
      return (b.valorContrato ?? 0) - (a.valorContrato ?? 0);
    }
    if (ordenacaoContrato === "menor") {
      return (a.valorContrato ?? 0) - (b.valorContrato ?? 0);
    }
    return 0;
  };

  const dadosAtivosFiltrados = useMemo(() => {
    return dadosAtivos
      .filter((e) => {
        const clienteOk =
          !filtroCliente ||
          e.nomeEmpresa.toLowerCase().includes(filtroCliente.toLowerCase());
        const responsavelOk =
          !filtroResponsavel ||
          formatarNome(e.responsavel) === filtroResponsavel;
        const csOk =
          !filtroCs ||
          compararCS(e.csResponsavel, filtroCs) ||
          e.csResponsavel === filtroCs;
        const comercialOk =
          !filtroComercial ||
          compararComercial(
            e.comercialResponsavel,
            filtroComercial,
            mapaComerciais,
          );
        const progressoOk =
          !filtroProgresso ||
          (filtroProgresso === "0-25" && e.progresso <= 25) ||
          (filtroProgresso === "26-50" &&
            e.progresso > 25 &&
            e.progresso <= 50) ||
          (filtroProgresso === "51-75" &&
            e.progresso > 50 &&
            e.progresso <= 75) ||
          (filtroProgresso === "76-99" &&
            e.progresso > 75 &&
            e.progresso < 100) ||
          (filtroProgresso === "100" && e.progresso >= 100);

        const produtoOk = !filtroProduto || e.produto === filtroProduto;

        const statusCardOk =
          !filtroCardStatus ||
          (filtroCardStatus === "concluidos" && e.progresso >= 100) ||
          (filtroCardStatus === "andamento" &&
            e.progresso > 0 &&
            e.progresso < 100);

        const tipoEfetivo = obterTipoEfetivo(e);
        const tipoCardOk =
          !filtroCardTipo ||
          (filtroCardTipo === "safety" && tipoEfetivo === "Safety") ||
          (filtroCardTipo === "fast" && tipoEfetivo === "Fast");

        const alertaCardOk =
          !filtroCardAlerta || (filtroCardAlerta === "alerta" && e.alerta);

        const elegivelDeducaoOk =
          !filtroElegivelDeducao || e.gamificacaoDeducaoSuporte?.ativo === true;

        const comFollowUpFinalOk =
          !filtroComFollowUpFinal ||
          (!!e.dataFollowUpFinal && e.dataFollowUpFinal.trim() !== "");

        return (
          clienteOk &&
          responsavelOk &&
          csOk &&
          comercialOk &&
          progressoOk &&
          produtoOk &&
          statusCardOk &&
          tipoCardOk &&
          alertaCardOk &&
          elegivelDeducaoOk &&
          comFollowUpFinalOk
        );
      })
      .sort((a, b) => {
        let prim = 0;
        let sec = 0;

        if (ordenacaoPrincipal === "score") {
          prim = compararScore(a, b);
          sec = compararContrato(a, b);
        } else {
          prim = compararContrato(a, b);
          sec = compararScore(a, b);
        }

        if (prim !== 0) return prim;
        if (sec !== 0) return sec;

        const ordem = {
          vermelho: 0,
          amarelo: 1,
          laranja: 2,
          verde: 3,
          none: 4,
        };
        const farolDiff = (ordem[a.farol] ?? 4) - (ordem[b.farol] ?? 4);
        if (farolDiff !== 0) return farolDiff;
        return a.nomeEmpresa.localeCompare(b.nomeEmpresa, "pt-BR");
      });
  }, [
    dadosAtivos,
    filtroCliente,
    filtroResponsavel,
    filtroCs,
    filtroComercial,
    filtroProgresso,
    filtroProduto,
    filtroCardStatus,
    filtroCardTipo,
    filtroCardAlerta,
    filtroElegivelDeducao,
    filtroComFollowUpFinal,
    ordenacaoContrato,
    ordenacaoScore,
    ordenacaoPrincipal,
    mapaComerciais,
  ]);

  const dadosOngoingFiltrados = useMemo(() => {
    return dadosOngoing
      .filter((e) => {
        const clienteOk =
          !filtroCliente ||
          e.nomeEmpresa.toLowerCase().includes(filtroCliente.toLowerCase());
        const csOk =
          !filtroCs ||
          compararCS(e.csResponsavel, filtroCs) ||
          e.csResponsavel === filtroCs;
        const comercialOk =
          !filtroComercial ||
          compararComercial(
            e.comercialResponsavel,
            filtroComercial,
            mapaComerciais,
          );
        const responsavelOk =
          !filtroResponsavel ||
          formatarNome(e.responsavel) === filtroResponsavel;
        const produtoOk = !filtroProduto || e.produto === filtroProduto;

        return clienteOk && csOk && comercialOk && responsavelOk && produtoOk;
      })
      .sort((a, b) => {
        let prim = 0;
        let sec = 0;

        if (ordenacaoPrincipal === "score") {
          prim = compararScore(a, b);
          sec = compararContrato(a, b);
        } else {
          prim = compararContrato(a, b);
          sec = compararScore(a, b);
        }

        if (prim !== 0) return prim;
        if (sec !== 0) return sec;

        return a.nomeEmpresa.localeCompare(b.nomeEmpresa, "pt-BR");
      });
  }, [
    dadosOngoing,
    filtroCliente,
    filtroCs,
    filtroComercial,
    filtroResponsavel,
    filtroProduto,
    ordenacaoContrato,
    ordenacaoScore,
    ordenacaoPrincipal,
    mapaComerciais,
  ]);

  const dadosSuspensosFiltrados = useMemo(() => {
    return dadosSuspensos
      .filter((e) => {
        const clienteOk =
          !filtroCliente ||
          e.nomeEmpresa.toLowerCase().includes(filtroCliente.toLowerCase());
        const csOk =
          !filtroCs ||
          compararCS(e.csResponsavel, filtroCs) ||
          e.csResponsavel === filtroCs;
        const comercialOk =
          !filtroComercial ||
          compararComercial(
            e.comercialResponsavel,
            filtroComercial,
            mapaComerciais,
          );
        const responsavelOk =
          !filtroResponsavel ||
          formatarNome(e.responsavel) === filtroResponsavel;
        const produtoOk = !filtroProduto || e.produto === filtroProduto;

        return clienteOk && csOk && comercialOk && responsavelOk && produtoOk;
      })
      .sort((a, b) => {
        let prim = 0;
        let sec = 0;

        if (ordenacaoPrincipal === "score") {
          prim = compararScore(a, b);
          sec = compararContrato(a, b);
        } else {
          prim = compararContrato(a, b);
          sec = compararScore(a, b);
        }

        if (prim !== 0) return prim;
        if (sec !== 0) return sec;

        return a.nomeEmpresa.localeCompare(b.nomeEmpresa, "pt-BR");
      });
  }, [
    dadosSuspensos,
    filtroCliente,
    filtroCs,
    filtroComercial,
    filtroResponsavel,
    filtroProduto,
    ordenacaoContrato,
    ordenacaoScore,
    ordenacaoPrincipal,
    mapaComerciais,
  ]);

  const dadosCanceladosFiltrados = useMemo(() => {
    return dadosCancelados
      .filter((e) => {
        const clienteOk =
          !filtroCliente ||
          e.nomeEmpresa.toLowerCase().includes(filtroCliente.toLowerCase());
        const csOk =
          !filtroCs ||
          compararCS(e.csResponsavel, filtroCs) ||
          e.csResponsavel === filtroCs;
        const comercialOk =
          !filtroComercial ||
          compararComercial(
            e.comercialResponsavel,
            filtroComercial,
            mapaComerciais,
          );
        const responsavelOk =
          !filtroResponsavel ||
          formatarNome(e.responsavel) === filtroResponsavel;
        const produtoOk = !filtroProduto || e.produto === filtroProduto;

        return clienteOk && csOk && comercialOk && responsavelOk && produtoOk;
      })
      .sort((a, b) => {
        let prim = 0;
        let sec = 0;

        if (ordenacaoPrincipal === "score") {
          prim = compararScore(a, b);
          sec = compararContrato(a, b);
        } else {
          prim = compararContrato(a, b);
          sec = compararScore(a, b);
        }

        if (prim !== 0) return prim;
        if (sec !== 0) return sec;

        return a.nomeEmpresa.localeCompare(b.nomeEmpresa, "pt-BR");
      });
  }, [
    dadosCancelados,
    filtroCliente,
    filtroCs,
    filtroComercial,
    filtroResponsavel,
    filtroProduto,
    ordenacaoContrato,
    ordenacaoScore,
    ordenacaoPrincipal,
    mapaComerciais,
  ]);

  const LABEL_FAROL: Record<string, string> = {
    verde: "Verde",
    amarelo: "Amarelo",
    laranja: "Laranja (Pendência)",
    vermelho: "Vermelho",
    none: "-",
  };

  function exportarEsteiraExcel(
    linhas: Record<string, unknown>[],
    nomeAba: string,
    prefixoArquivo: string,
  ) {
    if (linhas.length === 0) {
      toast.error("Não há clientes para exportar.");
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(linhas);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, nomeAba);
    XLSX.writeFile(
      workbook,
      `${prefixoArquivo}-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  }

  function exportarAtivosExcel() {
    exportarEsteiraExcel(
      exportarColunasVisiveis(
        dadosAtivosFiltrados,
        colunasAtivasPrefs.colunasVisiveis,
      ),
      "Esteira Atual",
      "esteira-atual",
    );
  }

  function exportarOngoingExcel() {
    exportarEsteiraExcel(
      exportarColunasVisiveis(
        dadosOngoingFiltrados,
        colunasOngoingPrefs.colunasVisiveis,
      ),
      "Clientes Ongoing",
      "clientes-ongoing",
    );
  }

  function exportarSuspensosExcel() {
    exportarEsteiraExcel(
      exportarColunasVisiveis(
        dadosSuspensosFiltrados,
        colunasSuspensosPrefs.colunasVisiveis,
      ),
      "Clientes Suspensos",
      "clientes-suspensos",
    );
  }

  function exportarCanceladosExcel() {
    exportarEsteiraExcel(
      exportarColunasVisiveis(
        dadosCanceladosFiltrados,
        colunasCanceladosPrefs.colunasVisiveis,
      ),
      "Clientes Cancelados",
      "clientes-cancelados",
    );
  }

  function renderClienteComAlerta(empresa: LinhaEsteira) {
    return (
      <>
        {empresa.nomeEmpresa}
        {empresa.alerta && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              if (empresa.ocorrenciaAlertaId) {
                navigate(
                  `/historico?empresa=${encodeURIComponent(empresa.nomeEmpresa)}&ocorrencia=${empresa.ocorrenciaAlertaId}`,
                );
              } else {
                navigate(
                  `/historico?empresa=${encodeURIComponent(empresa.nomeEmpresa)}`,
                );
              }
            }}
            style={{
              color: "#dc2626",
              fontWeight: "bold",
              marginLeft: "8px",
              fontSize: "0.85rem",
              textDecoration: "underline",
              cursor: "pointer",
            }}
            title="Ver ocorrência de alerta"
          >
            [Alerta]
          </span>
        )}
      </>
    );
  }

  function renderValorContrato(empresa: LinhaEsteira) {
    return empresa.valorContrato !== undefined && empresa.valorContrato !== null
      ? new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
        }).format(empresa.valorContrato)
      : "—";
  }

  function renderContato(empresa: LinhaEsteira) {
    return nomesContatos(empresa);
  }

  function renderCsResponsavel(empresa: LinhaEsteira) {
    return normalizarNomeCS(empresa.csResponsavel) || "-";
  }

  function renderComercialResponsavel(empresa: LinhaEsteira) {
    return (
      normalizarNomeComercial(empresa.comercialResponsavel, mapaComerciais) ||
      "-"
    );
  }

  const colunasEsteiraAtual: ColumnDef<LinhaEsteira>[] = [
    {
      key: "status",
      label: "Status",
      defaultWidth: 70,
      locked: true,
      render: (empresa) => (
        <StatusFarol
          status={empresa.farol}
          pendencia={
            tiposPendencia.find((t) => t.id === empresa.pendencia?.tipoId)
              ?.nome || empresa.pendencia?.tipoNome
          }
        />
      ),
      exportValue: (empresa) => LABEL_FAROL[empresa.farol] ?? "-",
    },
    {
      key: "cliente",
      label: "Cliente",
      defaultWidth: 220,
      locked: true,
      render: renderClienteComAlerta,
      exportValue: (empresa) => empresa.nomeEmpresa,
    },
    {
      key: "responsavel",
      label: "Responsável",
      defaultWidth: 150,
      render: (empresa) => formatarNome(empresa.responsavel),
      exportValue: (empresa) => formatarNome(empresa.responsavel),
    },
    {
      key: "tipo",
      label: "Tipo",
      defaultWidth: 100,
      render: (empresa) =>
        obterTipoEfetivo(empresa) ? (
          <span
            style={{
              padding: "2px 10px",
              borderRadius: "999px",
              fontSize: "0.8rem",
              fontWeight: 600,
              background:
                obterTipoEfetivo(empresa) === "Fast" ? "#16a34a" : "#dc2626",
              color: "white",
            }}
          >
            {obterTipoEfetivo(empresa)}
          </span>
        ) : null,
      exportValue: (empresa) => obterTipoEfetivo(empresa) || "",
    },
    {
      key: "produto",
      label: "Produto",
      defaultWidth: 100,
      render: (empresa) =>
        empresa.produto ? (
          <span
            style={{
              padding: "2px 10px",
              borderRadius: "999px",
              fontSize: "0.8rem",
              fontWeight: 600,
              background: CORES_PRODUTO[empresa.produto] || "#64748b",
              color: "white",
            }}
          >
            {empresa.produto}
          </span>
        ) : (
          "—"
        ),
      exportValue: (empresa) => empresa.produto || "",
    },
    {
      key: "score",
      label: "Score",
      defaultWidth: 90,
      render: (empresa) =>
        empresa.score !== undefined && empresa.score !== null ? (
          <span
            style={{
              fontWeight: 600,
              color:
                obterTipoEfetivo(empresa) === "Fast" ? "#16a34a" : "#dc2626",
            }}
            title={
              (calcularScoreEfetivo(empresa) ?? empresa.score) !== empresa.score
                ? "Score reduzido temporariamente por contato recente com o Suporte"
                : undefined
            }
          >
            {(calcularScoreEfetivo(empresa) ?? empresa.score).toFixed(1)}
          </span>
        ) : (
          "—"
        ),
      exportValue: (empresa) =>
        calcularScoreEfetivo(empresa) ?? empresa.score ?? "",
    },
    {
      key: "dataEntrada",
      label: "Data de entrada",
      defaultWidth: 140,
      render: (empresa) => formatarData(empresa.dataEntrada),
      exportValue: (empresa) => formatarData(empresa.dataEntrada),
    },
    {
      key: "dias",
      label: "Dias",
      defaultWidth: 70,
      render: (empresa) => empresa.dias,
      exportValue: (empresa) => empresa.dias,
    },
    {
      key: "agendamento",
      label: "Agendamento",
      defaultWidth: 120,
      render: (empresa) => (empresa.tme !== null ? `${empresa.tme} dias` : "-"),
      exportValue: (empresa) =>
        empresa.tme !== null ? `${empresa.tme} dias` : "-",
    },
    {
      key: "progresso",
      label: "Progresso",
      defaultWidth: 170,
      className: "td-progresso",
      render: (empresa) => <ProgressBar value={empresa.progresso} />,
      exportLabel: "Progresso (%)",
      exportValue: (empresa) => empresa.progresso,
    },
    {
      key: "valorContrato",
      label: "Valor Contrato",
      defaultWidth: 150,
      align: "right",
      render: renderValorContrato,
      exportValue: (empresa) => empresa.valorContrato ?? "",
    },
  ];

  const colunasOngoing: ColumnDef<LinhaEsteira>[] = [
    {
      key: "cliente",
      label: "Cliente",
      defaultWidth: 220,
      locked: true,
      render: renderClienteComAlerta,
      exportValue: (empresa) => empresa.nomeEmpresa,
    },
    {
      key: "contato",
      label: "Contato",
      defaultWidth: 200,
      render: renderContato,
      exportValue: renderContato,
    },
    {
      key: "cs",
      label: "CS Responsável",
      defaultWidth: 160,
      render: renderCsResponsavel,
      exportValue: renderCsResponsavel,
    },
    {
      key: "comercial",
      label: "Comercial Responsável",
      defaultWidth: 180,
      render: renderComercialResponsavel,
      exportValue: renderComercialResponsavel,
    },
    {
      key: "valorContrato",
      label: "Valor Contrato",
      defaultWidth: 150,
      align: "right",
      render: renderValorContrato,
      exportValue: (empresa) => empresa.valorContrato ?? "",
    },
  ];

  const colunasSuspensos: ColumnDef<LinhaEsteira>[] = [
    {
      key: "cliente",
      label: "Cliente",
      defaultWidth: 200,
      locked: true,
      render: renderClienteComAlerta,
      exportValue: (empresa) => empresa.nomeEmpresa,
    },
    {
      key: "contato",
      label: "Contato",
      defaultWidth: 180,
      render: renderContato,
      exportValue: renderContato,
    },
    {
      key: "cs",
      label: "CS Responsável",
      defaultWidth: 150,
      render: renderCsResponsavel,
      exportValue: renderCsResponsavel,
    },
    {
      key: "comercial",
      label: "Comercial Responsável",
      defaultWidth: 170,
      render: renderComercialResponsavel,
      exportValue: renderComercialResponsavel,
    },
    {
      key: "dias",
      label: "Dias",
      defaultWidth: 70,
      render: (empresa) => empresa.dias,
      exportValue: (empresa) => empresa.dias,
    },
    {
      key: "progresso",
      label: "Progresso",
      defaultWidth: 170,
      className: "td-progresso",
      render: (empresa) => <ProgressBar value={empresa.progresso} />,
      exportLabel: "Progresso (%)",
      exportValue: (empresa) => empresa.progresso,
    },
    {
      key: "valorContrato",
      label: "Valor Contrato",
      defaultWidth: 150,
      align: "right",
      render: renderValorContrato,
      exportValue: (empresa) => empresa.valorContrato ?? "",
    },
  ];

  const colunasCancelados: ColumnDef<LinhaEsteira>[] = [
    {
      key: "cliente",
      label: "Cliente",
      defaultWidth: 220,
      locked: true,
      render: (empresa) => empresa.nomeEmpresa,
      exportValue: (empresa) => empresa.nomeEmpresa,
    },
    {
      key: "contato",
      label: "Contato",
      defaultWidth: 200,
      render: renderContato,
      exportValue: renderContato,
    },
    {
      key: "cs",
      label: "CS Responsável",
      defaultWidth: 160,
      render: renderCsResponsavel,
      exportValue: renderCsResponsavel,
    },
    {
      key: "comercial",
      label: "Comercial Responsável",
      defaultWidth: 180,
      render: renderComercialResponsavel,
      exportValue: renderComercialResponsavel,
    },
    {
      key: "valorContrato",
      label: "Valor Contrato",
      defaultWidth: 150,
      align: "right",
      render: renderValorContrato,
      exportValue: (empresa) => empresa.valorContrato ?? "",
    },
  ];

  const colunasAtivasPrefs = useColumnPreferences(
    "radar:colunas:esteira-atual",
    colunasEsteiraAtual,
  );
  const colunasOngoingPrefs = useColumnPreferences(
    "radar:colunas:ongoing",
    colunasOngoing,
  );
  const colunasSuspensosPrefs = useColumnPreferences(
    "radar:colunas:suspensos",
    colunasSuspensos,
  );
  const colunasCanceladosPrefs = useColumnPreferences(
    "radar:colunas:cancelados",
    colunasCancelados,
  );

  const [colunaArrastadaAtivos, setColunaArrastadaAtivos] = useState<
    string | null
  >(null);
  const [colunaArrastadaOngoing, setColunaArrastadaOngoing] = useState<
    string | null
  >(null);
  const [colunaArrastadaSuspensos, setColunaArrastadaSuspensos] = useState<
    string | null
  >(null);
  const [colunaArrastadaCancelados, setColunaArrastadaCancelados] = useState<
    string | null
  >(null);

  function exportarColunasVisiveis(
    linhas: LinhaEsteira[],
    colunas: ColumnDef<LinhaEsteira>[],
  ) {
    return linhas.map((empresa) => {
      const linha: Record<string, unknown> = {};
      colunas.forEach((col) => {
        if (!col.exportValue) return;
        linha[col.exportLabel || col.label] = col.exportValue(empresa);
      });
      return linha;
    });
  }

  return (
    <div className="monitoramento-page">
      <header>
        <h1>Radar</h1>

        <p>Acompanhe o progresso dos clientes na esteira de capacitação.</p>
      </header>

      {(role === "treinador" || role === "master") && (
        <div className="home-actions">
          <button className="btn-primary" onClick={novoCliente}>
            + Novo cliente
          </button>
        </div>
      )}

      <div className="home-stats">
        <div
          className={`stat-card clickable ${filtroCardStatus === "" && filtroCardTipo === "" && filtroCardAlerta === "" ? "active-total" : ""}`}
          onClick={() => {
            setFiltroCardStatus("");
            setFiltroCardTipo("");
            setFiltroCardAlerta("");
          }}
        >
          <div className="stat-card-texto">
            <div className="stat-value-row">
              <h3 className="stat-value">{stats.total}</h3>
              <p className="stat-label">Clientes na esteira</p>
            </div>
            <p className="stat-sub">Total de clientes</p>
          </div>
        </div>

        <div
          className={`stat-card clickable ${filtroCardStatus === "concluidos" ? "active-concluidos" : ""}`}
          onClick={() => handleStatusCardClick("concluidos")}
        >
          <div className="stat-card-texto">
            <div className="stat-value-row">
              <h3 className="stat-value">{stats.concluidos}</h3>
              <p className="stat-label">Concluídos</p>
            </div>
            <p className="stat-sub">
              {stats.total > 0
                ? ((stats.concluidos / stats.total) * 100).toFixed(1)
                : "0.0"}
              % do total
            </p>
          </div>
        </div>

        <div
          className={`stat-card clickable ${filtroCardStatus === "andamento" ? "active-andamento" : ""}`}
          onClick={() => handleStatusCardClick("andamento")}
        >
          <div className="stat-card-texto">
            <div className="stat-value-row">
              <h3 className="stat-value">{stats.emAndamento}</h3>
              <p className="stat-label">Em andamento</p>
            </div>
            <p className="stat-sub">
              {stats.total > 0
                ? ((stats.emAndamento / stats.total) * 100).toFixed(1)
                : "0.0"}
              % do total
            </p>
          </div>
        </div>

        <div
          className={`stat-card clickable ${filtroCardTipo === "safety" ? "active-safety" : ""}`}
          onClick={() => handleTipoCardClick("safety")}
        >
          <div className="stat-card-texto">
            <div className="stat-value-row">
              <h3 className="stat-value">{stats.safety}</h3>
              <p className="stat-label">Clientes Safety</p>
            </div>
            <p className="stat-sub">
              {stats.total > 0
                ? ((stats.safety / stats.total) * 100).toFixed(1)
                : "0.0"}
              % do total
            </p>
          </div>
        </div>

        <div
          className={`stat-card clickable ${filtroCardTipo === "fast" ? "active-fast" : ""}`}
          onClick={() => handleTipoCardClick("fast")}
        >
          <div className="stat-card-texto">
            <div className="stat-value-row">
              <h3 className="stat-value">{stats.fast}</h3>
              <p className="stat-label">Clientes Fast</p>
            </div>
            <p className="stat-sub">
              {stats.total > 0
                ? ((stats.fast / stats.total) * 100).toFixed(1)
                : "0.0"}
              % do total
            </p>
          </div>
        </div>

        <div
          className={`stat-card clickable ${filtroCardAlerta === "alerta" ? "active-alerta" : ""}`}
          onClick={handleAlertaCardClick}
        >
          <div className="stat-card-texto">
            <div className="stat-value-row">
              <h3 className="stat-value">{stats.alerta}</h3>
              <p className="stat-label">Clientes em Alerta</p>
            </div>
            <p className="stat-sub">Necessitam atenção 🔥</p>
          </div>
        </div>
      </div>

      {(role === "treinador" || role === "master") &&
        avisosSuporte.length > 0 && (
          <div className="avisos-suporte-painel">
            <button
              type="button"
              className="avisos-suporte-titulo"
              onClick={() => setAvisosSuporteAbertos((prev) => !prev)}
              aria-expanded={avisosSuporteAbertos}
            >
              <span
                className={`avisos-suporte-seta ${avisosSuporteAbertos ? "aberta" : ""}`}
              >
                ▸
              </span>
              Clientes em treinamento que contataram o Suporte (
              {avisosSuporte.length})
            </button>
            {avisosSuporteAbertos && (
              <ul className="avisos-suporte-lista">
                {avisosSuporte.map(({ ocorrencia, empresa }) => {
                  const destinatario = obterDestinatariosCliente(empresa)[0];
                  const finalizadoEm = ocorrencia.ssxDesk?.finishedAt
                    ? new Date(ocorrencia.ssxDesk.finishedAt)
                    : null;
                  const finalizacaoValida =
                    finalizadoEm && Number.isFinite(finalizadoEm.getTime());
                  return (
                    <li key={ocorrencia.id} className="aviso-suporte-item">
                      <div className="aviso-suporte-info">
                        <strong>{empresa.nomeEmpresa}</strong>
                        {destinatario && (
                          <span className="aviso-suporte-contato">
                            {" "}
                            — {destinatario.nome} (
                            {formatarTelefoneExibicao(destinatario.telefone)})
                          </span>
                        )}
                        <p className="aviso-suporte-motivo">
                          {ocorrencia.descricao}
                        </p>
                        <p className="aviso-suporte-motivo">
                          {finalizacaoValida ? (
                            <>
                              Chat finalizado em{" "}
                              <time dateTime={finalizadoEm.toISOString()}>
                                {finalizadoEm.toLocaleString("pt-BR", {
                                  timeZone: "America/Sao_Paulo",
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </time>{" "}
                              (horário de Brasília)
                            </>
                          ) : (
                            "Data e hora de finalização do chat não informadas."
                          )}
                        </p>
                      </div>
                      <div className="aviso-suporte-acoes">
                        <button
                          type="button"
                          className="aviso-suporte-link"
                          onClick={() =>
                            navigate(
                              `/historico?empresa=${encodeURIComponent(empresa.nomeEmpresa)}&ocorrencia=${ocorrencia.id}`,
                            )
                          }
                        >
                          Ver ocorrência
                        </button>
                        <button
                          type="button"
                          className="aviso-suporte-resolver"
                          onClick={() =>
                            marcarAvisoSuporteContatado(ocorrencia.id)
                          }
                        >
                          Marcar como contatado
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

      <div className="home-filtros">
        <input
          className="home-busca-cliente"
          placeholder="Buscar cliente..."
          value={filtroCliente}
          onChange={(e) => setFiltroCliente(e.target.value)}
        />

        <button
          ref={botaoFiltrosRef}
          type="button"
          className="botao-filtros"
          onClick={() => setModalFiltrosAberto(true)}
          aria-haspopup="dialog"
          aria-expanded={modalFiltrosAberto}
        >
          Filtros
          {filtrosAtivosCount > 0 && (
            <span className="botao-filtros-selo">{filtrosAtivosCount}</span>
          )}
        </button>
      </div>

      {modalFiltrosAberto && (
        <div
          className="modal-filtros-fundo"
          onClick={() => setModalFiltrosAberto(false)}
        >
          <div
            ref={modalFiltrosRef}
            className="modal-filtros-conteudo"
            role="dialog"
            aria-modal="true"
            aria-label="Filtros da esteira"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-filtros-header">
              <h3>Filtros</h3>
              <button
                type="button"
                className="modal-filtros-fechar"
                onClick={() => setModalFiltrosAberto(false)}
                title="Fechar"
              >
                ×
              </button>
            </div>

            <div className="modal-filtros-grid">
              <select
                value={filtroResponsavel}
                onChange={(e) => setFiltroResponsavel(e.target.value)}
              >
                <option value="">Treinador responsável</option>
                {[...new Set(dados.map((e) => formatarNome(e.responsavel)))]
                  .filter(Boolean)
                  .sort()
                  .map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
              </select>

              <select
                value={filtroCs}
                onChange={(e) => setFiltroCs(e.target.value)}
              >
                <option value="">CS responsável</option>
                {listaCS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <select
                value={filtroComercial}
                onChange={(e) => setFiltroComercial(e.target.value)}
              >
                <option value="">Comercial responsável</option>
                {listaComercial.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <select
                value={filtroProgresso}
                onChange={(e) => setFiltroProgresso(e.target.value)}
              >
                <option value="">Qualquer progresso</option>
                <option value="0-25">0% – 25%</option>
                <option value="26-50">26% – 50%</option>
                <option value="51-75">51% – 75%</option>
                <option value="76-99">76% – 99%</option>
                <option value="100">100%</option>
              </select>

              <select
                value={filtroProduto}
                onChange={(e) => setFiltroProduto(e.target.value)}
              >
                <option value="">Qualquer produto</option>
                {[...new Set(dados.map((e) => e.produto))]
                  .filter(Boolean)
                  .sort()
                  .map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
              </select>

              <select
                value={ordenacaoContrato}
                onChange={(e) => {
                  const val = e.target.value as any;
                  setOrdenacaoContrato(val);
                  if (val !== "") {
                    setOrdenacaoPrincipal("contrato");
                  } else if (ordenacaoScore !== "") {
                    setOrdenacaoPrincipal("score");
                  } else {
                    setOrdenacaoPrincipal("");
                  }
                }}
              >
                <option value="">Ordenar contrato: Padrão</option>
                <option value="maior">Ordenar contrato: Maior valor</option>
                <option value="menor">Ordenar contrato: Menor valor</option>
              </select>

              <select
                value={ordenacaoScore}
                onChange={(e) => {
                  const val = e.target.value as any;
                  setOrdenacaoScore(val);
                  if (val !== "") {
                    setOrdenacaoPrincipal("score");
                  } else if (ordenacaoContrato !== "") {
                    setOrdenacaoPrincipal("contrato");
                  } else {
                    setOrdenacaoPrincipal("");
                  }
                }}
              >
                <option value="">Ordenar score: Padrão</option>
                <option value="maior">Ordenar score: Maior nota</option>
                <option value="menor">Ordenar score: Menor nota</option>
              </select>

              {(role === "treinador" || role === "master") && (
                <label
                  className="checkbox-label"
                  title="Mostra apenas clientes marcados como elegíveis para dedução de pontos do treinador por contato com o Suporte."
                >
                  <input
                    type="checkbox"
                    checked={filtroElegivelDeducao}
                    onChange={(e) => setFiltroElegivelDeducao(e.target.checked)}
                  />
                  Elegíveis a dedução de pontos do treinador
                </label>
              )}

              <label
                className="checkbox-label"
                title="Mostra apenas clientes com data de follow up final preenchida."
              >
                <input
                  type="checkbox"
                  checked={filtroComFollowUpFinal}
                  onChange={(e) => setFiltroComFollowUpFinal(e.target.checked)}
                />
                Com follow up final realizado
              </label>
            </div>

            <div className="modal-filtros-footer">
              <button
                type="button"
                className="modal-filtros-limpar"
                disabled={
                  !(
                    filtroCliente ||
                    filtroResponsavel ||
                    filtroCs ||
                    filtroComercial ||
                    filtroProgresso ||
                    filtroProduto ||
                    filtroCardStatus ||
                    filtroCardTipo ||
                    filtroCardAlerta ||
                    filtroElegivelDeducao ||
                    filtroComFollowUpFinal ||
                    ordenacaoContrato ||
                    ordenacaoScore
                  )
                }
                onClick={() => {
                  setFiltroCliente("");
                  setFiltroResponsavel("");
                  setFiltroCs("");
                  setFiltroComercial("");
                  setFiltroProgresso("");
                  setFiltroProduto("");
                  setFiltroCardStatus("");
                  setFiltroCardTipo("");
                  setFiltroCardAlerta("");
                  setFiltroElegivelDeducao(false);
                  setFiltroComFollowUpFinal(false);
                  setOrdenacaoContrato("");
                  setOrdenacaoScore("");
                  setOrdenacaoPrincipal("");
                }}
              >
                Limpar filtros
              </button>
              <button
                type="button"
                className="modal-filtros-aplicar"
                onClick={() => setModalFiltrosAberto(false)}
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabela de Clientes Ativos */}
      <div className="collapsible-section">
        <div
          className="collapsible-header"
          onClick={() => setTabelaAtivaAberta((prev) => !prev)}
        >
          <div className="collapsible-title-wrapper">
            <h2>Esteira Atual ⚡</h2>
            <span className="collapsible-count-badge">
              {dadosAtivosFiltrados.length}
            </span>
          </div>
          <div className="collapsible-header-actions">
            <div onClick={(e) => e.stopPropagation()}>
              <ColumnSelector
                columns={colunasEsteiraAtual}
                order={colunasAtivasPrefs.order}
                hidden={colunasAtivasPrefs.hidden}
                onChangeOrder={colunasAtivasPrefs.setOrder}
                onChangeHidden={colunasAtivasPrefs.setHidden}
                onRestaurarPadrao={colunasAtivasPrefs.restaurarPadrao}
              />
            </div>
            {role === "master" && (
              <button
                className="btn-exportar-excel"
                onClick={(e) => {
                  e.stopPropagation();
                  exportarAtivosExcel();
                }}
                title="Exportar Esteira Atual para Excel"
              >
                📥 Exportar Excel
              </button>
            )}
            <span className="collapsible-arrow">
              {tabelaAtivaAberta ? "▼" : "▶"}
            </span>
          </div>
        </div>

        {!loading && tabelaAtivaAberta && (
          <div className="table-wrapper">
            <table>
              <colgroup>
                {colunasAtivasPrefs.colunasVisiveis.map((col) => (
                  <col
                    key={col.key}
                    style={{
                      width: `${colunasAtivasPrefs.widths[col.key] ?? col.defaultWidth}px`,
                    }}
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {colunasAtivasPrefs.colunasVisiveis.map((col) => (
                    <th
                      key={col.key}
                      className={`${col.className || ""} ${colunaArrastadaAtivos === col.key ? "th-arrastando" : ""}`.trim()}
                      style={
                        col.align === "right"
                          ? { textAlign: "right" }
                          : undefined
                      }
                      draggable
                      onDragStart={() => setColunaArrastadaAtivos(col.key)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (colunaArrastadaAtivos) {
                          colunasAtivasPrefs.setOrder(
                            reordenarColunaPorArraste(
                              colunasAtivasPrefs.order,
                              colunaArrastadaAtivos,
                              col.key,
                            ),
                          );
                        }
                        setColunaArrastadaAtivos(null);
                      }}
                      onDragEnd={() => setColunaArrastadaAtivos(null)}
                      title="Arraste para reordenar a coluna"
                    >
                      <span className="col-drag-handle" aria-hidden="true">
                        ⠿
                      </span>
                      {col.label}
                      <span
                        className="col-resize-handle"
                        draggable
                        onDragStart={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onMouseDown={(e) =>
                          iniciarRedimensionamentoColuna(
                            e,
                            col.key,
                            colunasAtivasPrefs.widths[col.key] ??
                              col.defaultWidth,
                            colunasAtivasPrefs.alterarLargura,
                          )
                        }
                      />
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {dadosAtivosFiltrados.map((empresa) => (
                  <tr
                    key={empresa.id}
                    className="linha-cliente"
                    onClick={() => abrirCliente(empresa)}
                  >
                    {colunasAtivasPrefs.colunasVisiveis.map((col) => (
                      <td
                        key={col.key}
                        className={col.className}
                        style={
                          col.align === "right"
                            ? { textAlign: "right", fontWeight: 600 }
                            : undefined
                        }
                      >
                        {col.render(empresa)}
                      </td>
                    ))}
                  </tr>
                ))}
                {dadosAtivosFiltrados.length === 0 && (
                  <tr>
                    <td
                      colSpan={colunasAtivasPrefs.colunasVisiveis.length}
                      style={{
                        textAlign: "center",
                        color: "#64748b",
                        padding: "2rem",
                      }}
                    >
                      Nenhum cliente ativo encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="table-footer">
              <span>
                Mostrando <strong>{dadosAtivosFiltrados.length}</strong> de{" "}
                <strong>{dadosAtivos.length}</strong>{" "}
                {dadosAtivos.length === 1 ? "cliente" : "clientes"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Tabela de Clientes Ongoing */}
      <div className="collapsible-section" style={{ marginTop: "2rem" }}>
        <div
          className="collapsible-header"
          onClick={() => setTabelaOngoingAberta((prev) => !prev)}
        >
          <div className="collapsible-title-wrapper">
            <h2>Clientes Ongoing 🔄</h2>
            <span
              className="collapsible-count-badge"
              style={{
                background: "rgba(16, 185, 129, 0.2)",
                color: "#34d399",
              }}
            >
              {dadosOngoingFiltrados.length}
            </span>
          </div>
          <div className="collapsible-header-actions">
            <div onClick={(e) => e.stopPropagation()}>
              <ColumnSelector
                columns={colunasOngoing}
                order={colunasOngoingPrefs.order}
                hidden={colunasOngoingPrefs.hidden}
                onChangeOrder={colunasOngoingPrefs.setOrder}
                onChangeHidden={colunasOngoingPrefs.setHidden}
                onRestaurarPadrao={colunasOngoingPrefs.restaurarPadrao}
              />
            </div>
            {role === "master" && (
              <button
                className="btn-exportar-excel"
                onClick={(e) => {
                  e.stopPropagation();
                  exportarOngoingExcel();
                }}
                title="Exportar Clientes Ongoing para Excel"
              >
                📥 Exportar Excel
              </button>
            )}
            <span className="collapsible-arrow">
              {tabelaOngoingAberta ? "▼" : "▶"}
            </span>
          </div>
        </div>

        {!loading && tabelaOngoingAberta && (
          <div className="table-wrapper">
            <table>
              <colgroup>
                {colunasOngoingPrefs.colunasVisiveis.map((col) => (
                  <col
                    key={col.key}
                    style={{
                      width: `${colunasOngoingPrefs.widths[col.key] ?? col.defaultWidth}px`,
                    }}
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {colunasOngoingPrefs.colunasVisiveis.map((col) => (
                    <th
                      key={col.key}
                      className={`${col.className || ""} ${colunaArrastadaOngoing === col.key ? "th-arrastando" : ""}`.trim()}
                      style={
                        col.align === "right"
                          ? { textAlign: "right" }
                          : undefined
                      }
                      draggable
                      onDragStart={() => setColunaArrastadaOngoing(col.key)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (colunaArrastadaOngoing) {
                          colunasOngoingPrefs.setOrder(
                            reordenarColunaPorArraste(
                              colunasOngoingPrefs.order,
                              colunaArrastadaOngoing,
                              col.key,
                            ),
                          );
                        }
                        setColunaArrastadaOngoing(null);
                      }}
                      onDragEnd={() => setColunaArrastadaOngoing(null)}
                      title="Arraste para reordenar a coluna"
                    >
                      <span className="col-drag-handle" aria-hidden="true">
                        ⠿
                      </span>
                      {col.label}
                      <span
                        className="col-resize-handle"
                        draggable
                        onDragStart={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onMouseDown={(e) =>
                          iniciarRedimensionamentoColuna(
                            e,
                            col.key,
                            colunasOngoingPrefs.widths[col.key] ??
                              col.defaultWidth,
                            colunasOngoingPrefs.alterarLargura,
                          )
                        }
                      />
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {dadosOngoingFiltrados.map((empresa) => (
                  <tr
                    key={empresa.id}
                    className="linha-cliente"
                    onClick={() => abrirCliente(empresa)}
                  >
                    {colunasOngoingPrefs.colunasVisiveis.map((col) => (
                      <td
                        key={col.key}
                        className={col.className}
                        style={
                          col.align === "right"
                            ? { textAlign: "right", fontWeight: 600 }
                            : undefined
                        }
                      >
                        {col.render(empresa)}
                      </td>
                    ))}
                  </tr>
                ))}
                {dadosOngoingFiltrados.length === 0 && (
                  <tr>
                    <td
                      colSpan={colunasOngoingPrefs.colunasVisiveis.length}
                      style={{
                        textAlign: "center",
                        color: "#64748b",
                        padding: "2rem",
                      }}
                    >
                      Nenhum cliente em acompanhamento contínuo (Ongoing).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="table-footer">
              <span>
                Mostrando <strong>{dadosOngoingFiltrados.length}</strong> de{" "}
                <strong>{dadosOngoing.length}</strong>{" "}
                {dadosOngoing.length === 1 ? "cliente" : "clientes"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Tabela de Clientes Suspensos */}
      <div className="collapsible-section" style={{ marginTop: "2rem" }}>
        <div
          className="collapsible-header"
          onClick={() => setTabelaSuspensaAberta((prev) => !prev)}
        >
          <div className="collapsible-title-wrapper">
            <h2>Clientes Suspensos ⏸️</h2>
            <span
              className="collapsible-count-badge"
              style={{
                background: "rgba(245, 158, 11, 0.2)",
                color: "#f59e0b",
              }}
            >
              {dadosSuspensosFiltrados.length}
            </span>
          </div>
          <div className="collapsible-header-actions">
            <div onClick={(e) => e.stopPropagation()}>
              <ColumnSelector
                columns={colunasSuspensos}
                order={colunasSuspensosPrefs.order}
                hidden={colunasSuspensosPrefs.hidden}
                onChangeOrder={colunasSuspensosPrefs.setOrder}
                onChangeHidden={colunasSuspensosPrefs.setHidden}
                onRestaurarPadrao={colunasSuspensosPrefs.restaurarPadrao}
              />
            </div>
            {role === "master" && (
              <button
                className="btn-exportar-excel"
                onClick={(e) => {
                  e.stopPropagation();
                  exportarSuspensosExcel();
                }}
                title="Exportar Clientes Suspensos para Excel"
              >
                📥 Exportar Excel
              </button>
            )}
            <span className="collapsible-arrow">
              {tabelaSuspensaAberta ? "▼" : "▶"}
            </span>
          </div>
        </div>

        {!loading && tabelaSuspensaAberta && (
          <div className="table-wrapper">
            <table>
              <colgroup>
                {colunasSuspensosPrefs.colunasVisiveis.map((col) => (
                  <col
                    key={col.key}
                    style={{
                      width: `${colunasSuspensosPrefs.widths[col.key] ?? col.defaultWidth}px`,
                    }}
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {colunasSuspensosPrefs.colunasVisiveis.map((col) => (
                    <th
                      key={col.key}
                      className={`${col.className || ""} ${colunaArrastadaSuspensos === col.key ? "th-arrastando" : ""}`.trim()}
                      style={
                        col.align === "right"
                          ? { textAlign: "right" }
                          : undefined
                      }
                      draggable
                      onDragStart={() => setColunaArrastadaSuspensos(col.key)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (colunaArrastadaSuspensos) {
                          colunasSuspensosPrefs.setOrder(
                            reordenarColunaPorArraste(
                              colunasSuspensosPrefs.order,
                              colunaArrastadaSuspensos,
                              col.key,
                            ),
                          );
                        }
                        setColunaArrastadaSuspensos(null);
                      }}
                      onDragEnd={() => setColunaArrastadaSuspensos(null)}
                      title="Arraste para reordenar a coluna"
                    >
                      <span className="col-drag-handle" aria-hidden="true">
                        ⠿
                      </span>
                      {col.label}
                      <span
                        className="col-resize-handle"
                        draggable
                        onDragStart={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onMouseDown={(e) =>
                          iniciarRedimensionamentoColuna(
                            e,
                            col.key,
                            colunasSuspensosPrefs.widths[col.key] ??
                              col.defaultWidth,
                            colunasSuspensosPrefs.alterarLargura,
                          )
                        }
                      />
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {dadosSuspensosFiltrados.map((empresa) => (
                  <tr
                    key={empresa.id}
                    className="linha-cliente"
                    onClick={() => abrirCliente(empresa)}
                  >
                    {colunasSuspensosPrefs.colunasVisiveis.map((col) => (
                      <td
                        key={col.key}
                        className={col.className}
                        style={
                          col.align === "right"
                            ? { textAlign: "right", fontWeight: 600 }
                            : undefined
                        }
                      >
                        {col.render(empresa)}
                      </td>
                    ))}
                  </tr>
                ))}
                {dadosSuspensosFiltrados.length === 0 && (
                  <tr>
                    <td
                      colSpan={colunasSuspensosPrefs.colunasVisiveis.length}
                      style={{
                        textAlign: "center",
                        color: "#64748b",
                        padding: "2rem",
                      }}
                    >
                      Nenhum cliente temporariamente suspenso.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="table-footer">
              <span>
                Mostrando <strong>{dadosSuspensosFiltrados.length}</strong> de{" "}
                <strong>{dadosSuspensos.length}</strong>{" "}
                {dadosSuspensos.length === 1 ? "cliente" : "clientes"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Tabela de Clientes Cancelados */}
      <div className="collapsible-section" style={{ marginTop: "2rem" }}>
        <div
          className="collapsible-header"
          onClick={() => setTabelaCanceladosAberta((prev) => !prev)}
        >
          <div className="collapsible-title-wrapper">
            <h2>Clientes Cancelados ❌</h2>
            <span
              className="collapsible-count-badge"
              style={{ background: "rgba(220, 38, 38, 0.2)", color: "#f87171" }}
            >
              {dadosCanceladosFiltrados.length}
            </span>
          </div>
          <div className="collapsible-header-actions">
            <div onClick={(e) => e.stopPropagation()}>
              <ColumnSelector
                columns={colunasCancelados}
                order={colunasCanceladosPrefs.order}
                hidden={colunasCanceladosPrefs.hidden}
                onChangeOrder={colunasCanceladosPrefs.setOrder}
                onChangeHidden={colunasCanceladosPrefs.setHidden}
                onRestaurarPadrao={colunasCanceladosPrefs.restaurarPadrao}
              />
            </div>
            {role === "master" && (
              <button
                className="btn-exportar-excel"
                onClick={(e) => {
                  e.stopPropagation();
                  exportarCanceladosExcel();
                }}
                title="Exportar Clientes Cancelados para Excel"
              >
                📥 Exportar Excel
              </button>
            )}
            <span className="collapsible-arrow">
              {tabelaCanceladosAberta ? "▼" : "▶"}
            </span>
          </div>
        </div>

        {!loading && tabelaCanceladosAberta && (
          <div className="table-wrapper">
            <table>
              <colgroup>
                {colunasCanceladosPrefs.colunasVisiveis.map((col) => (
                  <col
                    key={col.key}
                    style={{
                      width: `${colunasCanceladosPrefs.widths[col.key] ?? col.defaultWidth}px`,
                    }}
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {colunasCanceladosPrefs.colunasVisiveis.map((col) => (
                    <th
                      key={col.key}
                      className={`${col.className || ""} ${colunaArrastadaCancelados === col.key ? "th-arrastando" : ""}`.trim()}
                      style={
                        col.align === "right"
                          ? { textAlign: "right" }
                          : undefined
                      }
                      draggable
                      onDragStart={() => setColunaArrastadaCancelados(col.key)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (colunaArrastadaCancelados) {
                          colunasCanceladosPrefs.setOrder(
                            reordenarColunaPorArraste(
                              colunasCanceladosPrefs.order,
                              colunaArrastadaCancelados,
                              col.key,
                            ),
                          );
                        }
                        setColunaArrastadaCancelados(null);
                      }}
                      onDragEnd={() => setColunaArrastadaCancelados(null)}
                      title="Arraste para reordenar a coluna"
                    >
                      <span className="col-drag-handle" aria-hidden="true">
                        ⠿
                      </span>
                      {col.label}
                      <span
                        className="col-resize-handle"
                        draggable
                        onDragStart={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onMouseDown={(e) =>
                          iniciarRedimensionamentoColuna(
                            e,
                            col.key,
                            colunasCanceladosPrefs.widths[col.key] ??
                              col.defaultWidth,
                            colunasCanceladosPrefs.alterarLargura,
                          )
                        }
                      />
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {dadosCanceladosFiltrados.map((empresa) => (
                  <tr
                    key={empresa.id}
                    className="linha-cliente"
                    onClick={() => abrirCliente(empresa)}
                  >
                    {colunasCanceladosPrefs.colunasVisiveis.map((col) => (
                      <td
                        key={col.key}
                        className={col.className}
                        style={
                          col.align === "right"
                            ? { textAlign: "right", fontWeight: 600 }
                            : undefined
                        }
                      >
                        {col.render(empresa)}
                      </td>
                    ))}
                  </tr>
                ))}
                {dadosCanceladosFiltrados.length === 0 && (
                  <tr>
                    <td
                      colSpan={colunasCanceladosPrefs.colunasVisiveis.length}
                      style={{
                        textAlign: "center",
                        color: "#64748b",
                        padding: "2rem",
                      }}
                    >
                      Nenhum cliente cancelado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="table-footer">
              <span>
                Mostrando <strong>{dadosCanceladosFiltrados.length}</strong> de{" "}
                <strong>{dadosCancelados.length}</strong>{" "}
                {dadosCancelados.length === 1 ? "cliente" : "clientes"}
              </span>
            </div>
          </div>
        )}
      </div>

      {clienteSelecionado && (
        <div className="cliente-overlay">
          <div className="cliente-modal">
            <div
              className="cliente-modal-header"
              style={{ position: "relative" }}
            >
              <button
                onClick={() => setClienteSelecionado(null)}
                style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  background: "none",
                  border: "none",
                  fontSize: "1.1rem",
                  color: "#94a3b8",
                  cursor: "pointer",
                  padding: "4px",
                  lineHeight: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "28px",
                  height: "28px",
                  borderRadius: "50%",
                  transition: "background 0.2s, color 0.2s",
                }}
                className="btn-fechar-modal"
                title="Fechar"
              >
                ✕
              </button>
              <span className="cliente-modal-icon">🏢</span>
              <h2>{clienteSelecionado.nomeEmpresa}</h2>
            </div>

            <div className="cliente-info-details">
              <div className="info-item">
                <span className="info-label">ID do Cliente</span>
                <span
                  className="info-value"
                  style={{ fontWeight: "bold", color: "#1e90ff" }}
                >
                  {clienteSelecionado.idNumeric
                    ? `#${clienteSelecionado.idNumeric}`
                    : "Sem ID"}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">ID Central (SSX)</span>
                <span className="info-value">
                  {clienteSelecionado.idCentral || "-"}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">CS Responsável</span>
                <span className="info-value">
                  {normalizarNomeCS(clienteSelecionado.csResponsavel) || "-"}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">Comercial Responsável</span>
                <span className="info-value">
                  {normalizarNomeComercial(
                    clienteSelecionado.comercialResponsavel,
                    mapaComerciais,
                  ) || "-"}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">Persona</span>
                <span className="info-value">
                  {clienteSelecionado.persona || "-"}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">Produto</span>
                <span className="info-value">
                  {clienteSelecionado.produto || "-"}
                </span>
              </div>
              <div className="info-item full-width">
                <span className="info-label">Contatos</span>
                <span className="info-value">
                  {(() => {
                    const contatos =
                      clienteSelecionado.contatos &&
                      clienteSelecionado.contatos.length > 0
                        ? clienteSelecionado.contatos
                        : clienteSelecionado.contato
                          ? [
                              {
                                nome: clienteSelecionado.contato,
                                telefone: clienteSelecionado.telefone || "",
                              },
                            ]
                          : [];

                    if (contatos.length === 0) return "-";

                    return contatos
                      .map(
                        (c) =>
                          `${c.nome || "-"}${obterTelefonesContato(c).length ? ` (${obterTelefonesContato(c).join(", ")})` : ""}`,
                      )
                      .join(" | ");
                  })()}
                </span>
              </div>
              <div className="info-item full-width">
                <span className="info-label">E-mails</span>
                <span className="info-value">
                  {clienteSelecionado.emails &&
                  clienteSelecionado.emails.length > 0
                    ? clienteSelecionado.emails.join(" | ")
                    : "-"}
                </span>
              </div>
              <div className="info-item full-width">
                <span className="info-label">Localização</span>
                <span className="info-value">
                  {clienteSelecionado.localizacao || "-"}
                </span>
              </div>
              <div className="info-item full-width">
                <span className="info-label">Valor do Contrato</span>
                <span className="info-value">
                  {clienteSelecionado.valorContrato !== undefined &&
                  clienteSelecionado.valorContrato !== null
                    ? new Intl.NumberFormat("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      }).format(clienteSelecionado.valorContrato)
                    : "—"}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">Status Temporário</span>
                <span className="info-value">
                  {clienteSelecionado.isCancelled ? (
                    <span style={{ color: "#dc2626", fontWeight: "bold" }}>
                      ❌ Cancelado
                    </span>
                  ) : clienteSelecionado.isSuspended ? (
                    <span style={{ color: "#f59e0b", fontWeight: "bold" }}>
                      ⏸️ Suspenso Temporariamente
                    </span>
                  ) : (
                    <span style={{ color: "#10b981", fontWeight: "bold" }}>
                      ▶️ Ativo
                    </span>
                  )}
                </span>
              </div>
              {role === "master" && clienteSelecionado.isSuspended && (
                <div className="info-item">
                  <span className="info-label">
                    Notificação de Suspensão (WhatsApp)
                  </span>
                  <span className="info-value">
                    {clienteSelecionado.whatsappStatusSuspensao ===
                      "enviado" && (
                      <span
                        style={{ color: "#16a34a", fontWeight: "bold" }}
                        title={
                          clienteSelecionado.whatsappEnviadoEmSuspensao
                            ? "Enviado em " +
                              new Date(
                                clienteSelecionado.whatsappEnviadoEmSuspensao,
                              ).toLocaleString("pt-BR")
                            : undefined
                        }
                      >
                        ✅ Enviado
                      </span>
                    )}
                    {clienteSelecionado.whatsappStatusSuspensao ===
                      "parcial" && (
                      <span
                        style={{ color: "#d97706", fontWeight: "bold" }}
                        title={(
                          clienteSelecionado.whatsappDestinatariosSuspensao ||
                          []
                        )
                          .map(
                            (d) =>
                              `${d.nome}: ${d.status}${d.erro ? " (" + d.erro + ")" : ""}`,
                          )
                          .join("\n")}
                      >
                        ⚠️ Parcial
                      </span>
                    )}
                    {clienteSelecionado.whatsappStatusSuspensao ===
                      "falhou" && (
                      <span
                        style={{ color: "#dc2626", fontWeight: "bold" }}
                        title={(
                          clienteSelecionado.whatsappDestinatariosSuspensao ||
                          []
                        )
                          .map((d) => d.erro || "")
                          .filter(Boolean)
                          .join("\n")}
                      >
                        ❌ Falhou
                      </span>
                    )}
                    {clienteSelecionado.whatsappStatusSuspensao ===
                      "nao_enviado" && (
                      <span
                        style={{ color: "#64748b" }}
                        title="O usuário optou por não enviar"
                      >
                        🚫 Não enviado
                      </span>
                    )}
                    {!clienteSelecionado.whatsappStatusSuspensao && (
                      <span style={{ color: "#64748b" }}>—</span>
                    )}
                  </span>
                </div>
              )}
              {role === "master" && clienteSelecionado.isCancelled && (
                <div className="info-item">
                  <span className="info-label">
                    Notificação de Cancelamento (WhatsApp)
                  </span>
                  <span className="info-value">
                    {clienteSelecionado.whatsappStatusCancelamento ===
                      "enviado" && (
                      <span
                        style={{ color: "#16a34a", fontWeight: "bold" }}
                        title={
                          clienteSelecionado.whatsappEnviadoEmCancelamento
                            ? "Enviado em " +
                              new Date(
                                clienteSelecionado.whatsappEnviadoEmCancelamento,
                              ).toLocaleString("pt-BR")
                            : undefined
                        }
                      >
                        ✅ Enviado
                      </span>
                    )}
                    {clienteSelecionado.whatsappStatusCancelamento ===
                      "parcial" && (
                      <span
                        style={{ color: "#d97706", fontWeight: "bold" }}
                        title={(
                          clienteSelecionado.whatsappDestinatariosCancelamento ||
                          []
                        )
                          .map(
                            (d) =>
                              `${d.nome}: ${d.status}${d.erro ? " (" + d.erro + ")" : ""}`,
                          )
                          .join("\n")}
                      >
                        ⚠️ Parcial
                      </span>
                    )}
                    {clienteSelecionado.whatsappStatusCancelamento ===
                      "falhou" && (
                      <span
                        style={{ color: "#dc2626", fontWeight: "bold" }}
                        title={(
                          clienteSelecionado.whatsappDestinatariosCancelamento ||
                          []
                        )
                          .map((d) => d.erro || "")
                          .filter(Boolean)
                          .join("\n")}
                      >
                        ❌ Falhou
                      </span>
                    )}
                    {clienteSelecionado.whatsappStatusCancelamento ===
                      "nao_enviado" && (
                      <span
                        style={{ color: "#64748b" }}
                        title="O usuário optou por não enviar"
                      >
                        🚫 Não enviado
                      </span>
                    )}
                    {!clienteSelecionado.whatsappStatusCancelamento && (
                      <span style={{ color: "#64748b" }}>—</span>
                    )}
                  </span>
                </div>
              )}
              <div className="info-item">
                <span className="info-label">Score</span>
                <span
                  className="info-value"
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                >
                  {clienteSelecionado.score !== undefined &&
                  clienteSelecionado.score !== null ? (
                    <span
                      style={{
                        fontWeight: "bold",
                        color:
                          obterTipoEfetivo(clienteSelecionado) === "Fast"
                            ? "#10b981"
                            : "#ef4444",
                      }}
                      title={
                        (calcularScoreEfetivo(clienteSelecionado) ??
                          clienteSelecionado.score) !== clienteSelecionado.score
                          ? "Score reduzido temporariamente por contato recente com o Suporte"
                          : undefined
                      }
                    >
                      {(
                        calcularScoreEfetivo(clienteSelecionado) ??
                        clienteSelecionado.score
                      ).toFixed(1)}{" "}
                      ({obterTipoEfetivo(clienteSelecionado)})
                    </span>
                  ) : (
                    "—"
                  )}
                  {(role === "treinador" || role === "master") && (
                    <button
                      onClick={() => abrirModalScoreHome()}
                      style={{
                        background: "rgba(59, 130, 246, 0.15)",
                        border: "1px solid rgba(59, 130, 246, 0.25)",
                        color: "#60a5fa",
                        padding: "2px 8px",
                        borderRadius: "6px",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        cursor: "pointer",
                        width: "auto",
                        lineHeight: "1.2",
                      }}
                      title="Calcular/Editar Score"
                    >
                      Calcular
                    </button>
                  )}
                </span>
              </div>
              {(() => {
                const totalFasesSel = calcularTotalFases(
                  clienteSelecionado.temaText,
                );
                const progressoSel = calcularProgressoPorFases(
                  clienteSelecionado.currentPhase,
                  totalFasesSel,
                );
                return (
                  <>
                    {(progressoSel >= 100 ||
                      clienteSelecionado.dataFinalizacao) && (
                      <div className="info-item">
                        <span
                          className="info-label"
                          style={{ fontSize: "0.68rem" }}
                        >
                          Finalização da Esteira
                        </span>
                        <span className="info-value">
                          {formatarData(clienteSelecionado.dataFinalizacao)}
                        </span>
                        {podeNotificarConclusao(clienteSelecionado, role) && (
                          <div className="conclusao-notificacao">
                            <span className="conclusao-notificacao-destino">Aviso ao CS e Comercial</span>
                            <span className={`conclusao-notificacao-status conclusao-notificacao-status--${clienteSelecionado.whatsappStatusConclusao || "pendente"}`}>
                              {clienteSelecionado.whatsappStatusConclusao === "enviado"
                                ? "Enviado"
                                : clienteSelecionado.whatsappStatusConclusao === "parcial"
                                  ? "Enviado parcialmente"
                                  : clienteSelecionado.whatsappStatusConclusao === "falhou"
                                    ? "Falha no envio"
                                    : clienteSelecionado.whatsappStatusConclusao === "sem_destinatario"
                                      ? "Sem destinatários"
                                      : "Envio não confirmado"}
                            </span>
                            <button type="button" className="conclusao-notificacao-reenviar"
                              disabled={carregandoConclusao}
                              title="Reenviar aviso de finalização ao CS e Comercial"
                              onClick={() => abrirNotificacaoConclusao(clienteSelecionado)}>
                              <RotateCw size={13} aria-hidden="true" />
                              {carregandoConclusao ? "Preparando..." : "Reenviar aviso"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {clienteSelecionado.dataFollowUpFinal && (
                      <div className="info-item">
                        <span
                          className="info-label"
                          style={{ fontSize: "0.68rem" }}
                        >
                          Follow-up Final
                        </span>
                        <span className="info-value">
                          {formatarData(clienteSelecionado.dataFollowUpFinal)}
                        </span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            <div className="cliente-modal-actions">
              {(role === "treinador" || role === "master") && (
                <button
                  className="btn-editar"
                  onClick={() => editarCliente(clienteSelecionado)}
                >
                  Editar cliente
                </button>
              )}

              <button
                className="btn-esteira"
                onClick={() => navigate(`/esteira/${clienteSelecionado.id}`)}
              >
                Ver esteira
              </button>

              <button
                className="btn-ocorrencias"
                onClick={() =>
                  navigate(
                    `/historico?empresa=${encodeURIComponent(clienteSelecionado.nomeEmpresa)}&origem=home`,
                  )
                }
              >
                Ver ocorrências
              </button>

              {(role === "treinador" || role === "master") && (
                <button
                  className="btn-excluir"
                  onClick={() => setConfirmarExclusaoAberto(true)}
                >
                  Excluir cliente
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmarExclusaoAberto && clienteSelecionado && (
        <div
          className="confirm-overlay"
          onClick={() => setConfirmarExclusaoAberto(false)}
        >
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-modal-header">
              <span className="confirm-modal-icon">⚠️</span>
              <h2>Confirmar Exclusão</h2>
            </div>
            <p className="confirm-modal-text">
              Deseja realmente excluir o cliente{" "}
              <strong>{clienteSelecionado.nomeEmpresa}</strong>? Esta ação não
              poderá ser desfeita.
            </p>
            <div className="confirm-modal-actions">
              <button
                className="btn-excluir-confirm"
                onClick={async () => {
                  if (!clienteSelecionado.id) {
                    toast.error(
                      "Erro: cliente sem ID válido. Não é possível excluir.",
                    );
                    return;
                  }
                  await excluirCliente(clienteSelecionado.id);
                  setConfirmarExclusaoAberto(false);
                }}
              >
                Sim, excluir
              </button>
              <button
                className="btn-cancelar-confirm"
                onClick={() => setConfirmarExclusaoAberto(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {modalClienteAberto && (
        <div className="cliente-overlay">
          <div className="cliente-modal">
            <div
              className="cliente-modal-header"
              style={{ position: "relative" }}
            >
              <button
                onClick={() => setModalClienteAberto(false)}
                style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  background: "none",
                  border: "none",
                  fontSize: "1.1rem",
                  color: "#94a3b8",
                  cursor: "pointer",
                  padding: "4px",
                  lineHeight: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "28px",
                  height: "28px",
                  borderRadius: "50%",
                  transition: "background 0.2s, color 0.2s",
                }}
                className="btn-fechar-modal"
                title="Fechar"
              >
                ✕
              </button>
              <span className="cliente-modal-icon">
                {editandoClienteId ? "✏️" : "🏢"}
              </span>
              <h2>{editandoClienteId ? "Editar cliente" : "Novo cliente"}</h2>
            </div>

            <div className="form-group">
              <label>Nome da empresa</label>
              <input
                placeholder="Ex: Greensat"
                value={clienteForm.nomeEmpresa}
                onChange={(e) =>
                  setClienteForm({
                    ...clienteForm,
                    nomeEmpresa: e.target.value,
                  })
                }
                onBlur={async () => {
                  // Busca automática do idCentral pelo nome (planilha do CS). Só
                  // preenche sozinho quando o campo ainda está vazio — se alguém já
                  // digitou/corrigiu o ID manualmente, não sobrescreve.
                  if (
                    !clienteForm.nomeEmpresa.trim() ||
                    clienteForm.idCentral?.trim()
                  ) {
                    return;
                  }

                  setBuscandoIdCentral(true);
                  try {
                    const encontrado = await buscarIdCentralPorNome(
                      clienteForm.nomeEmpresa,
                    );
                    if (encontrado) {
                      setClienteForm((atual) => ({
                        ...atual,
                        idCentral: encontrado,
                      }));
                    } else {
                      toast.warning(
                        "Não encontrei essa central na planilha do CS. Preencha o ID Central manualmente.",
                      );
                    }
                  } finally {
                    setBuscandoIdCentral(false);
                  }
                }}
              />
            </div>

            <div className="form-group">
              <label>ID Central (SSX)</label>
              <input
                value={clienteForm.idCentral || ""}
                onChange={(e) =>
                  setClienteForm({
                    ...clienteForm,
                    idCentral: e.target.value,
                  })
                }
                placeholder={
                  buscandoIdCentral
                    ? "Buscando na planilha do CS..."
                    : "Preenchido automaticamente pelo nome da empresa"
                }
                disabled={buscandoIdCentral}
              />
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label>Responsável</label>
                <select
                  value={clienteForm.responsavel}
                  onChange={(e) =>
                    setClienteForm({
                      ...clienteForm,
                      responsavel: e.target.value as Empresa["responsavel"],
                    })
                  }
                >
                  <option value="">Selecione...</option>
                  <option value="Pedro">Pedro</option>
                  <option value="Jean">Jean</option>
                  <option value="Jeff">Jeff</option>
                  <option value="Natalia">Natalia</option>
                  <option value="Clarice">Clarice</option>
                </select>
              </div>

              <div className="form-group">
                <label>Tipo</label>
                <select
                  value={clienteForm.tipo}
                  onChange={(e) =>
                    setClienteForm({
                      ...clienteForm,
                      tipo: e.target.value as Empresa["tipo"],
                    })
                  }
                >
                  <option value="">Selecione...</option>
                  <option value="Fast">Fast</option>
                  <option value="Safety">Safety</option>
                </select>
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label>CS responsável</label>
                <select
                  value={clienteForm.csResponsavel || ""}
                  onChange={(e) =>
                    setClienteForm({
                      ...clienteForm,
                      csResponsavel: e.target.value as Empresa["csResponsavel"],
                    })
                  }
                >
                  <option value="">Selecione...</option>
                  {listaCS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Comercial responsável</label>
                <input
                  placeholder="Ex: Carlos"
                  value={clienteForm.comercialResponsavel || ""}
                  onChange={(e) =>
                    setClienteForm({
                      ...clienteForm,
                      comercialResponsavel: e.target.value,
                    })
                  }
                  list="comerciais-sugestoes"
                />
                <datalist id="comerciais-sugestoes">
                  {listaComercial.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="form-group">
              <label>Contatos</label>

              {(clienteForm.contatos || []).length === 0 && (
                <p className="contatos-vazio">
                  Nenhum contato cadastrado ainda.
                </p>
              )}

              <div className="contatos-lista">
                {(clienteForm.contatos || []).map((c, idx) => {
                  const telefones = c.telefones?.length
                    ? c.telefones
                    : [c.telefone || ""];
                  const atualizarTelefones = (numeros: string[]) => {
                    setClienteForm((atual) => ({
                      ...atual,
                      contatos: (atual.contatos || []).map((contato, i) =>
                        i === idx
                          ? {
                              ...contato,
                              telefone: numeros[0] || "",
                              telefones: numeros,
                            }
                          : contato,
                      ),
                    }));
                  };

                  return (
                    <div key={idx} className="contato-item">
                      <div className="contato-campo">
                        <label>Nome</label>
                        <input
                          placeholder="Ex: João"
                          value={c.nome}
                          onChange={(e) => {
                            const novaLista = [...(clienteForm.contatos || [])];
                            novaLista[idx] = {
                              ...novaLista[idx],
                              nome: e.target.value,
                            };
                            setClienteForm({
                              ...clienteForm,
                              contatos: novaLista,
                            });
                          }}
                        />
                      </div>

                      <div className="contato-campo">
                        {telefones.map((telefone, numeroIdx) => {
                          const preenchido = telefone.trim().length > 0;
                          const { valido, erro } =
                            analisarTelefoneWhatsApp(telefone);
                          const inputId = `contato-${idx}-telefone-${numeroIdx}`;
                          return (
                            <div key={numeroIdx} className="contato-campo">
                              <label htmlFor={inputId}>
                                Telefone {numeroIdx + 1}
                              </label>
                              <div className="contato-telefone-linha">
                                <input
                                  id={inputId}
                                  type="tel"
                                  placeholder="Ex: (11) 99999-9999"
                                  value={telefone}
                                  aria-invalid={preenchido && !valido}
                                  onChange={(e) =>
                                    atualizarTelefones(
                                      telefones.map((numero, i) =>
                                        i === numeroIdx
                                          ? e.target.value
                                          : numero,
                                      ),
                                    )
                                  }
                                />
                                {telefones.length > 1 && (
                                  <button
                                    type="button"
                                    className="contato-remover"
                                    aria-label={`Remover telefone ${numeroIdx + 1} de ${c.nome || "contato"}`}
                                    onClick={() =>
                                      atualizarTelefones(
                                        telefones.filter(
                                          (_, i) => i !== numeroIdx,
                                        ),
                                      )
                                    }
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                              <span
                                className={`contato-feedback ${preenchido ? (valido ? "valido" : "invalido") : ""}`}
                              >
                                {preenchido
                                  ? valido
                                    ? `Será enviado para ${formatarTelefoneExibicao(telefone)}`
                                    : erro
                                  : ""}
                              </span>
                            </div>
                          );
                        })}
                        <button
                          type="button"
                          className="btn-add-contato"
                          onClick={() => atualizarTelefones([...telefones, ""])}
                        >
                          + Adicionar número
                        </button>
                        <span className="contato-feedback">
                          Você poderá escolher quais números receberão a
                          mensagem na confirmação do envio.
                        </span>
                      </div>

                      <button
                        type="button"
                        className="contato-remover"
                        title="Remover contato"
                        onClick={() => {
                          const novaLista = (clienteForm.contatos || []).filter(
                            (_, i) => i !== idx,
                          );
                          setClienteForm({
                            ...clienteForm,
                            contatos: novaLista,
                          });
                        }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                className="btn-add-contato"
                onClick={() =>
                  setClienteForm({
                    ...clienteForm,
                    contatos: [
                      ...(clienteForm.contatos || []),
                      { nome: "", telefone: "" },
                    ],
                  })
                }
              >
                + Adicionar contato
              </button>
            </div>

            <div className="form-group">
              <label>E-mails (opcional)</label>

              {(clienteForm.emails || []).length === 0 && (
                <p className="contatos-vazio">
                  Nenhum e-mail cadastrado ainda.
                </p>
              )}

              <div className="contatos-lista">
                {(clienteForm.emails || []).map((email, idx) => {
                  const emailPreenchido = email.trim().length > 0;
                  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
                    email.trim(),
                  );

                  return (
                    <div key={idx} className="email-item">
                      <div className="contato-campo">
                        <label>E-mail</label>
                        <input
                          type="email"
                          placeholder="Ex: contato@empresa.com"
                          value={email}
                          onChange={(e) => {
                            const novaLista = [...(clienteForm.emails || [])];
                            novaLista[idx] = e.target.value;
                            setClienteForm({
                              ...clienteForm,
                              emails: novaLista,
                            });
                          }}
                        />
                        <span
                          className={`contato-feedback ${emailPreenchido ? (emailValido ? "valido" : "invalido") : ""}`}
                        >
                          {emailPreenchido && !emailValido
                            ? "E-mail em formato inválido"
                            : ""}
                        </span>
                      </div>

                      <button
                        type="button"
                        className="contato-remover"
                        title="Remover e-mail"
                        onClick={() => {
                          const novaLista = (clienteForm.emails || []).filter(
                            (_, i) => i !== idx,
                          );
                          setClienteForm({
                            ...clienteForm,
                            emails: novaLista,
                          });
                        }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                className="btn-add-contato"
                onClick={() =>
                  setClienteForm({
                    ...clienteForm,
                    emails: [...(clienteForm.emails || []), ""],
                  })
                }
              >
                + Adicionar e-mail
              </button>
            </div>

            <div className="cliente-pendencias">
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="pendencia-checkbox">
                    <input
                      type="checkbox"
                      checked={clienteForm.pendencia?.ativa ?? false}
                      onChange={(e) =>
                        setClienteForm({
                          ...clienteForm,
                          pendencia: {
                            tipoId: clienteForm.pendencia?.tipoId || "",
                            tipoNome: clienteForm.pendencia?.tipoNome || "",
                            venceEm: clienteForm.pendencia?.venceEm || "",
                            ativa: e.target.checked,
                          },
                        })
                      }
                    />
                    Cliente possui pendências
                  </label>
                </div>
                <div className="form-group">
                  <label htmlFor="cliente-tipo-pendencia">
                    Tipo de pendência
                  </label>
                  <select
                    id="cliente-tipo-pendencia"
                    disabled={
                      !clienteForm.pendencia?.ativa || carregandoPendencias
                    }
                    value={clienteForm.pendencia?.tipoId || ""}
                    onChange={(e) => {
                      const tipo = tiposPendencia.find(
                        (t) => t.id === e.target.value,
                      );
                      setClienteForm({
                        ...clienteForm,
                        pendencia: {
                          ...clienteForm.pendencia!,
                          tipoId: tipo?.id || "",
                          tipoNome: tipo?.nome || "",
                        },
                      });
                    }}
                  >
                    <option value="">
                      {carregandoPendencias
                        ? "Carregando..."
                        : "Selecione a pendência"}
                    </option>
                    {clienteForm.pendencia?.tipoId &&
                      !tiposPendencia.some(
                        (t) => t.id === clienteForm.pendencia?.tipoId,
                      ) && (
                        <option value={clienteForm.pendencia.tipoId}>
                          {clienteForm.pendencia.tipoNome} (tipo removido)
                        </option>
                      )}
                    {tiposPendencia.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nome}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {clienteForm.pendencia?.ativa && (
                <div className="form-group">
                  <label htmlFor="cliente-pendencia-vencimento">
                    Vencimento da pendência (opcional)
                  </label>
                  <input
                    id="cliente-pendencia-vencimento"
                    type="date"
                    value={clienteForm.pendencia.venceEm || ""}
                    onChange={(e) =>
                      setClienteForm({
                        ...clienteForm,
                        pendencia: {
                          ...clienteForm.pendencia!,
                          venceEm: e.target.value,
                        },
                      })
                    }
                  />
                  <small>
                    Válida até o fim da data escolhida, no horário de Brasília.
                    Sem data, permanece até desmarcar.
                  </small>
                  {!tiposPendencia.length && !carregandoPendencias && (
                    <small>
                      Cadastre os tipos de pendência na seção Tabulações.
                    </small>
                  )}
                  {clienteForm.pendencia.venceEm &&
                    (vencimentoPendencia(clienteForm.pendencia.venceEm) ||
                      Infinity) <= agora && (
                      <small>
                        Pendência vencida: o semáforo já segue as regras
                        tradicionais.
                      </small>
                    )}
                </div>
              )}
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label>Persona</label>
                <input
                  placeholder="Ex: Empreendedor"
                  value={clienteForm.persona || ""}
                  onChange={(e) =>
                    setClienteForm({
                      ...clienteForm,
                      persona: e.target.value,
                    })
                  }
                />
              </div>

              <div className="form-group">
                <label>Data de entrada</label>
                <input
                  type="date"
                  value={clienteForm.dataEntrada}
                  onChange={(e) =>
                    setClienteForm({
                      ...clienteForm,
                      dataEntrada: e.target.value,
                    })
                  }
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label>Data de finalização da esteira</label>
                <input
                  type="date"
                  value={clienteForm.dataFinalizacao || ""}
                  onChange={(e) =>
                    setClienteForm({
                      ...clienteForm,
                      dataFinalizacao: e.target.value,
                    })
                  }
                />
              </div>

              <div className="form-group">
                <label>Data de follow-up final</label>
                <input
                  type="date"
                  value={clienteForm.dataFollowUpFinal || ""}
                  onChange={(e) =>
                    setClienteForm({
                      ...clienteForm,
                      dataFollowUpFinal: e.target.value,
                    })
                  }
                />
              </div>
            </div>

            <div className="form-group">
              <label>Localização (Endereço)</label>
              <input
                placeholder="Ex: Av. Paulista, 1000 - São Paulo/SP"
                value={clienteForm.localizacao || ""}
                onChange={(e) =>
                  setClienteForm({
                    ...clienteForm,
                    localizacao: e.target.value,
                  })
                }
              />
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label>Produto</label>
                <select
                  value={clienteForm.produto || ""}
                  onChange={(e) =>
                    setClienteForm({
                      ...clienteForm,
                      produto: e.target.value as Empresa["produto"],
                    })
                  }
                >
                  <option value="">Selecione o produto</option>
                  <option value="Pro">Pro</option>
                  <option value="Lite">Lite</option>
                  <option value="Start">Start</option>
                </select>
              </div>

              <div className="form-group">
                <label>Valor do contrato (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="Ex: 1500.00"
                  value={clienteForm.valorContrato ?? ""}
                  onChange={(e) =>
                    setClienteForm({
                      ...clienteForm,
                      valorContrato: e.target.value
                        ? Number(e.target.value)
                        : undefined,
                    })
                  }
                />
              </div>
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={clienteForm.exibirAvisosSuporte ?? true}
                  onChange={(e) =>
                    setClienteForm({
                      ...clienteForm,
                      exibirAvisosSuporte: e.target.checked,
                    })
                  }
                />
                Exibir avisos de contato com o Suporte na Home
              </label>
              <small>
                Desmarque para ocultar este cliente em “Clientes em treinamento
                que contataram o Suporte”.
              </small>
            </div>

            <div className="form-group">
              <label>Status</label>
              <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
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
                    checked={clienteForm.isOngoing ?? false}
                    onChange={(e) =>
                      setClienteForm({
                        ...clienteForm,
                        isOngoing: e.target.checked,
                      })
                    }
                  />
                  Cliente Ongoing 🔄
                </label>
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
                    checked={clienteForm.isCancelled ?? false}
                    onChange={(e) =>
                      setClienteForm({
                        ...clienteForm,
                        isCancelled: e.target.checked,
                      })
                    }
                  />
                  Cliente Cancelado ❌
                </label>
              </div>
            </div>

            {role === "master" && (
              <div className="form-group">
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
                    checked={
                      clienteForm.gamificacaoDeducaoSuporte?.ativo ?? false
                    }
                    onChange={(e) =>
                      setClienteForm({
                        ...clienteForm,
                        gamificacaoDeducaoSuporte: {
                          ...clienteForm.gamificacaoDeducaoSuporte,
                          ativo: e.target.checked,
                        },
                      })
                    }
                  />
                  Elegível para dedução de pontos do treinador (contato com o
                  Suporte)
                </label>
                <p
                  style={{
                    fontSize: "0.8rem",
                    opacity: 0.7,
                    margin: "0.35rem 0 0",
                  }}
                >
                  Os pontos são descontados do treinador já definido em
                  "Responsável"
                  {clienteForm.responsavel
                    ? ` (${clienteForm.responsavel})`
                    : ""}
                  .
                </p>

                {clienteForm.gamificacaoDeducaoSuporte?.ativo && (
                  <div
                    style={{
                      marginTop: "0.75rem",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.75rem",
                    }}
                  >
                    {(
                      [
                        { chave: "duvida", label: "Dúvida" },
                        { chave: "problema", label: "Problema" },
                        { chave: "solicitacao", label: "Solicitação" },
                      ] as const
                    ).map(({ chave, label }) => (
                      <div key={chave} className="form-grid-2">
                        <div className="form-group">
                          <label>{label} — Dentro do expediente</label>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            placeholder="0"
                            value={
                              clienteForm.gamificacaoDeducaoSuporte?.[chave]
                                ?.dentroExpediente ?? ""
                            }
                            onChange={(e) =>
                              setClienteForm({
                                ...clienteForm,
                                gamificacaoDeducaoSuporte: {
                                  ativo: true,
                                  ...clienteForm.gamificacaoDeducaoSuporte,
                                  [chave]: {
                                    ...clienteForm.gamificacaoDeducaoSuporte?.[
                                      chave
                                    ],
                                    dentroExpediente: e.target.value
                                      ? Number(e.target.value)
                                      : 0,
                                  },
                                },
                              })
                            }
                          />
                        </div>
                        <div className="form-group">
                          <label>{label} — Fora do expediente</label>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            placeholder="0"
                            value={
                              clienteForm.gamificacaoDeducaoSuporte?.[chave]
                                ?.foraExpediente ?? ""
                            }
                            onChange={(e) =>
                              setClienteForm({
                                ...clienteForm,
                                gamificacaoDeducaoSuporte: {
                                  ativo: true,
                                  ...clienteForm.gamificacaoDeducaoSuporte,
                                  [chave]: {
                                    ...clienteForm.gamificacaoDeducaoSuporte?.[
                                      chave
                                    ],
                                    foraExpediente: e.target.value
                                      ? Number(e.target.value)
                                      : 0,
                                  },
                                },
                              })
                            }
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div
              style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}
            >
              <button
                type="button"
                className="btn-cancelar-modal"
                onClick={() => setModalClienteAberto(false)}
                style={{
                  flex: 1,
                  padding: "0.85rem",
                  borderRadius: "10px",
                  fontWeight: "600",
                  cursor: "pointer",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  background: "#1e293b",
                  color: "#cbd5e1",
                  fontSize: "0.95rem",
                  transition: "0.2s ease",
                }}
              >
                Cancelar
              </button>
              <button
                className="btn-primary"
                onClick={salvarCliente}
                disabled={buscandoIdCentral}
                style={{ flex: 1, marginTop: 0 }}
              >
                {buscandoIdCentral
                  ? "Buscando ID Central..."
                  : "Salvar cliente"}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalScoreHomeAberto && (
        <div
          className="home-score-modal-overlay"
          onClick={() => setModalScoreHomeAberto(false)}
        >
          <div
            className="home-score-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="home-score-modal-header">
              <h2>Calcular Score do Cliente</h2>
              <button
                className="home-score-modal-fechar"
                onClick={() => setModalScoreHomeAberto(false)}
              >
                ✕
              </button>
            </div>

            <div className="home-score-modal-body">
              {/* Pergunta 1 */}
              <div className="home-score-pergunta">
                <label>
                  Cliente entra pelo computador? *{" "}
                  <span className="home-score-hint">
                    (Sim = +1.0 e zera perda / Não: 1ª vez cancela o bônus, a
                    partir da 2ª = -1.0)
                  </span>
                </label>
                {!!clienteSelecionado?.scoreContadoresPerda
                  ?.entraComputador && (
                  <span
                    className="home-score-hint"
                    style={{ display: "block" }}
                  >
                    Perda salva (em relação ao bônus do Sim): -
                    {(
                      clienteSelecionado.scoreContadoresPerda.entraComputador *
                      1.0
                    ).toFixed(1)}
                  </span>
                )}
                <div className="home-radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="entraComputador"
                      value="Sim"
                      checked={respostasScoreHome.entraComputador === "Sim"}
                      onChange={() =>
                        setRespostasScoreHome((prev) => ({
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
                      checked={respostasScoreHome.entraComputador === "Não"}
                      onChange={() =>
                        setRespostasScoreHome((prev) => ({
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
              <div className="home-score-pergunta">
                <label>
                  Cliente compartilha a tela? *{" "}
                  <span className="home-score-hint">
                    (Sim = +1.0 e zera perda / Não: 1ª vez cancela o bônus, a
                    partir da 2ª = -1.0)
                  </span>
                </label>
                {!!clienteSelecionado?.scoreContadoresPerda
                  ?.compartilhaTela && (
                  <span
                    className="home-score-hint"
                    style={{ display: "block" }}
                  >
                    Perda salva (em relação ao bônus do Sim): -
                    {(
                      clienteSelecionado.scoreContadoresPerda.compartilhaTela *
                      1.0
                    ).toFixed(1)}
                  </span>
                )}
                <div className="home-radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="compartilhaTela"
                      value="Sim"
                      checked={respostasScoreHome.compartilhaTela === "Sim"}
                      onChange={() =>
                        setRespostasScoreHome((prev) => ({
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
                      checked={respostasScoreHome.compartilhaTela === "Não"}
                      onChange={() =>
                        setRespostasScoreHome((prev) => ({
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
              <div className="home-score-pergunta">
                <label>
                  Cliente faz perguntas? *{" "}
                  <span className="home-score-hint">
                    (Sim = +2.0 / Não = 0)
                  </span>
                </label>
                <div className="home-radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="fazPerguntas"
                      value="Sim"
                      checked={respostasScoreHome.fazPerguntas === "Sim"}
                      onChange={() =>
                        setRespostasScoreHome((prev) => ({
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
                      checked={respostasScoreHome.fazPerguntas === "Não"}
                      onChange={() =>
                        setRespostasScoreHome((prev) => ({
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
              <div className="home-score-pergunta">
                <label>
                  Cliente se recorda de temas anteriores? *{" "}
                  <span className="home-score-hint">
                    (Sim = +2.0 e zera perda / Não: 1ª vez cancela o bônus, a
                    partir da 2ª = -3.0)
                  </span>
                </label>
                {!!clienteSelecionado?.scoreContadoresPerda?.recordaTemas && (
                  <span
                    className="home-score-hint"
                    style={{ display: "block" }}
                  >
                    Perda salva: -
                    {clienteSelecionado.scoreContadoresPerda.recordaTemas.toFixed(
                      1,
                    )}
                  </span>
                )}
                <div className="home-radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="recordaTemas"
                      value="Sim"
                      checked={respostasScoreHome.recordaTemas === "Sim"}
                      onChange={() =>
                        setRespostasScoreHome((prev) => ({
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
                      checked={respostasScoreHome.recordaTemas === "Não"}
                      onChange={() =>
                        setRespostasScoreHome((prev) => ({
                          ...prev,
                          recordaTemas: "Não",
                        }))
                      }
                    />
                    Não
                  </label>
                </div>
                {respostasScoreHome.recordaTemas === "Não" && (
                  <div className="home-duvidas-temas">
                    <label>Dúvidas do cliente sobre temas anteriores:</label>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <input
                        type="text"
                        value={novaDuvidaTemaHome}
                        onChange={(e) => setNovaDuvidaTemaHome(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            adicionarDuvidaTemaHome();
                          }
                        }}
                        placeholder="Descreva a dúvida do cliente"
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={adicionarDuvidaTemaHome}
                      >
                        Adicionar
                      </button>
                    </div>
                    {duvidasTemasHome.length > 0 && (
                      <ul className="home-duvidas-temas-lista">
                        {duvidasTemasHome.map((duvida, index) => (
                          <li key={index}>
                            {duvida}
                            <button
                              type="button"
                              className="home-duvida-tema-remover"
                              onClick={() => removerDuvidaTemaHome(index)}
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
              <div className="home-score-pergunta">
                <label>
                  Cliente faltou 2 dias seguidos? *{" "}
                  <span className="home-score-hint">
                    (Sim = -1.0 / Não = +1.0)
                  </span>
                </label>
                <div className="home-radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="faltouDoisDias"
                      value="Sim"
                      checked={respostasScoreHome.faltouDoisDias === "Sim"}
                      onChange={() =>
                        setRespostasScoreHome((prev) => ({
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
                      checked={respostasScoreHome.faltouDoisDias === "Não"}
                      onChange={() =>
                        setRespostasScoreHome((prev) => ({
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
              <div className="home-score-pergunta">
                <label>
                  Cliente possui estrutura necessária? *{" "}
                  <span className="home-score-hint">
                    (Sim = +1.0 / Não = 0)
                  </span>
                </label>
                <div className="home-radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="estruturaNecessaria"
                      value="Sim"
                      checked={respostasScoreHome.estruturaNecessaria === "Sim"}
                      onChange={() =>
                        setRespostasScoreHome((prev) => ({
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
                      checked={respostasScoreHome.estruturaNecessaria === "Não"}
                      onChange={() =>
                        setRespostasScoreHome((prev) => ({
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
              <div className="home-score-pergunta">
                <label>
                  Cliente reclama do sistema? *{" "}
                  <span className="home-score-hint">
                    (Sim = -3.0 / Não = +2.0)
                  </span>
                </label>
                <div className="home-radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="clienteReclamante"
                      value="Sim"
                      checked={respostasScoreHome.clienteReclamante === "Sim"}
                      onChange={() =>
                        setRespostasScoreHome((prev) => ({
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
                      checked={respostasScoreHome.clienteReclamante === "Não"}
                      onChange={() =>
                        setRespostasScoreHome((prev) => ({
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
              <div className="home-score-pergunta">
                <label>
                  Cliente sumiu? *{" "}
                  <span className="home-score-hint">
                    (Sim = -5.0 / Não = 0)
                  </span>
                </label>
                <div className="home-radio-group-score">
                  <label>
                    <input
                      type="radio"
                      name="clienteSumido"
                      value="Sim"
                      checked={respostasScoreHome.clienteSumido === "Sim"}
                      onChange={() =>
                        setRespostasScoreHome((prev) => ({
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
                      checked={respostasScoreHome.clienteSumido === "Não"}
                      onChange={() =>
                        setRespostasScoreHome((prev) => ({
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

            {clienteSelecionado &&
              obterAjustesAtivos(clienteSelecionado).length > 0 && (
                <div className="home-score-deducoes-ativas">
                  <span className="home-score-deducoes-titulo">
                    Reduções ativas no score deste cliente:
                  </span>
                  <ul>
                    {obterAjustesAtivos(clienteSelecionado).map((a, idx) => {
                      const ocorrenciasDaEmpresa = historicoComIds.filter(
                        (o) =>
                          o.empresa.trim().toLowerCase() ===
                          clienteSelecionado.nomeEmpresa.trim().toLowerCase(),
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
                                className="home-score-deducao-ocorrencia-link"
                                onClick={() =>
                                  navigate(
                                    `/historico?empresa=${encodeURIComponent(clienteSelecionado.nomeEmpresa)}&ocorrencia=${ocorrenciaRef.id}`,
                                  )
                                }
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
                              className="home-score-deducao-remover"
                              onClick={() => removerReducaoAtivaHome(a)}
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

            <div className="home-score-modal-footer">
              <div className="home-score-calculo-previo">
                {(() => {
                  const res = calcularPontuacaoScore(
                    respostasScoreHome,
                    clienteSelecionado?.scoreContadoresPerda,
                  );
                  const ajustesAtivos = clienteSelecionado
                    ? obterAjustesAtivos(clienteSelecionado)
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
                        <span className="home-score-deducao-inline">
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
                  onClick={confirmarScoreNeutroHome}
                  className="btn-score-neutro"
                >
                  Neutro
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={confirmarCalculoScoreHome}
                  style={{ width: "auto", margin: 0, padding: "0.6rem 1.2rem" }}
                >
                  Confirmar Cálculo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <GestaoNotificacaoModal
        open={gestaoConfirmModalOpen}
        titulo={
          gestaoEmpresaEvento === "conclusao"
            ? "Notificar Supervisor, CS e Comercial sobre a conclusão da esteira?"
            : gestaoEmpresaEvento === "cancelado"
            ? "🚫 Notificar Supervisor, CS e Comercial sobre o cancelamento?"
            : gestaoEmpresaEvento === "retorno"
              ? "🔄 Notificar Supervisor, CS e Comercial sobre o retorno à esteira?"
              : "⏸️ Notificar Supervisor, CS e Comercial sobre a suspensão?"
        }
        destinatarios={gestaoDestinatarios}
        avisos={gestaoAvisos}
        mensagem={gestaoMensagem}
        onChangeMensagem={setGestaoMensagem}
        onResultado={async ({ status, enviadoEm, destinatarios }) => {
          // O retorno não tem campo de status próprio na empresa; gravá-lo nos campos
          // de suspensão apagaria o registro do envio da suspensão.
          if (!gestaoEmpresaId || gestaoEmpresaEvento === "retorno") return;
          try {
            if (gestaoEmpresaEvento === "conclusao") {
              const campos = camposResultadoConclusao({ status, enviadoEm, destinatarios });
              await salvarEmpresas({ id: gestaoEmpresaId, ...campos });
              setEmpresas((lista) => lista.map((empresa) => empresa.id === gestaoEmpresaId
                ? { ...empresa, ...campos } : empresa));
              setClienteSelecionado((empresa) => empresa?.id === gestaoEmpresaId
                ? { ...empresa, ...campos } : empresa);
            } else if (gestaoEmpresaEvento === "cancelado") {
              await salvarEmpresas({
                id: gestaoEmpresaId,
                whatsappStatusCancelamento: status,
                whatsappEnviadoEmCancelamento: enviadoEm,
                whatsappDestinatariosCancelamento: destinatarios,
              });
            } else {
              await salvarEmpresas({
                id: gestaoEmpresaId,
                whatsappStatusSuspensao: status,
                whatsappEnviadoEmSuspensao: enviadoEm,
                whatsappDestinatariosSuspensao: destinatarios,
              });
            }
          } catch (error) {
            console.error(
              "Erro ao registrar status de envio da notificação de gestão:",
              error,
            );
            throw error;
          }
        }}
        onClose={() => {
          setGestaoConfirmModalOpen(false);
          setGestaoDestinatarios([]);
          setGestaoMensagem("");
          setGestaoEmpresaId(undefined);
        }}
      />
    </div>
  );
}
