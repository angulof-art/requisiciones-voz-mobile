# Auditoria de cierre de produccion

Fecha: 23/08/2026

Proyecto: `angulof-art/requisiciones-voz-mobile`

Baseline: `2.0.0-beta.4` en `bdef7724ef4bb251942791530d9bd7df155d6ca5`

## Estado

**NOT READY** para `2.0.0-rc.1`. La entrega queda en `2.0.0-beta.5`.

Los bloqueos criticos de cuentas multirrol y acceso anonimo fueron cerrados.
Solo queda pendiente una ejecucion manual completa de offline autenticado y
cross-user en navegador/dispositivo real. La automatizacion IndexedDB A -> B ->
A pasa, pero no se convierte artificialmente en evidencia manual.

## Supabase real

Auditoria previa al cierre:

- 5 usuarios Auth confirmados y 5 perfiles.
- Aloft San Jose: 1 organizacion, 1 sede y 10 departamentos.
- 327 productos, 11 requisiciones, 64 lineas y 102 cambios antes del E2E.
- Roles configurados: administrator, manager, requester y receiver.
- La migracion `disable_demo_anon_access` no estaba aplicada al iniciar.

Se crearon tres identidades claramente QA mediante Supabase Dashboard. Sus
contrasenas temporales no se guardaron en Git, documentos ni logs. Se asignaron
manager, requester/Cocina y receiver/Bodega dentro de Aloft San Jose.

## Matriz multirrol

Con sesiones email/password distintas:

| Comprobacion | Resultado |
| --- | --- |
| Administrator: contexto, Admin y Reportes | PASS |
| Manager: login, contexto, catalogo y reportes | PASS |
| Requester: login, Cocina, catalogo y creacion | PASS |
| Receiver: login, Bodega, entrada y fulfillment | PASS |
| Requester administra catalogo/organizacion/roles | DENIED |
| Receiver crea pedidos o administra usuarios | DENIED |
| Manager escala a administrator | DENIED |
| Usuario Aloft accede a organizacion QA | DENIED |
| Usuario QA accede a Aloft | DENIED |

La organizacion temporal `QA ONLY - RC Isolation`, su sede, departamento,
producto y memberships fueron eliminados. Las tres cuentas QA se conservaron
desactivadas junto con sus memberships para mantener trazabilidad.

## IDOR y BOLA

Con token requester real se intentaron cambios directos de `organization_id`,
`location_id` y `requested_by_user_id`; todos fueron rechazados por
RLS/constraints/triggers. Tambien se comprobo aislamiento de organizacion en
ambos sentidos. La cobertura previa de `department_id` y
`destination_department_id` continua verde.

## Workflow E2E

Pedido QA: `req-rc-e2e-1787516004122`.

- Requester/Cocina creo tres lineas y envio a Bodega.
- Receiver/Bodega ejecuto submitted -> received -> preparing -> partial -> delivered.
- Tomate: 5 kg solicitados, 4 kg entregados, estado parcial.
- Cebollin: sin existencia y razon registrada.
- Pechuga: entrega completa.
- Requester ejecuto delivered -> accepted -> closed.
- Resultado remoto: `closed`, revision 8, tres lineas, siete transiciones,
  dos actores y todos los timestamps obligatorios.
- `draft -> delivered`, `submitted -> closed` y `closed -> preparing`: DENIED.

Durante el flujo se detecto y corrigio un bloqueo de UI: requester solo recibia
su departamento propio como directorio. Ahora `directoryDepartments` mantiene
todos los destinos de la organizacion mientras `departments/departmentIds`
continuan limitando el origen autorizado.

## Anonymous access

Antes: 327 productos, 11 requisiciones, 64 lineas y 102 cambios visibles y con
escritura anonima.

Despues de aplicar `202608220008_disable_demo_anon_access.sql`:

| Operacion anon | Resultado |
| --- | --- |
| SELECT products | 0 |
| SELECT requisitions | 0 |
| SELECT requisition_items | 0 |
| SELECT requisition_changes | 0 |
| INSERT/UPDATE/DELETE product | DENIED |
| INSERT/UPDATE/DELETE requisition | DENIED |

No quedan policies ni grants `anon` sobre esas tablas, directorio,
memberships o `product_alias_learning`. Una sesion administrator siguio
leyendo catalogo y pedidos despues del corte.

La verificacion remota final registro 327 productos, 12 requisiciones, 70
lineas y 132 cambios. Las tres identidades QA tienen perfil y memberships
inactivos; sus tres memberships permanecen como evidencia de auditoria. El
perfil administrator original continua activo.

## Local, offline y concurrencia

- IndexedDB automatizado A -> B -> A: PASS para pedido actual, historial, cola,
  favoritos/plantillas, recientes y settings.
- Persistencia, reapertura, fallback y backoff: PASS.
- Conflicto por `revision_number`: PASS; devuelve `sync_conflict` sin sobrescribir.
- Login requester real y persistencia local fueron iniciados, pero la prueba
  manual completa requester -> receiver -> requester fue interrumpida por el
  control externo del navegador. Queda como unico bloqueo del RC.

## Voice y exports

- Voice Engine: 177/177, 100.00 %.
- PDF, XLSX, CSV y Share: PASS con parcial, faltante, sustitucion y notas.
- 5.000 requisiciones simuladas: PASS en la suite de readiness.

## Advisors

Security Advisor:

- INFO: `requisition_daily_sequences` tiene RLS sin policy, intencional porque
  no admite acceso directo.
- WARN aceptado: `public.next_requisition_number(uuid)` es SECURITY DEFINER.
  PUBLIC y anon no ejecutan; authenticated si; el helper valida permiso con
  `auth.uid()` y `search_path` es vacio.
- WARN MEDIUM: Leaked Password Protection desactivado. Supabase lo ofrece en
  plan Pro o superior; el proyecto actual es Free.

Performance Advisor no informa `unindexed_foreign_keys`. Solo quedan indices
nuevos aun sin uso. Las tablas `inventory_*` no fueron modificadas.

## Migraciones

Supabase y Git contienen:

- `add_foreign_key_indexes`
- `secure_requisition_scope_trigger`
- `enforce_requisition_scope_integrity`
- `secure_requisition_number_wrapper`
- `disable_demo_anon_access`

## Criterio pendiente

Antes de promover a RC, ejecutar `Run cross-user local test` desde
`tools/rc-live-harness.html` con las cuentas QA reactivadas y completar tambien
una desconexion fisica de red, cierre/reapertura y sincronizacion. Hasta entonces:

**NOT READY**
