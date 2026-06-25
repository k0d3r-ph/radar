import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  UserPlus,
  Trash2,
  Shield,
  Mail,
  KeyRound,
  AlertTriangle,
  UserCheck,
  User,
  Edit2,
} from "lucide-react";
import {
  criarNovoUsuario,
  listarUsuarios,
  removerUsuarioFirestore,
  atualizarRoleUsuario,
} from "../../services/auth";
import type { UsuarioDocument } from "../../services/auth";
import { formatarNome } from "../../utils/formatarNome";
import { useAuth } from "../../context/AuthContext";
import "./Usuarios.css";

const ROLE_DISPLAY: Record<string, string> = {
  suporte: "Suporte",
  hardware: "Hardware",
  comercial: "Comercial/Aplicações",
  financeiro: "Financeiro",
  crc: "CRC",
  treinador: "Treinador",
  cs: "CS",
  master: "Master",
};

export const Usuarios: React.FC = () => {
  const { role: currentUserRole } = useAuth();
  const [users, setUsers] = useState<UsuarioDocument[]>([]);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senhaTemp, setSenhaTemp] = useState("");
  const [role, setRole] = useState("suporte");
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);
  const [confirmarExclusaoUid, setConfirmarExclusaoUid] = useState<string | null>(null);

  // Edit role states
  const [editingUser, setEditingUser] = useState<UsuarioDocument | null>(null);
  const [editingUserRole, setEditingUserRole] = useState("suporte");
  const [savingRole, setSavingRole] = useState(false);

  const carregarUsuarios = async () => {
    try {
      setLoading(true);
      const lista = await listarUsuarios();
      setUsers(lista);
    } catch (error: any) {
      console.error("Erro ao carregar usuários:", error);
      const isPermissionError = error?.code === "permission-denied" || 
                                 String(error).includes("permission-denied") || 
                                 error?.message?.includes("permission-denied");
      
      if (isPermissionError) {
        toast.error("Erro de permissão no Firestore. Certifique-se de que suas regras de segurança (Security Rules) permitem que o Treinador liste a coleção 'usuarios'.");
      } else {
        toast.error(`Erro ao carregar a lista: ${error?.message || error}`);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarUsuarios();
  }, []);

  const handleCadastrar = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!nome.trim() || !email.trim() || !senhaTemp.trim() || !role) {
      toast.error("Preencha todos os campos obrigatórios.");
      return;
    }

    if (role === "master" && currentUserRole !== "master") {
      toast.error("Você não tem permissão para cadastrar um perfil Master.");
      return;
    }

    if (senhaTemp.length < 6) {
      toast.error("A senha temporária deve ter pelo menos 6 caracteres.");
      return;
    }

    setSubmitting(true);
    try {
      await criarNovoUsuario(email.trim(), senhaTemp.trim(), role, nome.trim());
      toast.success("Usuário pré-cadastrado com sucesso!");
      setNome("");
      setEmail("");
      setSenhaTemp("");
      setRole("suporte");
      await carregarUsuarios();
    } catch (error: any) {
      console.error("Erro ao criar usuário:", error);
      let msg = "Erro ao cadastrar usuário.";
      if (error.code === "auth/email-already-in-use") {
        msg = "Este e-mail já está sendo utilizado por outro usuário.";
      } else if (error.code === "auth/invalid-email") {
        msg = "O formato do e-mail é inválido.";
      } else if (error.code === "auth/weak-password") {
        msg = "A senha fornecida é muito fraca.";
      }
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleExcluir = async (uid: string) => {
    setDeletingUid(uid);
    try {
      await removerUsuarioFirestore(uid);
      toast.success("Acesso do usuário excluído com sucesso!");
      setConfirmarExclusaoUid(null);
      await carregarUsuarios();
    } catch (error) {
      console.error("Erro ao excluir usuário:", error);
      toast.error("Erro ao excluir o registro do usuário.");
    } finally {
      setDeletingUid(null);
    }
  };

  const handleConfirmarEdicaoRole = async () => {
    if (!editingUser) return;
    setSavingRole(true);
    try {
      await atualizarRoleUsuario(editingUser.uid, editingUserRole);
      toast.success("Perfil de acesso atualizado com sucesso!");
      setEditingUser(null);
      await carregarUsuarios();
    } catch (error) {
      console.error("Erro ao atualizar perfil:", error);
      toast.error("Erro ao atualizar o perfil de acesso.");
    } finally {
      setSavingRole(false);
    }
  };

  const usuarioParaExcluir = users.find((u) => u.uid === confirmarExclusaoUid);

  return (
    <div className="usuarios-page">
      <div className="usuarios-glow"></div>
      
      <header className="usuarios-header">
        <h1>Gerenciamento de Usuários</h1>
        <p>Cadastre novos membros da equipe e configure seus respectivos perfis de acesso.</p>
      </header>

      <div className="usuarios-grid">
        {/* Formulário de Cadastro */}
        <section className="usuarios-card form-section">
          <h2>
            <UserPlus size={20} className="card-icon" />
            Cadastrar Novo Usuário
          </h2>
          <form onSubmit={handleCadastrar} className="cadastro-form">
            <div className="input-group">
              <label htmlFor="nome">Nome Completo</label>
              <div className="input-wrapper">
                <User className="input-icon" size={18} />
                <input
                  id="nome"
                  type="text"
                  placeholder="Nome do usuário"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  required
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="input-group">
              <label htmlFor="email">E-mail Corporativo</label>
              <div className="input-wrapper">
                <Mail className="input-icon" size={18} />
                <input
                  id="email"
                  type="email"
                  placeholder="exemplo@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="input-group">
              <label htmlFor="senhaTemp">Senha Temporária</label>
              <div className="input-wrapper">
                <KeyRound className="input-icon" size={18} />
                <input
                  id="senhaTemp"
                  type="password"
                  placeholder="Mínimo de 6 caracteres"
                  value={senhaTemp}
                  onChange={(e) => setSenhaTemp(e.target.value)}
                  required
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="input-group">
              <label htmlFor="role">Perfil de Acesso</label>
              <div className="input-wrapper">
                <Shield className="input-icon" size={18} />
                <select
                  id="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  required
                  disabled={submitting}
                >
                  <option value="suporte">Suporte</option>
                  <option value="hardware">Hardware</option>
                  <option value="comercial">Comercial/Aplicações</option>
                  <option value="financeiro">Financeiro</option>
                  <option value="crc">CRC</option>
                  <option value="treinador">Treinador</option>
                  <option value="cs">CS</option>
                  {currentUserRole === "master" && (
                    <option value="master">Master</option>
                  )}
                </select>
              </div>
            </div>

            <button type="submit" className="btn-primary form-submit-btn" disabled={submitting}>
              {submitting ? <div className="spinner"></div> : "Criar Usuário"}
            </button>
          </form>
        </section>

        {/* Lista de Usuários */}
        <section className="usuarios-card list-section">
          <h2>
            <UserCheck size={20} className="card-icon" />
            Usuários Cadastrados
          </h2>

          {loading ? (
            <div className="list-loader">
              <div className="spinner"></div>
              <p>Carregando usuários...</p>
            </div>
          ) : users.length === 0 ? (
            <p className="no-data-msg">Nenhum usuário cadastrado.</p>
          ) : (
            <div className="table-responsive">
              <table className="usuarios-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>E-mail</th>
                    <th>Perfil</th>
                    <th>Status</th>
                    <th className="action-col">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.uid}>
                      <td className="nome-cell">{formatarNome(u.nome) || "—"}</td>
                      <td className="email-cell">{u.email}</td>
                      <td>
                        <span className={`role-tag role-${u.role}`}>
                          {ROLE_DISPLAY[u.role] || u.role}
                        </span>
                      </td>
                      <td>
                        <span className={`status-badge ${u.needsPasswordChange ? "status-pending" : "status-active"}`}>
                          {u.needsPasswordChange ? "Primeiro Acesso Pendente" : "Ativo"}
                        </span>
                      </td>
                      <td className="action-col">
                        {currentUserRole === "master" && (
                          <button
                            className="btn-edit-user"
                            onClick={() => {
                              setEditingUser(u);
                              setEditingUserRole(u.role);
                            }}
                            title="Editar Perfil"
                            style={{ marginRight: "8px" }}
                          >
                            <Edit2 size={16} />
                          </button>
                        )}
                        <button
                          className="btn-delete-user"
                          onClick={() => setConfirmarExclusaoUid(u.uid)}
                          title="Excluir Usuário"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Modal de Confirmação de Exclusão */}
      {confirmarExclusaoUid && usuarioParaExcluir && (
        <div className="confirm-overlay" onClick={() => setConfirmarExclusaoUid(null)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-modal-header">
              <AlertTriangle className="confirm-modal-icon warning" size={24} />
              <h2>Confirmar Exclusão</h2>
            </div>
            <p className="confirm-modal-text">
              Deseja realmente remover o acesso de <strong>{formatarNome(usuarioParaExcluir.nome) || usuarioParaExcluir.email}</strong>? 
              Ele perderá o acesso a esta plataforma imediatamente.
            </p>
            <div className="confirm-modal-actions">
              <button
                className="btn-excluir-confirm"
                onClick={() => handleExcluir(usuarioParaExcluir.uid)}
                disabled={deletingUid !== null}
              >
                {deletingUid ? <div className="spinner"></div> : "Sim, excluir"}
              </button>
              <button
                className="btn-cancelar-confirm"
                onClick={() => setConfirmarExclusaoUid(null)}
                disabled={deletingUid !== null}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Edição de Perfil */}
      {editingUser && (
        <div className="confirm-overlay" onClick={() => setEditingUser(null)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-modal-header">
              <Shield className="confirm-modal-icon" size={24} style={{ color: "#818cf8" }} />
              <h2>Editar Perfil de Acesso</h2>
            </div>
            <p className="confirm-modal-text">
              Selecione o novo perfil para o usuário <strong>{formatarNome(editingUser.nome) || editingUser.email}</strong>:
            </p>
            <div className="input-group" style={{ marginTop: "10px" }}>
              <div className="input-wrapper">
                <Shield className="input-icon" size={18} />
                <select
                  value={editingUserRole}
                  onChange={(e) => setEditingUserRole(e.target.value)}
                  className="role-edit-select"
                  style={{ width: "100%", paddingLeft: "45px" }}
                >
                  <option value="suporte">Suporte</option>
                  <option value="hardware">Hardware</option>
                  <option value="comercial">Comercial/Aplicações</option>
                  <option value="financeiro">Financeiro</option>
                  <option value="crc">CRC</option>
                  <option value="treinador">Treinador</option>
                  <option value="cs">CS</option>
                  <option value="master">Master</option>
                </select>
              </div>
            </div>
            <div className="confirm-modal-actions">
              <button
                className="btn-salvar-confirm"
                onClick={handleConfirmarEdicaoRole}
                disabled={savingRole}
                style={{ background: "#6366f1", color: "white", border: "1px solid #6366f1" }}
              >
                {savingRole ? <div className="spinner"></div> : "Salvar"}
              </button>
              <button
                className="btn-cancelar-confirm"
                onClick={() => setEditingUser(null)}
                disabled={savingRole}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
