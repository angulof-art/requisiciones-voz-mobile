alter table public.products
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists location_id uuid references public.locations(id) on delete restrict;

alter table public.requisitions
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists location_id uuid references public.locations(id) on delete restrict,
  add column if not exists department_id uuid references public.departments(id) on delete restrict,
  add column if not exists destination_department_id uuid references public.departments(id) on delete restrict,
  add column if not exists requested_by_user_id uuid references public.profiles(id) on delete restrict,
  add column if not exists revision_number integer not null default 1 check (revision_number > 0);

alter table public.requisition_changes
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists changed_by_user_id uuid references public.profiles(id) on delete restrict;

comment on column public.products.workspace_id is 'Legacy V10 compatibility key. Deprecated after organization_id backfill; do not use for authorization.';
comment on column public.products.owner_id is 'Legacy V10 owner snapshot. Preserved for audit; organization memberships now authorize access.';
comment on column public.requisitions.workspace_id is 'Legacy V10 compatibility key. Deprecated after organization_id backfill; do not use for authorization.';
comment on column public.requisitions.owner_id is 'Legacy V10 owner snapshot. Preserved for audit; requested_by_user_id and memberships now authorize access.';
comment on column public.requisition_changes.workspace_id is 'Legacy V10 compatibility key. Deprecated after organization_id backfill; do not use for authorization.';
comment on column public.requisition_changes.owner_id is 'Legacy V10 owner snapshot. Preserved for audit; changed_by_user_id is the authenticated actor.';
comment on column public.requisitions.requested_by is 'Immutable-readable display-name snapshot retained even when the profile changes.';
comment on column public.requisition_changes.changed_by is 'Display-name snapshot retained for historical audit.';

create index if not exists products_organization_location_idx on public.products(organization_id, location_id);
create index if not exists requisitions_organization_updated_idx on public.requisitions(organization_id, updated_at desc);
create index if not exists requisitions_location_updated_idx on public.requisitions(location_id, updated_at desc);
create index if not exists requisitions_department_updated_idx on public.requisitions(department_id, updated_at desc);
create index if not exists requisitions_destination_department_idx on public.requisitions(destination_department_id, updated_at desc);
create index if not exists requisitions_requested_by_user_idx on public.requisitions(requested_by_user_id, updated_at desc);
create index if not exists requisition_changes_organization_idx on public.requisition_changes(organization_id, changed_at desc);
create index if not exists requisition_changes_changed_by_user_idx on public.requisition_changes(changed_by_user_id);
create index if not exists requisition_items_product_id_idx on public.requisition_items(product_id);

