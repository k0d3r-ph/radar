import { useEffect, useRef, useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { TEMPLATE_TREINAMENTO } from "../utils/templateTreinamento";

/** Texto em edição no modal, guardado pela página para sobreviver a "Revisar avaliação". */
export type RascunhoConclusao = {
  analise: string;
  impressoes: string;
  /** Marcações usadas na última análise gerada; diferente da atual = análise desatualizada. */
  assinaturaAnalise: string;
};

type Props = {
  tentativa: number;
  empresa: string;
  ocupado: boolean;
  erro: string;
  rascunho: RascunhoConclusao;
  /** Assinatura das marcações atuais (perguntas, respostas parciais e finais). */
  assinaturaAtual: string;
  onRascunho: (rascunho: RascunhoConclusao) => void;
  gerarAnalise: () => Promise<string>;
  onCancelar: () => void;
  onConfirmar: (impressoes: string, analise: string) => Promise<boolean>;
};

const LIMITE = 4000;

export function ImpressaoValidacaoModal({
  tentativa,
  empresa,
  ocupado,
  erro,
  rascunho,
  assinaturaAtual,
  onRascunho,
  gerarAnalise,
  onCancelar,
  onConfirmar,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const montado = useRef(true);
  const [analise, setAnalise] = useState(rascunho.analise);
  const [impressoes, setImpressoes] = useState(rascunho.impressoes);
  const [assinaturaAnalise, setAssinaturaAnalise] = useState(rascunho.assinaturaAnalise);
  const [gerando, setGerando] = useState(false);
  const [erroIa, setErroIa] = useState("");
  const desatualizada = !!analise && assinaturaAnalise !== assinaturaAtual;
  // Evita duas chamadas simultâneas à IA (cliques repetidos ou montagem dupla do StrictMode).
  const gerandoRef = useRef(false);

  async function gerar() {
    if (gerandoRef.current) return;
    gerandoRef.current = true;
    setGerando(true);
    setErroIa("");
    try {
      const texto = await gerarAnalise();
      if (!montado.current) return;
      setAnalise(texto.slice(0, LIMITE));
      setAssinaturaAnalise(assinaturaAtual);
    } catch (e) {
      if (montado.current) setErroIa(e instanceof Error ? e.message : "Não foi possível gerar a análise com IA.");
    } finally {
      gerandoRef.current = false;
      if (montado.current) setGerando(false);
    }
  }
  const gerarAoAbrir = useRef(rascunho.analise ? null : gerar);

  useEffect(() => {
    montado.current = true;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    // Gera automaticamente na primeira abertura; com texto já existente, só avisa se ficou desatualizado.
    void gerarAoAbrir.current?.();
    return () => {
      montado.current = false;
      if (dialog?.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    onRascunho({ analise, impressoes, assinaturaAnalise });
  }, [analise, impressoes, assinaturaAnalise, onRascunho]);

  async function confirmar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ocupado || gerando) return;
    if (await onConfirmar(impressoes.trim(), analise.trim())) {
      dialogRef.current?.close();
      onCancelar();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="validacao-impressao-dialog"
      aria-labelledby="validacao-impressao-titulo"
      onCancel={(event) => {
        event.preventDefault();
        if (!ocupado) onCancelar();
      }}
    >
      <form onSubmit={confirmar}>
        <h2 id="validacao-impressao-titulo">Registrar resultado da validação</h2>
        <p>
          Tentativa {tentativa} · {empresa}. As respostas da avaliação serão
          mantidas; a análise e as impressões abaixo entram na ocorrência de
          validação no Histórico.
        </p>
        {erro && <p className="validacao-impressao-erro" role="alert">{erro}</p>}

        <div className="validacao-analise-cabecalho">
          <label htmlFor="validacao-analise-desempenho">
            Análise do desempenho <span>(gerada com IA a partir da validação parcial e da final · editável)</span>
          </label>
          <button
            type="button"
            className="validacao-template"
            disabled={ocupado || gerando}
            onClick={() => void gerar()}
          >
            <Sparkles size={14} aria-hidden="true" />
            {gerando ? "Gerando análise…" : analise ? "Gerar novamente com IA" : "Gerar análise com IA"}
          </button>
        </div>
        <p role="status" aria-live="polite" className="validacao-analise-status">
          {gerando
            ? "Analisando as marcações da validação parcial e da final…"
            : desatualizada
              ? "As respostas mudaram depois desta análise. Use “Gerar novamente com IA” para atualizá-la."
              : ""}
        </p>
        {erroIa && <p className="validacao-impressao-erro" role="alert">{erroIa}</p>}
        <textarea
          id="validacao-analise-desempenho"
          rows={8}
          maxLength={LIMITE}
          value={analise}
          readOnly={gerando}
          aria-busy={gerando}
          onChange={(event) => setAnalise(event.target.value)}
          disabled={ocupado}
          placeholder={gerando ? "Gerando análise…" : "Gere a análise com IA ou escreva a sua avaliação do desempenho do cliente."}
        />

        <label htmlFor="validacao-impressoes-agenda">
          Impressões da agenda <span>(opcional, texto livre do treinador)</span>
        </label>
        <button
          type="button"
          className="validacao-template"
          disabled={ocupado}
          onClick={() => setImpressoes(TEMPLATE_TREINAMENTO)}
        >
          Usar template de treinamento
        </button>
        <textarea
          id="validacao-impressoes-agenda"
          autoFocus
          rows={6}
          maxLength={LIMITE}
          value={impressoes}
          onChange={(event) => setImpressoes(event.target.value)}
          disabled={ocupado}
          placeholder="Inclua observações adicionais sobre a agenda..."
        />
        <div className="validacao-impressao-acoes">
          <button type="button" disabled={ocupado} onClick={onCancelar}>
            Revisar avaliação
          </button>
          <button type="submit" className="validacao-primario" disabled={ocupado || gerando}>
            {ocupado ? "Concluindo..." : gerando ? "Aguardando análise…" : "Concluir avaliação"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
