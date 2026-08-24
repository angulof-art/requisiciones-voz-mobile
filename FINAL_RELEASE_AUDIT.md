# Auditoria final de Pedidos por Voz V2

## 1. Version

- Version evaluada: `2.0.0-rc.1`.
- Estado: **READY FOR RC**.
- Motivo de RC: el nucleo pasa; la unica dependencia pendiente es la configuracion empresarial de correo.

## 2. Commit

- Commit de correcciones auditadas: `aee61f44ed8c0b690118698e1c4164529375e6e3`.
- Commit de release: el commit apuntado por el tag `v2.0.0-rc.1`.

## 3. Fecha

- Auditoria ejecutada el 23/08/2026, zona `America/Costa_Rica`.

## 4. Arquitectura

PWA estatica mobile-first con modulos ES, IndexedDB como almacenamiento principal,
service worker versionado y Supabase para Auth, Data API, RLS y Edge Functions. El
frontend usa solo la publishable key; no contiene `service_role` ni secretos.

## 5. Auth

- Login, logout, restauracion de sesion y contexto offline: PASS.
- Usuario inactivo y membresia inactiva: DENIED.
- Un `401` transitorio al cargar el contexto se reintenta una sola vez.
- Un fallo real de red puede usar el contexto local previamente validado; errores de
  permisos, usuario inactivo o token invalido nunca usan ese fallback.

## 6. Roles

Matriz repetida para `administrator`, `manager`, `requester`, `receiver` y usuario
sin autorizacion. Los alcances de organizacion, sede, departamento, bandeja,
reportes y correo coinciden con los permisos asignados.

## 7. RLS

- RLS activa en tablas operativas y de correo.
- Requester: pedidos propios/origen autorizado.
- Receiver: pedidos destinados a su departamento.
- Manager/Administrator: acceso amplio solo dentro de su organizacion.
- Usuario sin membresia activa: cero filas operativas.

## 8. Anon

Pruebas HTTP directas sin JWT: lectura de productos, pedidos, lineas y cambios,
ademas de `INSERT`, `UPDATE`, `DELETE` y Edge Function: `401/DENIED`.
Se confirmaron cero politicas y cero grants anon/public en tablas nucleares y de
correo. `product_alias_learning` conserva tambien cero grants anon/public.

## 9. Workflow

Smoke de base ejecutado dentro de transaccion y revertido:
`draft -> submitted -> received -> preparing -> partial -> delivered -> accepted -> closed`.
Resultado final `closed`, revision 8, siete filas de auditoria y todos los timestamps.

## 10. Voice

- Dataset: `177/177` (100%).
- La frase operativa larga genero seis lineas.
- Aguacate queda en revision cuando existe ambiguedad de variante; no se sustituye
  silenciosamente.

## 11. IndexedDB

Migracion V10 idempotente, reapertura, fallback, scopes por usuario/organizacion,
cola, 1.000 productos y 5.000 pedidos: PASS. Las claves V10 de `localStorage`
permanecen como respaldo.

## 12. Offline real

Chromium real a 390 px: login online, corte de red, alta de Tomate y Lechuga,
edicion, favorito, cierre de pagina y reapertura offline. Se recuperaron sesion,
contexto, borrador, lineas, unidades, cantidades, favorito y cola: PASS.

## 13. Sync

Tras reconectar, la requisicion `REQ-20260823-024436-19ED10` llego una sola vez a
Supabase con Tomate `4 kg` y Lechuga `5 und`. No hubo numeros duplicados. Se agrego
el grant autenticado faltante de `product_alias_learning`, manteniendo RLS y anon
cerrado.

## 14. Concurrency

Revision optimista: una actualizacion desde una revision obsoleta produce
`sync_conflict`; no sobrescribe silenciosamente. PASS.

## 15. Dashboard

KPIs de pedidos, pendientes, preparando, parciales, entregados, urgentes,
faltantes y tiempo medio, con filtros por fecha, sede, departamento y estado: PASS.

## 16. Exports

Prueba real en Chromium: PDF con cabecera `%PDF`, XLSX con contenedor ZIP valido y
Share API con numero y detalle del pedido. Pruebas automatizadas cubren parciales,
faltantes, sustitucion y observaciones.

## 17. Email distribution

Modulo integrado en `main`: grupos, destinatarios, reglas, vista previa, pedido
mixto, split opcional, deduplicacion, auditoria, permisos e idempotencia. Las pruebas
cubren Verduras, Almacen/Abarrotes, Evento especial, HTML, CRLF y doble click.
`email_distribution_enabled` permanece desactivado.

El historial remoto ya contenia las tres migraciones de correo bajo versiones
`20260823232633`, `20260823232947` y `20260823233450`; no se reaplicaron ni se
duplicaron. La correccion de alias quedo aplicada como `20260824023419`.

## 18. Edge Function

`send-requisition-email` version 2, estado ACTIVE y `verify_jwt=true`. Anon es
rechazado. La funcion valida membresia, permiso, organizacion, revision,
destinatarios y envio externo antes de usar el proveedor.

## 19. Email provider

- `RESEND_API_KEY`: NOT CONFIGURED.
- `REQUISITION_EMAIL_FROM`: NOT CONFIGURED.
- `REQUISITION_EMAIL_REPLY_TO`: NOT CONFIGURED.
- `REQUISITION_ALLOWED_ORIGINS`: NOT CONFIGURED.
- Destinatarios activos: 0.
- Prueba real de correo: NO EJECUTADA, correctamente bloqueada por falta de
  configuracion y destinatario QA autorizado.

La UI muestra: "Envío por correo todavía no configurado." y no intenta enviar.

## 20. PWA

Cache, shell offline, reapertura, service worker, aviso de actualizacion,
instalacion y cache busting por version: PASS. El cambio a `2.0.0-rc.1` genera una
cache nueva y evita dejar clientes fijados en beta.5.

## 21. CSP

`object-src 'none'` y `base-uri 'self'` siguen activos. Supabase HTTPS/WSS,
Auth, PWA, blobs de exportacion y Edge Functions permanecen permitidos.

## 22. Security Advisor

Sin avisos CRITICAL ni HIGH. Se aceptan y documentan:

- WARN intencional para `next_requisition_number`: callable por authenticated,
  con anon/PUBLIC revocados, `auth.uid()`, permiso `requisitions.create` y
  `search_path` seguro.
- WARN de leaked-password protection desactivada; depende de capacidad del plan.
- INFO de tabla de secuencias con RLS sin policies; todos los grants estan revocados.

## 23. Performance Advisor

Solo INFO por indices aun no usados, incluidos indices FK y del modulo de correo sin
trafico. No se eliminaron automaticamente.

## 24. Tests

- `pnpm run lint`: PASS.
- `pnpm test`: PASS.
- `pnpm run build`: PASS.
- `pnpm run security:scan`: PASS, 110 archivos.
- Produccion: 5.000 pedidos en 1,7 s aproximadamente.
- Browser E2E: offline, reopen, sync, A -> B -> A, favoritos, 320/360/390/768/1280,
  PDF, XLSX y Share: PASS.

## 25. Pages deployment

- URL: `https://angulof-art.github.io/requisiciones-voz-mobile/`.
- La verificacion final compara HTML, modulos, manifest, service worker y version
  publica con `main` antes de crear el tag de release.

## 26. Riesgos restantes

Unico bloqueo externo para `2.0.0`: dominio/remitente Resend verificado, secrets,
destinatarios empresariales autorizados y un envio QA real aceptado por el proveedor.
No se inventaron correos ni dominios.

## 27. Estado final

**READY FOR RC**. Core, seguridad y publicacion: PASS. Email: integrado y
desactivado de forma segura, pendiente exclusivamente de configuracion externa.
