begin;

create index if not exists department_memberships_department_scope_idx
  on public.department_memberships(department_id, organization_id, location_id);
create index if not exists department_memberships_org_user_idx
  on public.department_memberships(organization_id, user_id);
create index if not exists departments_location_org_idx
  on public.departments(location_id, organization_id);
create index if not exists location_memberships_location_org_idx
  on public.location_memberships(location_id, organization_id);
create index if not exists location_memberships_org_user_idx
  on public.location_memberships(organization_id, user_id);
create index if not exists membership_roles_membership_scope_idx
  on public.membership_roles(membership_id, organization_id, user_id);
create index if not exists membership_roles_role_code_idx
  on public.membership_roles(role_code);
create index if not exists organizations_created_by_idx
  on public.organizations(created_by) where created_by is not null;
create index if not exists product_alias_learning_created_by_idx
  on public.product_alias_learning(created_by);
create index if not exists product_alias_learning_product_id_idx
  on public.product_alias_learning(product_id);
create index if not exists products_location_id_idx
  on public.products(location_id) where location_id is not null;
create index if not exists products_location_org_idx
  on public.products(location_id, organization_id) where location_id is not null;
create index if not exists requisition_changes_req_org_idx
  on public.requisition_changes(requisition_id, organization_id);
create index if not exists requisitions_department_scope_idx
  on public.requisitions(department_id, organization_id, location_id);
create index if not exists requisitions_destination_org_idx
  on public.requisitions(destination_department_id, organization_id) where destination_department_id is not null;
create index if not exists requisitions_location_org_idx
  on public.requisitions(location_id, organization_id);
create index if not exists role_permissions_permission_code_idx
  on public.role_permissions(permission_code);

commit;
