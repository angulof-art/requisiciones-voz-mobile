# Checklist de produccion

Fecha: 23/08/2026  
Version evaluada: `2.0.0-beta.3`

| Area | Estado | Evidencia |
| --- | --- | --- |
| Auth | WARNING | Login, restauracion, refresh y logout implementados; Supabase tiene 0 usuarios y 0 perfiles. |
| RLS | WARNING | Politicas organizacionales aplicadas; la matriz multicuenta real no puede ejecutarse sin cuentas QA autorizadas. |
| Migracion | WARNING | Backfill preserva 327 productos, 8 pedidos, 53 lineas y 92 cambios; el corte anonimo permanece pendiente deliberadamente. |
| IndexedDB | PASS | Migracion idempotente, reanudable, aislada por contexto y con respaldo V10 intacto. |
| Offline | WARNING | Flujos locales automatizados pasan; falta la secuencia E2E con una sesion real. |
| Sync | WARNING | Cola, backoff y conflicto por revision pasan pruebas; falta validar contra dos cuentas/dispositivos reales. |
| Voice | PASS | 177/177 frases controladas, 100 % total y por categoria. |
| Exports | PASS | PDF binario, XLSX real de dos hojas, CSV y fallback de Share verificados. |
| PWA | PASS | Cache versionada, actualizacion controlada, instalacion y assets verificados estaticamente. |
| Security | WARNING | CSP y escaneo de secretos pasan; el acceso anonimo V10 sigue activo hasta que exista un administrador. |
| Performance | PASS | Reporte sobre 5.000 pedidos en 899,5 ms; IndexedDB soporta 1.000 productos y 5.000 pedidos. |
| Mobile | PASS | Login probado a 320 y 390 px sin overflow ni errores de consola. |
| Tests | PASS | `lint`, `test` y `build` pasan en la version evaluada. |

## Avisos remotos

- Seguridad: `requisition_daily_sequences` tiene RLS sin politicas. Es
  intencional: el cliente no recibe acceso directo y usa una funcion controlada.
  Referencia: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- Rendimiento: Supabase informa FK sin indices de cobertura. La migracion local
  `202608230013_add_foreign_key_indexes.sql` las corrige, pero aun no pudo
  aplicarse al proyecto remoto. Referencia:
  https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys

## Condiciones antes de produccion

1. Crear el administrador real con el procedimiento documentado.
2. Crear cuentas de requester y receiver de prueba en dos organizaciones.
3. Ejecutar `tools/rls-matrix.mjs` y el flujo Cocina a Bodega completo.
4. Aplicar y verificar la migracion de indices pendiente.
5. Aplicar `202608220008_disable_demo_anon_access.sql` solo despues de los pasos anteriores.
6. Repetir advisors, pruebas y smoke móvil en la URL candidata.

Estado global: **NOT READY**.
