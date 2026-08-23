alter table public.products alter column organization_id set not null;
alter table public.requisitions alter column organization_id set not null;
alter table public.requisitions alter column location_id set not null;
alter table public.requisitions alter column department_id set not null;
alter table public.requisition_changes alter column organization_id set not null;

alter table public.products
  add constraint products_location_organization_fk
  foreign key (location_id, organization_id)
  references public.locations(id, organization_id) on delete restrict;

alter table public.requisitions
  add constraint requisitions_id_organization_unique unique (id, organization_id),
  add constraint requisitions_location_organization_fk
    foreign key (location_id, organization_id)
    references public.locations(id, organization_id) on delete restrict,
  add constraint requisitions_department_scope_fk
    foreign key (department_id, organization_id, location_id)
    references public.departments(id, organization_id, location_id) on delete restrict,
  add constraint requisitions_destination_organization_fk
    foreign key (destination_department_id, organization_id)
    references public.departments(id, organization_id) on delete restrict;

alter table public.requisition_changes
  add constraint requisition_changes_requisition_organization_fk
  foreign key (requisition_id, organization_id)
  references public.requisitions(id, organization_id) on delete cascade;

create or replace function app_private.protect_requisition_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
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

drop trigger if exists protect_requisition_scope on public.requisitions;
create trigger protect_requisition_scope
before update on public.requisitions
for each row execute function app_private.protect_requisition_scope();

revoke all on function app_private.protect_requisition_scope() from public, anon, authenticated;

