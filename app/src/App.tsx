import { Routes, Route, Navigate, NavLink, useNavigate } from "react-router-dom";
import { Esteira } from "./pages/Esteira/Esteira";
import { Historico } from "./pages/Historico/Historico";
import Home from "./pages/Home/Home";
import { Login } from "./pages/Login/Login";
import { AlterarSenha } from "./pages/AlterarSenha/AlterarSenha";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { LogOut } from "lucide-react";
import { Usuarios } from "./pages/Usuarios/Usuarios";

function AppRoutes() {
  const { user, loading, needsPasswordChange, role, logout } = useAuth();
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
          {role === "treinador" && (
            <NavLink
              to="/usuarios"
              className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
            >
              Usuários
            </NavLink>
          )}
        </div>
        <button className="nav-logout-btn" onClick={handleLogout} title="Sair">
          <LogOut size={16} />
          <span>Sair</span>
        </button>
      </nav>

      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/login" element={<Navigate to="/home" replace />} />
        <Route path="/alterar-senha" element={<Navigate to="/home" replace />} />

        <Route path="/esteira" element={<Esteira />} />
        <Route path="/esteira/:id" element={<Esteira />} />

        <Route path="/historico" element={<Historico />} />

        <Route path="/home" element={<Home />} />

        {role === "treinador" ? (
          <Route path="/usuarios" element={<Usuarios />} />
        ) : (
          <Route path="/usuarios" element={<Navigate to="/home" replace />} />
        )}
        
        <Route path="*" element={<Navigate to="/home" replace />} />
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
