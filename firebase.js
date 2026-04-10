/* =============================================================================
  firebase.js — Protocolos · Musicala (LIGHT) — GitHub Pages Ready
  -----------------------------------------------------------------------------
  ✅ Compatible con navegador sin Node ni Vite
  ✅ Imports desde CDN oficial de Firebase
  ✅ Singleton para evitar doble init
  ✅ Exporta app, db, auth, provider
  ✅ Exporta helpers de Firestore/Auth usados por app.js
  ✅ Permite override opcional con window.__FIREBASE_CONFIG__
============================================================================= */

'use strict';

/* -----------------------------------------------------------------------------
  Firebase SDK desde CDN oficial
  Esto sí funciona en GitHub Pages y hosting estático.
----------------------------------------------------------------------------- */
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';

import { getFirestore, collection, getDocs, addDoc, doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';

/* -----------------------------------------------------------------------------
  Config por defecto
  IMPORTANTE:
  Esta configuración cliente NO es un secreto.
  La seguridad real vive en Auth + Firestore Rules.
----------------------------------------------------------------------------- */
const FALLBACK_CONFIG = {
  apiKey: 'AIzaSyAEtWoz2J-eVHnV6FCl1A41N-p9vIvznaI',
  authDomain: 'protocolos-musicala.firebaseapp.com',
  projectId: 'protocolos-musicala',
  storageBucket: 'protocolos-musicala.firebasestorage.app',
  messagingSenderId: '431338520687',
  appId: '1:431338520687:web:36ff433c905859ebda4d9a'
};

/* -----------------------------------------------------------------------------
  Override opcional
  Si más adelante quieren, pueden poner en index.html antes de app.js algo como:
  <script>
    window.__FIREBASE_CONFIG__ = { ... }
  </script>
----------------------------------------------------------------------------- */
function readRuntimeConfig() {
  const cfg = globalThis?.__FIREBASE_CONFIG__;
  if (!cfg || typeof cfg !== 'object') return null;

  const normalized = {
    apiKey: cfg.apiKey,
    authDomain: cfg.authDomain,
    projectId: cfg.projectId,
    storageBucket: cfg.storageBucket,
    messagingSenderId: cfg.messagingSenderId,
    appId: cfg.appId
  };

  const hasMinimum =
    normalized.apiKey &&
    normalized.authDomain &&
    normalized.projectId &&
    normalized.appId;

  return hasMinimum ? normalized : null;
}

export function pickConfig() {
  return readRuntimeConfig() || FALLBACK_CONFIG;
}

export const firebaseConfig = pickConfig();

/* -----------------------------------------------------------------------------
  Singleton global
----------------------------------------------------------------------------- */
const FIREBASE_SINGLETON_KEY = '__MUSICALA_PROTOCOLS_FIREBASE_SINGLETON__';

function createFirebaseSingleton() {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();

  provider.setCustomParameters({
    prompt: 'select_account'
  });

  return { app, db, auth, provider };
}

const singleton =
  globalThis[FIREBASE_SINGLETON_KEY] ||
  (globalThis[FIREBASE_SINGLETON_KEY] = createFirebaseSingleton());

/* -----------------------------------------------------------------------------
  Exports principales
----------------------------------------------------------------------------- */
export const app = singleton.app;
export const db = singleton.db;
export const auth = singleton.auth;
export const provider = singleton.provider;

/* -----------------------------------------------------------------------------
  Persistencia de sesión
  Esto hace que la sesión sobreviva al refresco del navegador.
  Si falla, no rompemos la app por eso.
----------------------------------------------------------------------------- */
try {
  await setPersistence(auth, browserLocalPersistence);
} catch (error) {
  console.warn('[firebase.js] No se pudo establecer persistencia local:', error);
}

/* -----------------------------------------------------------------------------
  Re-export de helpers que app.js necesita
----------------------------------------------------------------------------- */
export {
  collection,
  getDocs,
  addDoc,
  doc,
  setDoc,
  serverTimestamp,
  onAuthStateChanged,
  signInWithPopup,
  signOut
};

/* -----------------------------------------------------------------------------
  Helper opcional para depuración
----------------------------------------------------------------------------- */
export function firebaseReady() {
  return {
    app: !!app,
    db: !!db,
    auth: !!auth,
    provider: !!provider,
    projectId: firebaseConfig?.projectId || null
  };
}

console.info('[firebase.js] Firebase inicializado', {
  projectId: firebaseConfig?.projectId || null,
  authDomain: firebaseConfig?.authDomain || null
});