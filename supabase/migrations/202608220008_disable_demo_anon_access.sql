drop policy if exists "products dev anon access" on public.products;
drop policy if exists "requisitions dev anon access" on public.requisitions;
drop policy if exists "requisition_items dev anon access" on public.requisition_items;
drop policy if exists "requisition_changes dev anon access" on public.requisition_changes;

revoke all on
  public.products,
  public.requisitions,
  public.requisition_items,
  public.requisition_changes,
  public.product_alias_learning
from anon;

comment on table public.requisitions is 'Phase 3: authenticated, organization-scoped requisitions. Anonymous Data API access disabled.';
