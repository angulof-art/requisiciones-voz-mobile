begin;

insert into public.permissions (code, description) values
  ('email.send', 'Enviar requisiciones por correo'),
  ('email.recipients.manage', 'Administrar destinatarios de correo'),
  ('email.groups.manage', 'Administrar grupos y reglas de distribucion'),
  ('email.send_external', 'Enviar a correos externos autorizados'),
  ('email.audit.read', 'Consultar auditoria de envios por correo')
on conflict (code) do update set description = excluded.description;

insert into public.role_permissions (role_code, permission_code) values
  ('administrator', 'email.send'),
  ('administrator', 'email.recipients.manage'),
  ('administrator', 'email.groups.manage'),
  ('administrator', 'email.send_external'),
  ('administrator', 'email.audit.read'),
  ('manager', 'email.send'),
  ('manager', 'email.groups.manage'),
  ('manager', 'email.audit.read'),
  ('requester', 'email.send')
on conflict do nothing;

create table public.email_distribution_settings (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  enabled boolean not null default false,
  provider text not null default 'resend' check (provider in ('resend')),
  allow_external boolean not null default false,
  max_recipients integer not null default 25 check (max_recipients between 1 and 50),
  created_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.email_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 120),
  department_label text not null default '' check (length(department_label) <= 120),
  email text not null check (
    length(email) between 3 and 254
    and email = lower(trim(email))
    and email ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  active boolean not null default true,
  recipient_type text not null default 'other' check (
    recipient_type in ('warehouse', 'purchasing', 'security', 'controller', 'costs', 'management', 'other')
  ),
  created_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create unique index email_recipients_org_email_unique
  on public.email_recipients (organization_id, lower(email));
create index email_recipients_org_active_idx
  on public.email_recipients (organization_id, active, recipient_type);

create table public.email_distribution_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 120),
  code text not null check (code = upper(code) and code ~ '^[A-Z0-9_-]{2,40}$'),
  description text not null default '' check (length(description) <= 500),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (id, organization_id)
);

create index email_distribution_groups_org_active_idx
  on public.email_distribution_groups (organization_id, active, name);

create table public.email_distribution_group_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  group_id uuid not null,
  recipient_id uuid not null,
  delivery_type text not null default 'to' check (delivery_type in ('to', 'cc', 'bcc')),
  default_selected boolean not null default true,
  required boolean not null default false,
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  created_at timestamptz not null default now(),
  unique (group_id, recipient_id),
  foreign key (group_id, organization_id)
    references public.email_distribution_groups(id, organization_id) on delete cascade,
  foreign key (recipient_id, organization_id)
    references public.email_recipients(id, organization_id) on delete restrict
);

create index email_group_recipients_group_sort_idx
  on public.email_distribution_group_recipients (group_id, sort_order, recipient_id);
create index email_group_recipients_recipient_idx
  on public.email_distribution_group_recipients (recipient_id);

create table public.email_distribution_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 120),
  rule_type text not null check (rule_type in ('category', 'explicit_event', 'custom')),
  match_value text not null default '' check (length(match_value) <= 160),
  group_id uuid not null,
  priority integer not null default 100 check (priority between 0 and 10000),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, rule_type, match_value),
  foreign key (group_id, organization_id)
    references public.email_distribution_groups(id, organization_id) on delete restrict
);

create index email_distribution_rules_org_active_idx
  on public.email_distribution_rules (organization_id, active, priority, rule_type);
create index email_distribution_rules_group_idx
  on public.email_distribution_rules (group_id);

create table public.requisition_email_sends (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  requisition_id text not null,
  requisition_revision integer not null check (requisition_revision > 0),
  sender_user_id uuid not null references public.profiles(id) on delete restrict,
  distribution_group_id uuid,
  distribution_group_name_snapshot text not null default '',
  subject text not null check (length(subject) between 1 and 240 and subject !~ E'[\r\n]'),
  custom_note text not null default '' check (length(custom_note) <= 2000),
  status text not null default 'pending' check (
    status in ('pending', 'sending', 'sent', 'failed', 'delivered', 'bounced', 'complained')
  ),
  provider text not null default 'resend',
  provider_message_id text,
  idempotency_key text not null check (length(idempotency_key) between 16 and 240),
  recipient_fingerprint text not null check (length(recipient_fingerprint) between 8 and 128),
  resend_of_send_id uuid references public.requisition_email_sends(id) on delete restrict,
  is_update boolean not null default false,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz,
  error_code text,
  error_message_safe text,
  unique (organization_id, idempotency_key),
  foreign key (requisition_id, organization_id)
    references public.requisitions(id, organization_id) on delete restrict,
  foreign key (distribution_group_id, organization_id)
    references public.email_distribution_groups(id, organization_id) on delete restrict
);

create index requisition_email_sends_org_created_idx
  on public.requisition_email_sends (organization_id, created_at desc);
create index requisition_email_sends_requisition_created_idx
  on public.requisition_email_sends (requisition_id, created_at desc);
create index requisition_email_sends_sender_created_idx
  on public.requisition_email_sends (sender_user_id, created_at desc);
create index requisition_email_sends_status_idx
  on public.requisition_email_sends (organization_id, status, created_at desc);

create table public.requisition_email_send_recipients (
  id uuid primary key default gen_random_uuid(),
  send_id uuid not null references public.requisition_email_sends(id) on delete restrict,
  recipient_id uuid references public.email_recipients(id) on delete restrict,
  recipient_name_snapshot text not null check (length(trim(recipient_name_snapshot)) between 1 and 120),
  email_snapshot text not null check (length(email_snapshot) between 3 and 254),
  delivery_type text not null check (delivery_type in ('to', 'cc', 'bcc')),
  created_at timestamptz not null default now(),
  unique (send_id, email_snapshot)
);

create index requisition_email_send_recipients_send_idx
  on public.requisition_email_send_recipients (send_id, delivery_type);
create index requisition_email_send_recipients_recipient_idx
  on public.requisition_email_send_recipients (recipient_id)
  where recipient_id is not null;

create trigger set_email_distribution_settings_updated_at
before update on public.email_distribution_settings
for each row execute function app_private.touch_updated_at();

create trigger set_email_recipients_updated_at
before update on public.email_recipients
for each row execute function app_private.touch_updated_at();

create trigger set_email_distribution_groups_updated_at
before update on public.email_distribution_groups
for each row execute function app_private.touch_updated_at();

create trigger set_email_distribution_rules_updated_at
before update on public.email_distribution_rules
for each row execute function app_private.touch_updated_at();

create or replace function app_private.ensure_email_distribution_for_organization(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  warehouse_group_id uuid;
  vegetables_group_id uuid;
  event_group_id uuid;
begin
  insert into public.email_distribution_settings (organization_id)
  values (target_id)
  on conflict (organization_id) do nothing;

  insert into public.email_distribution_groups (organization_id, name, code, description)
  values (target_id, 'Almacen / Abarrotes', 'WAREHOUSE', 'Distribucion operativa para almacen y abarrotes')
  on conflict (organization_id, code) do update set name = excluded.name
  returning id into warehouse_group_id;

  insert into public.email_distribution_groups (organization_id, name, code, description)
  values (target_id, 'Verduras', 'VEGETABLES', 'Distribucion operativa para frutas y verduras')
  on conflict (organization_id, code) do update set name = excluded.name
  returning id into vegetables_group_id;

  insert into public.email_distribution_groups (organization_id, name, code, description)
  values (target_id, 'Evento especial', 'SPECIAL_EVENT', 'Distribucion explicita para eventos especiales')
  on conflict (organization_id, code) do update set name = excluded.name
  returning id into event_group_id;

  insert into public.email_distribution_rules
    (organization_id, name, rule_type, match_value, group_id, priority)
  values
    (target_id, 'Categoria Abarrotes', 'category', 'Abarrotes', warehouse_group_id, 100),
    (target_id, 'Categoria Verduras', 'category', 'Verduras', vegetables_group_id, 100),
    (target_id, 'Evento especial explicito', 'explicit_event', 'Evento especial', event_group_id, 10)
  on conflict (organization_id, rule_type, match_value)
  do update set group_id = excluded.group_id, name = excluded.name;
end;
$$;

create or replace function app_private.seed_email_distribution_for_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.ensure_email_distribution_for_organization(new.id);
  return new;
end;
$$;

revoke all on function app_private.ensure_email_distribution_for_organization(uuid)
  from public, anon, authenticated;
revoke all on function app_private.seed_email_distribution_for_organization()
  from public, anon, authenticated;

create trigger seed_email_distribution_after_organization
after insert on public.organizations
for each row execute function app_private.seed_email_distribution_for_organization();

create or replace function app_private.seed_email_recipient_group_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.email_distribution_group_recipients
    (organization_id, group_id, recipient_id, delivery_type, default_selected, required, sort_order)
  select
    new.organization_id,
    g.id,
    new.id,
    case
      when g.code = 'WAREHOUSE' then 'to'
      when new.recipient_type = 'purchasing' then 'to'
      else 'cc'
    end,
    true,
    false,
    case new.recipient_type
      when 'purchasing' then 10
      when 'security' then 20
      when 'controller' then 30
      when 'warehouse' then 40
      when 'costs' then 50
      else 100
    end
  from public.email_distribution_groups g
  where g.organization_id = new.organization_id
    and (
      (g.code = 'WAREHOUSE' and new.recipient_type = 'warehouse')
      or (
        g.code = 'VEGETABLES'
        and new.recipient_type in ('purchasing', 'security', 'controller', 'warehouse', 'costs')
      )
      or (
        g.code = 'SPECIAL_EVENT'
        and new.recipient_type in ('purchasing', 'controller', 'warehouse', 'costs')
      )
    )
  on conflict (group_id, recipient_id) do nothing;

  return new;
end;
$$;

revoke all on function app_private.seed_email_recipient_group_defaults()
  from public, anon, authenticated;

create trigger seed_email_recipient_group_defaults_after_insert
after insert on public.email_recipients
for each row execute function app_private.seed_email_recipient_group_defaults();

do $$
declare
  organization_record record;
begin
  for organization_record in select id from public.organizations loop
    perform app_private.ensure_email_distribution_for_organization(organization_record.id);
  end loop;
end $$;

create or replace function app_private.can_read_email_configuration(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.has_permission(target_organization_id, 'email.send')
    or app_private.has_permission(target_organization_id, 'email.recipients.manage')
    or app_private.has_permission(target_organization_id, 'email.groups.manage')
    or app_private.has_permission(target_organization_id, 'email.audit.read');
$$;

create or replace function app_private.can_read_email_send(target_send_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.requisition_email_sends s
    where s.id = target_send_id
      and app_private.can_read_requisition_id(s.requisition_id)
      and (
        s.sender_user_id = (select auth.uid())
        or app_private.has_permission(s.organization_id, 'email.audit.read')
      )
  );
$$;

revoke all on function app_private.can_read_email_configuration(uuid)
  from public, anon, authenticated;
revoke all on function app_private.can_read_email_send(uuid)
  from public, anon, authenticated;
grant execute on function app_private.can_read_email_configuration(uuid) to authenticated;
grant execute on function app_private.can_read_email_send(uuid) to authenticated;

alter table public.email_distribution_settings enable row level security;
alter table public.email_recipients enable row level security;
alter table public.email_distribution_groups enable row level security;
alter table public.email_distribution_group_recipients enable row level security;
alter table public.email_distribution_rules enable row level security;
alter table public.requisition_email_sends enable row level security;
alter table public.requisition_email_send_recipients enable row level security;

create policy "email settings scoped read"
on public.email_distribution_settings for select to authenticated
using (app_private.can_read_email_configuration(organization_id));

create policy "email settings managed update"
on public.email_distribution_settings for update to authenticated
using (app_private.has_permission(organization_id, 'email.recipients.manage'))
with check (app_private.has_permission(organization_id, 'email.recipients.manage'));

create policy "email recipients scoped read"
on public.email_recipients for select to authenticated
using (app_private.can_read_email_configuration(organization_id));

create policy "email recipients managed insert"
on public.email_recipients for insert to authenticated
with check (
  app_private.has_permission(organization_id, 'email.recipients.manage')
  and created_by = (select auth.uid())
);

create policy "email recipients managed update"
on public.email_recipients for update to authenticated
using (app_private.has_permission(organization_id, 'email.recipients.manage'))
with check (
  app_private.has_permission(organization_id, 'email.recipients.manage')
  and created_by is not null
);

create policy "email groups scoped read"
on public.email_distribution_groups for select to authenticated
using (app_private.can_read_email_configuration(organization_id));

create policy "email groups managed insert"
on public.email_distribution_groups for insert to authenticated
with check (
  app_private.has_permission(organization_id, 'email.groups.manage')
  and created_by = (select auth.uid())
);

create policy "email groups managed update"
on public.email_distribution_groups for update to authenticated
using (app_private.has_permission(organization_id, 'email.groups.manage'))
with check (app_private.has_permission(organization_id, 'email.groups.manage'));

create policy "email group recipients scoped read"
on public.email_distribution_group_recipients for select to authenticated
using (app_private.can_read_email_configuration(organization_id));

create policy "email group recipients managed insert"
on public.email_distribution_group_recipients for insert to authenticated
with check (app_private.has_permission(organization_id, 'email.groups.manage'));

create policy "email group recipients managed update"
on public.email_distribution_group_recipients for update to authenticated
using (app_private.has_permission(organization_id, 'email.groups.manage'))
with check (app_private.has_permission(organization_id, 'email.groups.manage'));

create policy "email group recipients managed delete"
on public.email_distribution_group_recipients for delete to authenticated
using (app_private.has_permission(organization_id, 'email.groups.manage'));

create policy "email rules scoped read"
on public.email_distribution_rules for select to authenticated
using (app_private.can_read_email_configuration(organization_id));

create policy "email rules managed insert"
on public.email_distribution_rules for insert to authenticated
with check (
  app_private.has_permission(organization_id, 'email.groups.manage')
  and created_by = (select auth.uid())
);

create policy "email rules managed update"
on public.email_distribution_rules for update to authenticated
using (app_private.has_permission(organization_id, 'email.groups.manage'))
with check (app_private.has_permission(organization_id, 'email.groups.manage'));

create policy "email sends authorized read"
on public.requisition_email_sends for select to authenticated
using (
  app_private.can_read_requisition_id(requisition_id)
  and (
    sender_user_id = (select auth.uid())
    or app_private.has_permission(organization_id, 'email.audit.read')
  )
);

create policy "email send recipients authorized read"
on public.requisition_email_send_recipients for select to authenticated
using (app_private.can_read_email_send(send_id));

revoke all on
  public.email_distribution_settings,
  public.email_recipients,
  public.email_distribution_groups,
  public.email_distribution_group_recipients,
  public.email_distribution_rules,
  public.requisition_email_sends,
  public.requisition_email_send_recipients
from public, anon, authenticated;

grant select, update on public.email_distribution_settings to authenticated;
grant select, insert, update on public.email_recipients to authenticated;
grant select, insert, update on public.email_distribution_groups to authenticated;
grant select, insert, update, delete on public.email_distribution_group_recipients to authenticated;
grant select, insert, update on public.email_distribution_rules to authenticated;
grant select on public.requisition_email_sends, public.requisition_email_send_recipients to authenticated;

comment on table public.email_distribution_settings is 'Organization-scoped email feature flag and safe operational limits.';
comment on table public.requisition_email_sends is 'Immutable-facing audit written only by the authenticated Edge Function administrative client.';
comment on column public.requisition_email_sends.status is 'sent means the provider accepted the request; it does not prove delivery or reading.';

commit;
