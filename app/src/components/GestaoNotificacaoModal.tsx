import { useState } from "react";
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

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2100,
      }}
    >
      <div
        style={{
          maxWidth: "550px",
          width: "90%",
          background: "var(--card-bg, #1a1f2e)",
          borderRadius: "14px",
          padding: "24px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
        }}
      >
        <h3 style={{ margin: "0 0 16px", fontSize: "1.2rem", color: "var(--text-color, #ffffff)", fontWeight: 700 }}>
          {titulo}
        </h3>

        <div style={{ marginBottom: "16px" }}>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "6px", color: "var(--text-color, #ffffff)" }}>
            Destinatários
          </label>
          <div style={{ fontSize: "0.85rem", color: "var(--text-muted, #94a3b8)" }}>
            {destinatarios.length > 0 ? destinatarios.map((d) => d.nome).join(", ") : "Nenhum destinatário encontrado."}
          </div>
        </div>

        {avisos.length > 0 && (
          <div
            style={{
              marginBottom: "16px",
              padding: "10px 14px",
              borderRadius: "8px",
              border: "1px solid rgba(251, 191, 36, 0.3)",
              background: "rgba(251, 191, 36, 0.08)",
              color: "#fbbf24",
              fontSize: "0.8rem",
              lineHeight: 1.5,
            }}
          >
            {avisos.map((aviso) => (
              <div key={aviso}>⚠️ {aviso}</div>
            ))}
          </div>
        )}

        <div style={{ marginBottom: "8px" }}>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "6px", color: "var(--text-color, #ffffff)" }}>
            Texto da mensagem (você pode personalizar antes de enviar)
          </label>
          <textarea
            rows={6}
            value={mensagem}
            onChange={(e) => onChangeMensagem(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "rgba(255, 255, 255, 0.03)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "8px",
              color: "var(--text-color, #ffffff)",
              padding: "10px 14px",
              fontFamily: "inherit",
            }}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" }}>
          <button
            type="button"
            className="btn-secondary"
            disabled={enviando}
            onClick={async () => {
              if (onResultado) {
                try {
                  await onResultado({ status: "nao_enviado", enviadoEm: Date.now(), destinatarios: [] });
                } catch (error) {
                  console.error("Erro ao registrar não-envio da notificação de gestão:", error);
                }
              }
              onClose();
            }}
          >
            Não enviar
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={enviando || destinatarios.length === 0}
            onClick={async () => {
              setEnviando(true);
              try {
                toast.info("Disparando notificação para o WhatsApp...");
                const resultados = await Promise.allSettled(
                  destinatarios.map((d) => enviarMensagemWhatsApp({ to: d.telefone, message: mensagem }))
                );

                const whatsappDestinatarios: WhatsappDestinatarioEnvio[] = destinatarios.map((d, idx) => {
                  const r = resultados[idx];
                  return r.status === "fulfilled"
                    ? { nome: d.nome, telefone: d.telefone, status: "enviado" as const }
                    : {
                        nome: d.nome,
                        telefone: d.telefone,
                        status: "falhou" as const,
                        erro: String(r.reason?.message || r.reason || "Erro desconhecido"),
                      };
                });

                const falhas = resultados.filter((r) => r.status === "rejected").length;
                const status: WhatsappStatus =
                  falhas === 0 ? "enviado" : falhas < resultados.length ? "parcial" : "falhou";

                if (onResultado) {
                  try {
                    await onResultado({ status, enviadoEm: Date.now(), destinatarios: whatsappDestinatarios });
                  } catch (error) {
                    console.error("Erro ao registrar status de envio da notificação de gestão:", error);
                  }
                }

                if (falhas === 0) {
                  toast.success("Notificação enviada com sucesso!");
                } else if (falhas < resultados.length) {
                  toast.warning("Notificação enviada parcialmente — alguns destinatários falharam.");
                } else {
                  toast.error("Falha ao enviar a notificação para todos os destinatários.");
                }
              } catch (err: any) {
                console.error("Erro ao enviar notificação de gestão pelo WhatsApp:", err);
                toast.error(`Erro ao enviar WhatsApp: ${err.message || err}`);
              } finally {
                setEnviando(false);
                onClose();
              }
            }}
          >
            {enviando ? "Enviando..." : "Sim, enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}
