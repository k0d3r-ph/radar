import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { toast } from "sonner";
import { enviarMensagemWhatsApp } from "../services/whatsapp";
import {
  PLACEHOLDER_NOME,
  aplicarNomeDestinatario,
} from "../services/notificacoes";
import { generateEsteiraImage } from "../utils/generateEsteiraImage";
import { obterDestinatariosCliente, formatarTelefoneExibicao } from "../utils/telefone";
import { montarMensagemProgressoValidacao } from "../utils/notificacaoValidacao";
import type { Empresa, WhatsappDestinatarioEnvio, WhatsappStatus } from "../types";

type Destinatario = { nome: string; telefone: string };
type ResultadoDestinatario = Destinatario & {
  status: "enviado" | "falhou";
  erro?: string;
};

interface NotificacaoProgressoEsteiraModalProps {
  open: boolean;
  empresa: Empresa;
  ocorridoEm: number;
  onClose: () => void;
  onResultado: (resultado: {
    status: WhatsappStatus;
    enviadoEm: number;
    destinatarios: WhatsappDestinatarioEnvio[];
  }) => Promise<void>;
}

function dataBrasilia(timestamp: number): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date(timestamp));
}

function traduzirErro(error: unknown): string {
  return error instanceof Error ? error.message : "Falha desconhecida no envio.";
}

export function NotificacaoProgressoEsteiraModal({
  open,
  empresa,
  ocorridoEm,
  onClose,
  onResultado,
}: NotificacaoProgressoEsteiraModalProps) {
  const destinatarios = obterDestinatariosCliente(empresa);
  const [selecionados, setSelecionados] = useState<string[]>(() =>
    destinatarios.map((destinatario) => destinatario.telefone),
  );
  const [mensagem, setMensagem] = useState(() =>
    montarMensagemProgressoValidacao(dataBrasilia(ocorridoEm)),
  );
  const [incluirImagem, setIncluirImagem] = useState(true);
  const [resultados, setResultados] = useState<ResultadoDestinatario[] | null>(null);
  const [enviando, setEnviando] = useState(false);
  const fecharRef = useRef<HTMLButtonElement>(null);
  const focoAnteriorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    focoAnteriorRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    requestAnimationFrame(() => fecharRef.current?.focus());
    return () => {
      requestAnimationFrame(() => focoAnteriorRef.current?.focus());
    };
  }, [open]);

  if (!open) return null;

  const falhas = resultados?.filter((resultado) => resultado.status === "falhou") ?? [];
  const totalEnviados = resultados?.filter((resultado) => resultado.status === "enviado").length ?? 0;
  const destinatariosSelecionados = destinatarios.filter((destinatario) =>
    selecionados.includes(destinatario.telefone),
  );

  async function fecharSemEnviar() {
    try {
      await onResultado({
        status: destinatarios.length === 0 ? "sem_destinatario" : "nao_enviado",
        enviadoEm: Date.now(),
        destinatarios: [],
      });
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível registrar a decisão.");
    }
  }

  async function enviar() {
    const alvos = resultados
      ? destinatarios.filter((destinatario) =>
          falhas.some((falha) => falha.telefone === destinatario.telefone),
        )
      : destinatariosSelecionados;
    if (alvos.length === 0) return;

    setEnviando(true);
    let imageBase64: string | undefined;
    try {
      if (incluirImagem) imageBase64 = await generateEsteiraImage(empresa);
    } catch (error) {
      toast.error(`Não foi possível gerar a imagem da esteira: ${traduzirErro(error)}`);
      setEnviando(false);
      return;
    }

    const respostas = await Promise.all(
      alvos.map(async (destinatario) => {
        try {
          await enviarMensagemWhatsApp({
            to: destinatario.telefone,
            message: aplicarNomeDestinatario(mensagem, destinatario.nome),
            ...(imageBase64
              ? { imageBase64, filename: `esteira_${empresa.nomeEmpresa}.png` }
              : {}),
          });
          return { destinatario, status: "enviado" as const };
        } catch (error) {
          return {
            destinatario,
            status: "falhou" as const,
            erro: traduzirErro(error),
          };
        }
      }),
    );

    const base = destinatariosSelecionados.map((destinatario) => {
      const resposta = respostas.find(
        (item) => item.destinatario.telefone === destinatario.telefone,
      );
      const anterior = resultados?.find(
        (item) => item.telefone === destinatario.telefone,
      );
      if (!resposta) return anterior ?? { ...destinatario, status: "falhou" as const };
      return {
        ...destinatario,
        status: resposta.status,
        ...(resposta.erro ? { erro: resposta.erro } : {}),
      };
    });
    const quantidadeFalhas = base.filter((resultado) => resultado.status === "falhou").length;
    const status: WhatsappStatus =
      quantidadeFalhas === 0
        ? "enviado"
        : quantidadeFalhas < base.length
          ? "parcial"
          : "falhou";
    setResultados(base);

    try {
      await onResultado({
        status,
        enviadoEm: Date.now(),
        destinatarios: base.map(({ nome, telefone, status: statusDestinatario, erro }) => ({
          nome,
          telefone,
          status: statusDestinatario,
          ...(erro ? { erro } : {}),
        })),
      });
      if (quantidadeFalhas === 0) toast.success("Progresso enviado ao cliente.");
      else if (quantidadeFalhas < base.length) toast.warning("Progresso enviado parcialmente.");
      else toast.error("Não foi possível enviar o progresso aos destinatários selecionados.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? `Mensagem enviada, mas não foi possível registrar o status: ${error.message}`
          : "Mensagem enviada, mas não foi possível registrar o status.",
      );
    } finally {
      setEnviando(false);
    }
  }

  function tratarTecla(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !enviando) {
      event.preventDefault();
      if (resultados) onClose();
      else void fecharSemEnviar();
      return;
    }
    if (event.key !== "Tab") return;
    const modal = event.currentTarget;
    const elementos = Array.from(
      modal.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled)',
      ),
    );
    if (elementos.length === 0) {
      event.preventDefault();
      return;
    }
    const primeiro = elementos[0];
    const ultimo = elementos[elementos.length - 1];
    if (event.shiftKey && document.activeElement === primeiro) {
      event.preventDefault();
      ultimo.focus();
    } else if (!event.shiftKey && document.activeElement === ultimo) {
      event.preventDefault();
      primeiro.focus();
    }
  }

  return (
    <div
      className="score-modal-overlay animate-fade-in"
      style={{ zIndex: 2100 }}
      onKeyDown={tratarTecla}
    >
      <section
        className="score-modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notificacao-progresso-titulo"
        style={{ maxWidth: "550px", width: "90%", maxHeight: "90vh", overflowY: "auto" }}
      >
        <h2 id="notificacao-progresso-titulo">Enviar progresso pelo WhatsApp?</h2>
        <p>
          A validação foi aprovada. Confirme o envio da esteira atualizada para os contatos
          selecionados.
        </p>
        <fieldset disabled={enviando || resultados !== null}>
          <legend>Destinatários</legend>
          {destinatarios.length === 0 ? (
            <p>Nenhum telefone válido está cadastrado para este cliente.</p>
          ) : (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={destinatarios.length > 0 && selecionados.length === destinatarios.length}
                  onChange={(event) =>
                    setSelecionados(
                      event.target.checked
                        ? destinatarios.map((destinatario) => destinatario.telefone)
                        : [],
                    )
                  }
                />
                Selecionar todos
              </label>
              {destinatarios.map((destinatario) => {
                const resultado = resultados?.find(
                  (item) => item.telefone === destinatario.telefone,
                );
                return (
                  <label key={destinatario.telefone} className="whatsapp-destinatario-opcao">
                    <input
                      type="checkbox"
                      checked={selecionados.includes(destinatario.telefone)}
                      onChange={(event) =>
                        setSelecionados((atual) =>
                          event.target.checked
                            ? [...atual, destinatario.telefone]
                            : atual.filter((telefone) => telefone !== destinatario.telefone),
                        )
                      }
                    />
                    <span>
                      {destinatario.nome} ·{" "}
                      {formatarTelefoneExibicao(destinatario.telefone) || destinatario.telefone}
                      {resultado && ` · ${resultado.status === "enviado" ? "Enviado" : "Falhou"}`}
                      {resultado?.erro && <small> — {resultado.erro}</small>}
                    </span>
                  </label>
                );
              })}
            </>
          )}
        </fieldset>
        {(!resultados || falhas.length > 0) && (
          <>
            <label>
              Mensagem
              <textarea
                rows={5}
                value={mensagem}
                disabled={enviando}
                onChange={(event) => setMensagem(event.target.value)}
              />
            </label>
            <p>Use {PLACEHOLDER_NOME} para personalizar a saudação por contato.</p>
          </>
        )}
        <label>
          <input
            type="checkbox"
            checked={incluirImagem}
            disabled={enviando || resultados !== null}
            onChange={(event) => setIncluirImagem(event.target.checked)}
          />
          Incluir imagem da esteira com o progresso atualizado
        </label>
        {resultados && (
          <p role="status">
            {totalEnviados} enviado(s); {falhas.length} falha(s).
          </p>
        )}
        <div className="validacao-acoes">
          {!resultados && (
            <button
              ref={fecharRef}
              type="button"
              disabled={enviando}
              onClick={() => void fecharSemEnviar()}
            >
              {destinatarios.length === 0 ? "Fechar" : "Não enviar"}
            </button>
          )}
          {resultados && (
            <button type="button" disabled={enviando} onClick={onClose}>
              Fechar
            </button>
          )}
          {destinatarios.length > 0 && (!resultados || falhas.length > 0) && (
            <button
              type="button"
              className="validacao-primario"
              disabled={enviando || destinatariosSelecionados.length === 0}
              onClick={() => void enviar()}
            >
              {enviando
                ? "Enviando..."
                : resultados
                  ? `Tentar novamente (${falhas.length})`
                  : `Enviar para ${destinatariosSelecionados.length} contato(s)`}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
