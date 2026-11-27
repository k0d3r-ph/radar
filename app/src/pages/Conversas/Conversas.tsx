import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Link2, MessagesSquare, RefreshCw, Search, Send } from "lucide-react";
import { toast } from "sonner";
import {
  conectarSocketWhatsApp,
  enviarMensagemChat,
  listarConversasChat,
  listarMensagensChat,
  marcarConversaChatComoLida,
  type ConversaChat,
  type EventoChat,
  type MensagemChat,
} from "../../services/conversasWhatsApp";
import type { WhatsAppSessionState } from "../../services/whatsapp";
import { invalidarCacheEmpresas } from "../../services/empresas";
import {
  ROTULO_TIPO_MENSAGEM,
  diaBrasilia,
  horaBrasilia,
  horarioLista,
  normalizarBusca,
  rotuloDia,
  subtituloConversa,
  telefoneConversa,
  tituloConversa,
} from "./formatacaoChat";
import { VincularConversaModal } from "./VincularConversaModal";
import "./Conversas.css";

type Filtro = "todas" | "naoLidas" | "semVinculo";

interface MensagensConversa {
  itens: MensagemChat[];
  /** Se ainda pode haver mensagens mais antigas no servidor. */
  temMais: boolean;
}

const TAMANHO_PAGINA = 50;

function ordenarConversas(lista: ConversaChat[]): ConversaChat[] {
  return [...lista].sort((a, b) => (b.ultimaMensagemEm ?? 0) - (a.ultimaMensagemEm ?? 0) || a.id.localeCompare(b.id));
}

function compararMensagens(a: MensagemChat, b: MensagemChat): number {
  return a.enviadaEm - b.enviadaEm || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Junta mensagens sem repetir ids (o envio e o evento do socket trazem a mesma mensagem). */
function mesclarMensagens(atuais: MensagemChat[], novas: MensagemChat[]): MensagemChat[] {
  const porId = new Map(atuais.map((m) => [m.id, m]));
  for (const mensagem of novas) porId.set(mensagem.id, { ...porId.get(mensagem.id), ...mensagem });
  return Array.from(porId.values()).sort(compararMensagens);
}

export function Conversas() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selecionadaId = searchParams.get("conversa");

  const [conversas, setConversas] = useState<ConversaChat[] | null>(null);
  const [erroLista, setErroLista] = useState("");
  const [atualizandoLista, setAtualizandoLista] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");

  const [mensagens, setMensagens] = useState<Record<string, MensagensConversa>>({});
  /** Erro ao carregar o histórico, por conversa (o "carregando" é derivado: sem itens e sem erro). */
  const [errosMensagens, setErrosMensagens] = useState<Record<string, string>>({});
  const [carregandoAnteriores, setCarregandoAnteriores] = useState(false);

  const [rascunhos, setRascunhos] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState("");

  const [sessao, setSessao] = useState<WhatsAppSessionState | null>(null);
  const [erroSocket, setErroSocket] = useState("");
  const [vinculando, setVinculando] = useState<ConversaChat | null>(null);

  const selecionadaRef = useRef(selecionadaId);
  useEffect(() => {
    selecionadaRef.current = selecionadaId;
  }, [selecionadaId]);
  const listaMensagensRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const estavaNoFimRef = useRef(true);
  const alturaAntesAnterioresRef = useRef<number | null>(null);
  const marcandoLidaRef = useRef(new Set<string>());

  const conversaSelecionada = useMemo(
    () => conversas?.find((c) => c.id === selecionadaId) ?? null,
    [conversas, selecionadaId],
  );

  const atualizarConversa = useCallback((conversa: ConversaChat) => {
    setConversas((lista) => ordenarConversas([...(lista ?? []).filter((c) => c.id !== conversa.id), conversa]));
  }, []);

  const carregarConversas = useCallback(async (opcoes: { recarregarVinculos?: boolean } = {}) => {
    setAtualizandoLista(true);
    try {
      const lista = await listarConversasChat(opcoes);
      setConversas(ordenarConversas(lista));
      setErroLista("");
    } catch (erro) {
      setErroLista(erro instanceof Error ? erro.message : "Não foi possível carregar as conversas.");
    } finally {
      setAtualizandoLista(false);
    }
  }, []);

  const marcarComoLida = useCallback(async (conversaId: string) => {
    if (marcandoLidaRef.current.has(conversaId)) return;
    marcandoLidaRef.current.add(conversaId);
    try {
      atualizarConversa(await marcarConversaChatComoLida(conversaId));
    } catch {
      // Sem impacto para quem lê: o contador volta a ser zerado na próxima abertura.
    } finally {
      marcandoLidaRef.current.delete(conversaId);
    }
  }, [atualizarConversa]);

  const buscandoMensagensRef = useRef(new Set<string>());
  // O estado só muda na resposta da requisição, então pode ser chamado ao abrir a conversa.
  const carregarMensagens = useCallback((conversaId: string) => {
    if (buscandoMensagensRef.current.has(conversaId)) return;
    buscandoMensagensRef.current.add(conversaId);
    listarMensagensChat(conversaId)
      .then((itens) => {
        estavaNoFimRef.current = true;
        setMensagens((atual) => ({
          ...atual,
          [conversaId]: { itens: mesclarMensagens(atual[conversaId]?.itens ?? [], itens), temMais: itens.length >= TAMANHO_PAGINA },
        }));
        setErrosMensagens((atual) => ({ ...atual, [conversaId]: "" }));
      })
      .catch((erro) => {
        const texto = erro instanceof Error ? erro.message : "Não foi possível carregar as mensagens.";
        setErrosMensagens((atual) => ({ ...atual, [conversaId]: texto }));
      })
      .finally(() => {
        buscandoMensagensRef.current.delete(conversaId);
      });
  }, []);

  // Carga inicial. Se a página abriu direto numa conversa com não lidas, já marca como lida.
  useEffect(() => {
    let ativo = true;
    listarConversasChat()
      .then((lista) => {
        if (!ativo) return;
        setConversas(ordenarConversas(lista));
        setErroLista("");
        const aberta = lista.find((c) => c.id === selecionadaRef.current);
        if (aberta && aberta.naoLidas > 0 && document.visibilityState === "visible") marcarComoLida(aberta.id);
      })
      .catch((erro) => {
        if (ativo) setErroLista(erro instanceof Error ? erro.message : "Não foi possível carregar as conversas.");
      });
    return () => {
      ativo = false;
    };
  }, [marcarComoLida]);

  // Tempo real: status do WhatsApp e mensagens novas de qualquer conversa.
  useEffect(() => {
    const socket = conectarSocketWhatsApp();
    let jaConectou = false;

    socket.on("connect", () => {
      setErroSocket("");
      // Na reconexão, busca o que pode ter chegado enquanto o socket esteve fora.
      if (jaConectou) {
        carregarConversas();
        const aberta = selecionadaRef.current;
        if (aberta) carregarMensagens(aberta);
      }
      jaConectou = true;
    });
    socket.on("connect_error", (erro) => {
      if (erro.message === "nao_autorizado") {
        socket.disconnect();
        setErroSocket("Seu acesso às conversas foi recusado. Entre novamente no Radar.");
      } else {
        setErroSocket("Sem conexão em tempo real com o WhatsApp. Tentando reconectar…");
      }
    });
    socket.on("whatsapp-status", (estado: WhatsAppSessionState) => setSessao(estado));
    socket.on("whatsapp-chat", (evento: EventoChat) => {
      atualizarConversa(evento.conversa);
      if (evento.tipo !== "mensagem") return;
      const { mensagem } = evento;
      setMensagens((atual) => {
        const existente = atual[mensagem.conversaId];
        if (!existente) return atual;
        return { ...atual, [mensagem.conversaId]: { ...existente, itens: mesclarMensagens(existente.itens, [mensagem]) } };
      });
      if (
        !mensagem.deMim &&
        mensagem.conversaId === selecionadaRef.current &&
        document.visibilityState === "visible"
      ) {
        marcarComoLida(mensagem.conversaId);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [atualizarConversa, carregarConversas, carregarMensagens, marcarComoLida]);

  // Ao abrir uma conversa (clique, link ou voltar do navegador), carrega o histórico uma vez.
  const historicoCarregado = selecionadaId ? !!mensagens[selecionadaId] : true;
  const historicoComErro = selecionadaId ? !!errosMensagens[selecionadaId] : false;
  useEffect(() => {
    if (selecionadaId && !historicoCarregado && !historicoComErro) carregarMensagens(selecionadaId);
  }, [selecionadaId, historicoCarregado, historicoComErro, carregarMensagens]);

  // Voltar para a aba com a conversa aberta conta como leitura.
  useEffect(() => {
    function aoMudarVisibilidade() {
      const aberta = selecionadaRef.current;
      if (document.visibilityState !== "visible" || !aberta) return;
      const conversa = conversas?.find((c) => c.id === aberta);
      if (conversa && conversa.naoLidas > 0) marcarComoLida(aberta);
    }
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => document.removeEventListener("visibilitychange", aoMudarVisibilidade);
  }, [conversas, marcarComoLida]);

  const mensagensAbertas = selecionadaId ? mensagens[selecionadaId] : undefined;

  // Rolagem: vai ao fim ao abrir e quando chega mensagem com o usuário já no fim;
  // ao carregar anteriores, mantém a posição de leitura.
  useLayoutEffect(() => {
    const lista = listaMensagensRef.current;
    if (!lista) return;
    if (alturaAntesAnterioresRef.current !== null) {
      lista.scrollTop = lista.scrollHeight - alturaAntesAnterioresRef.current;
      alturaAntesAnterioresRef.current = null;
      return;
    }
    if (estavaNoFimRef.current) lista.scrollTop = lista.scrollHeight;
  }, [mensagensAbertas]);

  async function carregarAnteriores() {
    if (!selecionadaId || !mensagensAbertas?.itens.length) return;
    const conversaId = selecionadaId;
    setCarregandoAnteriores(true);
    try {
      const [maisAntiga] = mensagensAbertas.itens;
      const anteriores = await listarMensagensChat(conversaId, maisAntiga);
      alturaAntesAnterioresRef.current = listaMensagensRef.current?.scrollHeight ?? null;
      setMensagens((atual) => {
        const existente = atual[conversaId] ?? { itens: [], temMais: true };
        return {
          ...atual,
          [conversaId]: { itens: mesclarMensagens(existente.itens, anteriores), temMais: anteriores.length >= TAMANHO_PAGINA },
        };
      });
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível carregar mensagens anteriores.");
    } finally {
      setCarregandoAnteriores(false);
    }
  }

  const whatsappConectado = sessao?.status === "connected";
  const rascunho = selecionadaId ? rascunhos[selecionadaId] ?? "" : "";

  async function enviar() {
    if (!selecionadaId || enviando) return;
    const texto = rascunho.trim();
    if (!texto) return;
    const conversaId = selecionadaId;
    setEnviando(true);
    setErroEnvio("");
    try {
      const mensagem = await enviarMensagemChat(conversaId, texto);
      estavaNoFimRef.current = true;
      setMensagens((atual) => {
        const existente = atual[conversaId] ?? { itens: [], temMais: false };
        return { ...atual, [conversaId]: { ...existente, itens: mesclarMensagens(existente.itens, [mensagem]) } };
      });
      setRascunhos((atual) => ({ ...atual, [conversaId]: "" }));
    } catch (erro) {
      // O texto fica no campo para tentar de novo.
      setErroEnvio(erro instanceof Error ? erro.message : "Não foi possível enviar a mensagem.");
    } finally {
      setEnviando(false);
      campoRef.current?.focus();
    }
  }

  function abrirConversa(id: string) {
    setErroEnvio("");
    estavaNoFimRef.current = true;
    setSearchParams({ conversa: id }, { replace: !!selecionadaId });
    const conversa = conversas?.find((c) => c.id === id);
    if (conversa && conversa.naoLidas > 0) marcarComoLida(id);
  }

  function tentarCarregarMensagens(conversaId: string) {
    setErrosMensagens((atual) => ({ ...atual, [conversaId]: "" }));
    carregarMensagens(conversaId);
  }

  function voltarParaLista() {
    setSearchParams({}, { replace: true });
  }

  const contagens = useMemo(() => ({
    naoLidas: (conversas ?? []).filter((c) => c.naoLidas > 0).length,
    semVinculo: (conversas ?? []).filter((c) => c.vinculos.length === 0).length,
  }), [conversas]);

  const conversasVisiveis = useMemo(() => {
    const termo = normalizarBusca(busca);
    const digitos = busca.replace(/\D/g, "");
    return (conversas ?? []).filter((c) => {
      if (filtro === "naoLidas" && c.naoLidas === 0) return false;
      if (filtro === "semVinculo" && c.vinculos.length > 0) return false;
      if (!termo) return true;
      const textos = [tituloConversa(c), c.nomeContato ?? "", ...c.vinculos.map((v) => v.nomeEmpresa)];
      if (textos.some((t) => normalizarBusca(t).includes(termo))) return true;
      return digitos.length >= 3 && (c.telefone ?? "").includes(digitos);
    });
  }, [conversas, busca, filtro]);

  const avisoConexao = erroSocket
    ? erroSocket
    : sessao && !whatsappConectado
      ? sessao.status === "qrcode"
        ? "O WhatsApp está aguardando a leitura do QR Code."
        : sessao.status === "authenticating"
          ? "O WhatsApp está conectando. As mensagens aparecem assim que terminar."
          : "O WhatsApp está desconectado. Mensagens novas não chegam e o envio fica bloqueado."
      : "";

  function renderizarLista() {
    if (erroLista && !conversas) {
      return (
        <div className="conversas-estado" role="alert">
          <p>{erroLista}</p>
          <button type="button" className="conversas-botao-secundario" onClick={() => carregarConversas()}>
            Tentar de novo
          </button>
        </div>
      );
    }
    if (!conversas) return <p className="conversas-estado">Carregando conversas…</p>;
    if (conversas.length === 0) {
      return (
        <p className="conversas-estado">
          Nenhuma conversa ainda. As mensagens trocadas pelo WhatsApp conectado aparecem aqui.
        </p>
      );
    }
    if (conversasVisiveis.length === 0) {
      return (
        <div className="conversas-estado">
          <p>Nenhuma conversa encontrada com esse filtro.</p>
          <button
            type="button"
            className="conversas-botao-secundario"
            onClick={() => {
              setBusca("");
              setFiltro("todas");
            }}
          >
            Limpar busca e filtros
          </button>
        </div>
      );
    }
    return (
      <ul className="conversas-lista" aria-label="Conversas">
        {conversasVisiveis.map((conversa) => {
          const subtitulo = subtituloConversa(conversa);
          const ativa = conversa.id === selecionadaId;
          return (
            <li key={conversa.id}>
              <button
                type="button"
                className={`conversas-item${ativa ? " ativa" : ""}${conversa.naoLidas > 0 ? " nao-lida" : ""}`}
                aria-current={ativa ? "true" : undefined}
                onClick={() => abrirConversa(conversa.id)}
              >
                <span className="conversas-item-topo">
                  <span className="conversas-item-titulo">{tituloConversa(conversa)}</span>
                  <span className="conversas-item-hora">{horarioLista(conversa.ultimaMensagemEm)}</span>
                </span>
                <span className="conversas-item-empresa">
                  {subtitulo ?? <span className="conversas-selo-sem-vinculo">Sem vínculo</span>}
                </span>
                <span className="conversas-item-rodape">
                  <span className="conversas-item-previa">
                    {conversa.ultimaMensagemDeMim ? "Você: " : ""}
                    {conversa.ultimaMensagemPrevia || "Sem mensagens"}
                  </span>
                  {conversa.naoLidas > 0 && (
                    <span className="conversas-item-badge">
                      {conversa.naoLidas}
                      <span className="sr-only"> {conversa.naoLidas === 1 ? "não lida" : "não lidas"}</span>
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  function renderizarMensagens() {
    if (!selecionadaId) return null;
    if (!mensagensAbertas) {
      const erro = errosMensagens[selecionadaId];
      if (erro) {
        return (
          <div className="conversas-estado" role="alert">
            <p>{erro}</p>
            <button type="button" className="conversas-botao-secundario" onClick={() => tentarCarregarMensagens(selecionadaId)}>
              Tentar de novo
            </button>
          </div>
        );
      }
      return <p className="conversas-estado">Carregando mensagens…</p>;
    }
    if (mensagensAbertas.itens.length === 0) {
      return <p className="conversas-estado">Nenhuma mensagem gravada nesta conversa ainda.</p>;
    }
    let diaAnterior = "";
    return (
      <>
        {mensagensAbertas.temMais && (
          <div className="conversas-anteriores">
            <button
              type="button"
              className="conversas-botao-secundario"
              onClick={carregarAnteriores}
              disabled={carregandoAnteriores}
            >
              {carregandoAnteriores ? "Carregando…" : "Carregar mensagens anteriores"}
            </button>
          </div>
        )}
        {mensagensAbertas.itens.map((mensagem) => {
          const dia = diaBrasilia(mensagem.enviadaEm);
          const mostrarDia = dia !== diaAnterior;
          diaAnterior = dia;
          return (
            <Fragment key={mensagem.id}>
              {mostrarDia && (
                <div className="conversas-separador-dia" role="separator">
                  <span>{rotuloDia(mensagem.enviadaEm)}</span>
                </div>
              )}
              <div className={`conversas-mensagem ${mensagem.deMim ? "de-mim" : "do-contato"}`}>
                {mensagem.tipo !== "texto" && (
                  <span className="conversas-mensagem-midia">
                    {ROTULO_TIPO_MENSAGEM[mensagem.tipo]}
                    {mensagem.tipo !== "outro" && (
                      <span className="conversas-mensagem-midia-dica"> · abra no celular para ver</span>
                    )}
                  </span>
                )}
                {mensagem.texto && <p className="conversas-mensagem-texto">{mensagem.texto}</p>}
                <span className="conversas-mensagem-rodape">
                  {mensagem.deMim && (
                    <span>{mensagem.enviadoPorNome ? `por ${mensagem.enviadoPorNome}` : "fora do Radar"} · </span>
                  )}
                  <time dateTime={new Date(mensagem.enviadaEm).toISOString()}>{horaBrasilia(mensagem.enviadaEm)}</time>
                </span>
              </div>
            </Fragment>
          );
        })}
      </>
    );
  }

  return (
    <div className={`conversas-pagina${selecionadaId ? " com-conversa" : ""}`}>
      <aside className="conversas-painel-lista" aria-label="Lista de conversas">
        <div className="conversas-cabecalho">
          <h1 className="conversas-titulo">Conversas</h1>
          <button
            type="button"
            className="conversas-botao-icone"
            onClick={() => carregarConversas()}
            disabled={atualizandoLista}
            aria-label="Atualizar conversas"
            title="Atualizar conversas"
          >
            <RefreshCw size={16} aria-hidden="true" className={atualizandoLista ? "girando" : undefined} />
          </button>
        </div>

        <div className="conversas-busca">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder="Buscar por contato, cliente ou telefone"
            aria-label="Buscar conversas"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        <div className="conversas-filtros" role="group" aria-label="Filtrar conversas">
          {([
            ["todas", "Todas", null],
            ["naoLidas", "Não lidas", contagens.naoLidas],
            ["semVinculo", "Sem vínculo", contagens.semVinculo],
          ] as const).map(([valor, rotulo, contagem]) => (
            <button
              key={valor}
              type="button"
              className={`conversas-filtro${filtro === valor ? " ativo" : ""}`}
              aria-pressed={filtro === valor}
              onClick={() => setFiltro(valor)}
            >
              {rotulo}
              {contagem ? ` (${contagem})` : ""}
            </button>
          ))}
        </div>

        {erroLista && conversas && (
          <p className="conversas-aviso" role="alert">{erroLista}</p>
        )}
        {renderizarLista()}
      </aside>

      <section className="conversas-painel-chat" aria-label="Conversa aberta">
        {avisoConexao && (
          <div className="conversas-aviso conversas-aviso-conexao" role="status">
            <span>{avisoConexao}</span>
            {!erroSocket && <Link to="/whatsapp">Abrir tela WhatsApp</Link>}
          </div>
        )}

        {!selecionadaId ? (
          <div className="conversas-vazio-chat">
            <MessagesSquare size={40} aria-hidden="true" />
            <p>Escolha uma conversa na lista para ler e responder.</p>
          </div>
        ) : (
          <>
            <header className="conversas-chat-cabecalho">
              <button
                type="button"
                className="conversas-botao-icone conversas-voltar"
                onClick={voltarParaLista}
                aria-label="Voltar para a lista de conversas"
              >
                <ArrowLeft size={18} aria-hidden="true" />
              </button>
              <div className="conversas-chat-identificacao">
                <h2>{conversaSelecionada ? tituloConversa(conversaSelecionada) : "Conversa"}</h2>
                <p>
                  {conversaSelecionada && subtituloConversa(conversaSelecionada)
                    ? `${subtituloConversa(conversaSelecionada)} · `
                    : ""}
                  {conversaSelecionada ? telefoneConversa(conversaSelecionada) : ""}
                </p>
              </div>
              {conversaSelecionada && conversaSelecionada.vinculos.length === 0 && (
                <button
                  type="button"
                  className="conversas-botao-secundario conversas-botao-vincular"
                  onClick={() => setVinculando(conversaSelecionada)}
                >
                  <Link2 size={15} aria-hidden="true" /> Vincular a um cliente
                </button>
              )}
            </header>

            <div
              ref={listaMensagensRef}
              className="conversas-mensagens"
              role="log"
              aria-live="polite"
              aria-label="Mensagens"
              tabIndex={0}
              onScroll={(e) => {
                const alvo = e.currentTarget;
                estavaNoFimRef.current = alvo.scrollHeight - alvo.scrollTop - alvo.clientHeight < 80;
              }}
            >
              {renderizarMensagens()}
            </div>

            <form
              className="conversas-envio"
              onSubmit={(e) => {
                e.preventDefault();
                enviar();
              }}
            >
              {erroEnvio && <p className="conversas-envio-erro" role="alert">{erroEnvio}</p>}
              <div className="conversas-envio-linha">
                <textarea
                  ref={campoRef}
                  className="conversas-envio-campo"
                  aria-label="Mensagem"
                  placeholder={whatsappConectado ? "Digite a mensagem (Enter envia, Shift+Enter quebra a linha)" : "Envio indisponível: WhatsApp desconectado"}
                  value={rascunho}
                  rows={1}
                  maxLength={4096}
                  disabled={!whatsappConectado || !conversaSelecionada}
                  onChange={(e) => {
                    const valor = e.target.value;
                    setRascunhos((atual) => ({ ...atual, [selecionadaId]: valor }));
                    if (erroEnvio) setErroEnvio("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      enviar();
                    }
                  }}
                />
                <button
                  type="submit"
                  className="conversas-botao-enviar"
                  disabled={!whatsappConectado || enviando || !rascunho.trim() || !conversaSelecionada}
                  aria-label={enviando ? "Enviando mensagem" : "Enviar mensagem"}
                  title="Enviar"
                >
                  <Send size={18} aria-hidden="true" />
                </button>
              </div>
            </form>
          </>
        )}
      </section>

      {vinculando && (
        <VincularConversaModal
          conversa={vinculando}
          onFechar={() => setVinculando(null)}
          onVinculado={(empresa) => {
            setVinculando(null);
            invalidarCacheEmpresas();
            toast.success(`Conversa vinculada a ${empresa.nomeEmpresa}.`);
            carregarConversas({ recarregarVinculos: true });
          }}
        />
      )}
    </div>
  );
}
