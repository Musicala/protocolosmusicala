/* =============================================================================
  app.js — Protocolos · Musicala (LIGHT) — PRO (Firestore Edition) v3.3.0
  -----------------------------------------------------------------------------
  ✅ Fuente principal: Firestore (colección: "protocols")
  ✅ Fallback: /protocols.json (si Firestore falla o no hay permisos)
  ✅ UI: búsqueda + filtros + chips + stats + modal + editor (admin)
  ✅ Auth: Google login (btnLogin/btnLogout + userpill)
  ✅ Permisos UI: admin por email
  ✅ CRUD: crear/editar protocolos desde el editor (Firestore)
  ✅ Checklist persistente por sesión (sessionStorage)
  ✅ Copiar protocolo + Registrar caso (descarga .json) + Exportar
  ✅ Accesibilidad: aria-live, teclado, escape, focus restore
  ✅ Robustez: estados de carga/error, sanitización, debounce, renders seguros

  Improvements v3.3.0:
  - ✅ Event delegation para checklist: no crea listeners por cada checkbox.
  - ✅ Stats usan .statcard (no “card” clicable).
  - ✅ Guards más claros para cuando db/auth/provider no existan.
  - ✅ Render de modal más estable (menos re-trabajo).
============================================================================= */

'use strict';

import * as FB from './firebase.js';
import {
  collection,
  getDocs,
  addDoc,
  doc,
  setDoc,
  serverTimestamp
} from 'firebase/firestore';

import {
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from 'firebase/auth';

/* ---------- Firebase handles ---------- */
const db = FB?.db ?? null;
const auth = FB?.auth ?? null;
const provider = FB?.provider ?? null;

/* ---------- Admin emails (UI gate + Rules ya las pusiste) ---------- */
const ADMIN_EMAILS = new Set([
  'alekcaballeromusic@gmail.com',
  'catalina.medina.leal@gmail.com',
  'musicalaasesor@gmail.com',
  'imusicala@gmail.com'
]);

/* ---------- Helpers DOM ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

/* ---------- Utils ---------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}
function slug(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
function debounce(fn, ms = 150) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
function safeJson(v) {
  try { return JSON.stringify(v); } catch { return ''; }
}
function prettyJson(v, fallback = '') {
  try {
    if (typeof v === 'string') return v;
    return JSON.stringify(v, null, 2);
  } catch { return fallback; }
}
function download(filename, text, mime = 'application/json;charset=utf-8') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copiado ✅');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('Copiado ✅');
  }
}
function toast(msg) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    Object.assign(el.style, {
      position: 'fixed',
      left: '50%',
      bottom: '18px',
      transform: 'translateX(-50%)',
      background: 'rgba(16,24,40,.92)',
      color: '#fff',
      padding: '10px 12px',
      borderRadius: '14px',
      fontWeight: '800',
      fontSize: '13px',
      zIndex: '60',
      boxShadow: '0 10px 30px rgba(0,0,0,.20)',
      transition: 'opacity .2s ease',
      opacity: '0',
      pointerEvents: 'none'
    });
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 1300);
}

/* ---------- URL detect ---------- */
const URL_RX = /(https?:\/\/[^\s)]+)|(www\.[^\s)]+)/gi;
function extractLinksFromText(text) {
  const links = new Set();
  const s = String(text || '');
  let m;
  while ((m = URL_RX.exec(s))) {
    const raw = m[0];
    const url = raw.startsWith('http') ? raw : `https://${raw}`;
    links.add(url.replace(/[.,;]+$/,''));
  }
  return Array.from(links);
}

/* ---------- Render text helpers ---------- */
function nl2br(s) {
  return String(s ?? '').replace(/\n/g, '<br/>');
}
function linkifyHtml(htmlEscapedWithBr) {
  // html ya viene escapado y con <br/>. Solo convertimos URLs a <a>.
  return htmlEscapedWithBr.replace(URL_RX, (m) => {
    const raw = m;
    const url = raw.startsWith('http') ? raw : `https://${raw}`;
    const safeHref = esc(url.replace(/[.,;]+$/,''));
    const label = esc(raw.replace(/[.,;]+$/,''));
    return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
}
function renderTextBlock(value) {
  // devuelve HTML seguro: esc + saltos + linkify
  const base = esc(String(value ?? '').trim());
  const withBr = nl2br(base);
  return linkifyHtml(withBr);
}

/* ---------- sessionStorage (checklist) ---------- */
const CHECK_KEY = 'musicala_protocols_check_v1';

function loadChecklistStore() {
  try {
    const raw = sessionStorage.getItem(CHECK_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch { return {}; }
}
function saveChecklistStore(store) {
  try { sessionStorage.setItem(CHECK_KEY, JSON.stringify(store)); } catch {}
}
function getCheckedSet(protocolId) {
  const store = loadChecklistStore();
  const arr = store[protocolId];
  if (!Array.isArray(arr)) return new Set();
  return new Set(arr.filter(n => Number.isFinite(n)));
}
function setCheckedSet(protocolId, set) {
  const store = loadChecklistStore();
  store[protocolId] = Array.from(set).sort((a,b)=>a-b);
  saveChecklistStore(store);
}

/* ---------- Normalization (FIX real de [object Object]) ---------- */
function coerceStep(x) {
  if (x == null) return '';
  if (typeof x === 'string') return x.trim();
  if (typeof x === 'number' || typeof x === 'boolean') return String(x);

  if (typeof x === 'object') {
    const cand =
      x.text ?? x.label ?? x.name ?? x.step ?? x.value ?? x.title ?? x.description ?? x.summary;
    if (typeof cand === 'string') return cand.trim();

    if (Array.isArray(x.items)) {
      return x.items.map(coerceStep).filter(Boolean).join(' ').trim();
    }

    // último recurso: JSON compacto, mejor que [object Object]
    const j = safeJson(x);
    return j ? j : '';
  }
  return String(x).trim();
}

function stepsFromRawFields(fields) {
  const raw = fields?.raw;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];

  const entries = Object.entries(raw)
    .map(([k, v]) => [String(k).trim(), v])
    .filter(([k]) => /^paso\s*\d+/i.test(k));

  if (!entries.length) return [];

  const sorted = entries.sort((a, b) => {
    const na = Number(String(a[0]).match(/\d+/)?.[0] || 0);
    const nb = Number(String(b[0]).match(/\d+/)?.[0] || 0);
    return na - nb;
  });

  return sorted
    .map(([, v]) => coerceStep(v))
    .filter(Boolean)
    .flatMap(s => s.split('\n').map(t => t.trim()).filter(Boolean));
}

function buildSearchBlob(p) {
  const f = p.fields || {};
  const parts = [
    p.title || '',
    p.summary || '',
    p.category || '',
    (p.tags || []).join(' '),
    safeJson(f),
    (p.steps || []).join(' ')
  ];
  return parts.join(' ').toLowerCase();
}

function inferUrgency(p) {
  const f = p.fields || {};
  const flat = (typeof f === 'object') ? safeJson(f).toLowerCase() : '';
  const hay = `${(p.title||'')} ${(p.summary||'')} ${(p.category||'')} ${flat}`.toLowerCase();

  for (const k of Object.keys(f)) {
    const lk = k.toLowerCase();
    if (lk.includes('urg') || lk.includes('prioridad') || lk.includes('nivel')) {
      const v = String(f[k]).toLowerCase();
      if (v.includes('urg') || v.includes('alto') || v.includes('inmedi')) return 'urgent';
      if (v.includes('import') || v.includes('medio')) return 'important';
      return 'normal';
    }
  }

  if (/evacu|incend|emergen|accident|ambul|sangr|riesgo|urgente|crisis|robo/.test(hay)) return 'urgent';
  if (/queja|formal|reporte|incumpl|seguim|auditor|sgs|nomina|legal|contrat/.test(hay)) return 'important';
  return 'normal';
}

function inferTags(p) {
  const tags = new Set();
  const cat = (p.category || '').toLowerCase();
  const t = (p.title || '').toLowerCase();
  const s = (p.summary || '').toLowerCase();
  const f = safeJson(p.fields || {}).toLowerCase();

  const add = (tag) => tag && tags.add(tag);
  if (cat) add(cat);

  const hay = `${cat} ${t} ${s} ${f}`;

  const addIf = (rx, tag) => { if (rx.test(hay)) add(tag); };

  addIf(/seguridad|emergenc|evacu|sgs|riesgo|robo/, 'seguridad');
  addIf(/clase|docente|pedagog|grupo|estudiant|nna/, 'clases');
  addIf(/ventas|cliente|acud|famil|whats|callcenter|keybe/, 'ventas');
  addIf(/contab|pago|fact|cobro|retenc|nomina|bold|nequi|pse/, 'contabilidad');
  addIf(/marketing|public|campañ|ads|redes/, 'marketing');
  addIf(/legal|contrat|termin|document|firma/, 'legal');
  addIf(/apertura|cierre|llaves|salon|espacio|operaci|recepcion/, 'operación');
  addIf(/fsa|kiwa/, 'fsa');

  return Array.from(tags).slice(0, 12);
}

function normalizeProtocol(raw) {
  const p = { ...raw };

  p.id = String(p.id || p._id || p.protocol_id || '').trim();
  p.title = String(p.title || p.name || 'Protocolo').trim();
  p.summary = String(p.summary || p.resumen || p.description || '').trim();
  p.category = String(p.category || p.categoria || p.area || 'General').trim();

  if (!p.fields || typeof p.fields !== 'object' || Array.isArray(p.fields)) p.fields = {};

  // steps: tolerante
  let steps = [];
  if (Array.isArray(p.steps)) steps = p.steps.map(coerceStep).filter(Boolean);
  else if (Array.isArray(p.pasos)) steps = p.pasos.map(coerceStep).filter(Boolean);
  else if (typeof p.steps === 'string') steps = p.steps.split('\n').map(s => s.trim()).filter(Boolean);

  // si no hay steps, intenta desde fields.raw
  if (!steps.length) steps = stepsFromRawFields(p.fields);

  // si no hay, intenta desde fields.steps/pasos
  if (!steps.length) {
    const f = p.fields || {};
    if (Array.isArray(f.steps)) steps = f.steps.map(coerceStep).filter(Boolean);
    else if (Array.isArray(f.pasos)) steps = f.pasos.map(coerceStep).filter(Boolean);
    else if (typeof f.steps === 'string') steps = f.steps.split('\n').map(s => s.trim()).filter(Boolean);
  }

  p.steps = steps;

  // tags
  if (Array.isArray(p.tags)) {
    p.tags = p.tags.map(t => String(t || '').trim().toLowerCase()).filter(Boolean);
  } else {
    p.tags = inferTags(p);
  }

  // urgency
  p.urgency = inferUrgency(p);

  // searchable blob
  p._search = buildSearchBlob(p);

  if (!p.id) p.id = `${slug(p.category)}-${slug(p.title)}-${Math.random().toString(16).slice(2,10)}`;

  return p;
}

/* ---------- State ---------- */
const state = {
  data: { source_file: '—', protocols: [] },
  q: '',
  category: '',
  urgency: '',
  chip: '',
  selected: null,
  lastFocusEl: null,

  user: null,
  isAdmin: false
};

/* ---------- DOM ---------- */
const elGrid = $('#grid');
const elEmpty = $('#empty');
const elSubtitle = $('#subtitle');
const elQ = $('#q');
const elCat = $('#category');
const elUrg = $('#urgency');
const elChips = $('#chips');
const elStats = $('#stats');

const inlineState = $('#inlineState');
const inlineTitle = $('#inlineTitle');
const inlineSub = $('#inlineSub');

const modal = $('#modal');
const mTitle = $('#mTitle');
const mSummary = $('#mSummary');
const mFields = $('#mFields');
const mBadge = $('#mBadge');
const mChecklistWrap = $('#mChecklistWrap');
const mChecklist = $('#mChecklist');

const helpModal = $('#help');
const editor = $('#editor');

/* ---------- Inline state ---------- */
function setInlineState(on, title = '', sub = '', isError = false) {
  if (!inlineState) return;
  inlineState.hidden = !on;
  if (inlineTitle) inlineTitle.textContent = title || '';
  if (inlineSub) inlineSub.textContent = sub || '';
  if (on) inlineState.dataset.state = isError ? 'error' : 'loading';
  else delete inlineState.dataset.state;
}

/* ---------- Loaders ---------- */
async function loadFromFirestore() {
  if (!db) throw new Error('No Firestore db (firebase.js)');

  const snap = await getDocs(collection(db, 'protocols'));
  const protocols = snap.docs.map(d => normalizeProtocol({ id: d.id, ...d.data() }));
  protocols.sort((a, b) =>
    (a.category || '').localeCompare(b.category || '', 'es') ||
    (a.title || '').localeCompare(b.title || '', 'es')
  );

  return {
    source_file: `Firestore · protocols (${protocols.length})`,
    protocols
  };
}

async function loadFromLocalJson() {
  const candidates = ['/protocols.json', './protocols.json'];
  let lastErr = null;

  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status} (${url})`);
      const json = await res.json();

      const arr = Array.isArray(json.protocols) ? json.protocols : (Array.isArray(json) ? json : []);
      const protocols = arr.map(normalizeProtocol).filter(Boolean);

      protocols.sort((a, b) =>
        (a.category || '').localeCompare(b.category || '', 'es') ||
        (a.title || '').localeCompare(b.title || '', 'es')
      );

      return {
        source_file: `Local JSON · ${url} (${protocols.length})`,
        protocols
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('No local protocols.json found');
}

async function load() {
  setInlineState(true, 'Cargando protocolos…', 'Intentando Firestore. Si falla, usamos fallback local.');

  try {
    state.data = await loadFromFirestore();
    initFilters();
    initChips();
    render();
    setInlineState(false);
  } catch (err) {
    console.warn('[Firestore fail] fallback to local json:', err);

    try {
      state.data = await loadFromLocalJson();
      initFilters();
      initChips();
      render();

      setInlineState(true, 'Cargado en modo local 🧩', 'Firestore falló o no hay permisos. Estás usando protocols.json.', false);
      setTimeout(() => setInlineState(false), 1800);
    } catch (err2) {
      console.error(err2);

      setInlineState(true, 'No pude cargar nada 😵', 'Revisa Firestore o agrega /public/protocols.json', true);
      if (elSubtitle) elSubtitle.textContent = 'Error cargando protocolos. Revisa consola.';
      if (elGrid) {
        elGrid.innerHTML = `
          <div class="empty">
            <div class="empty__icon">⚠️</div>
            <div class="empty__title">No cargó la data</div>
            <div class="empty__sub">
              Verifica: 1) colección <b>protocols</b> en Firestore y permisos de lectura
              2) o agrega <b>/public/protocols.json</b> como fallback.
            </div>
          </div>`;
      }
    }
  } finally {
    if (inlineState?.dataset?.state === 'loading') setInlineState(false);
  }
}

/* ---------- Filters + Chips ---------- */
function initFilters() {
  if (!elCat) return;
  const cats = Array.from(new Set((state.data.protocols || []).map(p => p.category).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'es'));
  elCat.innerHTML = [
    `<option value="">Todas</option>`,
    ...cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`)
  ].join('');
}

function initChips() {
  if (!elChips) return;

  const freq = new Map();
  (state.data.protocols || []).forEach(p => (p.tags || []).forEach(t => freq.set(t, (freq.get(t) || 0) + 1)));

  const tags = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([t]) => t);

  elChips.innerHTML = tags.map(t =>
    `<button class="chip" type="button" data-chip="${esc(t)}" aria-pressed="false" title="Filtrar por #${esc(t)}">#${esc(t)}</button>`
  ).join('');
}

/* ---------- Search + Filter ---------- */
function tokenizeQuery(q) {
  if (!q) return [];
  const tokens = [];
  const rx = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = rx.exec(q))) {
    const val = (m[1] || m[2] || '').trim();
    if (val) tokens.push(val.toLowerCase());
  }
  return tokens.slice(0, 14);
}

function filtered() {
  const q = state.q.trim().toLowerCase();
  const chip = state.chip;
  const tokens = tokenizeQuery(q);

  return (state.data.protocols || []).filter(p => {
    if (state.category && p.category !== state.category) return false;
    if (state.urgency && p.urgency !== state.urgency) return false;
    if (chip && !(p.tags || []).includes(chip)) return false;

    if (tokens.length) {
      const hay = p._search || '';
      for (const tok of tokens) if (!hay.includes(tok)) return false;
    }
    return true;
  });
}

/* ---------- Render ---------- */
function render() {
  const list = filtered();
  if (elSubtitle) elSubtitle.textContent = `${list.length} protocolo(s) · Fuente: ${state.data.source_file || '—'}`;
  renderStats(list);
  renderGrid(list);
  syncAuthUI();
}

function renderStats(list) {
  if (!elStats) return;

  const total = (state.data.protocols || []).length;
  const byU = { urgent: 0, important: 0, normal: 0 };
  list.forEach(p => { byU[p.urgency] = (byU[p.urgency] || 0) + 1; });

  const pct = (n) => total ? Math.round((n / total) * 100) : 0;

  const mk = (label, n, cls) => `
    <div class="statcard">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px">
        <div style="font-weight:950">${esc(label)}</div>
        <span class="badge ${cls}">${n}</span>
      </div>
      <div class="muted" style="margin-top:8px">${pct(n)}% del total</div>
      <div class="muted" style="margin-top:8px">En tu filtro actual: <b>${list.length}</b></div>
    </div>
  `;

  elStats.innerHTML = `
    <div class="muted" style="margin-bottom:10px">Resumen</div>
    <div style="display:grid; gap:10px">
      ${mk('Urgentes', byU.urgent, 'badge--urgent')}
      ${mk('Importantes', byU.important, 'badge--important')}
      ${mk('Normales', byU.normal, 'badge--normal')}
    </div>
  `;
}

function renderGrid(list) {
  if (!elGrid || !elEmpty) return;

  if (!list.length) {
    elGrid.innerHTML = '';
    elEmpty.hidden = false;
    return;
  }
  elEmpty.hidden = true;

  elGrid.innerHTML = list.map(p => {
    const badgeCls = p.urgency === 'urgent' ? 'badge--urgent' : (p.urgency === 'important' ? 'badge--important' : 'badge--normal');
    const badgeTxt = p.urgency === 'urgent' ? 'Urgente' : (p.urgency === 'important' ? 'Importante' : 'Normal');
    const tagline = (p.tags || []).slice(0, 4).map(t => `#${t}`).join(' ');

    return `
      <article class="card" tabindex="0" role="button" aria-label="Abrir protocolo ${esc(p.title)}"
        data-id="${esc(p.id)}">
        <div class="card__top">
          <h3 class="card__title">${esc(p.title)}</h3>
          <span class="badge ${badgeCls}">${badgeTxt}</span>
        </div>
        <p class="card__sum">${esc(p.summary || 'Sin resumen')}</p>
        <div class="card__meta">
          <span class="pill">${esc(p.category || 'General')}</span>
          <span class="pill">${esc(tagline || '—')}</span>
        </div>
      </article>
    `;
  }).join('');
}

/* ---------- Modal open/close + bindings ---------- */
const _boundModals = new WeakSet();

function openModal(el) {
  if (!el) return;
  el.hidden = false;
  document.body.style.overflow = 'hidden';
  el.dataset.open = '1';
}
function closeModal(el) {
  if (!el) return;
  el.hidden = true;
  document.body.style.overflow = '';
  delete el.dataset.open;
  try { state.lastFocusEl?.focus?.(); } catch {}
}
function bindModal(el) {
  if (!el || _boundModals.has(el)) return;
  _boundModals.add(el);

  el.addEventListener('click', (e) => {
    const close = e.target?.dataset?.close;
    const isBackdrop = e.target?.classList?.contains('modal__backdrop');
    if (close || isBackdrop) closeModal(el);
  });
}

// Escape global para cualquier modal abierto
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = $$('.modal').find(m => !m.hidden && m.dataset.open === '1');
  if (open) closeModal(open);
});

/* ---------- Open protocol ---------- */
function openById(id, focusEl = null) {
  const p = (state.data.protocols || []).find(x => x.id === id);
  if (!p) return;

  state.selected = p;
  state.lastFocusEl = focusEl || document.activeElement;

  renderModal(p);
  openModal(modal);
  setTimeout(() => $('#mClose')?.focus?.(), 0);
}

/* ---------- Render helpers (Fields) ---------- */
function prettyValue(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    const flat = v.map(x => (typeof x === 'string' ? x : safeJson(x))).filter(Boolean);
    return flat.join('\n');
  }
  if (typeof v === 'object') {
    if ('raw' in v) {
      const keys = Object.keys(v).filter(k => k !== 'raw');
      const head = keys.length ? keys.map(k => `${k}: ${prettyValue(v[k])}`).join('\n') : '';
      return head || '[detalle interno]';
    }
    return prettyJson(v, safeJson(v));
  }
  return String(v);
}

function renderLinksBlock(links = []) {
  const uniq = Array.from(new Set(links)).slice(0, 10);
  if (!uniq.length) return '';
  return `
    <div class="kv__item">
      <div class="kv__k">Links</div>
      <div class="kv__v">
        ${uniq.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`).join('<br/>')}
      </div>
    </div>
  `;
}

function renderModal(p) {
  if (mTitle) mTitle.textContent = p.title || 'Protocolo';
  if (mSummary) mSummary.textContent = p.summary || '';

  const badgeTxt = p.urgency === 'urgent' ? 'Urgente' : (p.urgency === 'important' ? 'Importante' : 'Normal');
  if (mBadge) {
    mBadge.textContent = badgeTxt;
    mBadge.className = 'badge ' + (p.urgency === 'urgent' ? 'badge--urgent' : (p.urgency === 'important' ? 'badge--important' : 'badge--normal'));
  }

  // admin edit button inside modal
  const btnEdit = $('#btnEdit');
  if (btnEdit) btnEdit.hidden = !state.isAdmin;

  // checklist
  const steps = (p.steps || []).map(coerceStep).filter(Boolean);
  if (mChecklistWrap && mChecklist) {
    if (steps.length) {
      mChecklistWrap.hidden = false;

      const checked = getCheckedSet(p.id);
      mChecklist.innerHTML = steps.map((s, i) => {
        const cid = `chk_${slug(p.id)}_${i}`;
        const isOn = checked.has(i);
        return `
          <div class="check">
            <input id="${esc(cid)}" type="checkbox" ${isOn ? 'checked' : ''} data-step="${i}"/>
            <label for="${esc(cid)}">${esc(s)}</label>
          </div>
        `;
      }).join('');

      // Guardamos el id del protocolo activo para delegation
      mChecklist.dataset.pid = p.id;
    } else {
      mChecklistWrap.hidden = true;
      mChecklist.innerHTML = '';
      delete mChecklist.dataset.pid;
    }
  }

  // fields
  const f = p.fields || {};
  const links = Array.isArray(f.links) ? f.links : [];

  const baseEntries = [
    ['Categoría', p.category || 'General'],
    ['Urgencia', badgeTxt],
    ['Etiquetas', (p.tags || []).slice(0, 10).map(t => `#${t}`).join(' ') || '—']
  ];

  const preferredKeys = ['subcategory', 'objective', 'activation', 'roles', 'owners', 'flow'];
  const preferred = preferredKeys
    .filter(k => Object.prototype.hasOwnProperty.call(f, k))
    .map(k => [k, f[k]]);

  const other = Object.entries(f)
    .filter(([k]) => !preferredKeys.includes(k) && k !== 'raw' && k !== 'links')
    .slice(0, 40);

  const entries = [...baseEntries, ...preferred, ...other];

  if (mFields) {
    const inferredLinks = extractLinksFromText(
      `${prettyValue(f.objective)}\n${prettyValue(f.activation)}\n${prettyValue(f.roles)}\n${prettyValue(f.flow)}\n${(p.steps || []).join('\n')}`
    );

    mFields.innerHTML = `
      ${entries.map(([k, v]) => {
        const txt = prettyValue(v) || '—';
        return `
          <div class="kv__item">
            <div class="kv__k">${esc(String(k))}</div>
            <div class="kv__v">${renderTextBlock(txt)}</div>
          </div>
        `;
      }).join('')}
      ${renderLinksBlock((links.length ? links : inferredLinks))}
      ${f.raw ? `
        <details class="kv__item" style="grid-column:1/-1">
          <summary class="kv__k" style="cursor:pointer">Ver campos originales (raw)</summary>
          <pre class="kv__v" style="white-space:pre-wrap; overflow:auto; margin:10px 0 0">${esc(JSON.stringify(f.raw, null, 2))}</pre>
        </details>
      ` : ''}
    `;
  }
}

/* ---------- Actions ---------- */
function getSelectedText(p) {
  const lines = [];
  lines.push(`PROTOCOLO: ${p.title}`);
  lines.push(`CATEGORÍA: ${p.category}`);
  lines.push(`URGENCIA: ${p.urgency}`);

  if (p.summary) lines.push(`\nRESUMEN:\n${p.summary}`);
  if ((p.steps || []).length) lines.push(`\nCHECKLIST:\n- ${(p.steps || []).join('\n- ')}`);

  const f = p.fields || {};
  const compact = { ...f };
  if (compact.raw) delete compact.raw;

  const extra = Object.keys(compact).length
    ? Object.entries(compact).map(([k, v]) => `${k}: ${prettyValue(v)}`).join('\n')
    : '';
  if (extra) lines.push(`\nDETALLE:\n${extra}`);

  if (f.raw) lines.push(`\nRAW (campos originales): (ver en la app)`);
  return lines.join('\n');
}

function getCaseRecord(p) {
  const when = new Date();
  const done = Array.from(getCheckedSet(p.id)).sort((a, b) => a - b);
  return {
    created_at: when.toISOString(),
    protocol_id: p.id,
    protocol_title: p.title,
    category: p.category,
    urgency: p.urgency,
    checklist_done: done,
    notes: '',
    source: state.data.source_file || '—'
  };
}

/* ---------- Auth UI ---------- */
function syncAuthUI() {
  const userPill = $('#userPill');
  const userName = $('#userName');
  const btnLogin = $('#btnLogin');
  const btnLogout = $('#btnLogout');
  const btnNew = $('#btnNew');
  const btnEdit = $('#btnEdit');

  const authReady = !!auth && !!provider;

  if (!authReady) {
    userPill && (userPill.hidden = true);
    btnLogin && (btnLogin.hidden = true);
    btnLogout && (btnLogout.hidden = true);
    btnNew && (btnNew.hidden = true);
    btnEdit && (btnEdit.hidden = true);
    return;
  }

  if (!state.user) {
    userPill && (userPill.hidden = true);
    btnLogin && (btnLogin.hidden = false);
    btnLogout && (btnLogout.hidden = true);
    btnNew && (btnNew.hidden = true);
    btnEdit && (btnEdit.hidden = true);
    return;
  }

  userPill && (userPill.hidden = false);
  if (userName) userName.textContent = state.user.displayName || state.user.email || 'Usuario';

  btnLogin && (btnLogin.hidden = true);
  btnLogout && (btnLogout.hidden = false);
  btnNew && (btnNew.hidden = !state.isAdmin);

  // btnEdit en modal se setea en renderModal, pero si está visible afuera, también:
  btnEdit && (btnEdit.hidden = !state.isAdmin);
}

function initAuth() {
  const authReady = !!auth && !!provider;

  if (!authReady) {
    console.warn('[Auth] firebase.js no exporta auth/provider. UI de login desactivada.');
    syncAuthUI();
    return;
  }

  onAuthStateChanged(auth, (u) => {
    state.user = u || null;
    state.isAdmin = !!u?.email && ADMIN_EMAILS.has(u.email);
    syncAuthUI();
  });

  $('#btnLogin')?.addEventListener('click', async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.error(e);
      toast('No pude iniciar sesión 😵');
    }
  });

  $('#btnLogout')?.addEventListener('click', async () => {
    try {
      await signOut(auth);
      toast('Sesión cerrada ✅');
    } catch (e) {
      console.error(e);
      toast('No pude cerrar sesión 😵');
    }
  });
}

/* ---------- Editor (admin) ---------- */
function parseCsv(s, max = 30) {
  return String(s || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .map(x => x.toLowerCase())
    .slice(0, max);
}
function parseLines(s, max = 80) {
  return String(s || '')
    .split('\n')
    .map(x => x.trim())
    .filter(Boolean)
    .slice(0, max);
}
function parseMaybeJson(s) {
  const raw = String(s || '').trim();
  if (!raw) return '';
  const first = raw[0];
  if (first !== '{' && first !== '[') return raw;
  try { return JSON.parse(raw); } catch { return raw; }
}

function openEditor(p = null) {
  if (!state.isAdmin) return toast('No tienes permisos para editar 😅');

  state.lastFocusEl = document.activeElement;

  $('#eId') && ($('#eId').value = p?.id || '');
  $('#eProtocolTitle') && ($('#eProtocolTitle').value = p?.title || '');
  $('#eCategory') && ($('#eCategory').value = p?.category || '');
  $('#eUrgency') && ($('#eUrgency').value = p?.urgency || 'normal');
  $('#eSummary') && ($('#eSummary').value = p?.summary || '');
  $('#eSteps') && ($('#eSteps').value = (p?.steps || []).map(coerceStep).filter(Boolean).join('\n'));
  $('#eTags') && ($('#eTags').value = (p?.tags || []).join(', '));
  $('#eOwners') && ($('#eOwners').value = (p?.fields?.owners || p?.owners || []).join(', '));

  const flowValue = (p?.fields?.flow ?? p?.flow ?? '');
  $('#eFlow') && ($('#eFlow').value = (typeof flowValue === 'object') ? prettyJson(flowValue, '') : String(flowValue || ''));

  const title = $('#eTitle');
  if (title) title.textContent = p ? 'Editar protocolo' : 'Nuevo protocolo';

  openModal(editor);
  setTimeout(() => $('#eProtocolTitle')?.focus?.(), 0);
}

async function saveEditor() {
  if (!state.isAdmin) return toast('No tienes permisos 😅');
  if (!db) return toast('No hay db (firebase.js) 😵');

  const id = $('#eId')?.value?.trim?.() || '';
  const title = $('#eProtocolTitle')?.value?.trim?.() || '';
  const category = ($('#eCategory')?.value?.trim?.() || 'General');
  if (!title) return toast('Falta el título 👀');

  const flowRaw = $('#eFlow')?.value ?? '';
  const flowParsed = parseMaybeJson(flowRaw);

  const payload = {
    title,
    category,
    urgency: $('#eUrgency')?.value || 'normal',
    summary: $('#eSummary')?.value?.trim?.() || '',
    steps: parseLines($('#eSteps')?.value || '', 120),
    tags: parseCsv($('#eTags')?.value || '', 30),

    fields: {
      owners: parseCsv($('#eOwners')?.value || '', 20).map(s => s.replace(/(^\w)/, m => m.toUpperCase())),
      flow: flowParsed
    },

    updated_at: serverTimestamp(),
    updated_by: state.user?.email || null
  };

  const btnSave = $('#btnSave');
  const prevTxt = btnSave?.textContent;
  if (btnSave) { btnSave.disabled = true; btnSave.textContent = 'Guardando…'; }

  try {
    let savedId = id;

    if (id) {
      await setDoc(doc(db, 'protocols', id), payload, { merge: true });
    } else {
      payload.created_at = serverTimestamp();
      payload.created_by = state.user?.email || null;
      const ref = await addDoc(collection(db, 'protocols'), payload);
      savedId = ref.id;
    }

    const normalized = normalizeProtocol({ id: savedId, ...payload });
    const idx = state.data.protocols.findIndex(p => p.id === savedId);

    if (idx >= 0) state.data.protocols[idx] = normalized;
    else state.data.protocols.unshift(normalized);

    state.data.protocols.sort((a, b) =>
      (a.category || '').localeCompare(b.category || '', 'es') ||
      (a.title || '').localeCompare(b.title || '', 'es')
    );

    initFilters();
    initChips();
    render();

    toast('Guardado ✅');
    closeModal(editor);

    if (state.selected?.id === savedId) {
      state.selected = normalized;
      renderModal(normalized);
    }
  } catch (e) {
    console.error(e);
    toast('No se pudo guardar 😵 (Rules/permisos)');
  } finally {
    if (btnSave) { btnSave.disabled = false; btnSave.textContent = prevTxt || 'Guardar'; }
  }
}

/* ---------- Events: Search / Filters ---------- */
elQ?.addEventListener('input', debounce(() => {
  state.q = elQ.value || '';
  render();
}, 140));

$('#btnClear')?.addEventListener('click', () => {
  if (elQ) elQ.value = '';
  state.q = '';
  render();
  elQ?.focus?.();
});

elCat?.addEventListener('change', () => {
  state.category = elCat.value || '';
  render();
});

elUrg?.addEventListener('change', () => {
  state.urgency = elUrg.value || '';
  render();
});

elChips?.addEventListener('click', (e) => {
  const btn = e.target.closest?.('[data-chip]');
  if (!btn) return;

  const chip = btn.dataset.chip;
  state.chip = (state.chip === chip) ? '' : chip;

  $$('[data-chip]', elChips).forEach(b =>
    b.setAttribute('aria-pressed', (b.dataset.chip === state.chip) ? 'true' : 'false')
  );

  render();
});

/* ---------- Actions ---------- */
$('#btnRandom')?.addEventListener('click', () => {
  const list = filtered();
  if (!list.length) return toast('No hay protocolos en este filtro 😅');
  const pick = list[Math.floor(Math.random() * list.length)];
  openById(pick.id);
});

$('#btnPrint')?.addEventListener('click', () => window.print());

$('#btnHelp')?.addEventListener('click', () => openModal(helpModal));
bindModal(helpModal);

$('#mClose')?.addEventListener('click', () => closeModal(modal));
bindModal(modal);

$('#btnCopy')?.addEventListener('click', () => {
  const p = state.selected; if (!p) return;
  copyText(getSelectedText(p));
});

$('#btnCase')?.addEventListener('click', () => {
  const p = state.selected; if (!p) return;
  const record = getCaseRecord(p);
  const fname = `caso_${slug(p.title)}_${record.created_at.slice(0, 10)}.json`;
  download(fname, JSON.stringify(record, null, 2));
  toast('Caso descargado 🧾');
});

$('#btnExport')?.addEventListener('click', () => {
  const payload = {
    exported_at: new Date().toISOString(),
    source: state.data.source_file || '—',
    protocols: state.data.protocols || []
  };
  download('protocolos_musicala_export.json', JSON.stringify(payload, null, 2));
  toast('Exportado ✅');
});

/* ---------- Grid open (delegation) ---------- */
elGrid?.addEventListener('click', (e) => {
  const card = e.target.closest?.('.card[data-id]');
  if (!card) return;
  openById(card.dataset.id, card);
});
elGrid?.addEventListener('keydown', (e) => {
  const card = e.target.closest?.('.card[data-id]');
  if (!card) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    openById(card.dataset.id, card);
  }
});

/* ---------- Checklist: event delegation (no listeners por checkbox) ---------- */
mChecklist?.addEventListener('change', (e) => {
  const inp = e.target?.closest?.('input[type="checkbox"][data-step]');
  if (!inp) return;

  const pid = mChecklist.dataset.pid;
  if (!pid) return;

  const idx = Number(inp.dataset.step);
  if (!Number.isFinite(idx)) return;

  const set = getCheckedSet(pid);
  if (inp.checked) set.add(idx); else set.delete(idx);
  setCheckedSet(pid, set);
});

/* ---------- Admin buttons ---------- */
$('#btnNew')?.addEventListener('click', () => openEditor(null));
$('#btnEdit')?.addEventListener('click', () => {
  const p = state.selected;
  if (!p) return;
  openEditor(p);
});

/* ---------- Editor modal bindings ---------- */
bindModal(editor);
$('#btnSave')?.addEventListener('click', saveEditor);

/* ---------- Boot ---------- */
initAuth();
load();