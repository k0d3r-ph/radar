import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import "./Home.css";

import ProgressBar from "../../components/ProgressBar";
import StatusFarol from "../../components/StatusFarol";

import { listarOcorrencias } from "../../services/ocorrencias";

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
  };

  const [clienteForm, setClienteForm] = useState<Empresa>(EMPTY_CLIENTE);

  const [modalClienteAberto, setModalClienteAberto] = useState(false);
  const [confirmarExclusaoAberto, setConfirmarExclusaoAberto] = useState(false);

  const [editandoClienteId, setEditandoClienteId] = useState<string | null>(
    null,
  );

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

    await salvarEmpresas({
      ...clienteForm,
      nomeEmpresa: clienteForm.nomeEmpresa.trim(),
      comercialResponsavel: comercialFormatted,
      id: editandoClienteId || undefined,
      updatedAt: Date.now(),
    });

    const lista = await listarEmpresas();

    setEmpresas(lista);

    setModalClienteAberto(false);
    setClienteSelecionado(null);
  }

  useEffect(() => {
    async function carregarDados() {
      setLoading(true);

      const [empresasLista, ocorrenciasLista] = await Promise.all([
        listarEmpresas(),
        listarOcorrencias(),
      ]);

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
  }, [filtroCliente, filtroResponsavel, filtroCs, filtroProgresso, filtroCardStatus, filtroCardTipo, filtroCardAlerta]);

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

      const farol = calcularFarol({
        progresso,
        tme,
        alerta: empresa.alerta,
      });

      return {
        ...empresa,
        tme,
        progresso,
        farol,
        dias: calcularDiasNaEsteira(empresa.dataEntrada, progresso, dataBase),
      };
    });
  }, [empresas, historico]);

  const stats = useMemo(() => {
    const total = dados.length;
    const concluidos = dados.filter((e) => e.progresso >= 100).length;
    const emAndamento = dados.filter(
      (e) => e.progresso > 0 && e.progresso < 100,
    ).length;
    const safety = dados.filter((e) => e.tipo === "Safety").length;
    const fast = dados.filter((e) => e.tipo === "Fast").length;
    const alerta = dados.filter((e) => e.alerta).length;
    return { total, concluidos, emAndamento, safety, fast, alerta };
  }, [dados]);

  const handleStatusCardClick = (status: "concluidos" | "andamento") => {
    setFiltroCardStatus((prev) => (prev === status ? "" : status));
  };

  const handleTipoCardClick = (tipo: "safety" | "fast") => {
    setFiltroCardTipo((prev) => (prev === tipo ? "" : tipo));
  };

  const handleAlertaCardClick = () => {
    setFiltroCardAlerta((prev) => (prev === "alerta" ? "" : "alerta"));
  };

  const dadosFiltrados = useMemo(() => {
    return dados
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
        const ordem = { vermelho: 0, amarelo: 1, verde: 2, none: 3 };
        const farolDiff = (ordem[a.farol] ?? 3) - (ordem[b.farol] ?? 3);
        if (farolDiff !== 0) return farolDiff; // ← primeiro ordena por farol
        return a.nomeEmpresa.localeCompare(b.nomeEmpresa, "pt-BR"); // ← depois alfabético
      });
  }, [dados, filtroCliente, filtroResponsavel, filtroCs, filtroProgresso, filtroCardStatus, filtroCardTipo, filtroCardAlerta]);

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

        {(filtroCliente ||
          filtroResponsavel ||
          filtroCs ||
          filtroProgresso ||
          filtroCardStatus ||
          filtroCardTipo ||
          filtroCardAlerta) && (
            <button
              onClick={() => {
                setFiltroCliente("");
                setFiltroResponsavel("");
                setFiltroCs("");
                setFiltroProgresso("");
                setFiltroCardStatus("");
                setFiltroCardTipo("");
                setFiltroCardAlerta("");
              }}
            >
              Limpar filtros
            </button>
          )}
      </div>

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

              <th>TME</th>

              <th className="td-progresso">Progresso</th>
            </tr>
          </thead>

          <tbody>
            {!loading &&
              dadosFiltrados.map((empresa) => (
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
                    {empresa.alerta && " 🔥"}
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
          </tbody>
        </table>

        <div className="table-footer">
          <span>
            Mostrando <strong>{dadosFiltrados.length}</strong> de <strong>{dados.length}</strong> {dados.length === 1 ? "cliente" : "clientes"}
          </span>
        </div>
      </div>

      {clienteSelecionado && (
        <div
          className="cliente-overlay"
          onClick={() => setClienteSelecionado(null)}
        >
          <div className="cliente-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cliente-modal-header">
              <span className="cliente-modal-icon">🏢</span>
              <h2>{clienteSelecionado.nomeEmpresa}</h2>
            </div>

            <div className="cliente-info-details">
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
        <div
          className="cliente-overlay"
          onClick={() => setModalClienteAberto(false)}
        >
          <div className="cliente-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cliente-modal-header">
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
              <label>Alerta</label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={clienteForm.alerta ?? false}
                  onChange={(e) =>
                    setClienteForm({ ...clienteForm, alerta: e.target.checked })
                  }
                />
                Cliente em alerta 🔥
              </label>
            </div>

            <button className="btn-primary" onClick={salvarCliente}>
              Salvar cliente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
