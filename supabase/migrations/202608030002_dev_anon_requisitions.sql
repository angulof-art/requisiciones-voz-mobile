-- Pedidos por Voz v1 - acceso anon temporal de desarrollo
--
-- Esta migracion permite que la PWA estatica pruebe sincronizacion con la
-- publishable key sin usar service_role ni secretos en el frontend.
--
-- Uso recomendado:
-- - OK para demo, piloto interno o pruebas controladas.
-- - Para produccion real, retire estas politicas y use Supabase Auth.

grant select, insert, update, delete on public.products to anon;
grant select, insert, update, delete on public.requisitions to anon;
grant select, insert, update, delete on public.requisition_items to anon;
grant select, insert on public.requisition_changes to anon;

drop policy if exists "products dev anon access" on public.products;
create policy "products dev anon access" on public.products
  for all to anon
  using (workspace_id = 'main')
  with check (workspace_id = 'main');

drop policy if exists "requisitions dev anon access" on public.requisitions;
create policy "requisitions dev anon access" on public.requisitions
  for all to anon
  using (workspace_id = 'main')
  with check (workspace_id = 'main');

drop policy if exists "requisition_items dev anon access" on public.requisition_items;
create policy "requisition_items dev anon access" on public.requisition_items
  for all to anon
  using (
    exists (
      select 1
      from public.requisitions r
      where r.id = requisition_items.requisition_id
        and r.workspace_id = 'main'
    )
  )
  with check (
    exists (
      select 1
      from public.requisitions r
      where r.id = requisition_items.requisition_id
        and r.workspace_id = 'main'
    )
  );

drop policy if exists "requisition_changes dev anon access" on public.requisition_changes;
create policy "requisition_changes dev anon access" on public.requisition_changes
  for all to anon
  using (workspace_id = 'main')
  with check (workspace_id = 'main');
