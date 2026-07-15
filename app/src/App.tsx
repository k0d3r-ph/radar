import { Routes, Route, Navigate, NavLink, useNavigate } from "react-router-dom";
import { Esteira } from "./pages/Esteira/Esteira";
import { Historico } from "./pages/Historico/Historico";
import Home from "./pages/Home/Home";
import { Login } from "./pages/Login/Login";
import { AlterarSenha } from "./pages/AlterarSenha/AlterarSenha";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { LogOut, Sun, Moon } from "lucide-react";
import { Usuarios } from "./pages/Usuarios/Usuarios";
import { Gamificacao } from "./pages/Gamificacao/Gamificacao";
import { Relatorios } from "./pages/Relatorios/Relatorios";
import { useTheme } from "./context/ThemeContext";
import { WhatsAppSettings } from "./pages/WhatsApp/WhatsAppSettings";
import { Chat } from "./pages/Chat/Chat";


function AppRoutes() {
  const { user, loading, needsPasswordChange, role, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await logout();
      navigate("/login");
    } catch (error) {
      console.error("Erro ao deslogar:", error);
    }
  };

  if (loading) {
    return (
      <div className="global-loader-container">
        <div className="global-spinner"></div>
        <p>Carregando o sistema...</p>
      </div>
    );
  }

  // Se o usuário não está logado
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Se o usuário está logado com senha temporária e precisa alterar
  if (needsPasswordChange) {
    return (
      <Routes>
        <Route path="/alterar-senha" element={<AlterarSenha />} />
        <Route path="*" element={<Navigate to="/alterar-senha" replace />} />
      </Routes>
    );
  }

  // Se o usuário está logado e com a senha pessoal definida
  return (
    <>
      <nav className="app-nav">
        <div className="nav-links">
          {role !== "painel" && (
            <>
              <NavLink
                to="/home"
                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
              >
                Home
              </NavLink>
              <NavLink
                to="/esteira"
                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
              >
                Esteira
              </NavLink>
              <NavLink
                to="/historico"
                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
              >
                Histórico de Ocorrências
              </NavLink>
              <NavLink
                to="/chat"
                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
              >
                Chat WhatsApp
              </NavLink>
            </>
          )}
          {role !== "painel" && (role === "treinador" || role === "master") && (
            <>
              <NavLink
                to="/usuarios"
                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
              >
                Usuários
              </NavLink>
              <NavLink
                to="/gamificacao"
                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
              >
                Gamificação
              </NavLink>
              <NavLink
                to="/whatsapp"
                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
              >
                WhatsApp
              </NavLink>
            </>
          )}
          <NavLink
            to="/relatorios"
            className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
          >
            Relatórios
          </NavLink>
        </div>
        <div className="nav-right-container">
          <button
            className="theme-toggle-btn"
            onClick={toggleTheme}
            title={theme === "light" ? "Alternar para Tema Escuro" : "Alternar para Tema Claro"}
          >
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button className="nav-logout-btn" onClick={handleLogout} title="Sair">
            <LogOut size={16} />
            <span>Sair</span>
          </button>
        </div>
      </nav>

      <Routes>
        <Route path="/" element={<Navigate to={role === "painel" ? "/relatorios" : "/home"} replace />} />
        <Route path="/login" element={<Navigate to={role === "painel" ? "/relatorios" : "/home"} replace />} />
        <Route path="/alterar-senha" element={<Navigate to={role === "painel" ? "/relatorios" : "/home"} replace />} />

        {role !== "painel" ? (
          <>
            <Route path="/esteira" element={<Esteira />} />
            <Route path="/esteira/:id" element={<Esteira />} />
            <Route path="/historico" element={<Historico />} />
            <Route path="/home" element={<Home />} />
            <Route path="/chat" element={<Chat />} />
          </>
        ) : (
          <>
            <Route path="/esteira" element={<Navigate to="/relatorios" replace />} />
            <Route path="/esteira/:id" element={<Navigate to="/relatorios" replace />} />
            <Route path="/historico" element={<Navigate to="/relatorios" replace />} />
            <Route path="/home" element={<Navigate to="/relatorios" replace />} />
            <Route path="/chat" element={<Navigate to="/relatorios" replace />} />
          </>
        )}

        {(role === "treinador" || role === "master") && role !== "painel" ? (
          <Route path="/usuarios" element={<Usuarios />} />
        ) : (
          <Route path="/usuarios" element={<Navigate to={role === "painel" ? "/relatorios" : "/home"} replace />} />
        )}

        {(role === "treinador" || role === "master") && role !== "painel" ? (
          <Route path="/gamificacao" element={<Gamificacao />} />
        ) : (
          <Route path="/gamificacao" element={<Navigate to={role === "painel" ? "/relatorios" : "/home"} replace />} />
        )}

        {(role === "treinador" || role === "master") && role !== "painel" ? (
          <Route path="/whatsapp" element={<WhatsAppSettings />} />
        ) : (
          <Route path="/whatsapp" element={<Navigate to={role === "painel" ? "/relatorios" : "/home"} replace />} />
        )}

        <Route path="/relatorio-score" element={<Navigate to="/relatorios" replace />} />
        <Route path="/relatorios" element={<Relatorios />} />
        
        <Route path="*" element={<Navigate to={role === "painel" ? "/relatorios" : "/home"} replace />} />
      </Routes>
    </>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

export default App;
