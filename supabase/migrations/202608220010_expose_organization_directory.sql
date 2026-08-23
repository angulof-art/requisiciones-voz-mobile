begin;

drop policy if exists "locations scoped read" on public.locations;
create policy "locations organization member read"
on public.locations
for select
to authenticated
using (
  active
  and app_private.is_org_member(organization_id)
);

drop policy if exists "departments scoped read" on public.departments;
create policy "departments organization member read"
on public.departments
for select
to authenticated
using (
  active
  and app_private.is_org_member(organization_id)
);

commit;
