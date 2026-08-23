# Checklist de produccion

Fecha: 23/08/2026  
Version evaluada: `2.0.0-beta.4`

| Area | Estado | Evidencia |
| --- | --- | --- |
| Auth | WARNING | Dos usuarios y perfiles reales; uno es administrador. Faltan memberships requester/receiver/manager. |
| RLS | WARNING | Admin, aislamiento A/B y manipulacion maliciosa probados; matriz multirrol bloqueada. |
| Migracion | WARNING | 327 productos, 11 pedidos, 64 lineas y 102 cambios preservados; corte anon pendiente. |
| IndexedDB | PASS | Migracion idempotente y aislamiento A/B de borradores, cola, preferencias y nombres. |
| Offline | WARNING | Flujos locales automatizados pasan; falta la secuencia E2E con una sesion real. |
| Sync | WARNING | Cola, backoff y conflicto por revision pasan pruebas; falta validar contra dos cuentas/dispositivos reales. |
| Voice | PASS | 177/177 frases controladas, 100 % total y por categoria. |
| Exports | PASS | PDF, XLSX, CSV y Share incluyen parcial, faltante, sustitucion y notas. |
| PWA | PASS | Cache versionada, actualizacion controlada, instalacion y assets verificados estaticamente. |
| Security | WARNING | CSP y scan pasan; `anon` aun ve/escribe datos y leaked-password protection esta desactivado. |
| Performance | PASS | Reporte de 5.000 pedidos en 1450,3 ms; indices FK remotos aplicados. |
| Mobile | PASS | Login sin overflow a 320, 360, 390, 768 y 1366 px. |
| Tests | PASS | `lint`, `test` y `build` pasan en la version evaluada. |

## Avisos remotos

- Seguridad: `requisition_daily_sequences` tiene RLS sin politicas. Es
  intencional: el cliente no recibe acceso directo y usa una funcion controlada.
  Referencia: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- Seguridad: Leaked Password Protection esta desactivado. Activar en Auth ->
  Providers -> Email si el plan lo permite:
  https://supabase.com/docs/guides/auth/password-security
- Seguridad: el RPC definer de numeracion es intencional, restringido a
  `authenticated` y vuelve a comprobar `requisitions.create` internamente.
- Rendimiento: sin FK faltantes; solo avisos INFO de indices aun no utilizados.

## Condiciones antes de produccion

1. Crear memberships requester, receiver y manager de prueba controladas.
2. Mantener el administrador real existente.
3. Ejecutar `tools/rls-matrix.mjs` y el flujo Cocina a Bodega completo.
4. Completar offline/reconexion con dos dispositivos reales.
5. Aplicar `202608220008_disable_demo_anon_access.sql` solo despues de los pasos anteriores.
6. Repetir advisors, pruebas y smoke móvil en la URL candidata.

Estado global: **NOT READY**.
