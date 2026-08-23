# Arquitectura

## Decision principal

La aplicacion es una PWA estatica independiente. Mantiene el patron sano de la
app de inventario: archivos simples, service worker que no intercepta recursos
externos, pruebas con Node y migraciones SQL separadas.

## Modulos

- `src/parser.js`: convierte dictado en lineas estructuradas.
- `src/catalog.js`: catalogo maestro, unidades y coincidencias.
- `src/requisitions.js`: pedidos, validaciones, numeracion, cambios y combinacion
  segura del historial local/remoto.
- `src/storage.js`: fachada asincrona, fallback y cola de sincronizacion.
- `src/db/indexeddb.js`: base local transaccional, stores, indices y paginacion.
- `src/db/migrate-v10.js`: copia V10 idempotente y verificacion de integridad.
- `src/exporters.js`: PDF imprimible, Excel `.xlsx` y CSV compatible con Google Sheets.
- `src/config.js`: configuracion publica del proyecto Supabase del piloto.
- `src/version.js`: version visible y referencia unica para cache busting.
- `src/supabase.js`: REST seguro con publishable key, sin secretos, con carga y
  descarga del historial.
- `src/app.js`: UI, voz, edicion, historial, catalogo y configuracion.

## Datos

IndexedDB es la fuente local principal y permite uso sin conexion. Las seis
claves V10 de `localStorage` se conservan como respaldo; una migracion automatica
copia por ID, verifica conteos y solo despues marca su finalizacion. Si IndexedDB
no esta disponible, la fachada entra en modo compatibilidad y propaga cualquier
fallo de escritura a la interfaz.

La configuracion publica incluida
conecta el piloto a Supabase. La cola sube cambios automaticamente cuando
regresa la conexion y la aplicacion descarga y combina los pedidos remotos sin
sobrescribir borradores locales mas recientes.

La cola vive en IndexedDB, consolida actualizaciones redundantes de una misma
entidad y registra intentos, ultimo error y proximo reintento con backoff. El
detalle de migracion y rollback esta en `docs/LOCAL_STORAGE_MIGRATION.md`.

La sincronizacion se puede desactivar por dispositivo. La interfaz expone
operaciones independientes para probar la conexion, subir el estado local y
descargar el estado remoto; la descarga reutiliza la misma combinacion segura
del historial y nunca vacia la base local antes de incorporar la nube.

## Actualizacion PWA

La version se toma de `package.json` y `pnpm run version:sync` actualiza los
recursos versionados. El service worker instala la nueva cache en espera y la
interfaz solicita confirmacion antes de activarla. El cambio de controlador
recarga una sola vez para evitar mezclar modulos de versiones diferentes.

## Supuestos

- La primera version exporta Excel `.xlsx` real para Excel y conserva CSV para Google Sheets.
- El PDF se genera como vista imprimible del navegador.
- La integracion directa con Google Sheets queda para una version con OAuth.
- Las ordenes avanzadas de voz se detectan, pero no modifican datos sin revision.
