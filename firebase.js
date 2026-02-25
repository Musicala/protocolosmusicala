/* =============================================================================
  firebase.js — Protocolos · Musicala (LIGHT) — Firebase Setup (PRO)
  -----------------------------------------------------------------------------
  ✅ Singleton (evita doble init en dev/HMR)
  ✅ Soporta ENV vars (Vite) opcional
  ✅ Exporta: app, db, auth, provider
============================================================================= */

'use strict';

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

/* -----------------------------------------------------------------------------
  1) Config
  Recomendado (Vite): define variables en .env:
    VITE_FIREBASE_API_KEY=...
    VITE_FIREBASE_AUTH_DOMAIN=...
    VITE_FIREBASE_PROJECT_ID=...
    VITE_FIREBASE_STORAGE_BUCKET=...
    VITE_FIREBASE_MESSAGING_SENDER_ID=...
    VITE_FIREBASE_APP_ID=...

  Si no existen, usa el fallback hardcoded (tu config actual).
----------------------------------------------------------------------------- */

const ENV = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};

// Fallback hardcoded (funciona igual)
const FALLBACK_CONFIG = {
  apiKey: 'AIzaSyAEtWoz2J-eVHnV6FCl1A41N-p9vIvznaI',
  authDomain: 'protocolos-musicala.firebaseapp.com',
  projectId: 'protocolos-musicala',
  storageBucket: 'protocolos-musicala.firebasestorage.app',
  messagingSenderId: '431338520687',
  appId: '1:431338520687:web:36ff433c905859ebda4d9a'
};

function pickConfig() {
  const cfg = {
    apiKey: ENV.VITE_FIREBASE_API_KEY,
    authDomain: ENV.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: ENV.VITE_FIREBASE_PROJECT_ID,
    storageBucket: ENV.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: ENV.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: ENV.VITE_FIREBASE_APP_ID
  };

  // Si falta algo clave, nos vamos con fallback.
  const hasAll = Object.values(cfg).every(Boolean);
  return hasAll ? cfg : FALLBACK_CONFIG;
}

export const firebaseConfig = pickConfig();

/* -----------------------------------------------------------------------------
  2) App (singleton)
----------------------------------------------------------------------------- */

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/* -----------------------------------------------------------------------------
  3) Services
----------------------------------------------------------------------------- */

export const db = getFirestore(app);

export const auth = getAuth(app);

// Google Provider
export const provider = new GoogleAuthProvider();

// UX: siempre preguntar cuenta (evita entrar con la última sin querer)
provider.setCustomParameters({
  prompt: 'select_account'
});

// Opcional: scopes extra si luego quieren leer Drive/Calendar etc.
// provider.addScope('https://www.googleapis.com/auth/userinfo.email');
// provider.addScope('https://www.googleapis.com/auth/userinfo.profile');
