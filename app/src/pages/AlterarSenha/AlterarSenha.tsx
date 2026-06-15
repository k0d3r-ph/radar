import React, { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { atualizarSenhaUsuario, registrarSenhaDefinida } from "../../services/auth";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Lock, KeyRound, Eye, EyeOff, CheckCircle, User as UserIcon } from "lucide-react";
import "./AlterarSenha.css";
import { formatarNome } from "../../utils/formatarNome";

const ROLE_DISPLAY: Record<string, string> = {
  suporte: "Suporte",
  hardware: "Hardware",
  comercial: "Comercial/Aplicações",
  financeiro: "Financeiro",
  crc: "CRC",
  treinador: "Treinador",
};

export const AlterarSenha: React.FC = () => {
  const { user, role, setNeedsPasswordChange, setRole, setUserName, logout } = useAuth();
  const [nome, setNome] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const userRole = role || "suporte";

  const handleAlterarSenha = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!nome.trim()) {
      toast.error("Por favor, preencha o seu nome.");
      return;
    }

    if (!novaSenha || !confirmarSenha) {
      toast.error("Por favor, preencha todos os campos.");
      return;
    }

    if (novaSenha.length < 6) {
      toast.error("A senha deve conter pelo menos 6 caracteres.");
      return;
    }

    if (novaSenha !== confirmarSenha) {
      toast.error("As senhas não coincidem.");
      return;
    }

    if (!user) {
      toast.error("Usuário não autenticado.");
      return;
    }

    setLoading(true);
    try {
      // 1. Atualiza a senha no Firebase Auth
      await atualizarSenhaUsuario(user, novaSenha);
      
      const nomeCapitalizado = formatarNome(nome);

      // 2. Cria/atualiza o documento no Firestore para registrar que a senha foi definida, com nome e role
      await registrarSenhaDefinida(user.uid, user.email || "", userRole, nomeCapitalizado);

      // 3. Atualiza o estado no contexto local
      setRole(userRole);
      setUserName(nomeCapitalizado);
      setNeedsPasswordChange(false);

      toast.success("Senha pessoal cadastrada com sucesso!");
      navigate("/home");
    } catch (err: any) {
      console.error(err);
      let errorMsg = "Erro ao cadastrar a nova senha. Tente novamente.";
      if (err.code === "auth/requires-recent-login") {
        errorMsg = "Por razões de segurança, faça login novamente antes de alterar sua senha.";
        await logout();
        navigate("/login");
      }
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="alterar-senha-container">
      <div className="alterar-senha-background-glow"></div>
      <div className="alterar-senha-card">
        <div className="alterar-senha-header">
          <div className="alterar-senha-logo-container">
            <KeyRound className="alterar-senha-logo-icon" size={36} />
          </div>
          <h1>Primeiro Acesso</h1>
          <p>Você entrou com uma senha temporária. Defina sua senha pessoal definitiva para continuar.</p>
        </div>

        <div className="senha-rules">
          <h3>Requisitos de Segurança:</h3>
          <ul>
            <li>
              <CheckCircle size={14} className={novaSenha.length >= 6 ? "rule-check valid" : "rule-check"} />
              Pelo menos 6 caracteres
            </li>
            <li>
              <CheckCircle
                size={14}
                className={novaSenha && novaSenha === confirmarSenha ? "rule-check valid" : "rule-check"}
              />
              As duas senhas devem ser idênticas
            </li>
          </ul>
        </div>

        <form onSubmit={handleAlterarSenha} className="alterar-senha-form">
          <div className="input-group">
            <label htmlFor="nome">Nome Completo</label>
            <div className="input-wrapper">
              <UserIcon className="input-icon" size={20} />
              <input
                id="nome"
                type="text"
                placeholder="Seu nome (ex: Pedro, Clarice)"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
                disabled={loading}
              />
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="perfil">Perfil de Acesso</label>
            <div className="input-wrapper">
              <input
                id="perfil"
                type="text"
                value={ROLE_DISPLAY[userRole] || userRole}
                readOnly
                disabled
                style={{
                  width: "100%",
                  height: "48px",
                  backgroundColor: "rgba(31, 41, 55, 0.3)",
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                  borderRadius: "12px",
                  padding: "0 15px",
                  fontSize: "15px",
                  color: "rgba(255, 255, 255, 0.6)",
                  outline: "none",
                  boxSizing: "border-box",
                  cursor: "not-allowed"
                }}
              />
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="novaSenha">Nova Senha Pessoal</label>
            <div className="input-wrapper">
              <Lock className="input-icon" size={20} />
              <input
                id="novaSenha"
                type={showPassword ? "text" : "password"}
                placeholder="Mínimo de 6 caracteres"
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
                required
                disabled={loading}
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword(!showPassword)}
                disabled={loading}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="confirmarSenha">Confirmar Nova Senha</label>
            <div className="input-wrapper">
              <Lock className="input-icon" size={20} />
              <input
                id="confirmarSenha"
                type={showPassword ? "text" : "password"}
                placeholder="Repita a nova senha"
                value={confirmarSenha}
                onChange={(e) => setConfirmarSenha(e.target.value)}
                required
                disabled={loading}
              />
            </div>
          </div>

          <div className="button-group">
            <button
              type="button"
              className="alterar-senha-cancel-btn"
              onClick={handleCancel}
              disabled={loading}
            >
              Cancelar e Sair
            </button>
            <button type="submit" className="alterar-senha-submit-btn" disabled={loading}>
              {loading ? <div className="spinner"></div> : "Salvar Senha"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
