import { useId, useState } from "react";

type Props = {
  /** Temas da esteira que ainda não estão na tabela, como sugestão no campo de nome. */
  sugestoes: string[];
  removidos: { chave: string; nome: string }[];
  salvando?: boolean;
  /** Devolve a mensagem de erro do nome, ou null quando ele pode ser usado. */
  validarNome: (nome: string) => string | null;
  /** Resolve `true` quando o tema foi gravado. */
  onIncluir: (tema: string, dia: string) => Promise<boolean>;
  onRestaurar: (chave: string, nome: string) => void;
};

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Inclusão manual de temas na tabela de aplicação e lista dos temas retirados, com a
 * opção de restaurá-los. Só aparece para quem pode editar (treinador/master).
 */
export function AjustesTemasAplicacao({ sugestoes, removidos, salvando, validarNome, onIncluir, onRestaurar }: Props) {
  const ids = useId();
  const [aberto, setAberto] = useState(false);
  const [tema, setTema] = useState("");
  const [dia, setDia] = useState(hojeISO);
  const [erroTema, setErroTema] = useState<string | null>(null);
  const [erroDia, setErroDia] = useState<string | null>(null);

  const fechar = () => {
    setAberto(false);
    setTema("");
    setDia(hojeISO());
    setErroTema(null);
    setErroDia(null);
  };

  const enviar = async () => {
    const mensagemTema = validarNome(tema);
    const mensagemDia = dia ? null : "Informe a data do treinamento.";
    setErroTema(mensagemTema);
    setErroDia(mensagemDia);
    if (mensagemTema || mensagemDia) return;
    if (await onIncluir(tema, dia)) fechar();
  };

  return (
    <div className="aplicacao-ajustes">
      {!aberto ? (
        <button type="button" className="btn-secondary aplicacao-ajustes-abrir" onClick={() => setAberto(true)}>
          + Incluir tema
        </button>
      ) : (
        <form
          className="aplicacao-ajustes-form"
          aria-label="Incluir tema na tabela"
          onSubmit={(e) => {
            e.preventDefault();
            void enviar();
          }}
        >
          <div className="aplicacao-ajustes-campo aplicacao-ajustes-campo--tema">
            <label htmlFor={`${ids}-tema`}>Tema</label>
            <input
              id={`${ids}-tema`}
              autoFocus
              value={tema}
              maxLength={120}
              list={`${ids}-sugestoes`}
              placeholder="Ex.: Cadastro de Pessoas"
              aria-invalid={!!erroTema}
              aria-describedby={erroTema ? `${ids}-erro-tema` : undefined}
              onChange={(e) => {
                setTema(e.target.value);
                setErroTema(null);
              }}
              onKeyDown={(e) => e.key === "Escape" && fechar()}
            />
            <datalist id={`${ids}-sugestoes`}>
              {sugestoes.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            {erroTema && (
              <span id={`${ids}-erro-tema`} role="alert" className="aplicacao-temas-erro">
                {erroTema}
              </span>
            )}
          </div>

          <div className="aplicacao-ajustes-campo">
            <label htmlFor={`${ids}-dia`}>Data do treinamento</label>
            <input
              id={`${ids}-dia`}
              type="date"
              value={dia}
              aria-invalid={!!erroDia}
              aria-describedby={`${ids}-dica-dia`}
              onChange={(e) => {
                setDia(e.target.value);
                setErroDia(null);
              }}
            />
            <small id={`${ids}-dica-dia`} className={erroDia ? "aplicacao-temas-erro" : undefined} role={erroDia ? "alert" : undefined}>
              {erroDia ??
                (dia > hojeISO()
                  ? "Data futura: o tema fica como previsto até esse dia."
                  : "Entra na linha desse dia (ou abre uma) e já pode ser marcado.")}
            </small>
          </div>

          <div className="aplicacao-ajustes-acoes">
            <button type="submit" className="btn-secondary" disabled={salvando}>
              {salvando ? "Incluindo..." : "Incluir"}
            </button>
            <button type="button" className="btn-small" onClick={fechar}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {removidos.length > 0 && (
        <div className="aplicacao-ajustes-removidos">
          <span>Temas retirados da tabela:</span>
          <ul>
            {removidos.map((r) => (
              <li key={r.chave}>
                {r.nome}
                <button
                  type="button"
                  className="btn-small"
                  disabled={salvando}
                  aria-label={`Restaurar o tema ${r.nome} na tabela`}
                  onClick={() => onRestaurar(r.chave, r.nome)}
                >
                  Restaurar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
