import { useEffect, useState } from "react";
import { ListChecks, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { listarTarefasChecklist, criarTarefaChecklist, atualizarTarefaChecklist, removerTarefaChecklist } from "../services/checklist";
import { listarUsuarios, type UsuarioDocument } from "../services/auth";
import type { TarefaChecklist } from "../types";
import "./ChecklistTarefas.css";

export default function ChecklistTarefas() {
  const { user, role, userName } = useAuth();

  const [aberto, setAberto] = useState(false);
  const [tarefas, setTarefas] = useState<TarefaChecklist[]>([]);
  const [novaDescricao, setNovaDescricao] = useState("");
  const [trainers, setTrainers] = useState<UsuarioDocument[]>([]);
  const [blocoAtivo, setBlocoAtivo] = useState("");

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

  if (!user) return null;

  const nomeBlocoAtivo =
    blocoAtivo === user.uid ? userName : trainers.find((t) => t.uid === blocoAtivo)?.nome || "";

  async function adicionarTarefa() {
    if (!user) return;
    const descricao = novaDescricao.trim();
    if (!descricao) return;

    const dados = {
      treinadorId: blocoAtivo,
      treinadorNome: nomeBlocoAtivo,
      descricao,
      concluida: false,
      criadoPorId: user.uid,
      criadoPorNome: userName,
      createdAt: Date.now(),
    };

    const id = await criarTarefaChecklist(dados);
    setTarefas((prev) => [{ id, ...dados }, ...prev]);
    setNovaDescricao("");
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

  const tarefasDoBloco = tarefas.filter((t) => t.treinadorId === blocoAtivo);
  const pendentes = tarefasDoBloco.filter((t) => !t.concluida);
  const concluidas = tarefasDoBloco.filter((t) => t.concluida);
  const percentual = tarefasDoBloco.length
    ? Math.round((concluidas.length / tarefasDoBloco.length) * 100)
    : 0;

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

          {tarefasDoBloco.length === 0 ? (
            <p className="checklist-flutuante-vazio">Nenhuma tarefa por aqui.</p>
          ) : (
            <ul className="checklist-flutuante-lista">
              {pendentes.map((tarefa) => (
                <li key={tarefa.id} className="checklist-flutuante-item">
                  <label>
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
                  </label>
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

              {concluidas.map((tarefa) => (
                <li key={tarefa.id} className="checklist-flutuante-item concluida">
                  <label>
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
                  </label>
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
