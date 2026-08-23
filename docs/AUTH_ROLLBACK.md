# Rollback temporal de Auth

Este procedimiento es solo para una recuperacion operativa breve. No revierte
ni elimina el esquema organizacional y no toca las tablas `inventory_*`.

## Antes del corte anonimo

No se requiere rollback: la migracion `disable_demo_anon_access` aun no se ha
aplicado y la aplicacion anterior conserva su acceso de demostracion.

## Despues del corte

Si Auth impide completamente la operacion, restaurar temporalmente los grants y
politicas V10 desde una migracion de emergencia revisada. Limitar siempre a
`workspace_id = 'main'` y retirar de nuevo al resolver el incidente.

```sql
grant select, insert, update, delete on public.products,
  public.requisitions, public.requisition_items, public.requisition_changes to anon;

create policy "products dev anon access" on public.products
for all to anon using (workspace_id = 'main') with check (workspace_id = 'main');
create policy "requisitions dev anon access" on public.requisitions
for all to anon using (workspace_id = 'main') with check (workspace_id = 'main');
create policy "requisition_items dev anon access" on public.requisition_items
for all to anon using (exists (
  select 1 from public.requisitions r
  where r.id = requisition_id and r.workspace_id = 'main'
)) with check (exists (
  select 1 from public.requisitions r
  where r.id = requisition_id and r.workspace_id = 'main'
));
create policy "requisition_changes dev anon access" on public.requisition_changes
for all to anon using (workspace_id = 'main') with check (workspace_id = 'main');
```

No usar `localStorage.clear`, `truncate`, `drop table` ni eliminar usuarios o
pedidos durante la recuperacion.

