import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Empresa, Ocorrencia } from "../../types";
import type { TentativaValidacao } from "../../../../server/src/domain/validacaoConhecimento";
import {
  TIPOS_CERTIFICADO,
  calcularDadosCertificado,
  dataCertificadoValida,
  formatarCargaHoraria,
  mascararDataCertificado,
  nomeArquivoCertificado,
  participantesSugeridos,
  PASSO_ARREDONDAMENTO_MINUTOS,
} from "../../utils/certificadoTreinamento";
import type { ConteudoCertificado, TipoCertificado } from "../../utils/certificadoTreinamento";
import { gerarCertificadoImagem } from "../../utils/gerarCertificadoImagem";
import { enviarMensagemWhatsApp } from "../../services/whatsapp";
import { PLACEHOLDER_NOME, aplicarNomeDestinatario } from "../../services/notificacoes";
import { formatarTelefoneExibicao, obterDestinatariosCliente } from "../../utils/telefone";

type Props = {
  tentativa: TentativaValidacao;
  cliente?: Empresa;
  ocorrencias: Ocorrencia[];
  onFechar: () => void;
};

type Participante = { id: number; nome: string };
type Etapa = "editar" | "enviar";

const MENSAGEM_PADRAO = `Olá, ${PLACEHOLDER_NOME}! Parabéns pela conclusão do treinamento da plataforma SSX. 🎓\n\nSeguem os certificados dos participantes.`;

function proximoIdParticipante(lista: Participante[]): number {
  return lista.reduce((maior, p) => Math.max(maior, p.id), 0) + 1;
}

function traduzirErro(e: unknown): string {
  return e instanceof Error ? e.message : "Falha desconhecida.";
}

export function CertificadosModal({ tentativa, cliente, ocorrencias, onFechar }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const automaticos = useMemo(() => calcularDadosCertificado(tentativa, ocorrencias), [tentativa, ocorrencias]);

  const [etapa, setEtapa] = useState<Etapa>("editar");
  const [tipo, setTipo] = useState<TipoCertificado | "">("");
  const [participantes, setParticipantes] = useState<Participante[]>(() => {
    const nomes = participantesSugeridos(tentativa.csatRespostas);
    return (nomes.length ? nomes : [""]).map((nome, i) => ({ id: i + 1, nome }));
  });
  const [selecionadoId, setSelecionadoId] = useState(participantes[0]?.id ?? 0);
  const [cargaHoraria, setCargaHoraria] = useState(automaticos.cargaHoraria);
  const [inicio, setInicio] = useState(automaticos.inicio);
  const [fim, setFim] = useState(automaticos.fim);
  const [dataGeracao, setDataGeracao] = useState(automaticos.dataGeracao);
  const [tentouGerar, setTentouGerar] = useState(false);
  const [previa, setPrevia] = useState("");
  const [erroPrevia, setErroPrevia] = useState("");
  const [baixando, setBaixando] = useState(false);

  // Envio pelo WhatsApp
  const destinatarios = useMemo(() => (cliente ? obterDestinatariosCliente(cliente) : []), [cliente]);
  const [selecionados, setSelecionados] = useState<string[]>(() => destinatarios.map((d) => d.telefone));
  const [mensagem, setMensagem] = useState(MENSAGEM_PADRAO);
  const [enviando, setEnviando] = useState(false);
  // Pares telefone|participante já confirmados, para o reenvio não duplicar certificados.
  const [enviados, setEnviados] = useState<Set<string>>(() => new Set());
  const [falhas, setFalhas] = useState<Record<string, string>>({});
  const [envioFeito, setEnvioFeito] = useState(false);

  const ocupado = baixando || enviando;
  const nomesValidos = participantes.map((p) => p.nome.replace(/\s+/g, " ").trim()).filter(Boolean);
  const erros = {
    tipo: !tipo ? "Escolha o tipo do certificado." : "",
    participantes: nomesValidos.length === 0 ? "Informe o nome de pelo menos um participante." : "",
    cargaHoraria: !cargaHoraria.trim() ? "Informe a carga horária. Ex.: 7h40min." : "",
    inicio: !dataCertificadoValida(inicio) ? "Use DD/MM/AAAA." : "",
    fim: !dataCertificadoValida(fim) ? "Use DD/MM/AAAA." : "",
    dataGeracao: !dataCertificadoValida(dataGeracao) ? "Use DD/MM/AAAA." : "",
  };
  const valido = Object.values(erros).every((e) => !e);
  const mostrarErro = (campo: keyof typeof erros) => (tentouGerar ? erros[campo] : "");

  function conteudo(participante: string): ConteudoCertificado {
    return {
      participante: participante.replace(/\s+/g, " ").trim(),
      tipo: tipo as TipoCertificado,
      cargaHoraria,
      inicio,
      fim,
      aproveitamento: automaticos.aproveitamento,
      dataGeracao,
    };
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  // Pré-visualização do participante selecionado, atualizada enquanto se digita.
  const nomePrevia = participantes.find((p) => p.id === selecionadoId)?.nome.trim() || nomesValidos[0] || "Nome do participante";
  useEffect(() => {
    if (!tipo) return; // Sem tipo, a pré-visualização mostra o aviso para escolher.
    let cancelado = false;
    const espera = window.setTimeout(() => {
      gerarCertificadoImagem({
        participante: nomePrevia,
        tipo,
        cargaHoraria,
        inicio,
        fim,
        aproveitamento: automaticos.aproveitamento,
        dataGeracao,
      })
        .then((url) => {
          if (!cancelado) {
            setPrevia(url);
            setErroPrevia("");
          }
        })
        .catch((e) => {
          if (!cancelado) setErroPrevia(`Não foi possível montar a pré-visualização: ${traduzirErro(e)}`);
        });
    }, 180);
    return () => {
      cancelado = true;
      window.clearTimeout(espera);
    };
  }, [tipo, nomePrevia, cargaHoraria, inicio, fim, dataGeracao, automaticos.aproveitamento]);

  function fechar() {
    if (ocupado) return;
    onFechar();
  }

  function alterarParticipante(id: number, nome: string) {
    setParticipantes((lista) => lista.map((p) => (p.id === id ? { ...p, nome } : p)));
  }

  function adicionarParticipante() {
    const novo = { id: proximoIdParticipante(participantes), nome: "" };
    setParticipantes((lista) => [...lista, novo]);
    setSelecionadoId(novo.id);
    requestAnimationFrame(() => document.getElementById(`certificado-participante-${novo.id}`)?.focus());
  }

  function removerParticipante(id: number) {
    const restante = participantes.filter((p) => p.id !== id);
    const lista = restante.length ? restante : [{ id: proximoIdParticipante(participantes), nome: "" }];
    setParticipantes(lista);
    if (selecionadoId === id || !restante.length) setSelecionadoId(lista[0].id);
  }

  function validarAntes(): boolean {
    setTentouGerar(true);
    if (!valido) {
      toast.error("Revise os campos destacados antes de gerar os certificados.");
      return false;
    }
    return true;
  }

  async function baixar() {
    if (!validarAntes()) return;
    setBaixando(true);
    try {
      for (const nome of nomesValidos) {
        const url = await gerarCertificadoImagem(conteudo(nome));
        const a = document.createElement("a");
        a.href = url;
        a.download = nomeArquivoCertificado(nome, dataGeracao);
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Pausa curta: alguns navegadores descartam downloads disparados em sequência.
        await new Promise((r) => setTimeout(r, 350));
      }
      toast.success(nomesValidos.length === 1 ? "Certificado baixado." : `${nomesValidos.length} certificados baixados.`);
    } catch (e) {
      toast.error(`Não foi possível gerar os certificados: ${traduzirErro(e)}`);
    } finally {
      setBaixando(false);
    }
  }

  function irParaEnvio() {
    if (!validarAntes()) return;
    setEtapa("enviar");
  }

  const chave = (telefone: string, participante: string) => `${telefone}|${participante}`;
  const alvos = destinatarios.filter((d) => selecionados.includes(d.telefone));
  const pendentesPorDestinatario = (telefone: string) => nomesValidos.filter((n) => !enviados.has(chave(telefone, n)));
  const totalPendente = alvos.reduce((acc, d) => acc + pendentesPorDestinatario(d.telefone).length, 0);

  async function enviar() {
    if (enviando || totalPendente === 0 || !mensagem.trim()) return;
    setEnviando(true);
    try {
      // Gera cada certificado uma vez e reaproveita para todos os destinatários.
      const imagens = new Map<string, string>();
      for (const nome of nomesValidos) imagens.set(nome, await gerarCertificadoImagem(conteudo(nome)));

      const novosEnviados = new Set(enviados);
      const novasFalhas: Record<string, string> = {};
      await Promise.all(
        alvos.map(async (destinatario) => {
          // Sequencial por contato, para os certificados chegarem na ordem.
          for (const nome of pendentesPorDestinatario(destinatario.telefone)) {
            const primeiro = nome === nomesValidos[0];
            const legenda = primeiro
              ? `${aplicarNomeDestinatario(mensagem, destinatario.nome).trim()}\n\nCertificado de ${nome}`
              : `Certificado de ${nome}`;
            try {
              await enviarMensagemWhatsApp({
                to: destinatario.telefone,
                message: legenda,
                imageBase64: imagens.get(nome),
                filename: nomeArquivoCertificado(nome, dataGeracao),
              });
              novosEnviados.add(chave(destinatario.telefone, nome));
            } catch (e) {
              novasFalhas[destinatario.telefone] = `${nome}: ${traduzirErro(e)}`;
              break; // Não segue enviando ao contato após uma falha; o reenvio continua daqui.
            }
          }
        }),
      );
      setEnviados(novosEnviados);
      setFalhas(novasFalhas);
      setEnvioFeito(true);
      const comFalha = Object.keys(novasFalhas).length;
      if (comFalha === 0) toast.success("Certificados enviados pelo WhatsApp.");
      else if (comFalha < alvos.length) toast.warning("Certificados enviados parcialmente. Use “Tentar novamente” para os que faltaram.");
      else toast.error("Não foi possível enviar os certificados. Verifique a conexão do WhatsApp e tente novamente.");
    } catch (e) {
      toast.error(`Não foi possível gerar os certificados para envio: ${traduzirErro(e)}`);
    } finally {
      setEnviando(false);
    }
  }

  const resumoCarga = `Soma de ${automaticos.agendas} agenda${automaticos.agendas === 1 ? "" : "s"}: ${formatarCargaHoraria(automaticos.minutosExatos)}, arredondada para ${PASSO_ARREDONDAMENTO_MINUTOS} min.`;

  return (
    <dialog
      ref={dialogRef}
      className="validacao-impressao-dialog certificado-dialog"
      aria-labelledby="certificado-titulo"
      onCancel={(event) => {
        event.preventDefault();
        fechar();
      }}
    >
      <div className="certificado-cabecalho">
        <h2 id="certificado-titulo">{etapa === "editar" ? "Gerar certificados" : "Enviar certificados pelo WhatsApp"}</h2>
        <p>
          {tentativa.empresa} · Tentativa {tentativa.numero} · Aproveitamento {automaticos.aproveitamento}. Um
          certificado por participante.
        </p>
      </div>

      <div className="certificado-corpo">
        <div className="certificado-formulario">
          {etapa === "editar" ? (
            <>
              <fieldset className="certificado-tipo" disabled={ocupado} aria-describedby={mostrarErro("tipo") ? "certificado-tipo-erro" : undefined}>
                <legend>Tipo do certificado</legend>
                {TIPOS_CERTIFICADO.map((t) => (
                  <label key={t.valor} className={tipo === t.valor ? "ativo" : ""}>
                    <input type="radio" name="certificado-tipo" value={t.valor} checked={tipo === t.valor} onChange={() => setTipo(t.valor)} />
                    {t.rotulo}
                  </label>
                ))}
                {mostrarErro("tipo") && <small id="certificado-tipo-erro" className="validacao-erro-campo">{erros.tipo}</small>}
              </fieldset>

              <fieldset className="certificado-participantes" disabled={ocupado}>
                <legend>Participantes</legend>
                <p>
                  {participantesSugeridos(tentativa.csatRespostas).length
                    ? "Sugeridos a partir das respostas do CSAT. Corrija ou complete os nomes como devem sair no certificado."
                    : "Digite o nome de cada participante como deve sair no certificado."}
                </p>
                <ul>
                  {participantes.map((p, i) => (
                    <li key={p.id} className={p.id === selecionadoId ? "selecionado" : ""}>
                      <input
                        id={`certificado-participante-${p.id}`}
                        aria-label={`Participante ${i + 1}`}
                        value={p.nome}
                        maxLength={80}
                        placeholder={`Nome do participante ${i + 1}`}
                        onFocus={() => setSelecionadoId(p.id)}
                        onChange={(e) => alterarParticipante(p.id, e.target.value)}
                      />
                      <button type="button" className="certificado-icone" aria-label={`Remover ${p.nome.trim() || `participante ${i + 1}`}`} title="Remover participante" onClick={() => removerParticipante(p.id)}>
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" className="certificado-adicionar" onClick={adicionarParticipante}>
                  <Plus size={15} aria-hidden="true" /> Adicionar participante
                </button>
                {mostrarErro("participantes") && <small className="validacao-erro-campo">{erros.participantes}</small>}
              </fieldset>

              <fieldset className="certificado-dados" disabled={ocupado}>
                <legend>Dados do certificado</legend>
                <label>
                  Carga horária
                  <input value={cargaHoraria} maxLength={20} onChange={(e) => setCargaHoraria(e.target.value)} aria-invalid={!!mostrarErro("cargaHoraria")} />
                  <small className={mostrarErro("cargaHoraria") ? "validacao-erro-campo" : ""}>{mostrarErro("cargaHoraria") || resumoCarga}</small>
                </label>
                <label>
                  Aproveitamento
                  <input value={automaticos.aproveitamento} readOnly aria-readonly="true" />
                  <small>Resultado desta validação.</small>
                </label>
                <label>
                  Início do período
                  <input inputMode="numeric" placeholder="DD/MM/AAAA" value={inicio} onChange={(e) => setInicio(mascararDataCertificado(e.target.value))} aria-invalid={!!mostrarErro("inicio")} />
                  <small className={mostrarErro("inicio") ? "validacao-erro-campo" : ""}>{mostrarErro("inicio") || "Primeiro treinamento realizado."}</small>
                </label>
                <label>
                  Fim do período
                  <input inputMode="numeric" placeholder="DD/MM/AAAA" value={fim} onChange={(e) => setFim(mascararDataCertificado(e.target.value))} aria-invalid={!!mostrarErro("fim")} />
                  <small className={mostrarErro("fim") ? "validacao-erro-campo" : ""}>{mostrarErro("fim") || "Data da validação do conhecimento."}</small>
                </label>
                <label>
                  Data de geração
                  <input inputMode="numeric" placeholder="DD/MM/AAAA" value={dataGeracao} onChange={(e) => setDataGeracao(mascararDataCertificado(e.target.value))} aria-invalid={!!mostrarErro("dataGeracao")} />
                  <small className={mostrarErro("dataGeracao") ? "validacao-erro-campo" : ""}>{mostrarErro("dataGeracao") || "Aparece no campo “Data”."}</small>
                </label>
              </fieldset>
            </>
          ) : (
            <>
              <fieldset className="certificado-destinatarios" disabled={enviando}>
                <legend>Destinatários</legend>
                {destinatarios.length === 0 ? (
                  <p>Nenhum telefone válido está cadastrado para este cliente. Cadastre os contatos na Home ou baixe os certificados para enviar manualmente.</p>
                ) : (
                  destinatarios.map((d) => {
                    const pendentes = pendentesPorDestinatario(d.telefone).length;
                    const situacao = !envioFeito
                      ? ""
                      : falhas[d.telefone]
                        ? ` · Falhou (${nomesValidos.length - pendentes} de ${nomesValidos.length} enviados)`
                        : pendentes === 0
                          ? " · Enviado"
                          : "";
                    return (
                      <label key={d.telefone} className="whatsapp-destinatario-opcao">
                        <input
                          type="checkbox"
                          checked={selecionados.includes(d.telefone)}
                          onChange={(e) =>
                            setSelecionados((atual) => (e.target.checked ? [...atual, d.telefone] : atual.filter((t) => t !== d.telefone)))
                          }
                        />
                        <span>
                          {d.nome} · {formatarTelefoneExibicao(d.telefone) || d.telefone}
                          {situacao}
                          {falhas[d.telefone] && <small> — {falhas[d.telefone]}</small>}
                        </span>
                      </label>
                    );
                  })
                )}
              </fieldset>
              <label htmlFor="certificado-mensagem">
                Mensagem <span>(vai junto com o primeiro certificado; os demais seguem com “Certificado de …”)</span>
              </label>
              <textarea id="certificado-mensagem" rows={5} value={mensagem} disabled={enviando} onChange={(e) => setMensagem(e.target.value)} />
              <p>Use {PLACEHOLDER_NOME} para personalizar a saudação por contato. Serão enviados {nomesValidos.length} certificado(s) a cada contato selecionado.</p>
            </>
          )}
        </div>

        <figure className="certificado-previa" aria-live="polite">
          {!tipo ? (
            <div className="certificado-previa-vazia">Escolha o tipo do certificado para ver a pré-visualização.</div>
          ) : erroPrevia ? (
            <div className="certificado-previa-vazia validacao-erro-campo" role="alert">{erroPrevia}</div>
          ) : previa ? (
            <img src={previa} alt={`Pré-visualização do certificado de ${nomePrevia}`} />
          ) : (
            <div className="certificado-previa-vazia" role="status">Montando pré-visualização…</div>
          )}
          <figcaption>Pré-visualização: {nomePrevia}. Clique no nome de outro participante para ver o certificado dele.</figcaption>
        </figure>
      </div>

      <div className="validacao-impressao-acoes">
        {etapa === "editar" ? (
          <>
            <button type="button" disabled={ocupado} onClick={fechar}>Fechar</button>
            <button type="button" disabled={ocupado} onClick={() => void baixar()}>
              <Download size={15} aria-hidden="true" /> {baixando ? "Gerando…" : `Baixar ${nomesValidos.length > 1 ? `${nomesValidos.length} certificados` : "certificado"}`}
            </button>
            <button type="button" className="validacao-primario" disabled={ocupado} onClick={irParaEnvio}>
              <Send size={15} aria-hidden="true" /> Enviar pelo WhatsApp
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={enviando} onClick={() => setEtapa("editar")}>Voltar</button>
            {envioFeito && <button type="button" disabled={enviando} onClick={fechar}>Fechar</button>}
            {destinatarios.length > 0 && totalPendente > 0 && (
              <button type="button" className="validacao-primario" disabled={enviando || alvos.length === 0 || !mensagem.trim()} onClick={() => void enviar()}>
                {enviando ? "Enviando…" : envioFeito ? `Tentar novamente (${totalPendente})` : `Enviar para ${alvos.length} contato(s)`}
              </button>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
