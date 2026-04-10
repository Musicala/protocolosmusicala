# Protocolos Musicala

Aplicación estática para consultar protocolos de Musicala con Firebase Auth y Firestore.

## Uso rápido

1. Abre `index.html` con Live Server o cualquier servidor estático.
2. Inicia sesión con Google.
3. La colección principal en Firestore es `protocols`.

## Importar protocolos a Firestore

El script de importación usa `firebase-admin` y requiere una credencial privada fuera del repo.

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\ruta\privada\protocolos-musicala-serviceAccount.json"
node scripts/import-protocolos.mjs
```

## Seguridad

- `firebase.js` expone configuración cliente de Firebase. Eso es normal y no es un secreto.
- La seguridad real depende de Firebase Auth y de las reglas de Firestore.
- La lista de admins visible en `app.js` solo controla la UI. No reemplaza reglas de Firestore.
- `protocols.json` contiene los protocolos completos. Si el repositorio o el hosting son públicos, ese archivo también queda expuesto.

## Recomendación antes de publicar

- Usar repositorio privado si `protocols.json` contiene información interna.
- No confiar en el botón de login como única barrera.
- Definir y versionar reglas de Firestore antes de abrir acceso al equipo.
