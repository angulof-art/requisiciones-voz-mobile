alter table public.requisitions
  add column if not exists requested_by_name text,
  add column if not exists required_at timestamptz,
  add column if not exists priority text not null default 'normal',
  add column if not exists submitted_at timestamptz,
  add column if not exists received_at timestamptz,
  add column if not exists preparing_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists rejected_at timestamptz;

update public.requisitions
set requested_by_name = coalesce(nullif(requested_by_name, ''), nullif(requested_by, ''), 'Responsable histórico')
where requested_by_name is null or requested_by_name = '';

alter table public.requisitions
  alter column requested_by_name set not null,
  drop constraint if exists requisitions_status_check,
  add constraint requisitions_status_check check (status in (
    'draft', 'review', 'submitted', 'received', 'preparing', 'partial',
    'delivered', 'accepted', 'closed', 'rejected', 'voided',
    'confirmed', 'exported'
  )),
  add constraint requisitions_priority_check check (priority in ('normal', 'urgent', 'emergency'));

alter table public.requisition_items
  add column if not exists requested_quantity numeric,
  add column if not exists delivered_quantity numeric not null default 0,
  add column if not exists fulfillment_status text not null default 'requested',
  add column if not exists unavailable_reason text not null default '',
  add column if not exists substitution_product_id text references public.products(id) on delete restrict;

update public.requisition_items
set requested_quantity = quantity
where requested_quantity is null;

alter table public.requisition_items
  alter column requested_quantity set not null,
  add constraint requisition_items_requested_quantity_check check (requested_quantity > 0),
  add constraint requisition_items_delivered_quantity_check check (
    delivered_quantity >= 0 and delivered_quantity <= requested_quantity
  ),
  add constraint requisition_items_fulfillment_status_check check (fulfillment_status in (
    'requested', 'available', 'preparing', 'partial', 'delivered',
    'unavailable', 'substituted', 'rejected'
  ));

alter table public.requisition_changes
  add column if not exists device_info text not null default '',
  add column if not exists source text not null default 'app';

create table if not exists public.requisition_daily_sequences (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  sequence_date date not null,
  last_value integer not null check (last_value > 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id, sequence_date)
);
alter table public.requisition_daily_sequences enable row level security;
revoke all on public.requisition_daily_sequences from public, anon, authenticated;

create or replace function app_private.next_requisition_number(
  target_organization_id uuid,
  target_date date default (now() at time zone 'America/Costa_Rica')::date
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_value integer;
begin
  if not app_private.has_permission(target_organization_id, 'requisitions.create') then
    raise exception 'Not authorized to reserve a requisition number';
  end if;
  insert into public.requisition_daily_sequences (organization_id, sequence_date, last_value)
  values (target_organization_id, target_date, 1)
  on conflict (organization_id, sequence_date) do update
    set last_value = public.requisition_daily_sequences.last_value + 1,
        updated_at = now()
  returning last_value into next_value;
  return 'REQ-' || to_char(target_date, 'YYYYMMDD') || '-' || lpad(next_value::text, 4, '0');
end;
$$;

revoke all on function app_private.next_requisition_number(uuid, date) from public, anon, authenticated;
grant execute on function app_private.next_requisition_number(uuid, date) to authenticated;

create or replace function public.next_requisition_number(target_organization_id uuid)
returns text
language sql
security invoker
set search_path = ''
as $$
  select app_private.next_requisition_number(target_organization_id);
$$;
revoke all on function public.next_requisition_number(uuid) from public, anon;
grant execute on function public.next_requisition_number(uuid) to authenticated;

create or replace function app_private.is_allowed_requisition_transition(previous_status text, next_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select previous_status = next_status or case previous_status
    when 'draft' then next_status in ('review', 'submitted', 'confirmed', 'voided')
    when 'review' then next_status in ('draft', 'submitted', 'confirmed', 'rejected', 'voided')
    when 'submitted' then next_status in ('received', 'rejected', 'voided')
    when 'received' then next_status in ('preparing', 'rejected', 'voided')
    when 'preparing' then next_status in ('partial', 'delivered', 'rejected', 'voided')
    when 'partial' then next_status in ('preparing', 'delivered', 'rejected', 'voided')
    when 'delivered' then next_status in ('accepted', 'rejected')
    when 'accepted' then next_status = 'closed'
    when 'confirmed' then next_status in ('submitted', 'exported', 'voided')
    when 'exported' then next_status in ('closed', 'voided')
    else false
  end;
$$;

create or replace function app_private.enforce_requisition_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_name text;
begin
  if not app_private.is_allowed_requisition_transition(old.status, new.status) then
    raise exception 'Invalid requisition transition: % -> %', old.status, new.status;
  end if;
  if old.status is distinct from new.status then
    case new.status
      when 'submitted' then new.submitted_at := coalesce(new.submitted_at, now());
      when 'received' then new.received_at := coalesce(new.received_at, now());
      when 'preparing' then new.preparing_at := coalesce(new.preparing_at, now());
      when 'delivered' then new.delivered_at := coalesce(new.delivered_at, now());
      when 'accepted' then new.accepted_at := coalesce(new.accepted_at, now());
      when 'closed' then new.closed_at := coalesce(new.closed_at, now());
      when 'rejected' then new.rejected_at := coalesce(new.rejected_at, now());
      else null;
    end case;
    select display_name into actor_name from public.profiles where id = (select auth.uid());
    insert into public.requisition_changes (
      id, workspace_id, organization_id, requisition_id, action,
      previous_value, new_value, changed_at, changed_by, changed_by_user_id,
      device_info, source
    ) values (
      'chg-workflow-' || gen_random_uuid()::text,
      new.workspace_id, new.organization_id, new.id, 'workflow_transition',
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status),
      now(), coalesce(actor_name, new.requested_by_name, 'Sistema'), (select auth.uid()),
      coalesce(new.device_info, ''), 'database-trigger'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_requisition_transition on public.requisitions;
create trigger enforce_requisition_transition
before update of status on public.requisitions
for each row execute function app_private.enforce_requisition_transition();

create or replace function app_private.can_update_requisition(
  target_organization_id uuid,
  target_location_id uuid,
  target_department_id uuid,
  target_destination_department_id uuid,
  target_requested_by_user_id uuid,
  target_status text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_org_member(target_organization_id) and (
    (
      app_private.has_permission(target_organization_id, 'requisitions.update')
      and app_private.has_location_access(target_location_id)
      and (
        app_private.has_role(target_organization_id, array['administrator', 'manager'])
        or (target_requested_by_user_id = (select auth.uid()) and app_private.has_department_access(target_department_id))
      )
    )
    or (
      app_private.has_permission(target_organization_id, 'requisitions.receive')
      and target_destination_department_id is not null
      and app_private.has_department_access(target_destination_department_id)
    )
  );
$$;

create or replace function app_private.can_update_requisition_id(target_requisition_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.requisitions r
    where r.id = target_requisition_id
      and app_private.can_update_requisition(
        r.organization_id, r.location_id, r.department_id,
        r.destination_department_id, r.requested_by_user_id, r.status
      )
  );
$$;

drop policy if exists "requisitions scoped update" on public.requisitions;
create policy "requisitions scoped update" on public.requisitions for update to authenticated
using (app_private.can_update_requisition(
  organization_id, location_id, department_id, destination_department_id,
  requested_by_user_id, status
))
with check (
  app_private.can_update_requisition(
    organization_id, location_id, department_id, destination_department_id,
    requested_by_user_id, status
  )
  and (
    destination_department_id is null
    or app_private.is_active_department_in_org(destination_department_id, organization_id)
  )
);

drop function if exists app_private.can_update_requisition(uuid, uuid, uuid, uuid, text);

revoke all on function app_private.is_allowed_requisition_transition(text, text) from public, anon, authenticated;
revoke all on function app_private.enforce_requisition_transition() from public, anon, authenticated;
revoke all on function app_private.can_update_requisition(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function app_private.can_update_requisition_id(text) from public, anon, authenticated;
grant execute on function app_private.can_update_requisition(uuid, uuid, uuid, uuid, uuid, text) to authenticated;
grant execute on function app_private.can_update_requisition_id(text) to authenticated;

create index if not exists requisitions_destination_status_idx
  on public.requisitions(organization_id, destination_department_id, status, updated_at desc);
create index if not exists requisitions_priority_required_idx
  on public.requisitions(organization_id, priority, required_at);
create index if not exists requisition_items_fulfillment_idx
  on public.requisition_items(requisition_id, fulfillment_status);
create index if not exists requisition_items_substitution_product_idx
  on public.requisition_items(substitution_product_id);
