create or replace function app_private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active
  );
$$;

create or replace function app_private.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_active_user() and exists (
    select 1 from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id and o.active
    where m.organization_id = target_organization_id
      and m.user_id = (select auth.uid())
      and m.active
  );
$$;

create or replace function app_private.has_role(target_organization_id uuid, accepted_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_org_member(target_organization_id) and exists (
    select 1
    from public.organization_memberships m
    join public.membership_roles mr on mr.membership_id = m.id
    where m.organization_id = target_organization_id
      and m.user_id = (select auth.uid())
      and m.active
      and mr.role_code = any(accepted_roles)
  );
$$;

create or replace function app_private.has_permission(target_organization_id uuid, target_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_org_member(target_organization_id) and exists (
    select 1
    from public.organization_memberships m
    join public.membership_roles mr on mr.membership_id = m.id
    join public.role_permissions rp on rp.role_code = mr.role_code
    where m.organization_id = target_organization_id
      and m.user_id = (select auth.uid())
      and m.active
      and rp.permission_code = target_permission
  );
$$;

create or replace function app_private.has_location_access(target_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.locations l
    where l.id = target_location_id and l.active
      and app_private.is_org_member(l.organization_id)
      and (
        app_private.has_role(l.organization_id, array['administrator', 'manager'])
        or exists (
          select 1 from public.location_memberships lm
          where lm.location_id = l.id and lm.user_id = (select auth.uid()) and lm.active
        )
        or exists (
          select 1 from public.department_memberships dm
          where dm.location_id = l.id and dm.user_id = (select auth.uid()) and dm.active
        )
      )
  );
$$;

create or replace function app_private.has_department_access(target_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.departments d
    where d.id = target_department_id and d.active
      and app_private.is_org_member(d.organization_id)
      and app_private.has_location_access(d.location_id)
      and (
        app_private.has_role(d.organization_id, array['administrator', 'manager'])
        or exists (
          select 1 from public.department_memberships dm
          where dm.department_id = d.id and dm.user_id = (select auth.uid()) and dm.active
        )
      )
  );
$$;

create or replace function app_private.manages_user(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships mine
    join public.organization_memberships theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid()) and mine.active
      and theirs.user_id = target_user_id
      and app_private.has_permission(mine.organization_id, 'users.manage')
  );
$$;

create or replace function app_private.can_read_requisition(
  target_organization_id uuid,
  target_location_id uuid,
  target_department_id uuid,
  target_destination_department_id uuid,
  target_requested_by_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_org_member(target_organization_id)
    and app_private.has_location_access(target_location_id)
    and (
      app_private.has_role(target_organization_id, array['administrator', 'manager'])
      or target_requested_by_user_id = (select auth.uid())
      or app_private.has_department_access(target_department_id)
      or (
        target_destination_department_id is not null
        and app_private.has_department_access(target_destination_department_id)
        and app_private.has_role(target_organization_id, array['receiver'])
      )
    );
$$;

create or replace function app_private.can_update_requisition(
  target_organization_id uuid,
  target_location_id uuid,
  target_department_id uuid,
  target_requested_by_user_id uuid,
  target_status text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.has_permission(target_organization_id, 'requisitions.update')
    and app_private.has_location_access(target_location_id)
    and (
      app_private.has_role(target_organization_id, array['administrator', 'manager'])
      or (
        target_requested_by_user_id = (select auth.uid())
        and target_status in ('draft', 'review', 'confirmed', 'exported')
        and app_private.has_department_access(target_department_id)
      )
    );
$$;

create or replace function app_private.can_read_requisition_id(target_requisition_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.requisitions r
    where r.id = target_requisition_id
      and app_private.can_read_requisition(
        r.organization_id, r.location_id, r.department_id,
        r.destination_department_id, r.requested_by_user_id
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
        r.requested_by_user_id, r.status
      )
  );
$$;

revoke all on all functions in schema app_private from public, anon, authenticated;
grant execute on function app_private.is_active_user() to authenticated;
grant execute on function app_private.is_org_member(uuid) to authenticated;
grant execute on function app_private.has_role(uuid, text[]) to authenticated;
grant execute on function app_private.has_permission(uuid, text) to authenticated;
grant execute on function app_private.has_location_access(uuid) to authenticated;
grant execute on function app_private.has_department_access(uuid) to authenticated;
grant execute on function app_private.manages_user(uuid) to authenticated;
grant execute on function app_private.can_read_requisition(uuid, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function app_private.can_update_requisition(uuid, uuid, uuid, uuid, text) to authenticated;
grant execute on function app_private.can_read_requisition_id(text) to authenticated;
grant execute on function app_private.can_update_requisition_id(text) to authenticated;

drop policy if exists "products owner access" on public.products;
drop policy if exists "requisitions owner access" on public.requisitions;
drop policy if exists "requisition_items owner access" on public.requisition_items;
drop policy if exists "requisition_changes owner access" on public.requisition_changes;

create policy "organizations member read" on public.organizations for select to authenticated
using (app_private.is_org_member(id));
create policy "organizations administrator update" on public.organizations for update to authenticated
using (app_private.has_role(id, array['administrator']))
with check (app_private.has_role(id, array['administrator']));

create policy "locations scoped read" on public.locations for select to authenticated
using (app_private.has_location_access(id));
create policy "locations managed insert" on public.locations for insert to authenticated
with check (app_private.has_permission(organization_id, 'locations.manage'));
create policy "locations managed update" on public.locations for update to authenticated
using (app_private.has_permission(organization_id, 'locations.manage'))
with check (app_private.has_permission(organization_id, 'locations.manage'));

create policy "departments scoped read" on public.departments for select to authenticated
using (app_private.has_department_access(id));
create policy "departments managed insert" on public.departments for insert to authenticated
with check (app_private.has_permission(organization_id, 'departments.manage') and app_private.has_location_access(location_id));
create policy "departments managed update" on public.departments for update to authenticated
using (app_private.has_permission(organization_id, 'departments.manage'))
with check (app_private.has_permission(organization_id, 'departments.manage') and app_private.has_location_access(location_id));

create policy "profiles scoped read" on public.profiles for select to authenticated
using (id = (select auth.uid()) or app_private.manages_user(id));
create policy "profiles scoped update" on public.profiles for update to authenticated
using (id = (select auth.uid()) or app_private.manages_user(id))
with check (id = (select auth.uid()) or app_private.manages_user(id));

create policy "organization memberships scoped read" on public.organization_memberships for select to authenticated
using (user_id = (select auth.uid()) or app_private.has_permission(organization_id, 'users.manage'));
create policy "organization memberships managed insert" on public.organization_memberships for insert to authenticated
with check (app_private.has_permission(organization_id, 'users.manage'));
create policy "organization memberships managed update" on public.organization_memberships for update to authenticated
using (app_private.has_permission(organization_id, 'users.manage'))
with check (app_private.has_permission(organization_id, 'users.manage'));

create policy "location memberships scoped read" on public.location_memberships for select to authenticated
using (user_id = (select auth.uid()) or app_private.has_permission(organization_id, 'users.manage'));
create policy "location memberships managed insert" on public.location_memberships for insert to authenticated
with check (app_private.has_permission(organization_id, 'users.manage'));
create policy "location memberships managed update" on public.location_memberships for update to authenticated
using (app_private.has_permission(organization_id, 'users.manage'))
with check (app_private.has_permission(organization_id, 'users.manage'));

create policy "department memberships scoped read" on public.department_memberships for select to authenticated
using (user_id = (select auth.uid()) or app_private.has_permission(organization_id, 'users.manage'));
create policy "department memberships managed insert" on public.department_memberships for insert to authenticated
with check (app_private.has_permission(organization_id, 'users.manage'));
create policy "department memberships managed update" on public.department_memberships for update to authenticated
using (app_private.has_permission(organization_id, 'users.manage'))
with check (app_private.has_permission(organization_id, 'users.manage'));

create policy "roles authenticated read" on public.roles for select to authenticated
using (app_private.is_active_user());
create policy "permissions authenticated read" on public.permissions for select to authenticated
using (app_private.is_active_user());
create policy "role permissions authenticated read" on public.role_permissions for select to authenticated
using (app_private.is_active_user());
create policy "membership roles scoped read" on public.membership_roles for select to authenticated
using (user_id = (select auth.uid()) or app_private.has_permission(organization_id, 'users.manage'));
create policy "membership roles managed insert" on public.membership_roles for insert to authenticated
with check (app_private.has_permission(organization_id, 'users.manage'));
create policy "membership roles managed delete" on public.membership_roles for delete to authenticated
using (app_private.has_permission(organization_id, 'users.manage'));

create policy "products organization read" on public.products for select to authenticated
using (
  app_private.has_permission(organization_id, 'catalog.read')
  and (location_id is null or app_private.has_location_access(location_id))
);
create policy "products organization insert" on public.products for insert to authenticated
with check (
  app_private.has_permission(organization_id, 'catalog.manage')
  and (location_id is null or app_private.has_location_access(location_id))
);
create policy "products organization update" on public.products for update to authenticated
using (app_private.has_permission(organization_id, 'catalog.manage'))
with check (
  app_private.has_permission(organization_id, 'catalog.manage')
  and (location_id is null or app_private.has_location_access(location_id))
);

create policy "requisitions scoped read" on public.requisitions for select to authenticated
using (app_private.can_read_requisition(organization_id, location_id, department_id, destination_department_id, requested_by_user_id));
create policy "requisitions scoped insert" on public.requisitions for insert to authenticated
with check (
  requested_by_user_id = (select auth.uid())
  and app_private.has_permission(organization_id, 'requisitions.create')
  and app_private.has_location_access(location_id)
  and app_private.has_department_access(department_id)
  and (destination_department_id is null or app_private.has_department_access(destination_department_id))
);
create policy "requisitions scoped update" on public.requisitions for update to authenticated
using (app_private.can_update_requisition(organization_id, location_id, department_id, requested_by_user_id, status))
with check (app_private.can_update_requisition(organization_id, location_id, department_id, requested_by_user_id, status));

create policy "requisition items parent read" on public.requisition_items for select to authenticated
using (app_private.can_read_requisition_id(requisition_id));
create policy "requisition items parent insert" on public.requisition_items for insert to authenticated
with check (app_private.can_update_requisition_id(requisition_id));
create policy "requisition items parent update" on public.requisition_items for update to authenticated
using (app_private.can_update_requisition_id(requisition_id))
with check (app_private.can_update_requisition_id(requisition_id));
create policy "requisition items parent delete" on public.requisition_items for delete to authenticated
using (app_private.can_update_requisition_id(requisition_id));

create policy "requisition changes parent read" on public.requisition_changes for select to authenticated
using (app_private.can_read_requisition_id(requisition_id));
create policy "requisition changes parent insert" on public.requisition_changes for insert to authenticated
with check (
  organization_id is not null
  and changed_by_user_id = (select auth.uid())
  and app_private.can_update_requisition_id(requisition_id)
);
create policy "requisition changes parent update" on public.requisition_changes for update to authenticated
using (changed_by_user_id = (select auth.uid()) and app_private.can_update_requisition_id(requisition_id))
with check (changed_by_user_id = (select auth.uid()) and app_private.can_update_requisition_id(requisition_id));

grant select, update on public.organizations to authenticated;
grant select, insert, update on public.locations, public.departments to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.organization_memberships, public.location_memberships, public.department_memberships to authenticated;
grant select on public.roles, public.permissions, public.role_permissions to authenticated;
grant select, insert, delete on public.membership_roles to authenticated;
grant select, insert, update on public.products, public.requisitions, public.requisition_changes to authenticated;
grant select, insert, update, delete on public.requisition_items to authenticated;

revoke truncate, references, trigger on public.organizations, public.locations, public.departments,
  public.profiles, public.organization_memberships, public.location_memberships,
  public.department_memberships, public.roles, public.permissions, public.role_permissions,
  public.membership_roles, public.products, public.requisitions, public.requisition_items,
  public.requisition_changes from authenticated;

