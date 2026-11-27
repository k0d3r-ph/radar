import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ContatoCliente, Empresa } from "../../types";
import type { ConversaChat } from "../../services/conversasWhatsApp";
import { listarEmpresas, salvarEmpresas } from "../../services/empresas";
import { normalizarBusca, telefoneConversa } from "./formatacaoChat";

interface Props {
  conversa: ConversaChat;
  onFechar: () => void;
  /** Chamado depois de gravar o telefone no cadastro do cliente. */
  onVinculado: (empresa: Empresa) => void;
}

const NOVO_CONTATO = "__novo__";
const LIMITE_RESULTADOS = 30;

/**
 * Liga uma conversa "sem vínculo" a um cliente, gravando o telefone num contato do
 * cadastro (novo ou existente). Depois disso o Radar reconhece o número sozinho.
 */
export function VincularConversaModal({ conversa, onFechar, onVinculado }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buscaRef = useRef<HTMLInputElement>(null);
  const tituloId = useId();
  const buscaId = useId();
  const contatoId = useId();
  const nomeId = useId();
  const erroId = useId();

  const [empresas, setEmpresas] = useState<Empresa[] | null>(null);
  const [erroCarregar, setErroCarregar] = useState("");
  const [busca, setBusca] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [contatoEscolhido, setContatoEscolhido] = useState(NOVO_CONTATO);
  const [nomeNovo, setNomeNovo] = useState(conversa.nomeContato || "");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const telefoneFormatado = telefoneConversa(conversa);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focoAnterior = document.activeElement as HTMLElement | null;
    if (!dialog.open) dialog.showModal();
    buscaRef.current?.focus();
    return () => {
      focoAnterior?.focus?.();
    };
  }, []);

  useEffect(() => {
    let ativo = true;
    listarEmpresas()
      .then((lista) => {
        if (!ativo) return;
        setEmpresas([...lista].sort((a, b) => a.nomeEmpresa.localeCompare(b.nomeEmpresa, "pt-BR")));
      })
      .catch(() => {
        if (ativo) setErroCarregar("Não foi possível carregar os clientes. Feche e tente de novo.");
      });
    return () => {
      ativo = false;
    };
  }, []);

  const resultados = useMemo(() => {
    if (!empresas) return [];
    const termo = normalizarBusca(busca);
    const filtradas = termo
      ? empresas.filter((e) => normalizarBusca(e.nomeEmpresa).includes(termo))
      : empresas;
    return filtradas.slice(0, LIMITE_RESULTADOS);
  }, [empresas, busca]);

  const empresaSelecionada = empresas?.find((e) => e.id === empresaId) ?? null;

  function escolherEmpresa(id: string) {
    setEmpresaId(id);
    setContatoEscolhido(NOVO_CONTATO);
    setErro("");
  }

  async function salvar() {
    if (!empresaSelecionada?.id || !conversa.telefone) return;
    const novoContato = contatoEscolhido === NOVO_CONTATO;
    if (novoContato && !nomeNovo.trim()) {
      setErro("Informe o nome do contato.");
      return;
    }
    setSalvando(true);
    setErro("");
    try {
      // Relê o cadastro para não sobrescrever contatos alterados em outra tela.
      const atual = (await listarEmpresas(true)).find((e) => e.id === empresaSelecionada.id);
      if (!atual) throw new Error("O cliente não foi encontrado. Atualize a página e tente de novo.");
      const telefone = telefoneFormatado || conversa.telefone;
      const contatos: ContatoCliente[] = [...(atual.contatos ?? [])];
      if (novoContato) {
        contatos.push({ nome: nomeNovo.trim(), telefone, telefones: [telefone] });
      } else {
        const indice = Number(contatoEscolhido);
        const contato = contatos[indice];
        if (!contato) throw new Error("O contato escolhido não existe mais. Escolha de novo.");
        const telefones = contato.telefones?.length ? contato.telefones : [contato.telefone].filter(Boolean);
        contatos[indice] = { ...contato, telefone: contato.telefone || telefone, telefones: [...telefones, telefone] };
      }
      await salvarEmpresas({ id: atual.id, contatos }, { updatedAtEsperado: atual.updatedAt });
      onVinculado({ ...atual, contatos });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível vincular a conversa. Tente de novo.");
      setSalvando(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="conversas-modal"
      aria-labelledby={tituloId}
      onCancel={(e) => {
        e.preventDefault();
        if (!salvando) onFechar();
      }}
    >
      <div className="conversas-modal-conteudo">
        <h2 id={tituloId} className="conversas-modal-titulo">Vincular a um cliente</h2>
        <p className="conversas-modal-descricao">
          O telefone <strong>{telefoneFormatado || "desta conversa"}</strong> será salvo no cadastro do cliente
          escolhido. Depois disso, as mensagens desse número aparecem ligadas a ele.
        </p>

        {!conversa.telefone ? (
          <p className="conversas-modal-erro" role="alert">
            O WhatsApp não informou o telefone desta conversa, então ela não pode ser vinculada.
          </p>
        ) : (
          <>
            <label htmlFor={buscaId} className="conversas-modal-label">Cliente</label>
            <input
              id={buscaId}
              ref={buscaRef}
              type="search"
              className="conversas-modal-input"
              placeholder="Buscar pelo nome do cliente"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              autoComplete="off"
            />
            <div className="conversas-modal-lista" role="listbox" aria-label="Clientes encontrados">
              {erroCarregar ? (
                <p className="conversas-modal-erro" role="alert">{erroCarregar}</p>
              ) : !empresas ? (
                <p className="conversas-modal-vazio">Carregando clientes…</p>
              ) : resultados.length === 0 ? (
                <p className="conversas-modal-vazio">Nenhum cliente encontrado para "{busca}".</p>
              ) : (
                resultados.map((empresa) => (
                  <button
                    key={empresa.id}
                    type="button"
                    role="option"
                    aria-selected={empresa.id === empresaId}
                    className={`conversas-modal-opcao${empresa.id === empresaId ? " selecionada" : ""}`}
                    onClick={() => escolherEmpresa(empresa.id!)}
                  >
                    {empresa.nomeEmpresa}
                  </button>
                ))
              )}
            </div>

            {empresaSelecionada && (
              <>
                <label htmlFor={contatoId} className="conversas-modal-label">Contato</label>
                <select
                  id={contatoId}
                  className="conversas-modal-input"
                  value={contatoEscolhido}
                  onChange={(e) => setContatoEscolhido(e.target.value)}
                >
                  <option value={NOVO_CONTATO}>Novo contato</option>
                  {(empresaSelecionada.contatos ?? []).map((contato, indice) => (
                    <option key={indice} value={String(indice)}>
                      Acrescentar a {contato.nome || `contato ${indice + 1}`}
                    </option>
                  ))}
                </select>
                {contatoEscolhido === NOVO_CONTATO && (
                  <>
                    <label htmlFor={nomeId} className="conversas-modal-label">Nome do contato</label>
                    <input
                      id={nomeId}
                      className="conversas-modal-input"
                      value={nomeNovo}
                      onChange={(e) => {
                        setNomeNovo(e.target.value);
                        setErro("");
                      }}
                      maxLength={80}
                      aria-invalid={!!erro && !nomeNovo.trim()}
                      aria-describedby={erro ? erroId : undefined}
                    />
                  </>
                )}
              </>
            )}
          </>
        )}

        {erro && <p id={erroId} className="conversas-modal-erro" role="alert">{erro}</p>}

        <div className="conversas-modal-acoes">
          <button type="button" className="conversas-botao-secundario" onClick={onFechar} disabled={salvando}>
            Cancelar
          </button>
          <button
            type="button"
            className="conversas-botao-primario"
            onClick={salvar}
            disabled={!empresaSelecionada || !conversa.telefone || salvando}
          >
            {salvando ? "Salvando…" : "Vincular"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
