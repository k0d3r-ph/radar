import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

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

export const db = getFirestore(app);
export const auth = getAuth(app);
