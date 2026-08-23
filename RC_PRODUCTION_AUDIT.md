# Auditoria de cierre de produccion

Fecha: 23/08/2026  
Proyecto: `angulof-art/requisiciones-voz-mobile`

## 1. Commit inicial

`c40b2469e39f4f8927d3176e5fd333446da36869` sobre `main`, arbol limpio y
version `2.0.0-beta.3`.

## 2. Commit final

El commit final es el `HEAD` publicado de `2.0.0-beta.4`. Su SHA se registra en
el informe de entrega para evitar una referencia circular dentro del propio
commit.

## 3. Version

`2.0.0-beta.4`. No se promovio a `2.0.0-rc.1` porque quedan bloqueos criticos
de validacion multirrol y acceso anonimo.

## 4. Auth real

Supabase registra logins email/password exitosos para las dos cuentas, refresh
de token y revocacion de token. La restauracion, refresh y logout tambien pasan
la suite local. No se introdujeron contrasenas en codigo ni en el informe.

No se pudo repetir login interactivo de todos los roles durante esta auditoria
porque no existen credenciales operativas para requester, receiver y manager.

## 5. Usuarios validados

- Dos usuarios Auth confirmados y dos perfiles activos.
- Un usuario con membership activa en Aloft San Jose y rol `administrator`.
- El segundo usuario no tiene membership; correctamente obtiene cero
  organizaciones, sedes, departamentos, productos y requisiciones.
- No se asigno acceso artificial al segundo perfil.

## 6. Roles

`administrator` fue validado con contexto real de usuario. No existen
memberships reales para `manager`, `requester` o `receiver`, por lo que esos
roles no pueden declararse validados.

## 7. RLS matrix

| Prueba | Resultado |
| --- | --- |
| Admin lee organizacion, sede, departamentos, catalogo y pedidos propios | PASS |
| Admin no ve ni actualiza una organizacion QA ajena | PASS |
| Usuario sin membership no ve datos organizacionales | PASS |
| Cambio malicioso de `organization_id` | DENIED por RLS |
| Cambio malicioso de `location_id` | DENIED por RLS |
| Cambio malicioso de `department_id` | DENIED por constraint |
| Cambio malicioso de `destination_department_id` | DENIED por RLS |
| `requested_by_user_id` sin membership | DENIED por trigger |
| Requester real | BLOCKED: no existe cuenta asignada |
| Receiver real | BLOCKED: no existe cuenta asignada |
| Manager real | BLOCKED: no existe cuenta asignada |

Los registros temporales `QA ONLY - RC Isolation` fueron eliminados al terminar
la prueba y se verifico que no quedaran restos.

## 8. Workflow E2E

La maquina de estados, timestamps, fulfillment, auditoria y revision pasan sus
pruebas automatizadas. El servidor rechazo `draft -> delivered`; sus funciones
tambien reportan como invalidas `submitted -> closed` y `closed -> preparing`.

El flujo real Requester/Cocina -> Receiver/Bodega -> Requester no pudo
ejecutarse por falta de las memberships requeridas. Estado: **BLOCKED**.

## 9. Anonymous access

El corte `202608220008_disable_demo_anon_access.sql` no fue aplicado. La prueba
remota actual confirma que `anon` ve 327 productos, 11 requisiciones, 64 lineas
y 102 cambios, y conserva privilegios INSERT/UPDATE/DELETE. Es un riesgo
critico conocido.

No se retiro `anon` porque Auth/RLS/workflow multirrol no estan validados y el
corte prematuro puede interrumpir la operacion existente.

## 10. IndexedDB cross-user

PASS automatizado A -> B -> A para requisiciones, pedido actual, cola de sync,
configuracion, plantillas/favoritos y nombres recientes. La configuracion se
separa por usuario y organizacion. Los valores V10 sin scope se conservan y el
primer administrador puede reclamarlos sin borrarlos.

## 11. Offline

PASS automatizado para persistencia, reapertura, cola, backoff, fallback y
errores de escritura. La secuencia completa login real -> offline -> reinicio
-> reconexion queda pendiente de dispositivos y credenciales multirrol.

## 12. Conflicts

PASS automatizado. La actualizacion compara `revision_number`; una revision
remota distinta produce `sync_conflict` y no sobrescribe silenciosamente.

## 13. Voice accuracy

Dataset: 177/177, `100.00 %`. La frase operativa de seis productos produjo seis
lineas correctas; aguacate quedo marcado para revision porque `und` no coincide
con su unidad permitida, que es el comportamiento conservador esperado.

## 14. Dashboard

KPIs, faltantes, sustituciones, tiempos y agrupacion por departamento pasan
pruebas. Los filtros de fecha, sede, departamento y estado tienen cobertura
automatica. No se valido visualmente el dashboard con un manager real.

## 15. Exports

PDF, XLSX, CSV y texto de Web Share pasan pruebas con entrega parcial, falta de
existencia, sustitucion y observaciones. La hoja principal XLSX conserva solo
Producto/Cantidad/Unidad de compra; la segunda hoja contiene el detalle
operativo. El PDF se genera como binario `%PDF-1.4`.

## 16. Security scan

PASS: 80 archivos rastreados, sin secretos privados ni `service_role` en el
frontend. Data API envia la publishable key como `apikey` y el access token del
usuario como `Authorization: Bearer`.

CSP conserva `object-src 'none'` y `base-uri 'self'`. Login no presenta overflow
horizontal en 320, 360, 390, 768 y 1366 px.

## 17. Security Advisor

- INFO: `requisition_daily_sequences` tiene RLS sin policy. Es intencional: no
  tiene acceso directo del cliente y se usa mediante RPC autorizada.
- WARN: Leaked Password Protection esta desactivado. Debe activarse en Supabase
  Dashboard -> Auth -> Providers -> Email -> Prevent use of leaked passwords.
  La funcion requiere plan Pro o superior. Referencia:
  https://supabase.com/docs/guides/auth/password-security
- WARN: el RPC publico `next_requisition_number` es `SECURITY DEFINER` y puede
  ejecutarlo `authenticated`. Es intencional: `anon`/`PUBLIC` estan revocados,
  el helper privado exige `requisitions.create`, usa `auth.uid()` y el wrapper
  conserva `search_path` vacio. No se concedio acceso al esquema privado.

Las funciones `SECURITY DEFINER` auditadas tienen `search_path` vacio. Los
triggers privados no son ejecutables directamente por `PUBLIC`, `anon` ni
`authenticated`. El wrapper publico de numeracion solo permite
`authenticated` y conserva autorizacion interna.

## 18. Performance Advisor

La migracion de indices FK fue aplicada y el advisor ya no informa claves
foraneas sin indice. Solo quedan avisos INFO de indices sin uso, esperables en
tablas nuevas. Los indices `inventory_*` pertenecen a otro sistema y no fueron
modificados. El reporte de 5.000 pedidos completo en 1450.3 ms.

## 19. Migraciones

Supabase registra `add_foreign_key_indexes`, `secure_requisition_scope_trigger`,
`enforce_requisition_scope_integrity` y `secure_requisition_number_wrapper`.
Los equivalentes estan versionados en `supabase/migrations`. Tambien se agrego
el archivo idempotente `202608030004_fix_requisition_changes_upsert_grants.sql`
para representar la migracion historica remota. La unica migracion
deliberadamente pendiente es `202608220008_disable_demo_anon_access.sql`.

La RPC de numeracion genero 20/20 numeros unicos dentro de una transaccion
revertida; un usuario sin membership fue rechazado.

## 20. Riesgos pendientes

- CRITICAL: `anon` aun puede leer y escribir datos productivos V10.
- CRITICAL: no existen cuentas/memberships reales de requester, receiver y
  manager para validar RLS y workflow E2E.
- HIGH: falta la prueba offline/sync autenticada en dos dispositivos reales.
- MEDIUM: Leaked Password Protection sigue desactivado.
- LOW: la precision acustica final depende del navegador, microfono y ruido.

Pasos obligatorios antes de RC:

1. Crear o asignar memberships reales y controladas para requester, receiver y manager.
2. Ejecutar `tools/rls-matrix.mjs` con cinco sesiones autorizadas.
3. Completar workflow Cocina -> Bodega -> Cocina y prueba offline/reconexion.
4. Aplicar `202608220008_disable_demo_anon_access.sql`.
5. Verificar como `anon`: conteos cero y sin INSERT/UPDATE/DELETE.
6. Repetir advisors y toda la suite.

## 21. Estado final

**NOT READY**

La beta es mas segura y consistente, pero no cumple los criterios obligatorios
para `2.0.0-rc.1`. Mantener `2.0.0-beta.4` hasta cerrar los riesgos criticos.
