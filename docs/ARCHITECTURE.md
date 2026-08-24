# Arquitectura

## Decision principal

La aplicacion es una PWA estatica independiente. Mantiene el patron sano de la
app de inventario: archivos simples, service worker que no intercepta recursos
externos, pruebas con Node y migraciones SQL separadas.

## Modulos

- `src/parser.js`: convierte dictado en lineas estructuradas.
- `src/voice-engine.js`: comandos aplicables, contexto y alias aprendidos.
- `src/catalog.js`: catalogo maestro, unidades y coincidencias.
- `src/requisitions.js`: pedidos, validaciones, numeracion, cambios y combinacion
  segura del historial local/remoto.
- `src/workflow.js`: maquina de estados, prioridades y cumplimiento por linea.
- `src/reports.js`: agregaciones puras para KPIs y reportes autorizados.
- `src/storage.js`: fachada asincrona, fallback y cola de sincronizacion.
- `src/db/indexeddb.js`: base local transaccional, stores, indices y paginacion.
- `src/db/migrate-v10.js`: copia V10 idempotente y verificacion de integridad.
- `src/exporters.js`: PDF imprimible, Excel `.xlsx` y CSV compatible con Google Sheets.
- `src/config.js`: configuracion publica del proyecto Supabase del piloto.
- `src/version.js`: version visible y referencia unica para cache busting.
- `src/supabase.js`: REST seguro con publishable key, sin secretos, con carga y
  descarga del historial.
- `src/auth/client.js`: cliente Supabase Auth fijado y configurado para PWA.
- `src/auth/session.js`: login, restauracion, renovacion, expiracion y logout.
- `src/auth/context.js`: perfil, organizacion, sede, departamento, roles y permisos.
- `src/auth/permissions.js`: controles de capacidad y filtro local equivalente a RLS.
- `src/email/distribution.js`: reglas, destinatarios, deduplicacion y split por grupo.
- `src/email/preview.js`: asuntos y vista previa HTML escapada.
- `src/email/api.js`: configuracion RLS e invocacion autenticada de correo.
- `src/email/ui.js`: formulario, administracion e historial de distribuciones.
- `src/app.js`: UI, voz, edicion, historial, catalogo y configuracion.

## Datos

IndexedDB es la fuente local principal y permite uso sin conexion. Las seis
claves V10 de `localStorage` se conservan como respaldo; una migracion automatica
copia por ID, verifica conteos y solo despues marca su finalizacion. Si IndexedDB
no esta disponible, la fachada entra en modo compatibilidad y propaga cualquier
fallo de escritura a la interfaz.

La configuracion publica incluida conecta la app a Supabase. Las llamadas de
datos usan el access token del usuario y RLS aplica el contexto organizacional.
La cola sube cambios automaticamente cuando
regresa la conexion y la aplicacion descarga y combina los pedidos remotos sin
sobrescribir borradores locales mas recientes.

La carga del contexto autenticado reintenta una sola vez los errores transitorios
de consulta. Cuando el navegador indica conexion pero la red realmente falla,
puede reutilizar el contexto local previamente validado para reabrir la PWA. Ese
fallback no se aplica a usuario inactivo, membresia ausente, permisos denegados ni
token invalido.

El flujo operativo usa origen, destino, prioridad y fecha requerida. Supabase
valida las transiciones y asigna consecutivos diarios; la bandeja receptora
permite registrar entregas parciales, faltantes y sustituciones sin ampliar el
acceso fuera de la organizacion.

IndexedDB version 2 agrega contexto autenticado e indices de organizacion y
usuario. El pedido actual usa una clave por usuario y organizacion. La cola
preserva entradas de otras sesiones, pero solo sincroniza las del contexto
activo.

La cola vive en IndexedDB, consolida actualizaciones redundantes de una misma
entidad y registra intentos, ultimo error y proximo reintento con backoff. El
detalle de migracion y rollback esta en `docs/LOCAL_STORAGE_MIGRATION.md`.

La sincronizacion optimista conserva `revisionNumber`, `lastSyncedRevision` y
`lastSyncedAt`. Una escritura remota solo actualiza la revision que el cliente
leyo; cero filas modificadas se interpreta como conflicto y deja el cambio
local pendiente para revision. La sincronizacion general procesa unicamente
los IDs presentes en la cola activa.

La sincronizacion se puede desactivar por dispositivo. La interfaz expone
operaciones independientes para probar la conexion, subir el estado local y
descargar el estado remoto; la descarga reutiliza la misma combinacion segura
del historial y nunca vacia la base local antes de incorporar la nube.

La experiencia movil deriva frecuentes del historial local y guarda plantillas
en settings del contexto aislado. La voz funciona por presion sostenida hasta
45 segundos, muestra transcripcion parcial y respeta `prefers-reduced-motion`.

Las exportaciones no dependen de servicios externos: el PDF y el XLSX se
construyen como archivos binarios en el navegador. Excel conserva una hoja
simple de tres columnas y agrega una segunda hoja operativa. Web Share usa la
hoja nativa del dispositivo y copia al portapapeles como fallback.

El historial renderiza lotes de 30 pedidos y permite cargar mas sin montar los
5.000 registros a la vez. `src/reports.js` calcula KPIs y agrupaciones sin
conceder acceso adicional: la capacidad `reports.read` y RLS siguen siendo la
autoridad.

La politica CSP permite unicamente recursos propios, blobs/datos de exportacion
y conexiones HTTPS/WSS a Supabase. `tools/security-scan.mjs` rechaza patrones de
secretos privados y `tools/production-readiness.mjs` verifica volumen,
exportaciones, CSP, service worker y paginacion.

La distribucion por correo se mantiene desacoplada del flujo de confirmacion.
La Edge Function `send-requisition-email` usa el JWT del usuario para todas las
lecturas operativas y solo crea la auditoria con privilegios administrativos
despues de validar membresia, permiso, organizacion, revision y destinatarios.
El navegador nunca recibe emails como fuente autoritativa ni secretos del
proveedor. Los detalles estan en `docs/EMAIL_DISTRIBUTION.md`.

`tools/final-browser-audit.mjs` ejecuta la prueba real de cierre con Chromium:
offline, reapertura, reconexion, sincronizacion, aislamiento A -> B -> A,
responsive y exportaciones. Recibe credenciales QA exclusivamente por entorno.

## Actualizacion PWA

La version se toma de `package.json` y `pnpm run version:sync` actualiza los
recursos versionados. El service worker instala la nueva cache en espera y la
interfaz solicita confirmacion antes de activarla. El cambio de controlador
recarga una sola vez para evitar mezclar modulos de versiones diferentes.

## Supuestos

- La primera version exporta Excel `.xlsx` real para Excel y conserva CSV para Google Sheets.
- El PDF se genera como archivo binario descargable dentro del navegador.
- La integracion directa con Google Sheets queda para una version con OAuth.
- Las ordenes avanzadas modifican el pedido mediante el motor conversacional y
  conservan deshacer; las referencias ambiguas exigen revision.
