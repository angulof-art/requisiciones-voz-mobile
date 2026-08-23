# Migracion remota V10

## Estrategia

La migracion remota esta separada en ocho archivos:

1. Crear organizaciones, sedes, departamentos, perfiles, membresias y roles.
2. Agregar columnas organizacionales sin eliminar columnas V10.
3. Crear Aloft San Jose, sede SJO, departamentos y ejecutar backfill.
4. Activar politicas RLS autenticadas y grants minimos.
5. Exigir contexto organizacional y relaciones consistentes.
6. Refinar lectura de destinos entre sedes sin ampliar la organizacion.
7. Permitir destinos activos de la misma organizacion sin ampliar membresias.
8. Retirar las politicas anonimas de demostracion despues de validar Auth.

`workspace_id`, `owner_id`, `requested_by` y `changed_by` permanecen. Los dos
primeros quedan deprecados para autorizacion; los dos ultimos son snapshots
historicos legibles aunque el perfil cambie.

## Backfill validado

Conteos antes y despues del backfill del 22/08/2026:

| Tabla | Antes | Despues |
| --- | ---: | ---: |
| products | 327 | 327 |
| requisitions | 8 | 8 |
| requisition_items | 53 | 53 |
| requisition_changes | 92 | 92 |

Los pedidos historicos ambiguos se asignaron a `MIGRACION`, no a un
departamento operativo inventado. La auditoria se guarda en
`app_private.migration_audit` y la transaccion aborta si cambia un conteo o
queda un contexto obligatorio vacio.

## Reversion

Las migraciones no borran datos ni columnas antiguas. Antes del corte, la app
V10 sigue funcionando mediante las politicas anonimas existentes. Despues del
corte, el procedimiento temporal de recuperacion esta en `AUTH_ROLLBACK.md`.
