import { useEffect, useState } from "react";
import { ListChecks, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import "./ChecklistTarefas.css";

interface Tarefa {
  id: string;
  descricao: string;
  concluida: boolean;
}

function chaveStorage(uid: string) {
  return `tarefas_${uid}`;
}

function carregarTarefas(uid: string): Tarefa[] {
  try {
    const bruto = localStorage.getItem(chaveStorage(uid));
    return bruto ? JSON.parse(bruto) : [];
  } catch {
    return [];
  }
}

export default function ChecklistTarefas() {
  const { user } = useAuth();

  const [aberto, setAberto] = useState(false);
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [novaDescricao, setNovaDescricao] = useState("");

  useEffect(() => {
    if (!user) return;
    setTarefas(carregarTarefas(user.uid));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    localStorage.setItem(chaveStorage(user.uid), JSON.stringify(tarefas));
  }, [tarefas, user]);

  function adicionarTarefa() {
    const descricao = novaDescricao.trim();
    if (!descricao) return;

    setTarefas((prev) => [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, descricao, concluida: false },
      ...prev,
    ]);
    setNovaDescricao("");
  }

  function alternarConclusao(id: string) {
    setTarefas((prev) =>
      prev.map((t) => (t.id === id ? { ...t, concluida: !t.concluida } : t)),
    );
  }

  function excluirTarefa(id: string) {
    setTarefas((prev) => prev.filter((t) => t.id !== id));
  }

  if (!user) return null;

  const pendentes = tarefas.filter((t) => !t.concluida);
  const concluidas = tarefas.filter((t) => t.concluida);

  return (
    <div className="checklist-flutuante">
      {aberto && (
        <div className="checklist-flutuante-painel">
          <div className="checklist-flutuante-header">
            <h2>Minhas Tarefas</h2>
            <button
              type="button"
              className="checklist-flutuante-fechar"
              onClick={() => setAberto(false)}
              title="Fechar"
            >
              <X size={16} />
            </button>
          </div>

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

          {tarefas.length === 0 ? (
            <p className="checklist-flutuante-vazio">Nenhuma tarefa por aqui.</p>
          ) : (
            <ul className="checklist-flutuante-lista">
              {pendentes.map((tarefa) => (
                <li key={tarefa.id} className="checklist-flutuante-item">
                  <label>
                    <input
                      type="checkbox"
                      checked={tarefa.concluida}
                      onChange={() => alternarConclusao(tarefa.id)}
                    />
                    <span>{tarefa.descricao}</span>
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
                      onChange={() => alternarConclusao(tarefa.id)}
                    />
                    <span>{tarefa.descricao}</span>
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
