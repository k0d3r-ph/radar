import { useEffect, useState } from "react";
import { ListChecks, X, Clock, AlarmClockOff } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { listarTarefasChecklist, criarTarefaChecklist, atualizarTarefaChecklist, removerTarefaChecklist } from "../services/checklist";
import { listarUsuarios, type UsuarioDocument } from "../services/auth";
import type { TarefaChecklist } from "../types";
import "./ChecklistTarefas.css";

function formatarDataParaInput(timestamp?: number): string {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatarSla(slaEm: number, agora: number): { texto: string; status: "atrasado" | "urgente" | "proximo" | "normal" } {
  const diff = slaEm - agora;
  const abs = Math.abs(diff);
  const minutos = Math.floor(abs / 60000);
  const horas = Math.floor(minutos / 60);
  const dias = Math.floor(horas / 24);

  let duracao: string;
  if (dias > 0) duracao = `${dias}d ${horas % 24}h`;
  else if (horas > 0) duracao = `${horas}h ${minutos % 60}min`;
  else duracao = `${minutos}min`;

  if (diff < 0) {
    return { texto: `Atrasado há ${duracao}`, status: "atrasado" };
  }
  if (diff <= 2 * 60 * 60 * 1000) {
    return { texto: `Vence em ${duracao}`, status: "urgente" };
  }
  if (diff <= 24 * 60 * 60 * 1000) {
    return { texto: `Vence em ${duracao}`, status: "proximo" };
  }
  return { texto: `Vence em ${duracao}`, status: "normal" };
}

export default function ChecklistTarefas() {
  const { user, role, userName } = useAuth();

  const [aberto, setAberto] = useState(false);
  const [tarefas, setTarefas] = useState<TarefaChecklist[]>([]);
  const [novaDescricao, setNovaDescricao] = useState("");
  const [novaSla, setNovaSla] = useState("");
  const [trainers, setTrainers] = useState<UsuarioDocument[]>([]);
  const [blocoAtivo, setBlocoAtivo] = useState("");
  const [editandoSlaId, setEditandoSlaId] = useState<string | null>(null);
  const [agora, setAgora] = useState(() => Date.now());

  const isMaster = role === "master";

  useEffect(() => {
    if (!user) return;
    setBlocoAtivo(user.uid);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    listarTarefasChecklist(aberto).then(setTarefas);
  }, [user, aberto]);

  useEffect(() => {
    if (!isMaster || !aberto) return;
    listarUsuarios().then((lista) => {
      const apenasTreinadores = lista.filter(
        (u) => u.role === "treinador" || u.role === "master"
      );
      setTrainers(apenasTreinadores);
    });
  }, [isMaster, aberto]);

  useEffect(() => {
    if (!aberto) return;
    setAgora(Date.now());
    const interval = setInterval(() => setAgora(Date.now()), 60000);
    return () => clearInterval(interval);
  }, [aberto]);

  if (!user) return null;

  const nomeBlocoAtivo =
    blocoAtivo === user.uid ? userName : trainers.find((t) => t.uid === blocoAtivo)?.nome || "";

  async function adicionarTarefa() {
    if (!user) return;
    const descricao = novaDescricao.trim();
    if (!descricao) return;

    const dados: Omit<TarefaChecklist, "id"> = {
      treinadorId: blocoAtivo,
      treinadorNome: nomeBlocoAtivo,
      descricao,
      concluida: false,
      criadoPorId: user.uid,
      criadoPorNome: userName,
      createdAt: Date.now(),
      ...(novaSla ? { slaEm: new Date(novaSla).getTime() } : {}),
    };

    const id = await criarTarefaChecklist(dados);
    setTarefas((prev) => [{ id, ...dados }, ...prev]);
    setNovaDescricao("");
    setNovaSla("");
  }

  async function alternarConclusao(tarefa: TarefaChecklist) {
    if (!tarefa.id) return;
    const concluida = !tarefa.concluida;
    await atualizarTarefaChecklist(tarefa.id, { concluida });
    setTarefas((prev) => prev.map((t) => (t.id === tarefa.id ? { ...t, concluida } : t)));
  }

  async function excluirTarefa(id?: string) {
    if (!id) return;
    await removerTarefaChecklist(id);
    setTarefas((prev) => prev.filter((t) => t.id !== id));
  }

  async function salvarSla(id: string, valor: string) {
    const slaEm = valor ? new Date(valor).getTime() : null;
    await atualizarTarefaChecklist(id, { slaEm: slaEm ?? undefined });
    setTarefas((prev) =>
      prev.map((t) => (t.id === id ? { ...t, slaEm: slaEm ?? undefined } : t))
    );
    setEditandoSlaId(null);
  }

  const tarefasDoBloco = tarefas.filter((t) => t.treinadorId === blocoAtivo);
  const pendentes = tarefasDoBloco.filter((t) => !t.concluida);
  const concluidas = tarefasDoBloco.filter((t) => t.concluida);
  const percentual = tarefasDoBloco.length
    ? Math.round((concluidas.length / tarefasDoBloco.length) * 100)
    : 0;

  const pendentesOrdenadas = [...pendentes].sort((a, b) => {
    if (a.slaEm == null && b.slaEm == null) return 0;
    if (a.slaEm == null) return 1;
    if (b.slaEm == null) return -1;
    return a.slaEm - b.slaEm;
  });

  return (
    <div className="checklist-flutuante">
      {aberto && (
        <div className="checklist-flutuante-painel">
          <div className="checklist-flutuante-header">
            <h2>{blocoAtivo === user.uid ? "Minhas Tarefas" : `Tarefas de ${nomeBlocoAtivo}`} · {percentual}%</h2>
            <button
              type="button"
              className="checklist-flutuante-fechar"
              onClick={() => setAberto(false)}
              title="Fechar"
            >
              <X size={16} />
            </button>
          </div>

          <div className="checklist-flutuante-progresso">
            <div
              className="checklist-flutuante-progresso-preenchido"
              style={{ width: `${percentual}%` }}
            />
          </div>

          {isMaster && (
            <select
              className="checklist-flutuante-select"
              value={blocoAtivo}
              onChange={(e) => setBlocoAtivo(e.target.value)}
            >
              <option value={user.uid}>Minhas tarefas</option>
              {trainers
                .filter((t) => t.uid !== user.uid)
                .map((t) => (
                  <option key={t.uid} value={t.uid}>
                    {t.nome}
                  </option>
                ))}
            </select>
          )}

          <div className="checklist-flutuante-form">
            <input
              placeholder="Adicionar nova tarefa..."
              value={novaDescricao}
              onChange={(e) => setNovaDescricao(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") adicionarTarefa();
              }}
              autoFocus
            />
            <button
              type="button"
              className="btn-primary"
              onClick={adicionarTarefa}
              disabled={!novaDescricao.trim()}
            >
              +
            </button>
          </div>

          <div className="checklist-flutuante-sla-form">
            <Clock size={14} className="checklist-flutuante-sla-icon" />
            <input
              type="datetime-local"
              className="checklist-flutuante-sla-input"
              value={novaSla}
              onChange={(e) => setNovaSla(e.target.value)}
              title="Definir SLA (prazo) para a nova tarefa"
            />
            {novaSla && (
              <button
                type="button"
                className="checklist-flutuante-sla-limpar"
                onClick={() => setNovaSla("")}
                title="Remover SLA"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {tarefasDoBloco.length === 0 ? (
            <p className="checklist-flutuante-vazio">Nenhuma tarefa por aqui.</p>
          ) : (
            <ul className="checklist-flutuante-lista">
              {pendentesOrdenadas.map((tarefa) => {
                const sla = tarefa.slaEm ? formatarSla(tarefa.slaEm, agora) : null;
                const editando = editandoSlaId === tarefa.id;
                return (
                  <li key={tarefa.id} className="checklist-flutuante-item">
                    <div className="checklist-flutuante-item-conteudo">
                      <input
                        type="checkbox"
                        checked={tarefa.concluida}
                        onChange={() => alternarConclusao(tarefa)}
                      />
                      <span>
                        {tarefa.descricao}
                        {tarefa.criadoPorId !== tarefa.treinadorId && (
                          <span className="checklist-flutuante-autor">
                            adicionado por {tarefa.criadoPorNome}
                          </span>
                        )}
                        {editando ? (
                          <input
                            type="datetime-local"
                            className="checklist-flutuante-sla-inline-input"
                            autoFocus
                            defaultValue={formatarDataParaInput(tarefa.slaEm)}
                            onBlur={(e) => salvarSla(tarefa.id!, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              if (e.key === "Escape") setEditandoSlaId(null);
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            className={`checklist-flutuante-sla-badge ${sla ? `sla-${sla.status}` : "sla-vazio"}`}
                            onClick={() => setEditandoSlaId(tarefa.id || null)}
                          >
                            {sla ? (
                              sla.texto
                            ) : (
                              <>
                                <AlarmClockOff size={11} /> Definir SLA
                              </>
                            )}
                          </button>
                        )}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="checklist-flutuante-remover"
                      onClick={() => excluirTarefa(tarefa.id)}
                      title="Remover tarefa"
                    >
                      <X size={14} />
                    </button>
                  </li>
                );
              })}

              {concluidas.map((tarefa) => (
                <li key={tarefa.id} className="checklist-flutuante-item concluida">
                  <div className="checklist-flutuante-item-conteudo">
                    <input
                      type="checkbox"
                      checked={tarefa.concluida}
                      onChange={() => alternarConclusao(tarefa)}
                    />
                    <span>
                      {tarefa.descricao}
                      {tarefa.criadoPorId !== tarefa.treinadorId && (
                        <span className="checklist-flutuante-autor">
                          adicionado por {tarefa.criadoPorNome}
                        </span>
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="checklist-flutuante-remover"
                    onClick={() => excluirTarefa(tarefa.id)}
                    title="Remover tarefa"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button
        type="button"
        className="checklist-flutuante-botao"
        onClick={() => setAberto((prev) => !prev)}
        title="Minhas tarefas"
      >
        <ListChecks size={22} />
        {pendentes.length > 0 && (
          <span className="checklist-flutuante-badge">{pendentes.length}</span>
        )}
      </button>
    </div>
  );
}
