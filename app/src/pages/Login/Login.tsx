import React, { useState } from "react";
import { loginComEmail, deslogarUsuario, enviarEmailRedefinicaoSenha } from "../../services/auth";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Mail, Lock, Eye, EyeOff, ShieldAlert } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../services/firebase";
import "./Login.css";

export const Login: React.FC = () => {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  // Estados para redefinição de senha
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [sendingReset, setSendingReset] = useState(false);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!resetEmail.trim()) {
      toast.error("Por favor, informe seu e-mail.");
      return;
    }

    setSendingReset(true);
    try {
      await enviarEmailRedefinicaoSenha(resetEmail.trim());
      toast.success("E-mail de redefinição enviado! Verifique sua caixa de entrada.");
      setIsForgotPassword(false);
      setResetEmail("");
    } catch (err: any) {
      console.error(err);
      let errorMsg = "Erro ao enviar e-mail de redefinição. Tente novamente.";
      if (
        err.code === "auth/user-not-found" ||
        err.code === "auth/invalid-email"
      ) {
        errorMsg = "Não encontramos nenhuma conta com esse e-mail.";
      }
      toast.error(errorMsg);
    } finally {
      setSendingReset(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !senha) {
      toast.error("Por favor, preencha todos os campos.");
      return;
    }

    setLoading(true);
    try {
      const user = await loginComEmail(email, senha);

      // Verifica se o documento do usuário existe no Firestore
      const userDocRef = doc(db, "usuarios", user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        await deslogarUsuario();
        return;
      }

      if (userDoc.data()?.inativo) {
        await deslogarUsuario();
        toast.error("Esta conta foi desativada. Fale com um administrador do Radar.");
        return;
      }

      toast.success("Login efetuado com sucesso!");
      navigate("/home");
    } catch (err: any) {
      console.error(err);
      let errorMsg = "Erro ao realizar o login. Tente novamente.";
      if (
        err.code === "auth/invalid-credential" ||
        err.code === "auth/wrong-password" ||
        err.code === "auth/user-not-found"
      ) {
        errorMsg = "E-mail ou senha incorretos.";
      } else if (err.code === "auth/invalid-email") {
        errorMsg = "O e-mail inserido é inválido.";
      } else if (err.code === "auth/too-many-requests") {
        errorMsg = "Acesso temporariamente bloqueado por excesso de tentativas.";
      }
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-background-glow"></div>
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo-container">
            <img src="/radar_crm_favicon.svg" />
          </div>
          <h1>{isForgotPassword ? "Recuperar Senha" : "Radar"}</h1>
          <p>
            {isForgotPassword
              ? "Digite seu e-mail para receber o link de redefinição"
              : "Faça login para visualizar os clientes no radar"}
          </p>
        </div>

        {isForgotPassword ? (
          <form onSubmit={handleResetPassword} className="login-form">
            <div className="input-group">
              <label htmlFor="reset-email">E-mail</label>
              <div className="input-wrapper">
                <Mail className="input-icon" size={20} />
                <input
                  id="reset-email"
                  type="email"
                  placeholder="exemplo@empresa.com"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  required
                  disabled={sendingReset}
                />
              </div>
            </div>

            <button type="submit" className="login-submit-btn" disabled={sendingReset}>
              {sendingReset ? <div className="spinner"></div> : "Enviar E-mail"}
            </button>

            <button
              type="button"
              className="login-back-btn"
              onClick={() => setIsForgotPassword(false)}
              disabled={sendingReset}
            >
              Voltar ao Login
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="login-form">
            <div className="input-group">
              <label htmlFor="email">E-mail</label>
              <div className="input-wrapper">
                <Mail className="input-icon" size={20} />
                <input
                  id="email"
                  type="email"
                  placeholder="exemplo@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
            </div>

            <div className="input-group">
              <label htmlFor="password">Senha</label>
              <div className="input-wrapper">
                <Lock className="input-icon" size={20} />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Sua senha"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
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

            <div className="forgot-password-container">
              <button
                type="button"
                className="forgot-password-link"
                onClick={() => setIsForgotPassword(true)}
                disabled={loading}
              >
                Esqueceu sua senha?
              </button>
            </div>

            <button type="submit" className="login-submit-btn" disabled={loading}>
              {loading ? <div className="spinner"></div> : "Entrar"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
