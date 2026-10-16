import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Empresa } from "../../types";

function normalizarBusca(valor: string) {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
}

interface GerarCsatModalProps {
  empresas: Empresa[];
  empresaInicialId?: string;
  gerando: boolean;
  erro: string;
  onGerar: (empresaId: string) => Promise<void>;
  onFechar: () => void;
}

export function GerarCsatModal({
  empresas, empresaInicialId, gerando, erro, onGerar, onFechar,
}: GerarCsatModalProps) {
  const [empresaId, setEmpresaId] = useState(empresaInicialId || "");
  const [busca, setBusca] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buscaRef = useRef<HTMLInputElement>(null);
  const tituloId = useId();
  const descricaoId = useId();
  const clienteId = useId();
  const erroId = useId();
  const empresasOrdenadas = empresas.filter((empresa) => empresa.id)
    .sort((a, b) => a.nomeEmpresa.localeCompare(b.nomeEmpresa, "pt-BR"));
  const termoBusca = normalizarBusca(busca);
  const empresasFiltradas = empresasOrdenadas.filter((empresa) =>
    normalizarBusca(empresa.nomeEmpresa).includes(termoBusca),
  );
  const empresaSelecionada = empresasOrdenadas.find((empresa) => empresa.id === empresaId);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const origem = document.activeElement;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    buscaRef.current?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = overflowAnterior;
      if (origem instanceof HTMLElement && origem.isConnected) origem.focus();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="hist-csat-dialog"
      aria-labelledby={tituloId}
      aria-describedby={descricaoId}
      onCancel={(event) => {
        event.preventDefault();
        if (!gerando) onFechar();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const campos = event.currentTarget.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)");
        const primeiro = campos[0];
        const ultimo = campos[campos.length - 1];
        if (event.shiftKey && document.activeElement === primeiro) {
          event.preventDefault();
          ultimo?.focus();
        } else if (!event.shiftKey && document.activeElement === ultimo) {
          event.preventDefault();
          primeiro?.focus();
        }
      }}
    >
      <form
        aria-busy={gerando}
        onSubmit={(event) => {
          event.preventDefault();
          if (empresaSelecionada?.id && !gerando) void onGerar(empresaSelecionada.id);
        }}
      >
        <h2 id={tituloId}>Gerar link CSAT</h2>
        <p id={descricaoId}>
          Para qual cliente você está gerando o link? Para treinamentos internos, selecione Systemsat.
        </p>
        <label htmlFor={clienteId}>Pesquisar empresa</label>
        <input
          ref={buscaRef}
          id={clienteId}
          className="hist-csat-pesquisa"
          type="search"
          placeholder="Digite o nome da empresa..."
          autoComplete="off"
          value={busca}
          disabled={gerando || empresasOrdenadas.length === 0}
          onChange={(event) => setBusca(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
        />
        <p className="hist-csat-contagem" role="status">
          {empresasFiltradas.length} {empresasFiltradas.length === 1 ? "empresa encontrada" : "empresas encontradas"}
        </p>
        <fieldset className="hist-csat-empresas" disabled={gerando} aria-describedby={erro ? erroId : undefined}>
          <legend>Selecione o cliente</legend>
          <div className="hist-csat-empresas-lista">
            {empresasFiltradas.map((empresa) => (
              <label
                key={empresa.id}
                className={`hist-csat-empresa${empresa.id === empresaId ? " hist-csat-empresa-selecionada" : ""}`}
              >
                <input
                  type="radio"
                  name={`${clienteId}-empresa`}
                  value={empresa.id}
                  checked={empresa.id === empresaId}
                  onChange={(event) => setEmpresaId(event.target.value)}
                />
                <span>{empresa.nomeEmpresa}</span>
              </label>
            ))}
            {empresasFiltradas.length === 0 && (
              <p className="hist-csat-empresas-vazio">
                {empresasOrdenadas.length === 0
                  ? "Nenhum cliente disponível. Feche esta janela e atualize a página para carregar os cadastros."
                  : "Nenhuma empresa encontrada. Tente outro nome ou limpe a pesquisa."}
              </p>
            )}
          </div>
        </fieldset>
        <p className="hist-csat-selecao" aria-live="polite">
          {empresaSelecionada ? <>Cliente selecionado: <strong>{empresaSelecionada.nomeEmpresa}</strong></> : "Selecione uma empresa para gerar o link."}
        </p>
        {erro && <p id={erroId} className="hist-csat-erro" role="alert">{erro}</p>}
        <div className="hist-csat-dialog-acoes">
          <button type="button" className="btn-secondary" disabled={gerando} onClick={onFechar}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={gerando || !empresaSelecionada}>
            {gerando ? "Gerando link..." : "Gerar link"}
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
