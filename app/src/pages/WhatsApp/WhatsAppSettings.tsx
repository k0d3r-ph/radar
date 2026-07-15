import React, { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import { toast } from "sonner";
import {
  QrCode,
  MessageSquare,
  Settings,
  Power,
  Send,
  Smartphone,
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Image as ImageIcon,
  Clock
} from "lucide-react";
import {
  desconectarWhatsApp,
  enviarMensagemWhatsApp,
  obterWhatsAppSocketUrl,
  type WhatsAppSessionState
} from "../../services/whatsapp";
import { listarEmpresas, salvarEmpresas, formatarTelefoneWhatsApp } from "../../services/empresas";
import { generateEsteiraImage } from "../../utils/generateEsteiraImage";
import type { Empresa } from "../../types";
import { db } from "../../services/firebase";
import "./WhatsAppSettings.css";

export const WhatsAppSettings: React.FC = () => {
  const [session, setSession] = useState<WhatsAppSessionState>({
    status: "disconnected"
  });
  const [socket, setSocket] = useState<Socket | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  
  // Test Message Form States
  const [selectedEmpresaId, setSelectedEmpresaId] = useState("");
  const [destinatario, setDestinatario] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [enviarImagem, setEnviarImagem] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [padronizando, setPadronizando] = useState(false);

  // Working Hours States
  const [workingHoursActive, setWorkingHoursActive] = useState(false);
  const [outOfHoursMessage, setOutOfHoursMessage] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("18:00");
  const [workingDays, setWorkingDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [savingConfig, setSavingConfig] = useState(false);

  // Carrega configurações de expediente do Firestore
  useEffect(() => {
    async function carregarConfig() {
      try {
        const { doc, getDoc } = await import("firebase/firestore");
        const docRef = doc(db, "whatsapp_config", "whatsapp");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setWorkingHoursActive(!!data.workingHoursActive);
          setOutOfHoursMessage(data.outOfHoursMessage || "");
          setStartTime(data.startTime || "08:00");
          setEndTime(data.endTime || "18:00");
          if (Array.isArray(data.workingDays)) {
            setWorkingDays(data.workingDays);
          }
        }
      } catch (err) {
        console.error("Erro ao carregar configurações de expediente:", err);
      }
    }
    carregarConfig();
  }, []);

  const handleSaveWorkingHours = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      const { doc, setDoc } = await import("firebase/firestore");
      const docRef = doc(db, "whatsapp_config", "whatsapp");
      await setDoc(docRef, {
        workingHoursActive,
        outOfHoursMessage,
        startTime,
        endTime,
        workingDays,
        updatedAt: Date.now()
      }, { merge: true });
      toast.success("Configurações de expediente salvas com sucesso!");
    } catch (err: any) {
      console.error("Erro ao salvar expediente:", err);
      toast.error("Erro ao salvar configurações.");
    } finally {
      setSavingConfig(false);
    }
  };

  const handleDayToggle = (day: number) => {
    setWorkingDays(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  // Carrega empresas para a lista de teste
  useEffect(() => {
    async function carregar() {
      try {
        const lista = await listarEmpresas();
        // Ordena por nome da empresa
        lista.sort((a, b) => a.nomeEmpresa.localeCompare(b.nomeEmpresa, "pt-BR"));
        setEmpresas(lista);
      } catch (err) {
        console.error("Erro ao carregar empresas:", err);
      }
    }
    carregar();
  }, []);

  // Efeito para sincronizar a conexão do Socket.io
  useEffect(() => {
    const socketUrl = obterWhatsAppSocketUrl();
    console.log("Conectando ao Socket.io do WhatsApp em:", socketUrl);
    const newSocket = io(socketUrl);

    newSocket.on("connect", () => {
      console.log("Conectado ao Socket.io do WhatsApp.");
    });

    newSocket.on("whatsapp-status", (data: WhatsAppSessionState) => {
      console.log("Atualização de status do WhatsApp recebida:", data);
      setSession(data);
    });

    newSocket.on("whatsapp-error", (data: { message: string }) => {
      toast.error(data.message || "Erro no serviço de WhatsApp.");
    });

    newSocket.on("disconnect", () => {
      console.log("Desconectado do Socket.io do WhatsApp.");
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Preenche dados ao selecionar uma empresa para teste
  const handleEmpresaSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedEmpresaId(id);

    if (!id) {
      setDestinatario("");
      setMensagem("");
      return;
    }

    const emp = empresas.find((x) => x.id === id);
    if (emp) {
      setDestinatario(emp.telefone || "");
      const contatoNome = emp.contato || "Cliente";
      setMensagem(
        `Olá, *${contatoNome}* (${emp.nomeEmpresa})! 🚀\nEste é um teste do Radar CRM enviado pelo WhatsApp para validar nossa automação.`
      );
    }
  };

  const handleIniciarManual = () => {
    if (socket) {
      socket.emit("initialize-whatsapp");
      toast.info("Iniciando serviço do WhatsApp...");
    }
  };

  const handleDesconectar = async () => {
    if (window.confirm("Deseja realmente desconectar o WhatsApp do Radar?")) {
      try {
        toast.info("Desconectando do WhatsApp...");
        await desconectarWhatsApp();
        toast.success("Desconectado com sucesso!");
      } catch (err: any) {
        toast.error(err.message || "Erro ao desconectar.");
      }
    }
  };

  const handlePadronizarTelefones = async () => {
    if (window.confirm("Deseja realmente padronizar os números de WhatsApp de todos os clientes cadastrados? (Isso adicionará o DDI '55' caso não exista e removerá caracteres especiais)")) {
      setPadronizando(true);
      toast.info("Iniciando a padronização dos números dos clientes no banco de dados...");
      try {
        const lista = await listarEmpresas();
        let alteradas = 0;
        
        for (const emp of lista) {
          if (!emp.id || !emp.telefone) continue;
          
          const telPadrao = formatarTelefoneWhatsApp(emp.telefone);
          if (emp.telefone !== telPadrao) {
            await salvarEmpresas({
              ...emp,
              telefone: telPadrao
            });
            alteradas++;
          }
        }
        
        const listaAtualizada = await listarEmpresas();
        listaAtualizada.sort((a, b) => a.nomeEmpresa.localeCompare(b.nomeEmpresa, "pt-BR"));
        setEmpresas(listaAtualizada);
        
        if (alteradas > 0) {
          toast.success(`Padronização concluída! ${alteradas} número(s) de cliente(s) foram corrigidos.`);
        } else {
          toast.success("Todos os números de clientes já estão no padrão correto!");
        }
      } catch (err: any) {
        console.error("Erro ao padronizar telefones:", err);
        toast.error("Erro durante o processo de padronização.");
      } finally {
        setPadronizando(false);
      }
    }
  };

  const handleEnviarMensagemTeste = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!destinatario.trim()) {
      toast.error("Preencha o número de destino.");
      return;
    }
    if (!mensagem.trim()) {
      toast.error("Digite o texto da mensagem.");
      return;
    }

    setEnviando(true);
    let imageBase64: string | undefined = undefined;

    try {
      if (enviarImagem && selectedEmpresaId) {
        const emp = empresas.find((x) => x.id === selectedEmpresaId);
        if (emp) {
          toast.info("Renderizando imagem da esteira em background...");
          imageBase64 = await generateEsteiraImage(emp);
        }
      }

      toast.info("Disparando mensagem...");
      await enviarMensagemWhatsApp({
        to: destinatario,
        message: mensagem,
        imageBase64,
        filename: `esteira_${selectedEmpresaId || "teste"}.png`
      });

      toast.success("Mensagem de teste enviada com sucesso!");
      setMensagem("");
      setSelectedEmpresaId("");
      setDestinatario("");
      setEnviarImagem(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar mensagem.");
    } finally {
      setEnviando(false);
    }
  };

  // Renderização da área de conexão (QR Code ou Conectado)
  const renderStatusSection = () => {
    switch (session.status) {
      case "connected":
        return (
          <div className="whatsapp-connected-card animate-fade-in">
            <div className="success-icon-wrapper">
              <CheckCircle2 size={64} className="success-icon" />
            </div>
            <h3>WhatsApp Conectado!</h3>
            <p className="card-subtitle">
              Sua conta está pareada e pronta para disparar as mensagens automáticas das esteiras.
            </p>

            <div className="connection-info">
              <div className="info-item">
                <span className="label">Nome da Conta</span>
                <span className="value">{session.userInfo?.name || "N/A"}</span>
              </div>
              <div className="info-item">
                <span className="label">Número</span>
                <span className="value">+{session.userInfo?.number || "N/A"}</span>
              </div>
              <div className="info-item">
                <span className="label">Status</span>
                <span className="value status-pill connected">Ativo</span>
              </div>
            </div>

            <button onClick={handleDesconectar} className="btn-whatsapp-disconnect">
              <Power size={16} />
              <span>Desconectar Conta</span>
            </button>
          </div>
        );

      case "qrcode":
        return (
          <div className="whatsapp-qrcode-card animate-fade-in">
            <h3>Conectar WhatsApp Web</h3>
            <p className="card-subtitle">
              Aponte a câmera do seu celular para o QR Code abaixo para autenticar o Radar CRM.
            </p>

            <div className="qrcode-wrapper">
              {session.qrCode ? (
                <div className="qrcode-container">
                  <img src={session.qrCode} alt="WhatsApp QR Code" className="qrcode-img" />
                  <div className="qrcode-scanner-line"></div>
                </div>
              ) : (
                <div className="qrcode-loader">
                  <Loader2 className="spinner" size={40} />
                  <p>Gerando QR Code...</p>
                </div>
              )}
            </div>

            <div className="instructions">
              <ol>
                <li>Abra o WhatsApp no seu celular</li>
                <li>Toque em <strong>Mais opções</strong> (Android) ou <strong>Configurações</strong> (iOS)</li>
                <li>Selecione <strong>Aparelhos conectados</strong> e depois <strong>Conectar um aparelho</strong></li>
                <li>Aponte a câmera para esta tela para capturar o código</li>
              </ol>
            </div>
            
            <button onClick={handleIniciarManual} className="btn-whatsapp-refresh">
              <RefreshCw size={14} />
              <span>Recarregar QR Code</span>
            </button>
          </div>
        );

      case "authenticating":
        return (
          <div className="whatsapp-loading-card">
            <Loader2 className="spinner loading-icon" size={64} />
            <h3>Carregando Sessão...</h3>
            <p className="card-subtitle">
              O servidor está processando as chaves de segurança e autenticando com os servidores do WhatsApp.
            </p>
          </div>
        );

      case "disconnected":
      default:
        return (
          <div className="whatsapp-disconnected-card animate-fade-in">
            <div className="warning-icon-wrapper">
              <AlertCircle size={64} className="warning-icon" />
            </div>
            <h3>WhatsApp Desconectado</h3>
            <p className="card-subtitle">
              O módulo de WhatsApp está inativo. As atualizações automáticas de esteiras não serão enviadas até que o serviço seja conectado.
            </p>
            <button onClick={handleIniciarManual} className="btn-whatsapp-connect">
              <Smartphone size={18} />
              <span>Iniciar Conexão (WhatsApp Web)</span>
            </button>
          </div>
        );
    }
  };

  return (
    <div className="whatsapp-settings-container">
      <header className="whatsapp-header">
        <div className="header-icon-wrapper">
          <Settings size={28} className="header-icon" />
        </div>
        <div className="header-text">
          <h1>Automação WhatsApp</h1>
          <p>Gerencie o pareamento de WhatsApp Web do Radar CRM e teste os envios das esteiras.</p>
        </div>
      </header>

      <div className="whatsapp-grid">
        <section className="whatsapp-card-section">
          <div className="card-header">
            <QrCode size={18} />
            <h2>Pareamento e Conexão</h2>
          </div>
          <div className="card-body">
            {renderStatusSection()}
          </div>
        </section>

        <section className="whatsapp-card-section" style={{ marginTop: "24px" }}>
          <div className="card-header">
            <RefreshCw size={18} style={{ color: "#128c7e" }} />
            <h2>Manutenção de Dados</h2>
          </div>
          <div className="card-body">
            <div className="maintenance-box">
              <p className="maintenance-desc">
                Analisa todos os clientes cadastrados no banco de dados e padroniza seus números de telefone (removendo parênteses, traços, espaços e adicionando o DDI "55" automaticamente).
              </p>
              <button
                type="button"
                onClick={handlePadronizarTelefones}
                disabled={padronizando}
                className="btn-whatsapp-maintenance"
                style={{ marginTop: "12px" }}
              >
                {padronizando ? (
                  <>
                    <Loader2 size={16} className="spinner" />
                    <span>Padronizando Telefones...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw size={16} />
                    <span>Padronizar Números dos Clientes</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </section>

        <section className="whatsapp-card-section">
          <div className="card-header">
            <MessageSquare size={18} />
            <h2>Enviar Mensagem de Teste</h2>
          </div>
          <div className="card-body">
            <form onSubmit={handleEnviarMensagemTeste} className="test-message-form">
              <div className="form-group">
                <label htmlFor="select-empresa">Selecionar Cliente (Preenche dados do CRM)</label>
                <select
                  id="select-empresa"
                  value={selectedEmpresaId}
                  onChange={handleEmpresaSelect}
                  className="whatsapp-select"
                >
                  <option value="">-- Escolha um cliente para auto-preencher --</option>
                  {empresas.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.nomeEmpresa} {emp.contato ? `(${emp.contato})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="input-destinatario">Telefone do Destinatário (WhatsApp)</label>
                <input
                  id="input-destinatario"
                  type="text"
                  placeholder="Ex: 5511999999999"
                  value={destinatario}
                  onChange={(e) => setDestinatario(e.target.value)}
                  className="whatsapp-input"
                  required
                />
                <span className="input-helper">Use formato com DDI (Ex: 55 para Brasil) + DDD + Número. Apenas dígitos.</span>
              </div>

              <div className="form-group">
                <label htmlFor="textarea-mensagem">Mensagem</label>
                <textarea
                  id="textarea-mensagem"
                  rows={6}
                  placeholder="Digite a mensagem..."
                  value={mensagem}
                  onChange={(e) => setMensagem(e.target.value)}
                  className="whatsapp-textarea"
                  required
                />
              </div>

              {selectedEmpresaId && (
                <div className="form-group-checkbox">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={enviarImagem}
                      onChange={(e) => setEnviarImagem(e.target.checked)}
                      className="whatsapp-checkbox"
                    />
                    <span className="checkbox-custom"></span>
                    <span className="checkbox-text">
                      <ImageIcon size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                      Enviar com a imagem atualizada da esteira deste cliente
                    </span>
                  </label>
                </div>
              )}

              <button
                type="submit"
                disabled={enviando || session.status !== "connected"}
                className="btn-whatsapp-send"
              >
                {enviando ? (
                  <>
                    <Loader2 size={16} className="spinner" />
                    <span>Disparando...</span>
                  </>
                ) : (
                  <>
                    <Send size={16} />
                    <span>Disparar Mensagem de Teste</span>
                  </>
                )}
              </button>

              {session.status !== "connected" && (
                <div className="form-warning">
                  <AlertCircle size={14} />
                  <span>Você precisa parear o WhatsApp antes de poder enviar mensagens de teste.</span>
                </div>
              )}
            </form>
          </div>
        </section>

        <section className="whatsapp-card-section" style={{ marginTop: "24px" }}>
          <div className="card-header">
            <Clock size={18} />
            <h2>Configurações de Expediente</h2>
          </div>
          <div className="card-body">
            <form onSubmit={handleSaveWorkingHours} className="test-message-form">
              <div className="form-group-checkbox">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={workingHoursActive}
                    onChange={(e) => setWorkingHoursActive(e.target.checked)}
                    className="whatsapp-checkbox"
                  />
                  <span className="checkbox-custom"></span>
                  <span className="checkbox-text">Ativar resposta automática fora do expediente</span>
                </label>
              </div>

              {workingHoursActive && (
                <div className="animate-fade-in" style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                    <div className="form-group">
                      <label>Início do Expediente</label>
                      <input
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="whatsapp-input"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Fim do Expediente</label>
                      <input
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="whatsapp-input"
                        required
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Dias de Expediente</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "8px" }}>
                      {[
                        { label: "Dom", value: 0 },
                        { label: "Seg", value: 1 },
                        { label: "Ter", value: 2 },
                        { label: "Qua", value: 3 },
                        { label: "Qui", value: 4 },
                        { label: "Sex", value: 5 },
                        { label: "Sáb", value: 6 }
                      ].map((day) => {
                        const active = workingDays.includes(day.value);
                        return (
                          <button
                            key={day.value}
                            type="button"
                            onClick={() => handleDayToggle(day.value)}
                            className={`day-toggle-btn ${active ? "active" : ""}`}
                            style={{
                              padding: "6px 12px",
                              borderRadius: "20px",
                              border: active ? "1px solid #128c7e" : "1px solid rgba(255, 255, 255, 0.1)",
                              background: active ? "rgba(18, 140, 126, 0.15)" : "transparent",
                              color: active ? "#128c7e" : "rgba(255, 255, 255, 0.6)",
                              fontSize: "0.82rem",
                              fontWeight: "600",
                              cursor: "pointer",
                              transition: "all 0.2s"
                            }}
                          >
                            {day.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="form-group">
                    <label htmlFor="textarea-mensagem-expediente">Mensagem Automática (Fora do Horário)</label>
                    <textarea
                      id="textarea-mensagem-expediente"
                      rows={4}
                      placeholder="Digite a mensagem que o cliente receberá se escrever fora do horário de atendimento..."
                      value={outOfHoursMessage}
                      onChange={(e) => setOutOfHoursMessage(e.target.value)}
                      className="whatsapp-textarea"
                      required
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={savingConfig}
                className="btn-whatsapp-send"
                style={{ marginTop: "16px" }}
              >
                {savingConfig ? (
                  <>
                    <Loader2 size={16} className="spinner" />
                    <span>Salvando...</span>
                  </>
                ) : (
                  <span>Salvar Configurações</span>
                )}
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
};
