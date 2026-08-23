create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  slug text not null unique check (slug = lower(slug)),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  code text not null check (length(trim(code)) > 0),
  timezone text not null default 'America/Costa_Rica',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (id, organization_id)
);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  location_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  code text not null check (length(trim(code)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, code),
  unique (id, organization_id),
  unique (id, organization_id, location_id),
  foreign key (location_id, organization_id)
    references public.locations(id, organization_id) on delete restrict
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (length(trim(display_name)) > 0),
  first_name text not null default '',
  last_name text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (id, organization_id, user_id)
);

create table if not exists public.location_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  user_id uuid not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, user_id),
  foreign key (location_id, organization_id)
    references public.locations(id, organization_id) on delete restrict,
  foreign key (organization_id, user_id)
    references public.organization_memberships(organization_id, user_id) on delete restrict
);

create table if not exists public.department_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  department_id uuid not null,
  user_id uuid not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, user_id),
  foreign key (department_id, organization_id, location_id)
    references public.departments(id, organization_id, location_id) on delete restrict,
  foreign key (organization_id, user_id)
    references public.organization_memberships(organization_id, user_id) on delete restrict
);

create table if not exists public.roles (
  code text primary key,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.permissions (
  code text primary key,
  description text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_code text not null references public.roles(code) on delete restrict,
  permission_code text not null references public.permissions(code) on delete restrict,
  primary key (role_code, permission_code)
);

create table if not exists public.membership_roles (
  membership_id uuid not null,
  organization_id uuid not null,
  user_id uuid not null,
  role_code text not null references public.roles(code) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (membership_id, role_code),
  foreign key (membership_id, organization_id, user_id)
    references public.organization_memberships(id, organization_id, user_id) on delete restrict
);

create table if not exists app_private.migration_audit (
  migration_key text primary key,
  details jsonb not null default '{}'::jsonb,
  completed_at timestamptz not null default now()
);

insert into public.roles (code, name, description) values
  ('administrator', 'Administrador', 'Administra la organización y todos sus datos.'),
  ('manager', 'Gerente', 'Supervisa sedes, catálogo y requisiciones.'),
  ('requester', 'Solicitante', 'Crea y consulta requisiciones autorizadas.'),
  ('receiver', 'Receptor', 'Consulta requisiciones dirigidas a sus departamentos.')
on conflict (code) do update set name = excluded.name, description = excluded.description;

insert into public.permissions (code, description) values
  ('org.manage', 'Administrar la organización'),
  ('locations.manage', 'Administrar sedes'),
  ('departments.manage', 'Administrar departamentos'),
  ('users.manage', 'Administrar membresías y roles'),
  ('catalog.read', 'Consultar catálogo'),
  ('catalog.manage', 'Administrar catálogo'),
  ('requisitions.create', 'Crear requisiciones'),
  ('requisitions.read', 'Consultar requisiciones autorizadas'),
  ('requisitions.update', 'Modificar requisiciones autorizadas'),
  ('requisitions.receive', 'Recibir requisiciones autorizadas'),
  ('config.technical', 'Ver configuración técnica')
on conflict (code) do update set description = excluded.description;

insert into public.role_permissions (role_code, permission_code)
select 'administrator', code from public.permissions
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('manager', 'locations.manage'), ('manager', 'departments.manage'),
  ('manager', 'catalog.read'),
  ('manager', 'catalog.manage'), ('manager', 'requisitions.create'),
  ('manager', 'requisitions.read'), ('manager', 'requisitions.update'),
  ('manager', 'requisitions.receive'),
  ('requester', 'catalog.read'), ('requester', 'requisitions.create'),
  ('requester', 'requisitions.read'), ('requester', 'requisitions.update'),
  ('receiver', 'catalog.read'), ('receiver', 'requisitions.read'),
  ('receiver', 'requisitions.receive')
on conflict do nothing;

create or replace function app_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_name text;
begin
  profile_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), 'Usuario');
  insert into public.profiles (id, display_name)
  values (new.id, profile_name)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function app_private.handle_new_user();

do $$
declare table_name text;
begin
  foreach table_name in array array['organizations','locations','departments','profiles','organization_memberships','location_memberships','department_memberships']
  loop
    execute format('drop trigger if exists %I on public.%I', 'set_' || table_name || '_updated_at', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function app_private.touch_updated_at()', 'set_' || table_name || '_updated_at', table_name);
  end loop;
end $$;

create index if not exists locations_organization_id_idx on public.locations(organization_id);
create index if not exists departments_organization_location_idx on public.departments(organization_id, location_id);
create index if not exists organization_memberships_user_idx on public.organization_memberships(user_id, active);
create index if not exists location_memberships_user_idx on public.location_memberships(user_id, active);
create index if not exists department_memberships_user_idx on public.department_memberships(user_id, active);
create index if not exists membership_roles_user_org_idx on public.membership_roles(user_id, organization_id);

alter table public.organizations enable row level security;
alter table public.locations enable row level security;
alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.location_memberships enable row level security;
alter table public.department_memberships enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.membership_roles enable row level security;

revoke all on all tables in schema app_private from public, anon, authenticated;
revoke all on all functions in schema app_private from public, anon, authenticated;
revoke all on public.organizations, public.locations, public.departments, public.profiles,
  public.organization_memberships, public.location_memberships, public.department_memberships,
  public.roles, public.permissions, public.role_permissions, public.membership_roles
  from public, anon, authenticated;
