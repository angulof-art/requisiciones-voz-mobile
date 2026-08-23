# Auth, contexto y RLS

## Jerarquia

La autorizacion sigue esta jerarquia:

```text
organization -> location -> department -> membership -> role -> permission
```

Los roles iniciales son `administrator`, `manager`, `requester` y `receiver`.
Los permisos se resuelven desde `membership_roles`, `role_permissions` y las
membresias activas. `user_metadata` nunca se usa para autorizar.

## Sesion cliente

`src/auth/client.js` crea el cliente con la publishable key publica. Auth
persiste y renueva la sesion; `src/auth/session.js` controla login, logout,
expiracion y recuperacion offline. Toda llamada REST de datos envia:

```text
apikey: <publishable key>
Authorization: Bearer <access token del usuario>
```

No se incluye ni se necesita `service_role` en frontend.

## Contexto activo

`src/auth/context.js` carga perfil, organizaciones, sedes, departamentos, roles
y permisos autorizados por RLS. La seleccion activa se valida contra los datos
remotos y se conserva por usuario en IndexedDB para una reapertura offline con
sesion aun valida.

## Aislamiento local

Pedidos, pedido actual y cola guardan `userId`/`organizationId`. Los borradores
de otro usuario u organizacion no se muestran ni se sincronizan. Cerrar sesion
no borra datos y advierte cuando existen cambios pendientes. Los datos locales
V10 sin contexto solo pueden ser reclamados una vez por un administrador.

## RLS

Las funciones auxiliares viven en `app_private`, usan `security definer`,
`search_path` vacio, nombres calificados y permisos de ejecucion limitados a
`authenticated`. Las politicas separan lectura, insercion, actualizacion y
eliminacion. Las tablas operativas no conceden `truncate` al cliente.

La matriz obligatoria antes del corte anonimo cubre:

- Organizacion A no puede leer ni escribir Organizacion B.
- Solicitante solo opera sus pedidos y departamentos asignados.
- Receptor solo consulta destinos asignados.
- Gerente opera las sedes autorizadas de su organizacion.
- Administrador gestiona su organizacion, nunca otra.
- IDs extranjeros enviados manualmente son rechazados por RLS/FK.

## Estado del piloto

Al 23/08/2026 el proyecto remoto tiene 2 usuarios, 2 perfiles y 1 membership
activa con rol administrator. Faltan memberships reales de requester, receiver
y manager, por lo que `tools/rls-matrix.mjs` no pudo completarse. La migracion
`202608220008_disable_demo_anon_access.sql` permanece deliberadamente sin
aplicar hasta ejecutar la matriz y el workflow E2E. No se debe asignar acceso
artificial al perfil que actualmente no tiene membership.
