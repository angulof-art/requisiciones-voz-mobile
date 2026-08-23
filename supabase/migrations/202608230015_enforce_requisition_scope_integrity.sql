create or replace function app_private.protect_requisition_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.location_id is not null and not exists (
    select 1 from public.locations l
    where l.id = new.location_id
      and l.organization_id = new.organization_id
      and l.active
  ) then
    raise exception 'The requisition location is outside its organization';
  end if;

  if new.department_id is not null and not exists (
    select 1 from public.departments d
    where d.id = new.department_id
      and d.organization_id = new.organization_id
      and (new.location_id is null or d.location_id = new.location_id)
      and d.active
  ) then
    raise exception 'The requisition department is outside its organization or location';
  end if;

  if new.destination_department_id is not null and not exists (
    select 1 from public.departments d
    where d.id = new.destination_department_id
      and d.organization_id = new.organization_id
      and d.active
  ) then
    raise exception 'The requisition destination is outside its organization';
  end if;

  if new.requested_by_user_id is not null and not exists (
    select 1 from public.organization_memberships m
    where m.organization_id = new.organization_id
      and m.user_id = new.requested_by_user_id
      and m.active
  ) then
    raise exception 'The requisition requester is not an active organization member';
  end if;

  if not app_private.has_role(old.organization_id, array['administrator', 'manager']) and (
    new.organization_id is distinct from old.organization_id
    or new.location_id is distinct from old.location_id
    or new.requested_by_user_id is distinct from old.requested_by_user_id
  ) then
    raise exception 'The requisition organization, location and requester are immutable';
  end if;

  if row(new.requisition_number, new.requested_by, new.status, new.original_transcript,
         new.location_id, new.department_id, new.destination_department_id,
         new.requested_by_user_id, new.confirmed_at, new.exported_at)
     is distinct from
     row(old.requisition_number, old.requested_by, old.status, old.original_transcript,
         old.location_id, old.department_id, old.destination_department_id,
         old.requested_by_user_id, old.confirmed_at, old.exported_at) then
    new.revision_number := old.revision_number + 1;
  end if;
  return new;
end;
$$;

revoke all on function app_private.protect_requisition_scope() from public, anon, authenticated;
grant execute on function app_private.protect_requisition_scope() to postgres;
