import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import type { BancoRadar } from "./dados";

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

/**
 * O Firebase fica só com a autenticação. Os dados são lidos e gravados pela API do Radar
 * (PostgreSQL) — ver services/dados.ts. `db` só identifica esse banco nas chamadas `doc(db, ...)`.
 */
export const db: BancoRadar = Object.freeze({ tipo: "radar" });
export const auth = getAuth(app);

/** Ver server/EMULADOR.md — usa o Auth Emulator local em vez do Firebase Auth de produção. */
const usarEmulador = import.meta.env?.VITE_USE_FIREBASE_EMULATOR === "true";
if (usarEmulador) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  console.info("[Firebase] Auth Emulator local ativo (:9099).");
}

// O SDK do Firestore guardava uma cópia dos dados no navegador (IndexedDB). Sem uso desde a
// migração para o PostgreSQL, ela é apagada para não deixar dados de clientes no computador.
try {
  globalThis.indexedDB?.deleteDatabase(`firestore/[DEFAULT]/${firebaseConfig.projectId}/main`);
} catch {
  /* IndexedDB indisponível: nada a apagar. */
}
