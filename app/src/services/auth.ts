import {
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  createUserWithEmailAndPassword,
  getAuth,
} from "firebase/auth";
import type { User } from "firebase/auth";
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, orderBy } from "firebase/firestore";
import { initializeApp, deleteApp } from "firebase/app";
import { auth, db, firebaseConfig } from "./firebase";

const COLLECTION_USUARIOS = "usuarios";

export async function loginComEmail(email: string, senhaParticular: string) {
  const userCredential = await signInWithEmailAndPassword(
    auth,
    email,
    senhaParticular,
  );
  return userCredential.user;
}

export async function deslogarUsuario() {
  await signOut(auth);
}

export async function atualizarSenhaUsuario(user: User, novaSenha: string) {
  await updatePassword(user, novaSenha);
}

export async function verificarPrimeiroAcesso(uid: string): Promise<boolean> {
  try {
    const userDocRef = doc(db, COLLECTION_USUARIOS, uid);
    const userDoc = await getDoc(userDocRef);

    if (!userDoc.exists()) {
      // Documento não existe no Firestore: é primeiro acesso/senha temporária
      return true;
    }

    const data = userDoc.data();
    return !!data?.needsPasswordChange;
  } catch (error) {
    console.error("Erro ao verificar primeiro acesso no Firestore:", error);
    // Em caso de erro de permissão (por exemplo, antes de cadastrar a primeira senha),
    // podemos retornar true se o doc não puder ser lido, mas para ser seguro
    // assumimos que precisa trocar a senha se não conseguirmos validar o doc.
    return true;
  }
}

export async function registrarSenhaDefinida(
  uid: string,
  email: string,
  role: string,
  nome: string,
) {
  const userDocRef = doc(db, COLLECTION_USUARIOS, uid);
  await setDoc(
    userDocRef,
    {
      email,
      role,
      nome,
      needsPasswordChange: false,
      updatedAt: Date.now(),
    },
    { merge: true },
  );
}

export interface UsuarioDocument {
  uid: string;
  email: string;
  role: string;
  nome: string;
  needsPasswordChange: boolean;
  createdAt?: number;
}

export async function criarNovoUsuario(email: string, senhaTemp: string, role: string, nome: string): Promise<void> {
  const tempAppName = `temp-register-${Date.now()}`;
  const tempApp = initializeApp(firebaseConfig, tempAppName);
  const tempAuth = getAuth(tempApp);

  try {
    const userCredential = await createUserWithEmailAndPassword(tempAuth, email, senhaTemp);
    const uid = userCredential.user.uid;

    await setDoc(doc(db, COLLECTION_USUARIOS, uid), {
      email,
      role,
      needsPasswordChange: true,
      nome,
      createdAt: Date.now()
    });

    await signOut(tempAuth);
  } finally {
    await deleteApp(tempApp);
  }
}

export async function listarUsuarios(): Promise<UsuarioDocument[]> {
  const querySnapshot = await getDocs(query(collection(db, COLLECTION_USUARIOS), orderBy("email")));
  const list: UsuarioDocument[] = [];
  querySnapshot.forEach((doc) => {
    const data = doc.data();
    list.push({
      uid: doc.id,
      email: data.email || "",
      role: data.role || "",
      nome: data.nome || "",
      needsPasswordChange: !!data.needsPasswordChange,
      createdAt: data.createdAt
    });
  });
  return list;
}

export async function removerUsuarioFirestore(uid: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION_USUARIOS, uid));
}
