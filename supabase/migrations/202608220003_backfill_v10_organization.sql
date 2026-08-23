do $$
declare
  organization_uuid uuid;
  location_uuid uuid;
  migration_department_uuid uuid;
  products_before bigint;
  requisitions_before bigint;
  items_before bigint;
  changes_before bigint;
begin
  select count(*) into products_before from public.products;
  select count(*) into requisitions_before from public.requisitions;
  select count(*) into items_before from public.requisition_items;
  select count(*) into changes_before from public.requisition_changes;

  insert into public.organizations (name, slug)
  values ('Aloft San José', 'aloft-san-jose')
  on conflict (slug) do update set name = excluded.name
  returning id into organization_uuid;

  insert into public.locations (organization_id, name, code, timezone)
  values (organization_uuid, 'Aloft San José', 'SJO', 'America/Costa_Rica')
  on conflict (organization_id, code) do update set name = excluded.name
  returning id into location_uuid;

  insert into public.departments (organization_id, location_id, name, code) values
    (organization_uuid, location_uuid, 'Cocina', 'COCINA'),
    (organization_uuid, location_uuid, 'Bodega', 'BODEGA'),
    (organization_uuid, location_uuid, 'Pastelería', 'PASTELERIA'),
    (organization_uuid, location_uuid, 'Bar', 'BAR'),
    (organization_uuid, location_uuid, 'Restaurante', 'RESTAURANTE'),
    (organization_uuid, location_uuid, 'Banquetes', 'BANQUETES'),
    (organization_uuid, location_uuid, 'Stewarding', 'STEWARDING'),
    (organization_uuid, location_uuid, 'Compras', 'COMPRAS'),
    (organization_uuid, location_uuid, 'Migración V10 - sin clasificar', 'MIGRACION')
  on conflict (location_id, code) do update set name = excluded.name;

  select id into migration_department_uuid
  from public.departments
  where organization_id = organization_uuid and location_id = location_uuid and code = 'MIGRACION';

  update public.products
  set organization_id = organization_uuid
  where organization_id is null;

  update public.requisitions
  set organization_id = coalesce(organization_id, organization_uuid),
      location_id = coalesce(location_id, location_uuid),
      department_id = coalesce(department_id, migration_department_uuid)
  where organization_id is null or location_id is null or department_id is null;

  update public.requisition_changes c
  set organization_id = r.organization_id
  from public.requisitions r
  where c.requisition_id = r.id and c.organization_id is null;

  if products_before <> (select count(*) from public.products)
    or requisitions_before <> (select count(*) from public.requisitions)
    or items_before <> (select count(*) from public.requisition_items)
    or changes_before <> (select count(*) from public.requisition_changes) then
    raise exception 'Backfill V10 changed historical record counts';
  end if;

  if exists (select 1 from public.products where organization_id is null)
    or exists (select 1 from public.requisitions where organization_id is null or location_id is null or department_id is null)
    or exists (select 1 from public.requisition_changes where organization_id is null) then
    raise exception 'Backfill V10 left mandatory organization context empty';
  end if;

  insert into app_private.migration_audit (migration_key, details)
  values ('v10_organization_backfill', jsonb_build_object(
    'organization_id', organization_uuid,
    'location_id', location_uuid,
    'migration_department_id', migration_department_uuid,
    'products', products_before,
    'requisitions', requisitions_before,
    'requisition_items', items_before,
    'requisition_changes', changes_before
  ))
  on conflict (migration_key) do update
    set details = excluded.details, completed_at = now();
end $$;

