import { useState, useEffect } from "react";
import { toast } from "sonner";
import { enviarMensagemWhatsApp } from "../services/whatsapp";
import type { DestinatarioGestao } from "../services/notificacoes";
import type { WhatsappDestinatarioEnvio, WhatsappStatus } from "../types";

interface GestaoNotificacaoModalProps {
  open: boolean;
  titulo: string;
  destinatarios: DestinatarioGestao[];
  /** Quem ficou de fora da lista e por quê (ex.: CS Responsável sem usuário correspondente). */
  avisos?: string[];
  mensagem: string;
  onChangeMensagem: (texto: string) => void;
  onClose: () => void;
  /**
   * Chamado ao final do fluxo (envio bem-sucedido, parcial, falho, ou quando o usuário
   * opta por não enviar), para que o chamador persista a marcação de "enviado"/"não
   * enviado" no registro correspondente (ocorrência de alerta, cliente suspenso etc.).
   */
  onResultado?: (resultado: {
    status: WhatsappStatus;
    enviadoEm: number;
    destinatarios: WhatsappDestinatarioEnvio[];
  }) => void | Promise<void>;
}

interface ResultadoDestinatario {
  nome: string;
  telefone: string;
  status: "enviado" | "falhou" | "pendente";
  erro?: string;
}

function traduzirErro(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "Erro desconhecido");

  if (msg.includes("AbortError") || msg.includes("Tempo limite"))
    return "Tempo limite atingido — o servidor WhatsApp não respondeu. Verifique se a VM está online.";
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("fetch"))
    return "Sem conexão com o servidor WhatsApp. Verifique sua rede ou se o serviço está rodando.";
  if (msg.includes("401") || msg.includes("403"))
    return "Acesso negado ao servidor WhatsApp (erro de autenticação).";
  if (msg.includes("404"))
    return "Endpoint não encontrado no servidor WhatsApp. Verifique a configuração da URL.";
  if (msg.includes("500") || msg.includes("502") || msg.includes("503"))
    return "O servidor WhatsApp retornou um erro interno. Tente novamente em instantes.";
  if (msg.includes("disconnected") || msg.includes("desconectado"))
    return "WhatsApp desconectado. Reconecte o dispositivo e tente novamente.";
  return msg;
}

export function GestaoNotificacaoModal({
  open,
  titulo,
  destinatarios,
  avisos = [],
  mensagem,
  onChangeMensagem,
  onClose,
  onResultado,
}: GestaoNotificacaoModalProps) {
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoDestinatario[] | null>(null);

  // Limpa o estado de resultados sempre que o modal é fechado,
  // para que na próxima abertura comece sem rastro de envios anteriores.
  useEffect(() => {
    if (!open) {
      setResultados(null);
      setEnviando(false);
    }
  }, [open]);

  if (!open) return null;

  const falhasAtuais = resultados?.filter((r) => r.status === "falhou") ?? [];
  const jaEnviou = resultados !== null;
  const todasFalhas = jaEnviou && resultados!.every((r) => r.status === "falhou");
  const algumaSucesso = resultados?.some((r) => r.status === "enviado") ?? false;

  async function enviar(alvos: DestinatarioGestao[]) {
    setEnviando(true);

    // Inicializa o estado de cada alvo como "pendente"
    setResultados((prev) => {
      const base: ResultadoDestinatario[] = destinatarios.map((d) => {
        const jaTem = prev?.find((r) => r.telefone === d.telefone);
        if (jaTem) return jaTem; // mantém resultado anterior (ex: enviado com sucesso)
        return { nome: d.nome, telefone: d.telefone, status: "pendente" };
      });
      // Marca os alvos desta rodada como "pendente" novamente
      return base.map((r) =>
        alvos.some((a) => a.telefone === r.telefone)
          ? { ...r, status: "pendente", erro: undefined }
          : r
      );
    });

    const promessas = alvos.map((d) =>
      enviarMensagemWhatsApp({ to: d.telefone, message: mensagem })
        .then(() => ({ telefone: d.telefone, ok: true, erro: undefined }))
        .catch((err: unknown) => ({ telefone: d.telefone, ok: false, erro: traduzirErro(err) }))
    );

    const respostas = await Promise.all(promessas);

    const novosResultados = destinatarios.map((d) => {
      const resp = respostas.find((r) => r.telefone === d.telefone);
      if (!resp) {
        // Não era alvo nesta rodada — mantém estado anterior
        const anterior = resultados?.find((r) => r.telefone === d.telefone);
        return anterior ?? { nome: d.nome, telefone: d.telefone, status: "pendente" as const };
      }
      return {
        nome: d.nome,
        telefone: d.telefone,
        status: resp.ok ? ("enviado" as const) : ("falhou" as const),
        erro: resp.erro,
      };
    });

    setResultados(novosResultados);

    const falhas = novosResultados.filter((r) => r.status === "falhou").length;
    const total = novosResultados.length;
    const statusGeral: WhatsappStatus =
      falhas === 0 ? "enviado" : falhas < total ? "parcial" : "falhou";

    if (onResultado) {
      try {
        await onResultado({
          status: statusGeral,
          enviadoEm: Date.now(),
          destinatarios: novosResultados.map((r) => ({
            nome: r.nome,
            telefone: r.telefone,
            status: r.status === "enviado" ? "enviado" : "falhou",
            ...(r.erro ? { erro: r.erro } : {}),
          })),
        });
      } catch (error) {
        console.error("Erro ao registrar status de envio da notificação de gestão:", error);
        toast.error("Mensagem enviada, mas houve falha ao registrar o status. Recarregue e tente novamente.");
        setEnviando(false);
        return;
      }
    }

    if (falhas === 0) {
      toast.success("Notificação enviada com sucesso!");
    } else if (falhas < total) {
      toast.warning("Notificação enviada parcialmente — alguns destinatários falharam.");
    } else {
      toast.error("Falha ao enviar a notificação para todos os destinatários.");
    }

    setEnviando(false);
  }

  const handleEnviar = () => enviar(destinatarios);
  const handleTentarNovamente = () => enviar(
    destinatarios.filter((d) => falhasAtuais.some((f) => f.telefone === d.telefone))
  );

  const statusIcon = (status: ResultadoDestinatario["status"]) => {
    if (status === "enviado") return "✅";
    if (status === "falhou") return "❌";
    return "⏳";
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--lt-fundo-00000099, rgba(0, 0, 0, 0.6))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2100,
      }}
    >
      <div
        style={{
          maxWidth: "560px",
          width: "90%",
          background: "var(--card-bg, var(--lt-fundo-1a1f2e, #1a1f2e))",
          borderRadius: "14px",
          padding: "24px",
          boxShadow: "0 20px 60px var(--lt-sombra-00000066, rgba(0,0,0,0.4))",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <h3 style={{ margin: "0 0 16px", fontSize: "1.2rem", color: "var(--text-color, var(--lt-texto-ffffff, #ffffff))", fontWeight: 700 }}>
          {titulo}
        </h3>

        {/* Avisos de destinatários ausentes */}
        {avisos.length > 0 && (
          <div
            style={{
              marginBottom: "16px",
              padding: "10px 14px",
              borderRadius: "8px",
              border: "1px solid rgba(251, 191, 36, 0.3)",
              background: "rgba(251, 191, 36, 0.08)",
              color: "var(--lt-texto-fbbf24, #fbbf24)",
              fontSize: "0.8rem",
              lineHeight: 1.5,
            }}
          >
            {avisos.map((aviso) => (
              <div key={aviso}>⚠️ {aviso}</div>
            ))}
          </div>
        )}

        {/* Destinatários com status de envio */}
        <div style={{ marginBottom: "16px" }}>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "8px", color: "var(--text-color, var(--lt-texto-ffffff, #ffffff))" }}>
            Destinatários
          </label>
          {destinatarios.length === 0 ? (
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted, var(--lt-texto-94a3b8, #94a3b8))" }}>
              Nenhum destinatário encontrado.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {destinatarios.map((d) => {
                const res = resultados?.find((r) => r.telefone === d.telefone);
                return (
                  <div
                    key={d.telefone}
                    style={{
                      borderRadius: "8px",
                      padding: "8px 12px",
                      background: "var(--lt-fundo-ffffff0a, rgba(255,255,255,0.04))",
                      border: res?.status === "falhou"
                        ? "1px solid rgba(239,68,68,0.35)"
                        : res?.status === "enviado"
                        ? "1px solid rgba(34,197,94,0.25)"
                        : "1px solid var(--lt-borda-ffffff12, rgba(255,255,255,0.07))",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                      <span style={{ fontSize: "0.87rem", color: "var(--text-color, var(--lt-texto-ffffff, #fff))", fontWeight: 500 }}>
                        {d.nome}
                      </span>
                      {res && (
                        <span style={{ fontSize: "0.8rem", flexShrink: 0 }}>
                          {statusIcon(res.status)}{" "}
                          <span style={{
                            color: res.status === "enviado" ? "var(--lt-texto-22c55e, #22c55e)" : res.status === "falhou" ? "var(--lt-texto-ef4444, #ef4444)" : "var(--lt-texto-94a3b8, #94a3b8)",
                            fontWeight: 600,
                          }}>
                            {res.status === "enviado" ? "Enviado" : res.status === "falhou" ? "Falhou" : "Enviando..."}
                          </span>
                        </span>
                      )}
                    </div>
                    {res?.status === "falhou" && res.erro && (
                      <div
                        style={{
                          marginTop: "6px",
                          fontSize: "0.78rem",
                          color: "var(--lt-texto-fca5a5, #fca5a5)",
                          lineHeight: 1.45,
                          padding: "6px 8px",
                          background: "rgba(239,68,68,0.1)",
                          borderRadius: "6px",
                        }}
                      >
                        {res.erro}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Texto da mensagem (oculto após envio bem-sucedido de todos) */}
        {!algumaSucesso || falhasAtuais.length > 0 ? (
          <div style={{ marginBottom: "8px" }}>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "6px", color: "var(--text-color, var(--lt-texto-ffffff, #ffffff))" }}>
              Texto da mensagem {!jaEnviou && "(você pode personalizar antes de enviar)"}
            </label>
            <textarea
              rows={6}
              value={mensagem}
              onChange={(e) => onChangeMensagem(e.target.value)}
              disabled={enviando}
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "var(--lt-fundo-ffffff08, rgba(255, 255, 255, 0.03))",
                border: "1px solid var(--lt-borda-ffffff14, rgba(255, 255, 255, 0.08))",
                borderRadius: "8px",
                color: "var(--text-color, var(--lt-texto-ffffff, #ffffff))",
                padding: "10px 14px",
                fontFamily: "inherit",
                resize: "vertical",
              }}
            />
          </div>
        ) : null}

        {/* Botões de ação */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px", flexWrap: "wrap" }}>
          {/* "Não enviar" — antes do primeiro envio */}
          {!jaEnviou && (
            <button
              type="button"
              className="btn-secondary"
              disabled={enviando}
              onClick={async () => {
                if (onResultado) {
                  try {
                    await onResultado({ status: destinatarios.length === 0 ? "sem_destinatario" : "nao_enviado", enviadoEm: Date.now(), destinatarios: [] });
                  } catch (error) {
                    console.error("Erro ao registrar não-envio da notificação de gestão:", error);
                  }
                }
                onClose();
              }}
            >
              {destinatarios.length === 0 ? "Fechar" : "Não enviar"}
            </button>
          )}

          {/* "Fechar" — após tentativa, quando não há mais falhas ou o usuário quer sair */}
          {jaEnviou && (
            <button
              type="button"
              className="btn-secondary"
              disabled={enviando}
              onClick={onClose}
            >
              {todasFalhas ? "Cancelar" : "Fechar"}
            </button>
          )}

          {/* "Tentar novamente" — apenas para os que falharam */}
          {jaEnviou && falhasAtuais.length > 0 && (
            <button
              type="button"
              className="btn-primary"
              disabled={enviando}
              onClick={handleTentarNovamente}
              style={{ background: "var(--warning-color, #f59e0b)", borderColor: "transparent" }}
            >
              {enviando
                ? "Enviando..."
                : `Tentar novamente (${falhasAtuais.length})`}
            </button>
          )}

          {/* "Sim, enviar" — antes do primeiro envio */}
          {!jaEnviou && (
            <button
              type="button"
              className="btn-primary"
              disabled={enviando || destinatarios.length === 0}
              onClick={handleEnviar}
            >
              {enviando ? "Enviando..." : "Sim, enviar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
