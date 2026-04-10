import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import admin from 'firebase-admin';

/* =============================================================================
  import-protocolos.mjs
  -----------------------------------------------------------------------------
  ✅ Importa protocols.json a Firestore
  ✅ NO depende de scripts/serviceAccount.json dentro del repo
  ✅ Usa credencial externa por variable de entorno
  ✅ Reejecutable con merge: true
  ✅ Más validaciones y logs útiles
============================================================================= */

/* -----------------------------------------------------------------------------
  Helpers
----------------------------------------------------------------------------- */
function readJsonFile(filePath, label = 'archivo JSON') {
  if (!fs.existsSync(filePath)) {
    throw new Error(`No encuentro ${label}: ${filePath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`No pude parsear ${label}: ${filePath}\n${error.message}`);
  }
}

function resolveCredentialPath() {
  const envPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    '';

  const trimmed = String(envPath).trim();

  if (!trimmed) {
    throw new Error(
      [
        'No encontré la credencial de Firebase Admin.',
        'Define una de estas variables de entorno:',
        '- GOOGLE_APPLICATION_CREDENTIALS',
        '- FIREBASE_SERVICE_ACCOUNT_PATH',
        '',
        'Ejemplo en PowerShell:',
        '$env:GOOGLE_APPLICATION_CREDENTIALS="C:\\ruta\\privada\\protocolos-musicala-serviceAccount.json"',
        'node scripts/import-protocolos.mjs'
      ].join('\n')
    );
  }

  return path.resolve(trimmed);
}

function coerceString(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function coerceArray(value) {
  return Array.isArray(value) ? value : [];
}

function coerceStep(step) {
  if (step == null) return null;

  if (typeof step === 'string') {
    const text = step.trim();
    return text ? { text } : null;
  }

  if (typeof step === 'object') {
    const textCandidate =
      step.text ??
      step.label ??
      step.name ??
      step.step ??
      step.value ??
      step.title ??
      step.description ??
      '';

    const text = String(textCandidate).trim();
    if (!text) return null;

    return {
      ...step,
      text
    };
  }

  const text = String(step).trim();
  return text ? { text } : null;
}

function normalizeTags(tags) {
  return coerceArray(tags)
    .map(t => String(t ?? '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 30);
}

function normalizeResponsables(value) {
  return coerceArray(value)
    .map(v => String(v ?? '').trim())
    .filter(Boolean)
    .slice(0, 30);
}

function buildSearch({ title, category, summary, tags, steps, responsables, flow }) {
  return [
    title,
    category,
    summary,
    tags.join(' '),
    steps.map(x => x.text).join(' '),
    responsables.join(' '),
    typeof flow === 'string' ? flow : JSON.stringify(flow ?? {})
  ]
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeProtocol(raw, index) {
  const title = coerceString(raw.title || raw.name);
  if (!title) {
    throw new Error(`El protocolo en posición ${index} no tiene título.`);
  }

  const category = coerceString(raw.category || raw.categoria || raw.area || 'General');

  const urgencyRaw = coerceString(raw.urgency || raw.priority || raw.prioridad || 'normal').toLowerCase();
  const urgency = ['urgent', 'important', 'normal'].includes(urgencyRaw) ? urgencyRaw : 'normal';

  const summary = coerceString(raw.summary || raw.resumen || raw.description);
  const tags = normalizeTags(raw.tags);
  const steps = coerceArray(raw.steps || raw.pasos).map(coerceStep).filter(Boolean);
  const responsables = normalizeResponsables(raw.responsables || raw.responsibles || raw.owners);
  const flow = raw.flow || raw.process || raw.fields?.flow || {};
  const status = coerceString(raw.status || 'active') || 'active';
  const version = Number.isFinite(raw.version) ? raw.version : Number.parseInt(raw.version, 10) || 1;

  const normalized = {
    title,
    category,
    urgency,
    summary,
    tags,
    steps,
    responsables,
    flow,
    _search: buildSearch({
      title,
      category,
      summary,
      tags,
      steps,
      responsables,
      flow
    }),
    status,
    version,
    meta: {
      source: raw?.meta?.source || 'protocols.json import',
      importedAt: admin.firestore.FieldValue.serverTimestamp(),
      generatedAt: raw?.meta?.generated_at || raw?.meta?.generatedAt || null
    }
  };

  if (raw.id != null && String(raw.id).trim()) {
    normalized.source_id = String(raw.id).trim();
  }

  return normalized;
}

/* -----------------------------------------------------------------------------
  Firebase Admin init
----------------------------------------------------------------------------- */
const serviceAccountPath = resolveCredentialPath();
const serviceAccount = readJsonFile(serviceAccountPath, 'credencial de Firebase Admin');

if (!serviceAccount.client_email || !serviceAccount.private_key || !serviceAccount.project_id) {
  throw new Error(
    `La credencial parece inválida o incompleta: ${serviceAccountPath}`
  );
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

/* -----------------------------------------------------------------------------
  Leer protocols.json
----------------------------------------------------------------------------- */
const protocolsPath = path.resolve(process.cwd(), 'protocols.json');
const rawJson = readJsonFile(protocolsPath, 'protocols.json');

const protocols = Array.isArray(rawJson)
  ? rawJson
  : Array.isArray(rawJson.protocols)
    ? rawJson.protocols
    : [];

if (!protocols.length) {
  throw new Error(
    'El JSON no trae protocolos. Esperaba un array o un objeto con { "protocols": [...] }.'
  );
}

console.log(`📦 protocols.json encontrado: ${protocolsPath}`);
console.log(`🔐 Credencial cargada desde: ${serviceAccountPath}`);
console.log(`🧾 Protocolos detectados: ${protocols.length}`);

/* -----------------------------------------------------------------------------
  Escritura masiva
----------------------------------------------------------------------------- */
const writer = db.bulkWriter();

let ok = 0;
let fail = 0;

writer.onWriteError((err) => {
  fail++;
  console.error(`❌ Write error en ${err.documentRef?.path || '(sin ruta)'}: ${err.message}`);
  return err.failedAttempts < 3;
});

for (let i = 0; i < protocols.length; i++) {
  const raw = protocols[i];

  try {
    const normalized = normalizeProtocol(raw, i);
    const id =
      (raw?.id && String(raw.id).trim()) ||
      db.collection('protocols').doc().id;

    const ref = db.collection('protocols').doc(id);

    writer.set(ref, normalized, { merge: true });
    ok++;
  } catch (error) {
    fail++;
    console.error(`❌ Error normalizando protocolo #${i + 1}: ${error.message}`);
  }
}

await writer.close();

/* -----------------------------------------------------------------------------
  Resultado
----------------------------------------------------------------------------- */
console.log('--------------------------------------------------');
console.log(`✅ Import terminado.`);
console.log(`✔️ Escrituras enviadas: ${ok}`);
console.log(`⚠️ Fallos detectados: ${fail}`);
console.log(`👉 Revisa Firebase Console → Firestore → collection "protocols"`);
console.log('--------------------------------------------------');