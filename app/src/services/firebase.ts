import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from "firebase/firestore";
import { getAuth, connectAuthEmulator } from "firebase/auth";

export const firebaseConfig = {
  apiKey: "AIzaSyBrHOHIZE8zre7wpGOb8qYCgcSlmUuZu4c",
  authDomain: "automatiza-esteira.firebaseapp.com",
  projectId: "automatiza-esteira",
  storageBucket: "automatiza-esteira.firebasestorage.app",
  messagingSenderId: "498529833842",
  appId: "1:498529833842:web:b2a2e568aa39db1a0543eb",
  measurementId: "G-QTS0C3907Y",
};

const app = initializeApp(firebaseConfig);

/** Ver server/EMULADOR.md — liga o app ao Firebase Emulator Suite local em vez de produção. */
const usarEmulador = import.meta.env?.VITE_USE_FIREBASE_EMULATOR === "true";

// O cache persistente (IndexedDB) guarda documentos entre sessões do navegador; misturar
// dados reais com dados do emulador no mesmo cache confundiria um ao alternar entre os
// dois, então o modo emulador usa só o cache padrão em memória.
export const db = usarEmulador
  ? initializeFirestore(app, {})
  : initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
export const auth = getAuth(app);

if (usarEmulador) {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  console.info("[Firebase] Emulator Suite local ativo (Firestore :8080, Auth :9099) — dados do Firebase não acessam produção.");
}
