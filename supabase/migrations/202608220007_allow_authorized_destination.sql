create or replace function app_private.is_active_department_in_org(
  target_department_id uuid,
  target_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.departments d
    join public.locations l on l.id = d.location_id and l.organization_id = d.organization_id
    where d.id = target_department_id
      and d.organization_id = target_organization_id
      and d.active and l.active
  );
$$;

revoke all on function app_private.is_active_department_in_org(uuid, uuid)
  from public, anon, authenticated;
grant execute on function app_private.is_active_department_in_org(uuid, uuid)
  to authenticated;

drop policy if exists "requisitions scoped insert" on public.requisitions;
create policy "requisitions scoped insert" on public.requisitions for insert to authenticated
with check (
  requested_by_user_id = (select auth.uid())
  and app_private.has_permission(organization_id, 'requisitions.create')
  and app_private.has_location_access(location_id)
  and app_private.has_department_access(department_id)
  and (
    destination_department_id is null
    or app_private.is_active_department_in_org(destination_department_id, organization_id)
  )
);

drop policy if exists "requisitions scoped update" on public.requisitions;
create policy "requisitions scoped update" on public.requisitions for update to authenticated
using (app_private.can_update_requisition(organization_id, location_id, department_id, requested_by_user_id, status))
with check (
  app_private.can_update_requisition(organization_id, location_id, department_id, requested_by_user_id, status)
  and (
    destination_department_id is null
    or app_private.is_active_department_in_org(destination_department_id, organization_id)
  )
);

