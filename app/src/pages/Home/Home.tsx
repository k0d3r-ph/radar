import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import "./Home.css";

import ProgressBar from "../../components/ProgressBar";
import StatusFarol from "../../components/StatusFarol";

import { listarOcorrencias, salvarOcorrencia } from "../../services/ocorrencias";

import {
  listarEmpresas,
  removerEmpresa,
  salvarEmpresas,
} from "../../services/empresas";

import {
  calcularDiasNaEsteira,
  calcularFarol,
  calcularProgressoPorFases,
  calcularTME,
  calcularTotalFases,
  obterUltimoTreinamento,
} from "../../utils/monitoramento";
import type { Empresa, Ocorrencia } from "../../types";
import { useAuth } from "../../context/AuthContext";
import { formatarNome } from "../../utils/formatarNome";

export default function Home() {
  const navigate = useNavigate();
  const { role } = useAuth();

  const [clienteSelecionado, setClienteSelecionado] = useState<Empresa | null>(
    null,
  );

  const [filtroCliente, setFiltroCliente] = useState(() => sessionStorage.getItem("filtroCliente") || "");
  const [filtroResponsavel, setFiltroResponsavel] = useState(() => sessionStorage.getItem("filtroResponsavel") || "");
  const [filtroCs, setFiltroCs] = useState(() => sessionStorage.getItem("filtroCs") || "");
  const [filtroProgresso, setFiltroProgresso] = useState(() => sessionStorage.getItem("filtroProgresso") || "");
  const [filtroCardStatus, setFiltroCardStatus] = useState<"concluidos" | "andamento" | "">(() => (sessionStorage.getItem("filtroCardStatus") as any) || "");
  const [filtroCardTipo, setFiltroCardTipo] = useState<"safety" | "fast" | "">(() => (sessionStorage.getItem("filtroCardTipo") as any) || "");
  const [filtroCardAlerta, setFiltroCardAlerta] = useState<"alerta" | "">(() => (sessionStorage.getItem("filtroCardAlerta") as any) || "");
  const [ordenacaoContrato, setOrdenacaoContrato] = useState<"" | "maior" | "menor">(() => (sessionStorage.getItem("ordenacaoContrato") as any) || "");

  const [empresas, setEmpresas] = useState<Empresa[]>([]);

  const [historico, setHistorico] = useState<Ocorrencia[]>([]);

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
    valorContrato: undefined,
  };

  const [clienteForm, setClienteForm] = useState<Empresa>(EMPTY_CLIENTE);

  const [modalClienteAberto, setModalClienteAberto] = useState(false);
  const [confirmarExclusaoAberto, setConfirmarExclusaoAberto] = useState(false);

  const [editandoClienteId, setEditandoClienteId] = useState<string | null>(
    null,
  );

  const [tabelaAtivaAberta, setTabelaAtivaAberta] = useState(true);
  const [tabelaOngoingAberta, setTabelaOngoingAberta] = useState(true);

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
    setClienteForm(empresa);

    setEditandoClienteId(empresa.id || null);

    setModalClienteAberto(true);
  }

  async function salvarCliente() {
    if (!clienteForm.nomeEmpresa.trim()) {
      return;
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
      empresas.forEach(e => {
        if (e.idNumeric && e.idNumeric > highest) {
          highest = e.idNumeric;
        }
      });
      idNumericToSave = highest + 1;
    }

    const antigoNome = editandoClienteId 
      ? empresas.find(e => e.id === editandoClienteId)?.nomeEmpresa
      : null;

    await salvarEmpresas({
      ...clienteForm,
      nomeEmpresa: nomeFinal,
      idNumeric: idNumericToSave,
      comercialResponsavel: comercialFormatted,
      id: editandoClienteId || undefined,
      updatedAt: Date.now(),
    });

    if (antigoNome && antigoNome.trim().toLowerCase() !== nomeFinal.trim().toLowerCase()) {
      const ocsParaAtualizar = historico.filter(o => o.empresa.trim().toLowerCase() === antigoNome.trim().toLowerCase());
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

      let [empresasLista, ocorrenciasLista] = await Promise.all([
        listarEmpresas(),
        listarOcorrencias(),
      ]);

      let mudouAlguma = false;

      let highest = 0;
      empresasLista.forEach(e => {
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

          const ocsParaAtualizar = ocorrenciasLista.filter(o => o.empresa.trim().toLowerCase() === antigoNome.trim().toLowerCase());
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
      setLoading(false);
    }

    carregarDados();
  }, []);

  useEffect(() => {
    sessionStorage.setItem("filtroCliente", filtroCliente);
    sessionStorage.setItem("filtroResponsavel", filtroResponsavel);
    sessionStorage.setItem("filtroCs", filtroCs);
    sessionStorage.setItem("filtroProgresso", filtroProgresso);
    sessionStorage.setItem("filtroCardStatus", filtroCardStatus);
    sessionStorage.setItem("filtroCardTipo", filtroCardTipo);
    sessionStorage.setItem("filtroCardAlerta", filtroCardAlerta);
    sessionStorage.setItem("ordenacaoContrato", ordenacaoContrato);
  }, [filtroCliente, filtroResponsavel, filtroCs, filtroProgresso, filtroCardStatus, filtroCardTipo, filtroCardAlerta, ordenacaoContrato]);

  const dados = useMemo(() => {
    return empresas.map((empresa) => {
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

      // Encontra a ocorrência mais recente da empresa que define ou resolve um alerta
      const ultimaOcorrenciaAlerta = historico
        .filter(
          (o) =>
            o.empresa.trim().toLowerCase() === empresa.nomeEmpresa.trim().toLowerCase() &&
            (o.alerta === true || o.retirarAlerta === true)
        )
        .sort(
          (a, b) =>
            (b.createdAt ?? b.dataOcorrencia ?? 0) -
            (a.createdAt ?? a.dataOcorrencia ?? 0)
        )[0];

      let temAlerta = false;
      let ocorrenciaAlertaId = undefined;

      if (ultimaOcorrenciaAlerta) {
        if (ultimaOcorrenciaAlerta.alerta === true) {
          temAlerta = true;
          ocorrenciaAlertaId = ultimaOcorrenciaAlerta.id;
        } else {
          temAlerta = false;
        }
      } else {
        temAlerta = !!empresa.alerta;
      }

      const farol = calcularFarol({
        progresso,
        tme,
        alerta: temAlerta,
      });

      return {
        ...empresa,
        alerta: temAlerta,
        ocorrenciaAlertaId: ocorrenciaAlertaId,
        tme,
        progresso,
        farol,
        dias: calcularDiasNaEsteira(empresa.dataEntrada, progresso, dataBase),
      };
    });
  }, [empresas, historico]);

  const dadosAtivos = useMemo(() => {
    return dados.filter((e) => !e.isOngoing);
  }, [dados]);

  const dadosOngoing = useMemo(() => {
    return dados.filter((e) => !!e.isOngoing);
  }, [dados]);

  const stats = useMemo(() => {
    const total = dadosAtivos.length;
    const concluidos = dadosAtivos.filter((e) => e.progresso >= 100).length;
    const emAndamento = dadosAtivos.filter(
      (e) => e.progresso > 0 && e.progresso < 100,
    ).length;
    const safety = dadosAtivos.filter((e) => e.tipo === "Safety").length;
    const fast = dadosAtivos.filter((e) => e.tipo === "Fast").length;
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

  const dadosAtivosFiltrados = useMemo(() => {
    return dadosAtivos
      .filter((e) => {
        const clienteOk =
          !filtroCliente ||
          e.nomeEmpresa.toLowerCase().includes(filtroCliente.toLowerCase());
        const responsavelOk =
          !filtroResponsavel || formatarNome(e.responsavel) === filtroResponsavel;
        const csOk = !filtroCs || e.csResponsavel === filtroCs;
        const progressoOk =
          !filtroProgresso ||
          (filtroProgresso === "0-25" && e.progresso <= 25) ||
          (filtroProgresso === "26-50" &&
            e.progresso > 25 &&
            e.progresso <= 50) ||
          (filtroProgresso === "51-75" &&
            e.progresso > 50 &&
            e.progresso <= 75) ||
          (filtroProgresso === "76-100" && e.progresso > 75);

        const statusCardOk =
          !filtroCardStatus ||
          (filtroCardStatus === "concluidos" && e.progresso >= 100) ||
          (filtroCardStatus === "andamento" && e.progresso > 0 && e.progresso < 100);

        const tipoCardOk =
          !filtroCardTipo ||
          (filtroCardTipo === "safety" && e.tipo === "Safety") ||
          (filtroCardTipo === "fast" && e.tipo === "Fast");

        const alertaCardOk =
          !filtroCardAlerta ||
          (filtroCardAlerta === "alerta" && e.alerta);

        return clienteOk && responsavelOk && csOk && progressoOk && statusCardOk && tipoCardOk && alertaCardOk;
      })
      .sort((a, b) => {
        if (ordenacaoContrato === "maior") {
          return (b.valorContrato ?? 0) - (a.valorContrato ?? 0);
        }
        if (ordenacaoContrato === "menor") {
          return (a.valorContrato ?? 0) - (b.valorContrato ?? 0);
        }
        const ordem = { vermelho: 0, amarelo: 1, verde: 2, none: 3 };
        const farolDiff = (ordem[a.farol] ?? 3) - (ordem[b.farol] ?? 3);
        if (farolDiff !== 0) return farolDiff;
        return a.nomeEmpresa.localeCompare(b.nomeEmpresa, "pt-BR");
      });
  }, [dadosAtivos, filtroCliente, filtroResponsavel, filtroCs, filtroProgresso, filtroCardStatus, filtroCardTipo, filtroCardAlerta, ordenacaoContrato]);

  const dadosOngoingFiltrados = useMemo(() => {
    return dadosOngoing
      .filter((e) => {
        const clienteOk =
          !filtroCliente ||
          e.nomeEmpresa.toLowerCase().includes(filtroCliente.toLowerCase());
        const csOk = !filtroCs || e.csResponsavel === filtroCs;
        const responsavelOk =
          !filtroResponsavel || formatarNome(e.responsavel) === filtroResponsavel;

        return clienteOk && csOk && responsavelOk;
      })
      .sort((a, b) => {
        if (ordenacaoContrato === "maior") {
          return (b.valorContrato ?? 0) - (a.valorContrato ?? 0);
        }
        if (ordenacaoContrato === "menor") {
          return (a.valorContrato ?? 0) - (b.valorContrato ?? 0);
        }
        return a.nomeEmpresa.localeCompare(b.nomeEmpresa, "pt-BR");
      });
  }, [dadosOngoing, filtroCliente, filtroCs, filtroResponsavel, ordenacaoContrato]);

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
              {stats.total > 0 ? ((stats.concluidos / stats.total) * 100).toFixed(1) : "0.0"}% do total
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
              {stats.total > 0 ? ((stats.emAndamento / stats.total) * 100).toFixed(1) : "0.0"}% do total
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
              {stats.total > 0 ? ((stats.safety / stats.total) * 100).toFixed(1) : "0.0"}% do total
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
              {stats.total > 0 ? ((stats.fast / stats.total) * 100).toFixed(1) : "0.0"}% do total
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

      <div className="home-filtros">
        <input
          className="home-busca-cliente"
          placeholder="Buscar cliente..."
          value={filtroCliente}
          onChange={(e) => setFiltroCliente(e.target.value)}
        />

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
          {["Jeferson", "Rafaela", "Luiz", "João", "Eduarda", "Clarice", "Lucas"]
            .sort()
            .map((c) => (
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
          <option value="76-100">76% – 100%</option>
        </select>

        <select
          value={ordenacaoContrato}
          onChange={(e) => setOrdenacaoContrato(e.target.value as any)}
        >
          <option value="">Ordenar contrato: Padrão</option>
          <option value="maior">Ordenar contrato: Maior valor</option>
          <option value="menor">Ordenar contrato: Menor valor</option>
        </select>
 
        {(filtroCliente ||
          filtroResponsavel ||
          filtroCs ||
          filtroProgresso ||
          filtroCardStatus ||
          filtroCardTipo ||
          filtroCardAlerta ||
          ordenacaoContrato) && (
            <button
              onClick={() => {
                setFiltroCliente("");
                setFiltroResponsavel("");
                setFiltroCs("");
                setFiltroProgresso("");
                setFiltroCardStatus("");
                setFiltroCardTipo("");
                setFiltroCardAlerta("");
                setOrdenacaoContrato("");
              }}
            >
              Limpar filtros
            </button>
          )}
      </div>

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
          <span className="collapsible-arrow">
            {tabelaAtivaAberta ? "▼" : "▶"}
          </span>
        </div>

        {!loading && tabelaAtivaAberta && (
          <div className="table-wrapper">
            <table>
              <colgroup>
                <col style={{ width: "1.5%" }} />
                <col style={{ width: "5%" }} />
                <col style={{ width: "5%" }} />
                <col style={{ width: "5%" }} />
                <col style={{ width: "5%" }} />
                <col style={{ width: "5%" }} />
                <col style={{ width: "5%" }} />
                <col style={{ width: "5%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Cliente</th>
                  <th>Responsável</th>
                  <th>Tipo</th>
                  <th>Data de entrada</th>
                  <th>Dias</th>
                  <th>Agendamento</th>
                  <th className="td-progresso">Progresso</th>
                </tr>
              </thead>
 
              <tbody>
                {dadosAtivosFiltrados.map((empresa) => (
                  <tr
                    key={empresa.id}
                    className="linha-cliente"
                    onClick={() => abrirCliente(empresa)}
                  >
                    <td>
                      <StatusFarol status={empresa.farol} />
                    </td>

                    <td>
                      {empresa.nomeEmpresa}
                      {empresa.alerta && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            if (empresa.ocorrenciaAlertaId) {
                              navigate(`/historico?empresa=${encodeURIComponent(empresa.nomeEmpresa)}&ocorrencia=${empresa.ocorrenciaAlertaId}`);
                            } else {
                              navigate(`/historico?empresa=${encodeURIComponent(empresa.nomeEmpresa)}`);
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
                    </td>

                    <td>{formatarNome(empresa.responsavel)}</td>

                    <td>
                      {empresa.tipo && (
                        <span
                          style={{
                            padding: "2px 10px",
                            borderRadius: "999px",
                            fontSize: "0.8rem",
                            fontWeight: 600,
                            background:
                              empresa.tipo === "Fast" ? "#16a34a" : "#dc2626",
                            color: "white",
                          }}
                        >
                          {empresa.tipo}
                        </span>
                      )}
                    </td>

                    <td>{formatarData(empresa.dataEntrada)}</td>

                    <td>{empresa.dias}</td>

                    <td>{empresa.tme !== null ? `${empresa.tme} dias` : "-"}</td>

                    <td className="td-progresso">
                      <ProgressBar value={empresa.progresso} />
                    </td>
                  </tr>
                ))}
                {dadosAtivosFiltrados.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", color: "#64748b", padding: "2rem" }}>
                      Nenhum cliente ativo encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="table-footer">
              <span>
                Mostrando <strong>{dadosAtivosFiltrados.length}</strong> de <strong>{dadosAtivos.length}</strong> {dadosAtivos.length === 1 ? "cliente" : "clientes"}
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
            <span className="collapsible-count-badge" style={{ background: "rgba(16, 185, 129, 0.2)", color: "#34d399" }}>
              {dadosOngoingFiltrados.length}
            </span>
          </div>
          <span className="collapsible-arrow">
            {tabelaOngoingAberta ? "▼" : "▶"}
          </span>
        </div>

        {!loading && tabelaOngoingAberta && (
          <div className="table-wrapper">
            <table>
              <colgroup>
                <col style={{ width: "5%" }} />
                <col style={{ width: "5%" }} />
                <col style={{ width: "5%" }} />
                <col style={{ width: "5%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Contato</th>
                  <th>CS Responsável</th>
                  <th>Comercial Responsável</th>
                </tr>
              </thead>

              <tbody>
                {dadosOngoingFiltrados.map((empresa) => (
                  <tr
                    key={empresa.id}
                    className="linha-cliente"
                    onClick={() => abrirCliente(empresa)}
                  >
                    <td>
                      {empresa.nomeEmpresa}
                      {empresa.alerta && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            if (empresa.ocorrenciaAlertaId) {
                              navigate(`/historico?empresa=${encodeURIComponent(empresa.nomeEmpresa)}&ocorrencia=${empresa.ocorrenciaAlertaId}`);
                            } else {
                              navigate(`/historico?empresa=${encodeURIComponent(empresa.nomeEmpresa)}`);
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
                    </td>

                    <td>{empresa.contato || "-"}</td>

                    <td>{formatarNome(empresa.csResponsavel) || "-"}</td>

                    <td>{formatarNome(empresa.comercialResponsavel) || "-"}</td>
                  </tr>
                ))}
                {dadosOngoingFiltrados.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: "center", color: "#64748b", padding: "2rem" }}>
                      Nenhum cliente em acompanhamento contínuo (Ongoing).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="table-footer">
              <span>
                Mostrando <strong>{dadosOngoingFiltrados.length}</strong> de <strong>{dadosOngoing.length}</strong> {dadosOngoing.length === 1 ? "cliente" : "clientes"}
              </span>
            </div>
          </div>
        )}
      </div>

      {clienteSelecionado && (
        <div className="cliente-overlay">
          <div className="cliente-modal">
            <div className="cliente-modal-header" style={{ position: "relative" }}>
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
                  transition: "background 0.2s, color 0.2s"
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
                <span className="info-value" style={{ fontWeight: "bold", color: "#1e90ff" }}>
                  {clienteSelecionado.idNumeric ? `#${clienteSelecionado.idNumeric}` : "Sem ID"}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">CS Responsável</span>
                <span className="info-value">
                  {formatarNome(clienteSelecionado.csResponsavel) || "-"}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">Comercial Responsável</span>
                <span className="info-value">
                  {formatarNome(clienteSelecionado.comercialResponsavel) || "-"}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">Telefone</span>
                <span className="info-value">
                  {clienteSelecionado.telefone || "-"}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">Persona</span>
                <span className="info-value">
                  {clienteSelecionado.persona || "-"}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">contato</span>
                <span className="info-value">
                  {clienteSelecionado.contato || "-"}
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
                  {clienteSelecionado.valorContrato !== undefined && clienteSelecionado.valorContrato !== null
                    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(clienteSelecionado.valorContrato)
                    : "—"}
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
                return progressoSel >= 100 ||
                  clienteSelecionado.dataFinalizacao ? (
                  <div className="info-item full-width">
                    <span className="info-label">Data de Finalização</span>
                    <span className="info-value">
                      {formatarData(clienteSelecionado.dataFinalizacao)}
                    </span>
                  </div>
                ) : null;
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
                    `/historico?empresa=${encodeURIComponent(clienteSelecionado.nomeEmpresa)}`,
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
              Deseja realmente excluir o cliente <strong>{clienteSelecionado.nomeEmpresa}</strong>?
              Esta ação não poderá ser desfeita.
            </p>
            <div className="confirm-modal-actions">
              <button
                className="btn-excluir-confirm"
                onClick={async () => {
                  await excluirCliente(clienteSelecionado.id!);
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
            <div className="cliente-modal-header" style={{ position: "relative" }}>
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
                  transition: "background 0.2s, color 0.2s"
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
                  <option value="Jeferson">Jeferson</option>
                  <option value="Rafaela">Rafaela</option>
                  <option value="Luiz">Luiz</option>
                  <option value="João">João</option>
                  <option value="Eduarda">Eduarda</option>
                  <option value="Clarice">Clarice</option>
                  <option value="Lucas">Lucas</option>
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
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label>Telefone de contato</label>
                <input
                  placeholder="Ex: (11) 99999-9999"
                  value={clienteForm.telefone || ""}
                  onChange={(e) =>
                    setClienteForm({
                      ...clienteForm,
                      telefone: e.target.value,
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
                <label>contato</label>
                <input
                  value={clienteForm.contato || ""}
                  onChange={(e) =>
                    setClienteForm({
                      ...clienteForm,
                      contato: e.target.value,
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
                    valorContrato: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
              />
            </div>

            {(() => {
              const totalFasesForm = calcularTotalFases(clienteForm.temaText);
              const progressoForm = calcularProgressoPorFases(
                clienteForm.currentPhase,
                totalFasesForm,
              );
              return (
                progressoForm >= 100 && (
                  <div className="form-group">
                    <label>Data de finalização</label>
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
                )
              );
            })()}



            <div className="form-group">
              <label>Status</label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={clienteForm.isOngoing ?? false}
                  onChange={(e) =>
                    setClienteForm({ ...clienteForm, isOngoing: e.target.checked })
                  }
                />
                Cliente Ongoing 🔄
              </label>
            </div>

            <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
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
                  transition: "0.2s ease"
                }}
              >
                Cancelar
              </button>
              <button
                className="btn-primary"
                onClick={salvarCliente}
                style={{ flex: 1, marginTop: 0 }}
              >
                Salvar cliente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
