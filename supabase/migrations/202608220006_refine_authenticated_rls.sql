create or replace function app_private.can_read_requisition(
  target_organization_id uuid,
  target_location_id uuid,
  target_department_id uuid,
  target_destination_department_id uuid,
  target_requested_by_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_org_member(target_organization_id)
    and (
      (
        app_private.has_role(target_organization_id, array['administrator', 'manager'])
        and app_private.has_location_access(target_location_id)
      )
      or (
        target_requested_by_user_id = (select auth.uid())
        and app_private.has_location_access(target_location_id)
      )
      or app_private.has_department_access(target_department_id)
      or (
        target_destination_department_id is not null
        and app_private.has_role(target_organization_id, array['receiver'])
        and app_private.has_department_access(target_destination_department_id)
      )
    );
$$;

revoke all on function app_private.can_read_requisition(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function app_private.can_read_requisition(uuid, uuid, uuid, uuid, uuid)
  to authenticated;

