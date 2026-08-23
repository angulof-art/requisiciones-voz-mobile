# Offline y sincronizacion

## Fuente local

IndexedDB es la fuente principal del dispositivo. Los pedidos, el pedido actual,
el catalogo, los nombres recientes, la configuracion y la cola se guardan en
stores separados. Las claves V10 de `localStorage` siguen intactas como respaldo.

El contexto local incluye usuario, organizacion, sede y departamento. Un cambio
de sesion no borra datos, pero tampoco permite que otro usuario vea o sincronice
el borrador privado anterior.

## Guardado

La interfaz muestra `Guardando`, `Guardado`, `Pendiente` o `Error al guardar`
segun el resultado real de IndexedDB. Nunca confirma un guardado antes de que la
transaccion termine. Si IndexedDB no esta disponible, se usa el modo de
compatibilidad con `localStorage` y los fallos se muestran al usuario.

## Cola

Cada entrada conserva ID, tipo, referencia, estado, intentos, fechas, ultimo
error y proximo reintento. Las actualizaciones repetidas del mismo pedido se
consolidan cuando no cambia su significado. El backoff evita reintentos
agresivos.

Solo se suben los pedidos asociados a entradas pendientes del contexto activo.
La cola de otros usuarios permanece almacenada y no se procesa en una sesion
ajena.

## Conflictos

Cada pedido usa `revisionNumber` y `lastSyncedRevision`. Una actualizacion remota
incluye la revision conocida en la condicion de escritura. Si el servidor ya
tiene otra revision, la API devuelve conflicto y la aplicacion conserva el
cambio local pendiente en vez de sobrescribir silenciosamente el servidor.

## Recuperacion

1. Reabrir la aplicacion con la misma cuenta.
2. Confirmar que el indicador local muestre `Guardado` o `Pendiente`.
3. Recuperar conexion.
4. Usar sincronizacion automatica o `Subir local`.
5. Ante un conflicto, revisar la version local y la remota antes de reintentar.

No usar `localStorage.clear`, borrar IndexedDB ni vaciar la cola para resolver
errores. Esas acciones eliminan las copias de recuperacion.

## Verificacion

`tools/indexeddb-smoke.mjs` prueba migracion, reapertura, corrupcion parcial,
interrupcion y grandes volumenes. `tools/concurrency-smoke.mjs` prueba deteccion
de revision obsoleta. La prueba E2E autenticada de desconexion y reconexion sigue
pendiente hasta crear las cuentas operativas reales descritas en
`docs/ADMIN_BOOTSTRAP.md`.
