begin;

create table if not exists public.product_alias_learning (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  spoken_phrase text not null,
  normalized_phrase text not null,
  correction_count integer not null default 1 check (correction_count > 0),
  confidence_boost numeric(5,2) not null default 5 check (confidence_boost between 0 and 30),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, product_id, normalized_phrase)
);

alter table public.product_alias_learning enable row level security;

create policy "product aliases organization read"
on public.product_alias_learning for select to authenticated
using (app_private.is_org_member(organization_id));

create policy "product aliases organization insert"
on public.product_alias_learning for insert to authenticated
with check (
  app_private.is_org_member(organization_id)
  and created_by = (select auth.uid())
);

create policy "product aliases organization update"
on public.product_alias_learning for update to authenticated
using (app_private.is_org_member(organization_id))
with check (app_private.is_org_member(organization_id));

create index if not exists product_alias_learning_lookup_idx
  on public.product_alias_learning(organization_id, normalized_phrase);

commit;
