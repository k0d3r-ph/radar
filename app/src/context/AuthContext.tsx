import React, { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import type { User } from "firebase/auth";
import { auth, db } from "../services/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { deslogarUsuario } from "../services/auth";
import { formatarNome } from "../utils/formatarNome";
import { toast } from "sonner";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  needsPasswordChange: boolean;
  setNeedsPasswordChange: (value: boolean) => void;
  role: string;
  setRole: (role: string) => void;
  cargo: string;
  userName: string;
  setUserName: (name: string) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsPasswordChange, setNeedsPasswordChange] = useState(false);
  const [role, setRole] = useState("");
  const [cargo, setCargo] = useState("");
  const [userName, setUserName] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setLoading(true);
      if (currentUser) {
        setUser(currentUser);
        try {
          const userDocRef = doc(db, "usuarios", currentUser.uid);
          const userDoc = await getDoc(userDocRef);
          if (userDoc.exists() && userDoc.data()?.inativo) {
            console.warn("Acesso negado: usuário inativado.");
            await deslogarUsuario();
            setUser(null);
            setRole("");
            setCargo("");
            setUserName("");
            setNeedsPasswordChange(false);
            toast.error("Esta conta foi desativada ou não possui permissões de acesso.");
          } else if (userDoc.exists()) {
            const data = userDoc.data();
            let userRole = data.role || "suporte";
            if (userRole === "crc") {
              userRole = "cs";
              await setDoc(userDocRef, { role: "cs", updatedAt: Date.now() }, { merge: true });
            }
            setRole(userRole);
            setCargo(data.cargo || "");
            const rawNome = data.nome || currentUser.email || "";
            const formattedNome = formatarNome(rawNome);
            setUserName(formattedNome);
            setNeedsPasswordChange(!!data.needsPasswordChange);
          } else {
            console.warn("Acesso negado: documento do usuário não existe no Firestore.");
            await deslogarUsuario();
            setUser(null);
            setRole("");
            setCargo("");
            setUserName("");
            setNeedsPasswordChange(false);
            toast.error("Esta conta foi desativada ou não possui permissões de acesso.");
          }
        } catch (error: any) {
          console.error("Erro ao carregar dados do usuário no Firestore:", error);
          await deslogarUsuario();
          setUser(null);
          setRole("");
          setCargo("");
          setUserName("");
          setNeedsPasswordChange(false);
          toast.error("Acesso negado: erro de permissão ou conexão.");
        }
      } else {
        setUser(null);
        setRole("");
        setCargo("");
        setUserName("");
        setNeedsPasswordChange(false);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const logout = async () => {
    await deslogarUsuario();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        needsPasswordChange,
        setNeedsPasswordChange,
        role,
        setRole,
        cargo,
        userName,
        setUserName,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth deve ser utilizado dentro de um AuthProvider");
  }
  return context;
};
