# Correccion del incidente de envio por correo

## Resultado

**NOT READY**

La correccion de estado, numeracion canonica, errores y duplicados esta publicada y
validada. Sin embargo, la prueba real `submitted -> send-requisition-email` alcanzo
la funcion y respondio `503 provider_not_configured`. No se declara READY hasta que
el administrador configure el proveedor de correo en Supabase sin exponer secretos.

## 1. Causa exacta del HTTP 409

La Edge Function desplegada, version 2 con `verify_jwt=true`, recibio correctamente
la solicitud autenticada y encontro la requisicion
`req-43497c02-d66e-40f3-81ca-d560ace733c6` en `status=draft`. El backend aplico su
proteccion prevista y devolvio `409 requisition_not_sendable`. No se retiro ni se
debilito esta validacion.

La UI permitia llegar al correo porque al confirmar o editar no cambiaba
`syncStatus` a `pending`. El navegador podia conservar `submitted/synced` aunque la
fila remota continuara en `draft`.

## 2. Causa de la desincronizacion del numero

La auditoria remota contiene el cambio
`numero_ajustado_por_sincronizacion`: `REQ-20260822-0001` fue sustituido por el
fallback local `REQ-20260822-001924-E733C6`. El sincronizador comprobaba colisiones
por numero, pero no consultaba primero si el mismo `id` ya tenia un numero canonico
en Supabase. Ademas, `serverNumberReserved` no se persistia al normalizar y el flujo
de confirmacion podia reservar otro numero al reabrir un borrador sincronizado.

Por eso el navegador llego a mostrar `REQ-20260823-0005` mientras Supabase conservaba
`REQ-20260822-001924-E733C6`. La fila remota no recibio la confirmacion posterior:
su ultima actualizacion fue anterior a los intentos de correo y permanecio en draft.

## 3. Archivos modificados

- `src/supabase.js`, `src/app.js`, `src/requisitions.js`
- `src/email/api.js`, `src/email/distribution.js`, `src/email/ui.js`
- `tools/email-incident-smoke.mjs`, `tools/integration-smoke.mjs`
- `package.json`, `src/version.js`, `README.md`, `index.html` y referencias de
  version/cache sincronizadas automaticamente por `pnpm run version:sync`

## 4. Migraciones

No hubo migraciones ni cambios de esquema, RLS, roles o datos historicos.

## 5. Edge Function

No se modifico ni redesplego. Produccion conserva `send-requisition-email` version 2,
activa y con `verify_jwt=true`. La validacion remota ya era correcta.

## 6. Numero canonico

Antes de actualizar, el sincronizador consulta la fila por `id`. Si Supabase ya tiene
`requisition_number`, ese valor reemplaza el provisional local, se usa en el PATCH,
se aplica desde la representacion devuelta por el servidor y se persiste en IndexedDB.
La respuesta canonica tambien actualiza estado, revision, fechas, origen, destino,
prioridad y fecha requerida. Editar una requisicion conserva el numero y solo avanza
la revision correspondiente.

## 7. Control de draft y review

Los cambios locales se marcan `pending`. En draft, el boton principal pasa a
`Enviar pedido`; en review pasa a `Revisar pedido`. Antes de abrir distribucion y
antes del POST se vuelve a leer Supabase. Draft, review, voided y rejected se bloquean
con mensajes especificos, y el backend sigue siendo la autoridad final.

## 8. Errores tecnicos

`src/email/api.js` lee el JSON del `FunctionsHttpError` y traduce los codigos pedidos,
incluidos `revision_changed`, `requisition_not_sendable`, `provider_not_configured`,
`duplicate_send`, destinatarios, permisos, membresia y rate limit. HTTP, non-2xx,
stack traces y detalles PostgREST quedan solo en consola segura.

## 9. Doble envio

Un bloqueo de envio impide una segunda ejecucion mientras la primera esta activa. El
boton muestra `Enviando correo...`, queda deshabilitado y conserva el mismo
`clientOperationId`; el backend mantiene su idempotencia y deteccion de duplicados.

## 10. Productos duplicados

La requisicion del incidente tiene 6 filas remotas y 6 IDs distintos. Banano, papaya
y sandia repetidos correspondian a lineas agregadas separadamente, no a IDs clonados.
No se combinaron. La normalizacion y la vista previa ahora representan cada
`requisition_item.id` una sola vez; lineas legitimas con productos iguales e IDs
distintos se conservan.

## 11. Lint

`pnpm run lint`: PASS.

## 12. Tests

`pnpm test`: PASS. Incluye los siete casos del incidente, migracion/IndexedDB,
concurrencia, integracion, seguridad y 177/177 frases de voz.

## 13. Build y pruebas adicionales

- `pnpm run build`: PASS.
- E2E Chromium: PASS para offline/reapertura, sincronizacion, aislamiento A/B,
  320/360/390/768/1280, PDF, XLSX y Web Share.
- Rendimiento: 5.000 pedidos PASS; corrida final 2.481 ms.
- Prueba real de correo submitted: FAIL externo controlado,
  `503 provider_not_configured`. Los datos y cuentas QA temporales fueron retirados.

## 14. Commit

`6d81ebf6116096f551b3730653f285b9695aef9f` -
`fix: reconcile requisition state numbering and email errors`

## 15. URL publicada

`https://angulof-art.github.io/requisiciones-voz-mobile/?release=2.0.0-rc.2`

GitHub Pages run `32796677804`: SUCCESS. HTML, version, app y modulo de errores
respondieron HTTP 200; la pagina publicada muestra `2.0.0-rc.2`.

## 16. Version desplegada

`2.0.0-rc.2`

## 17. Pendiente para READY

Configurar de forma segura el secreto del proveedor Resend en Supabase y repetir la
prueba real hasta obtener HTTP 200 con `status=sent`. No se debe colocar la clave en
GitHub ni en el frontend.
