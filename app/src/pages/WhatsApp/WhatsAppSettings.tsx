import React, { useEffect, useMemo, useState } from "react";
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
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Image as ImageIcon
} from "lucide-react";
import {
  desconectarWhatsApp,
  enviarMensagemWhatsApp,
  obterTokenSocketWhatsApp,
  obterWhatsAppSocketUrl,
  type WhatsAppSessionState
} from "../../services/whatsapp";
import { listarEmpresas, salvarEmpresas } from "../../services/empresas";
import { normalizarTelefoneWhatsApp, normalizarContatoCliente } from "../../utils/telefone";
import { generateEsteiraImage } from "../../utils/generateEsteiraImage";
import type { Empresa } from "../../types";
import "./WhatsAppSettings.css";

export const WhatsAppSettings: React.FC = () => {
  const [session, setSession] = useState<WhatsAppSessionState>({
    status: "disconnected"
  });
  const [socket, setSocket] = useState<Socket | null>(null);
  const [socketConectado, setSocketConectado] = useState(true);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  
  // Test Message Form States
  const [selectedEmpresaId, setSelectedEmpresaId] = useState("");
  const [destinatario, setDestinatario] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [enviarImagem, setEnviarImagem] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [padronizando, setPadronizando] = useState(false);
  const [desconectarConfirmOpen, setDesconectarConfirmOpen] = useState(false);
  const [padronizarConfirmOpen, setPadronizarConfirmOpen] = useState(false);

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
    // Chamado a cada (re)conexão, então o token renovado pelo Firebase é sempre o atual.
    const newSocket = io(socketUrl, {
      auth: (callback) => {
        obterTokenSocketWhatsApp().then(
          (token) => callback({ token }),
          () => callback({}),
        );
      },
    });

    let avisoAcessoExibido = false;
    newSocket.on("connect_error", (erro) => {
      setSocketConectado(false);
      // Sem permissão não adianta tentar de novo; erro de rede continua com a reconexão automática.
      if (erro.message === "nao_autorizado") {
        newSocket.disconnect();
        if (!avisoAcessoExibido) {
          avisoAcessoExibido = true;
          toast.error("Seu acesso ao painel do WhatsApp foi recusado. Entre novamente no Radar ou peça acesso a um Master.");
        }
      }
    });

    newSocket.on("connect", () => {
      console.log("Conectado ao Socket.io do WhatsApp.");
      setSocketConectado(true);
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
      setSocketConectado(false);
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
    setDesconectarConfirmOpen(false);
    try {
      toast.info("Desconectando do WhatsApp...");
      await desconectarWhatsApp();
      toast.success("Desconectado com sucesso!");
    } catch (err: any) {
      toast.error(err.message || "Erro ao desconectar.");
    }
  };

  // Números inválidos permanecem como estão, para não descartar o dado
  // digitado — eles aparecem sinalizados no cadastro do cliente.
  function calcularPadraoTelefone(emp: Empresa) {
    const telPadrao = emp.telefone
      ? normalizarTelefoneWhatsApp(emp.telefone) || emp.telefone
      : emp.telefone;
    // A lista de contatos é a fonte usada no disparo da esteira, então
    // precisa ser padronizada junto com o telefone principal.
    const contatosPadrao = (emp.contatos || []).map(normalizarContatoCliente);
    const telefoneMudou = emp.telefone !== telPadrao;
    const contatosMudaram = contatosPadrao.some(
      (c, i) => JSON.stringify(c) !== JSON.stringify((emp.contatos || [])[i])
    );
    return { telPadrao, contatosPadrao, precisaAtualizar: telefoneMudou || contatosMudaram };
  }

  const clientesParaPadronizar = useMemo(
    () => empresas.filter((emp) => emp.id && calcularPadraoTelefone(emp).precisaAtualizar),
    [empresas],
  );

  const handlePadronizarTelefones = async () => {
    setPadronizarConfirmOpen(false);
    setPadronizando(true);
    toast.info("Iniciando a padronização dos números dos clientes no banco de dados...");
    try {
      const lista = await listarEmpresas();
      let alteradas = 0;

      for (const emp of lista) {
        if (!emp.id) continue;

        const { telPadrao, contatosPadrao, precisaAtualizar } = calcularPadraoTelefone(emp);

        if (precisaAtualizar) {
          await salvarEmpresas({
            ...emp,
            telefone: telPadrao,
            ...(emp.contatos ? { contatos: contatosPadrao } : {}),
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

            <button onClick={() => setDesconectarConfirmOpen(true)} className="btn-whatsapp-disconnect">
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
        <section className="whatsapp-card-section whatsapp-card-section--connection">
          <div className="card-header">
            <QrCode size={18} />
            <h2>Pareamento e Conexão</h2>
          </div>
          <div className="card-body">
            {!socketConectado && (
              <div className="whatsapp-socket-aviso">
                <AlertCircle size={16} />
                <span>
                  Sem conexão com o servidor do WhatsApp. O status abaixo pode estar
                  desatualizado — tentando reconectar automaticamente.
                </span>
              </div>
            )}
            {renderStatusSection()}
          </div>
        </section>

        <section className="whatsapp-card-section whatsapp-card-section--maintenance">
          <div className="card-header">
            <RefreshCw size={18} style={{ color: "var(--lt-texto-128c7e, #128c7e)" }} />
            <h2>Manutenção de Dados</h2>
          </div>
          <div className="card-body">
            <div className="maintenance-box">
              <p className="maintenance-desc">
                Analisa todos os clientes cadastrados no banco de dados e padroniza seus números de telefone (removendo parênteses, traços, espaços e adicionando o DDI "55" automaticamente).
              </p>
              <button
                type="button"
                onClick={() => setPadronizarConfirmOpen(true)}
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

        <section className="whatsapp-card-section whatsapp-card-section--test">
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
                disabled={enviando || !socketConectado || session.status !== "connected"}
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
      </div>

      {desconectarConfirmOpen && (
        <div className="confirm-overlay" onClick={() => setDesconectarConfirmOpen(false)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-modal-header">
              <AlertTriangle className="confirm-modal-icon warning" size={24} />
              <h2>Desconectar WhatsApp</h2>
            </div>
            <p className="confirm-modal-text">
              Deseja realmente desconectar o WhatsApp do Radar? As atualizações
              automáticas de esteiras param de ser enviadas até um novo
              pareamento (via QR Code).
            </p>
            <div className="confirm-modal-actions">
              <button className="btn-excluir-confirm" onClick={handleDesconectar}>
                Sim, desconectar
              </button>
              <button
                className="btn-cancelar-confirm"
                onClick={() => setDesconectarConfirmOpen(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {padronizarConfirmOpen && (
        <div className="confirm-overlay" onClick={() => setPadronizarConfirmOpen(false)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-modal-header">
              <AlertTriangle className="confirm-modal-icon warning" size={24} />
              <h2>Padronizar números de telefone</h2>
            </div>
            <p className="confirm-modal-text">
              {clientesParaPadronizar.length === 0
                ? "Todos os números de clientes já estão no padrão correto — nenhuma alteração será feita."
                : `Isso vai alterar o telefone e/ou os contatos de ${clientesParaPadronizar.length} cliente(s) cadastrado(s), adicionando o DDI "55" quando faltar e removendo caracteres especiais. Essa ação grava direto no banco de dados e não pode ser desfeita em lote.`}
            </p>
            <div className="confirm-modal-actions">
              <button
                className="btn-excluir-confirm"
                onClick={handlePadronizarTelefones}
                disabled={clientesParaPadronizar.length === 0}
              >
                Sim, padronizar
              </button>
              <button
                className="btn-cancelar-confirm"
                onClick={() => setPadronizarConfirmOpen(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
