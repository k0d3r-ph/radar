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
  Phone,
  Briefcase,
} from "lucide-react";
import {
  criarNovoUsuario,
  listarUsuarios,
  removerUsuarioFirestore,
  atualizarRoleUsuario,
  atualizarDadosUsuario,
} from "../../services/auth";
import type { UsuarioDocument, CargoCsUsuario } from "../../services/auth";
import { formatarNome } from "../../utils/formatarNome";
import { useAuth } from "../../context/AuthContext";
import { listarLancamentosPontos, reassociarPontosTreinador } from "../../services/gamificacao";
import "./Usuarios.css";

const ROLE_DISPLAY: Record<string, string> = {
  suporte: "Suporte",
  hardware: "Hardware",
  comercial: "Comercial/Aplicações",
  financeiro: "Financeiro",
  treinador: "Treinador",
  cs: "CS",
  painel: "Painel",
  master: "Master",
};

const CARGO_DISPLAY: Record<string, string> = {
  supervisor: "Supervisor",
  analista: "Analista",
  comercial: "Comercial",
  "": "—",
};

export const Usuarios: React.FC = () => {
  const { role: currentUserRole } = useAuth();
  const [users, setUsers] = useState<UsuarioDocument[]>([]);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senhaTemp, setSenhaTemp] = useState("");
  const [role, setRole] = useState("suporte");
  const [cargo, setCargo] = useState<CargoCsUsuario>("");
  const [telefone, setTelefone] = useState("");
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);
  const [confirmarExclusaoUid, setConfirmarExclusaoUid] = useState<string | null>(null);

  // Edit role states
  const [editingUser, setEditingUser] = useState<UsuarioDocument | null>(null);
  const [editingUserRole, setEditingUserRole] = useState("suporte");
  const [editingUserCargo, setEditingUserCargo] = useState<CargoCsUsuario>("");
  const [editingUserTelefone, setEditingUserTelefone] = useState("");
  const [savingRole, setSavingRole] = useState(false);

  // Estados para reconsolidação de pontos da gamificação
  const [selectedOrphanId, setSelectedOrphanId] = useState("");
  const [selectedNewUserUid, setSelectedNewUserUid] = useState("");
  const [orphanedTrainers, setOrphanedTrainers] = useState<{ id: string; nome: string; count: number; totalPoints: number }[]>([]);
  const [isConsolidating, setIsConsolidating] = useState(false);

  const carregarOrfaos = async (listaUsuarios: UsuarioDocument[]) => {
    if (currentUserRole !== "master") return;
    try {
      const todosPontos = await listarLancamentosPontos();
      const uidsExistentes = new Set(listaUsuarios.map(u => u.uid));
      
      const orfaosMap: Record<string, { nome: string; count: number; totalPoints: number }> = {};
      
      todosPontos.forEach(p => {
        if (p.treinadorId && !uidsExistentes.has(p.treinadorId)) {
          if (!orfaosMap[p.treinadorId]) {
            orfaosMap[p.treinadorId] = {
              nome: p.treinadorNome || "Sem nome",
              count: 0,
              totalPoints: 0
            };
          }
          orfaosMap[p.treinadorId].count++;
          orfaosMap[p.treinadorId].totalPoints += p.pontos || 0;
        }
      });
      
      const orfaosLista = Object.entries(orfaosMap).map(([id, info]) => ({
        id,
        nome: info.nome,
        count: info.count,
        totalPoints: info.totalPoints
      }));
      
      setOrphanedTrainers(orfaosLista);
    } catch (error) {
      console.error("Erro ao carregar pontos órfãos da gamificação:", error);
    }
  };

  const handleConsolidarPontos = async () => {
    if (!selectedOrphanId || !selectedNewUserUid) {
      toast.error("Por favor, selecione os dois campos.");
      return;
    }

    const newUser = users.find(u => u.uid === selectedNewUserUid);
    if (!newUser) {
      toast.error("Novo usuário selecionado não encontrado.");
      return;
    }

    const confirmResult = window.confirm(
      `Deseja realmente transferir todos os pontos históricos do ID antigo para o usuário ${newUser.nome}?`
    );
    if (!confirmResult) return;

    setIsConsolidating(true);
    try {
      const qteAtualizada = await reassociarPontosTreinador(
        selectedOrphanId,
        newUser.uid,
        newUser.nome
      );
      toast.success(`${qteAtualizada} lançamentos de pontos foram consolidados com sucesso para o usuário ${newUser.nome}!`);
      
      setSelectedOrphanId("");
      setSelectedNewUserUid("");
      
      await carregarUsuarios();
    } catch (error: any) {
      console.error("Erro ao reconsolidar pontos:", error);
      toast.error(`Erro ao consolidar: ${error.message || error}`);
    } finally {
      setIsConsolidating(false);
    }
  };

  const carregarUsuarios = async () => {
    try {
      setLoading(true);
      const lista = await listarUsuarios();
      
      // Migrate users with role "crc" to "cs"
      const crcUsers = lista.filter(u => u.role === "crc");
      if (crcUsers.length > 0) {
        toast.info(`Migrando ${crcUsers.length} usuário(s) do perfil CRC para o perfil CS...`);
        for (const user of crcUsers) {
          await atualizarRoleUsuario(user.uid, "cs");
        }
        const listaAtualizada = await listarUsuarios();
        setUsers(listaAtualizada);
        await carregarOrfaos(listaAtualizada);
      } else {
        setUsers(lista);
        await carregarOrfaos(lista);
      }
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
      // Retrieve the new user's uid to store cargo/telefone
      const lista = await listarUsuarios(true);
      const novoUsuario = lista.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
      if (novoUsuario && (cargo || telefone.trim())) {
        await atualizarDadosUsuario(novoUsuario.uid, {
          cargo: cargo || undefined,
          telefone: telefone.trim() || undefined,
        });
      }
      toast.success("Usuário pré-cadastrado com sucesso!");
      setNome("");
      setEmail("");
      setSenhaTemp("");
      setRole("suporte");
      setCargo("");
      setTelefone("");
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
      await atualizarDadosUsuario(editingUser.uid, {
        cargo: editingUserCargo || undefined,
        telefone: editingUserTelefone.trim() || undefined,
      });
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
                  <option value="treinador">Treinador</option>
                  <option value="cs">CS</option>
                  <option value="painel">Painel</option>
                  {currentUserRole === "master" && (
                    <option value="master">Master</option>
                  )}
                </select>
              </div>
            </div>

            <div className="input-group">
              <label htmlFor="cargo">Cargo (Opcional)</label>
              <div className="input-wrapper">
                <Briefcase className="input-icon" size={18} />
                <select
                  id="cargo"
                  value={cargo}
                  onChange={(e) => setCargo(e.target.value as CargoCsUsuario)}
                  disabled={submitting}
                >
                  <option value="">— Nenhum —</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="analista">Analista</option>
                  <option value="comercial">Comercial</option>
                </select>
              </div>
            </div>

            <div className="input-group">
              <label htmlFor="telefone-usuario">Telefone WhatsApp (Opcional)</label>
              <div className="input-wrapper">
                <Phone className="input-icon" size={18} />
                <input
                  id="telefone-usuario"
                  type="tel"
                  placeholder="Ex: 5511999999999"
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                  disabled={submitting}
                />
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
                    <th>Cargo</th>
                    <th>Telefone WA</th>
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
                        {u.cargo ? (
                          <span className={`role-tag role-cs`} style={{ fontSize: "11px" }}>
                            {CARGO_DISPLAY[u.cargo] || u.cargo}
                          </span>
                        ) : (
                          <span style={{ color: "#64748b", fontSize: "12px" }}>—</span>
                        )}
                      </td>
                      <td style={{ fontSize: "12px", color: u.telefone ? "#a5b4fc" : "#64748b" }}>
                        {u.telefone || "—"}
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
                              setEditingUserCargo((u.cargo || "") as CargoCsUsuario);
                              setEditingUserTelefone(u.telefone || "");
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
      {/* Ferramenta de Administrador para Consolidação de Pontos */}
      {currentUserRole === "master" && (
        <section className="usuarios-card admin-tool-section" style={{ marginTop: "24px" }}>
          <h2>
            <KeyRound size={22} className="card-icon" /> 
            Consolidação de Pontos (Gamificação)
          </h2>
          <p className="admin-tool-description" style={{ color: "#9ca3af", fontSize: "14px", marginBottom: "20px", lineHeight: "1.5" }}>
            Se você excluiu um usuário e o cadastrou novamente, os pontos históricos dele continuam vinculados ao ID de usuário antigo.
            Use esta ferramenta para reassociar todos os lançamentos de pontos desse ID antigo para a nova conta do usuário.
          </p>
          
          <div className="admin-tool-grid">
            <div className="input-group">
              <label style={{ fontSize: "13px", fontWeight: "600", color: "#d1d5db" }}>Selecione os Lançamentos Órfãos (ID Antigo)</label>
              <div className="input-wrapper" style={{ marginTop: "8px" }}>
                <Shield className="input-icon" size={18} />
                <select
                  value={selectedOrphanId}
                  onChange={(e) => setSelectedOrphanId(e.target.value)}
                  className="role-edit-select"
                  style={{ width: "100%", paddingLeft: "45px", height: "48px", borderRadius: "12px", background: "rgba(31, 41, 55, 0.5)", border: "1px solid rgba(255, 255, 255, 0.1)", color: "white" }}
                >
                  <option value="">-- Selecione o ID Antigo --</option>
                  {orphanedTrainers.length === 0 ? (
                    <option value="" disabled>Nenhum ponto órfão encontrado</option>
                  ) : (
                    orphanedTrainers.map((orphan) => (
                      <option key={orphan.id} value={orphan.id}>
                        {orphan.nome} ({orphan.totalPoints} pts / {orphan.count} lançamentos)
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>
            
            <div className="input-group">
              <label style={{ fontSize: "13px", fontWeight: "600", color: "#d1d5db" }}>Selecione o Novo Cadastro (Usuário Atual)</label>
              <div className="input-wrapper" style={{ marginTop: "8px" }}>
                <UserCheck className="input-icon" size={18} />
                <select
                  value={selectedNewUserUid}
                  onChange={(e) => setSelectedNewUserUid(e.target.value)}
                  className="role-edit-select"
                  style={{ width: "100%", paddingLeft: "45px", height: "48px", borderRadius: "12px", background: "rgba(31, 41, 55, 0.5)", border: "1px solid rgba(255, 255, 255, 0.1)", color: "white" }}
                >
                  <option value="">-- Selecione o Usuário Atual --</option>
                  {users.map((u) => (
                    <option key={u.uid} value={u.uid}>
                      {u.nome} ({u.email})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          
          <button
            onClick={handleConsolidarPontos}
            disabled={isConsolidating || !selectedOrphanId || !selectedNewUserUid}
            className="btn-salvar-confirm"
            style={{
              background: "#10b981",
              color: "white",
              border: "none",
              borderRadius: "12px",
              padding: "12px 24px",
              fontWeight: "600",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              boxShadow: "0 4px 12px rgba(16, 185, 129, 0.2)",
              marginTop: "16px"
            }}
          >
            {isConsolidating ? <div className="spinner"></div> : "Reconsolidar Pontos"}
          </button>
        </section>
      )}

      {editingUser && (
        <div className="confirm-overlay" onClick={() => setEditingUser(null)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-modal-header">
              <Shield className="confirm-modal-icon" size={24} style={{ color: "#818cf8" }} />
              <h2>Editar Perfil e Dados</h2>
            </div>
            <p className="confirm-modal-text">
              Edite os dados do usuário <strong>{formatarNome(editingUser.nome) || editingUser.email}</strong>:
            </p>
            <div className="input-group" style={{ marginTop: "10px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, color: "#9ca3af", marginBottom: "6px", display: "block" }}>Perfil de Acesso</label>
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
                  <option value="treinador">Treinador</option>
                  <option value="cs">CS</option>
                  <option value="painel">Painel</option>
                  <option value="master">Master</option>
                </select>
              </div>
            </div>
            <div className="input-group" style={{ marginTop: "12px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, color: "#9ca3af", marginBottom: "6px", display: "block" }}>Cargo</label>
              <div className="input-wrapper">
                <Briefcase className="input-icon" size={18} />
                <select
                  value={editingUserCargo}
                  onChange={(e) => setEditingUserCargo(e.target.value as CargoCsUsuario)}
                  className="role-edit-select"
                  style={{ width: "100%", paddingLeft: "45px" }}
                >
                  <option value="">— Nenhum —</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="analista">Analista</option>
                  <option value="comercial">Comercial</option>
                </select>
              </div>
            </div>
            <div className="input-group" style={{ marginTop: "12px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, color: "#9ca3af", marginBottom: "6px", display: "block" }}>Telefone WhatsApp</label>
              <div className="input-wrapper">
                <Phone className="input-icon" size={18} />
                <input
                  type="tel"
                  placeholder="Ex: 5511999999999"
                  value={editingUserTelefone}
                  onChange={(e) => setEditingUserTelefone(e.target.value)}
                  className="role-edit-select"
                  style={{ width: "100%", paddingLeft: "45px" }}
                />
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
