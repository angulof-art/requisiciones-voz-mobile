# Migracion de almacenamiento local V10

## Objetivo

La Fase 2 cambia la fuente local principal de `localStorage` a IndexedDB sin
mover ni eliminar el origen. La base estable se llama `pedidos-voz-db` y usa
version interna `1`; esta version no depende de la version comercial de la app.

## Inventario V10

Las seis claves anteriores permanecen intactas:

| Clave | Estructura V10 |
| --- | --- |
| `requisiciones-voz:requisitions:v1` | Array de requisiciones |
| `requisiciones-voz:current:v1` | Requisicion actual o `null` |
| `requisiciones-voz:catalog:v1` | Array de productos |
| `requisiciones-voz:recent-names:v1` | Array ordenado de nombres |
| `requisiciones-voz:settings:v1` | Objeto de configuracion |
| `requisiciones-voz:sync-queue:v1` | Array de operaciones pendientes |

Una requisicion contiene `id`, `requisitionNumber`, `requestedBy`, `status`,
`originalTranscript`, `items`, `changes`, `createdAt`, `updatedAt`,
`confirmedAt`, `exportedAt`, `syncStatus` y `deviceInfo`. Cada linea se conserva
dentro de `items` con su propio `id`, referencias de producto, cantidad, unidad,
notas, texto original, confianza y banderas de revision.

Un producto contiene `id`, `code`, `officialName`, `category`, `defaultUnit`,
`allowedUnits`, `synonyms`, `active` y `updatedAt`. La configuracion contiene
preferencias visuales y el objeto publico `supabase`. La cola V10 contenia como
minimo `id`, `type`, `payload`, `createdAt` y `status`.

## Esquema IndexedDB

| Store | Clave | Indices |
| --- | --- | --- |
| `requisitions` | `id` | `requisitionNumber`, `status`, `createdAt`, `updatedAt`, `requestedBy` |
| `current_requisition` | `key` (`current`) | Ninguno |
| `catalog` | `id` | Ninguno |
| `settings` | `key` (`settings`) | Ninguno |
| `recent_names` | `id` normalizado | Ninguno |
| `sync_queue` | `id` | `status`, `createdAt`, `nextRetryAt` |
| `metadata` | `key` | Ninguno |

La API de `src/db/indexeddb.js` permite consultas paginadas por `limit` y
`offset`, filtros basicos y lectura descendente por `updatedAt`. El historial
puede obtener los ultimos 20 registros sin cargar los 5.000 pedidos completos.

## Proceso automatico

1. Abre IndexedDB y crea el esquema si hace falta.
2. Comprueba `migration_v10_completed`.
3. Lee y valida cada clave V10 sin modificarla.
4. Copia todos los registros validos mediante `put`, por ID, en una transaccion
   que abarca los stores de datos.
5. Verifica conteos, IDs, lineas, cambios, pedido actual, nombres y ajustes.
6. Solo despues registra `migration_v10_completed = true` y el timestamp.

Si un registro individual es invalido, queda documentado como advertencia y su
copia original permanece en `localStorage`. Los demas registros validos se
migran. Los IDs repetidos no generan copias adicionales.

## Interrupcion y reapertura

La bandera de finalizacion se escribe despues de la copia y la verificacion. Si
el navegador se cierra antes, la siguiente apertura repite `put` con las mismas
claves. Esto reemplaza el mismo registro y no duplica requisiciones, productos
ni operaciones de sincronizacion.

El pedido actual se guarda en un store independiente y cada linea permanece
anidada en la misma requisicion. La interfaz solo muestra `Guardado` cuando la
promesa de escritura termina correctamente.

## Cola y reintentos

La cola nueva agrega `dedupeKey`, `attempts`, `updatedAt`, `lastError` y
`nextRetryAt`. Las modificaciones pendientes del mismo pedido se consolidan en
el estado mas reciente. Los fallos usan esperas de 1, 5, 15 y 60 minutos; no se
ejecutan ciclos agresivos.

## Fallback y rollback

Si IndexedDB no existe o la migracion falla, `src/storage.js` usa modo
compatibilidad con las claves V10. Un error de escritura se propaga a la UI y
se muestra `Error al guardar`; no se informa un guardado falso.

El rollback consiste en publicar una version que vuelva a leer las claves V10.
Como la Fase 2 nunca ejecuta `localStorage.clear()` ni `removeItem()` sobre el
respaldo migrado, la copia anterior sigue disponible. Mientras IndexedDB sea la
fuente principal, las claves V10 se consideran un respaldo de migracion y no se
actualizan en paralelo.

## Metadata

`metadata` registra version de esquema, estado, inicio, finalizacion, reporte de
verificacion y una descripcion logica del respaldo. No duplica innecesariamente
todo el JSON V10 dentro de IndexedDB.
