import { useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, Navigate, NavLink, Link, useLocation, useNavigate } from "react-router-dom";
import { Esteira } from "./pages/Esteira/Esteira";
import { Historico } from "./pages/Historico/Historico";
import Home from "./pages/Home/Home";
import { Login } from "./pages/Login/Login";
import { Csat } from "./pages/Csat/Csat";
import { AlterarSenha } from "./pages/AlterarSenha/AlterarSenha";
import { AuthProvider, useAuth } from "./context/AuthContext";
import {
  BarChart3,
  BookOpenCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  History as HistoryIcon,
  Home as HomeIcon,
  Layers,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  Sun,
  Tags,
  Trophy,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { Usuarios } from "./pages/Usuarios/Usuarios";
import { Gamificacao } from "./pages/Gamificacao/Gamificacao";
import { Relatorios } from "./pages/Relatorios/Relatorios";
import { useTheme } from "./context/ThemeContext";
import { WhatsAppSettings } from "./pages/WhatsApp/WhatsAppSettings";
import { TiposOcorrencia } from "./pages/TiposOcorrencia/TiposOcorrencia";
import ChecklistTarefas from "./components/ChecklistTarefas";
import { useVerificaVersao } from "./utils/useVerificaVersao";
import { ValidacaoConhecimento } from "./pages/ValidacaoConhecimento/ValidacaoConhecimento";
import { RelatorioIndicadoresTreinamento } from "./pages/RelatorioIndicadoresTreinamento/RelatorioIndicadoresTreinamento";
import { PerfilUsuarioModal } from "./components/PerfilUsuarioModal";
import { obterFotoPerfil } from "./services/profilePhotos";
import { toast } from "sonner";
import { obterAbasRelatorio } from "./utils/relatoriosAbas";

function AppRoutes() {
  const { user, loading, needsPasswordChange, role, logout, userName } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [modalPerfilAberto, setModalPerfilAberto] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const [menuRecolhido, setMenuRecolhido] = useState(false);
  const [relatoriosSubmenuAberto, setRelatoriosSubmenuAberto] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuCloseRef = useRef<HTMLButtonElement>(null);
  const menuContainerRef = useRef<HTMLElement>(null);

  // Abas de Relatórios disponíveis para o perfil — mesma lista usada dentro da página
  // (ver Relatorios.tsx), para o submenu abaixo sempre bater com o que o usuário vai
  // encontrar lá. Sem personalização de ordem/visibilidade: todas aparecem.
  const abasRelatorio = useMemo(() => obterAbasRelatorio(role), [role]);
  const abaRelatorioAtiva = location.pathname === "/relatorios"
    ? new URLSearchParams(location.search).get("aba")
    : null;
  const [fotoPerfilCarregada, setFotoPerfilCarregada] = useState<{
    uid: string;
    url: string | null;
  } | null>(null);
  const fotoPerfil =
    user && fotoPerfilCarregada?.uid === user.uid
      ? fotoPerfilCarregada.url
      : null;

  function fecharMenu() {
    const devolverFocoAoMenu = menuAberto;
    setMenuAberto(false);
    if (devolverFocoAoMenu) {
      requestAnimationFrame(() => menuTriggerRef.current?.focus());
    }
  }

  useEffect(() => {
    if (menuAberto) menuCloseRef.current?.focus();
  }, [menuAberto]);

  useEffect(() => {
    if (!menuAberto) return;
    function controlarMenu(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuAberto(false);
        requestAnimationFrame(() => menuTriggerRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const itensFocaveis = menuContainerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled)',
      );
      if (!itensFocaveis?.length) return;
      const primeiro = itensFocaveis[0];
      const ultimo = itensFocaveis[itensFocaveis.length - 1];
      if (event.shiftKey && document.activeElement === primeiro) {
        event.preventDefault();
        ultimo.focus();
      } else if (!event.shiftKey && document.activeElement === ultimo) {
        event.preventDefault();
        primeiro.focus();
      }
    }
    document.addEventListener("keydown", controlarMenu);
    return () => document.removeEventListener("keydown", controlarMenu);
  }, [menuAberto]);

  useEffect(() => {
    if (!user?.uid) return;
    let ativo = true;
    obterFotoPerfil(user.uid)
      .then((url) => {
        if (ativo) setFotoPerfilCarregada({ uid: user.uid, url });
      })
      .catch((error) => {
        console.error("Erro ao carregar foto do perfil:", error);
        if (ativo) toast.error("Não foi possível carregar sua foto de perfil.");
      });
    return () => { ativo = false; };
  }, [user?.uid]);

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

  // Tela isolada para TV/monitor: sem menu, sem chrome do app, numa aba/janela própria.
  // Evita depender da Fullscreen API do "modo foco" (que alguns programas de alt+tab
  // encerram) — a própria aba, maximizada, já cumpre o papel de tela dedicada.
  if (location.pathname === "/indicadores-treinamento-tv") {
    return (
      <div className="indicadores-treinamento-container--tv">
        <RelatorioIndicadoresTreinamento modoTv />
      </div>
    );
  }

  // Se o usuário está logado e com a senha pessoal definida
  return (
    <div className={`app-shell-layout${menuRecolhido ? " app-shell-layout--collapsed" : ""}`}>
      <button
        type="button"
        className={`app-nav-backdrop${menuAberto ? " is-open" : ""}`}
        aria-label="Fechar menu"
        aria-hidden={!menuAberto}
        tabIndex={-1}
        onClick={fecharMenu}
      />
      <aside
        id="app-navigation"
        ref={menuContainerRef}
        role={menuAberto ? "dialog" : undefined}
        aria-modal={menuAberto || undefined}
        className={`app-nav${menuAberto ? " app-nav--open" : ""}`}
        aria-label="Menu principal"
      >
        <div className="app-nav-heading">
          <img
            className="app-nav-brand-mark"
            src="/radar_crm_favicon.svg"
            alt=""
          />
          <span className="app-nav-brand">Radar</span>
          <button
            type="button"
            className="app-nav-collapse"
            onClick={() => setMenuRecolhido((recolhido) => !recolhido)}
            aria-label={menuRecolhido ? "Expandir menu lateral" : "Recolher menu lateral"}
            aria-expanded={!menuRecolhido}
            title={menuRecolhido ? "Expandir menu" : "Recolher menu"}
          >
            {menuRecolhido ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
          <button
            ref={menuCloseRef}
            type="button"
            className="app-nav-close"
            onClick={fecharMenu}
            aria-label="Fechar menu"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="nav-links" aria-label="Navegação principal">
          {role !== "painel" && (
            <>
              <NavLink
                to="/home"
                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
                onClick={fecharMenu}
                aria-label="Home"
                title="Home"
              >
                <HomeIcon className="nav-link-icon" size={18} aria-hidden="true" />
                <span className="nav-link-label">Home</span>
              </NavLink>
              <NavLink
                to="/esteira"
                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
                onClick={fecharMenu}
                aria-label="Esteira"
                title="Esteira"
              >
                <Layers className="nav-link-icon" size={18} aria-hidden="true" />
                <span className="nav-link-label">Esteira</span>
              </NavLink>
              <NavLink
                to="/historico"
                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
                onClick={fecharMenu}
                aria-label="Histórico de Ocorrências"
                title="Histórico de Ocorrências"
              >
                <HistoryIcon className="nav-link-icon" size={18} aria-hidden="true" />
                <span className="nav-link-label">Histórico de Ocorrências</span>
              </NavLink>
            </>
          )}
          {role !== "painel" && (role === "treinador" || role === "master") && (
            <>
              <NavLink
                to="/usuarios"
                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
                onClick={fecharMenu}
                aria-label="Usuários"
                title="Usuários"
              >
                <Users className="nav-link-icon" size={18} aria-hidden="true" />
                <span className="nav-link-label">Usuários</span>
              </NavLink>
              <NavLink
                to="/gamificacao"
                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
                onClick={fecharMenu}
                aria-label="Gamificação"
                title="Gamificação"
              >
                <Trophy className="nav-link-icon" size={18} aria-hidden="true" />
                <span className="nav-link-label">Gamificação</span>
              </NavLink>
              <NavLink
                to="/validacao-conhecimento"
                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
                onClick={fecharMenu}
                aria-label="Validação do conhecimento"
                title="Validação do conhecimento"
              >
                <BookOpenCheck className="nav-link-icon" size={18} aria-hidden="true" />
                <span className="nav-link-label">Validação do conhecimento</span>
              </NavLink>
              <NavLink
                to="/whatsapp"
                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
                onClick={fecharMenu}
                aria-label="WhatsApp"
                title="WhatsApp"
              >
                <MessageCircle className="nav-link-icon" size={18} aria-hidden="true" />
                <span className="nav-link-label">WhatsApp</span>
              </NavLink>
            </>
          )}
          {role === "master" && (
            <NavLink
              to="/tipos-ocorrencia"
              className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
              onClick={fecharMenu}
              aria-label="Tabulações"
              title="Tabulações"
            >
              <Tags className="nav-link-icon" size={18} aria-hidden="true" />
              <span className="nav-link-label">Tabulações</span>
            </NavLink>
          )}
          {abasRelatorio.length > 1 ? (
            <div className="nav-relatorios-group">
              <button
                type="button"
                className={"nav-link nav-link-toggle" + (location.pathname === "/relatorios" ? " active" : "")}
                aria-expanded={relatoriosSubmenuAberto}
                aria-controls="nav-relatorios-submenu"
                aria-label="Relatórios"
                title="Relatórios"
                onClick={() => setRelatoriosSubmenuAberto((aberto) => !aberto)}
              >
                <BarChart3 className="nav-link-icon" size={18} aria-hidden="true" />
                <span className="nav-link-label">Relatórios</span>
                <ChevronDown
                  className={"nav-link-chevron" + (relatoriosSubmenuAberto ? " nav-link-chevron--aberto" : "")}
                  size={14}
                  aria-hidden="true"
                />
              </button>
              {relatoriosSubmenuAberto && (
                <div id="nav-relatorios-submenu" className="nav-submenu" role="group" aria-label="Seções de relatórios">
                  {abasRelatorio.map((aba) => (
                    <Link
                      key={aba.key}
                      to={`/relatorios?aba=${aba.key}`}
                      className={"nav-sublink" + (abaRelatorioAtiva === aba.key ? " active" : "")}
                      onClick={() => {
                        fecharMenu();
                        setRelatoriosSubmenuAberto(false);
                      }}
                    >
                      {aba.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <NavLink
              to="/relatorios"
              className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
              onClick={fecharMenu}
              aria-label="Relatórios"
              title="Relatórios"
            >
              <BarChart3 className="nav-link-icon" size={18} aria-hidden="true" />
              <span className="nav-link-label">Relatórios</span>
            </NavLink>
          )}
        </nav>
        <div className="nav-right-container">
          <button
            className="nav-profile-btn"
            onClick={() => setModalPerfilAberto(true)}
            title="Gerenciar minha foto de perfil"
          >
            <UserRound size={16} />
            <span>Minha foto</span>
          </button>
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
      </aside>

      <main className="app-content">
        <button
          type="button"
          ref={menuTriggerRef}
          className="app-nav-open"
          onClick={() => setMenuAberto(true)}
          aria-expanded={menuAberto}
          aria-controls="app-navigation"
        >
          <Menu size={18} />
          <span>Menu</span>
        </button>
      <Routes>
        <Route path="/validacao-conhecimento" element={role === "master" || role === "treinador" ? <ValidacaoConhecimento /> : <Navigate to="/" replace />} />
        <Route path="/" element={<Navigate to={role === "painel" ? "/relatorios" : "/home"} replace />} />
        <Route path="/login" element={<Navigate to={role === "painel" ? "/relatorios" : "/home"} replace />} />
        <Route path="/alterar-senha" element={<Navigate to={role === "painel" ? "/relatorios" : "/home"} replace />} />

        {role !== "painel" ? (
          <>
            <Route path="/esteira" element={<Esteira />} />
            <Route path="/esteira/:id" element={<Esteira />} />
            <Route path="/historico" element={<Historico />} />
            <Route path="/home" element={<Home />} />
          </>
        ) : (
          <>
            <Route path="/esteira" element={<Navigate to="/relatorios" replace />} />
            <Route path="/esteira/:id" element={<Navigate to="/relatorios" replace />} />
            <Route path="/historico" element={<Navigate to="/relatorios" replace />} />
            <Route path="/home" element={<Navigate to="/relatorios" replace />} />
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

        {role === "master" ? (
          <Route path="/tipos-ocorrencia" element={<TiposOcorrencia />} />
        ) : (
          <Route path="/tipos-ocorrencia" element={<Navigate to={role === "painel" ? "/relatorios" : "/home"} replace />} />
        )}

        <Route path="/relatorio-score" element={<Navigate to="/relatorios" replace />} />
        <Route path="/relatorios" element={<Relatorios />} />
        
        <Route path="*" element={<Navigate to={role === "painel" ? "/relatorios" : "/home"} replace />} />
      </Routes>
      </main>

      <ChecklistTarefas />
      {modalPerfilAberto && user && (
        <PerfilUsuarioModal
          uid={user.uid}
          nome={userName || user.email || "Usuário"}
          fotoAtual={fotoPerfil}
          onFotoAlterada={(url) =>
            setFotoPerfilCarregada({ uid: user.uid, url })
          }
          onFechar={() => setModalPerfilAberto(false)}
        />
      )}
    </div>
  );
}

function App() {
  useVerificaVersao();

  return (
    <AuthProvider>
      <Routes>
        <Route path="/csat/:token" element={<Csat />} />
        <Route path="*" element={<AppRoutes />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
