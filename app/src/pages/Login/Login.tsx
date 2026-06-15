import React, { useState } from "react";
import { loginComEmail, deslogarUsuario } from "../../services/auth";
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
          <h1>Radar</h1>
          <p>Faça login para visualizar os clientes no radar</p>
        </div>

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

          <button type="submit" className="login-submit-btn" disabled={loading}>
            {loading ? <div className="spinner"></div> : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
};
