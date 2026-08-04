-- Pedidos por Voz v1
-- Ejecutar en Supabase SQL Editor. No requiere llaves secretas en el frontend.

create extension if not exists pgcrypto;

create table if not exists public.products (
  id text primary key,
  workspace_id text not null default 'main',
  code text not null,
  official_name text not null,
  category text,
  default_unit text not null,
  allowed_units text[] not null default '{}',
  synonyms text[] not null default '{}',
  active boolean not null default true,
  owner_id uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, code)
);

create table if not exists public.requisitions (
  id text primary key,
  workspace_id text not null default 'main',
  requisition_number text not null,
  requested_by text not null,
  status text not null check (status in ('draft', 'review', 'confirmed', 'exported', 'voided')),
  original_transcript text,
  device_info text,
  owner_id uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  exported_at timestamptz,
  unique (workspace_id, requisition_number)
);

create table if not exists public.requisition_items (
  id text primary key,
  requisition_id text not null references public.requisitions(id) on delete cascade,
  product_id text references public.products(id),
  product_code text,
  product_name text not null,
  quantity numeric not null check (quantity > 0),
  unit text not null,
  notes text,
  original_text text,
  confidence numeric,
  needs_review boolean not null default false,
  unit_override boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.requisition_changes (
  id text primary key,
  workspace_id text not null default 'main',
  requisition_id text references public.requisitions(id) on delete cascade,
  action text not null,
  previous_value jsonb,
  new_value jsonb,
  changed_at timestamptz not null default now(),
  changed_by text,
  owner_id uuid default auth.uid()
);

create index if not exists products_workspace_name_idx on public.products (workspace_id, official_name);
create index if not exists requisitions_workspace_created_idx on public.requisitions (workspace_id, created_at desc);
create index if not exists requisitions_workspace_status_idx on public.requisitions (workspace_id, status);
create index if not exists requisition_items_requisition_idx on public.requisition_items (requisition_id, sort_order);
create index if not exists requisition_changes_requisition_idx on public.requisition_changes (requisition_id, changed_at desc);

alter table public.products enable row level security;
alter table public.requisitions enable row level security;
alter table public.requisition_items enable row level security;
alter table public.requisition_changes enable row level security;

drop policy if exists "products owner access" on public.products;
create policy "products owner access" on public.products
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "requisitions owner access" on public.requisitions;
create policy "requisitions owner access" on public.requisitions
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "requisition_items owner access" on public.requisition_items;
create policy "requisition_items owner access" on public.requisition_items
  for all to authenticated
  using (
    exists (
      select 1 from public.requisitions r
      where r.id = requisition_items.requisition_id
      and r.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.requisitions r
      where r.id = requisition_items.requisition_id
      and r.owner_id = auth.uid()
    )
  );

drop policy if exists "requisition_changes owner access" on public.requisition_changes;
create policy "requisition_changes owner access" on public.requisition_changes
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.requisitions to authenticated;
grant select, insert, update, delete on public.requisition_items to authenticated;
grant select, insert, update, delete on public.requisition_changes to authenticated;

-- Para pruebas locales sin autenticacion, cree politicas anon temporales solo
-- en un proyecto de desarrollo aislado. No active anon en produccion.
