begin;

insert into public.permissions (code, description) values
  ('reports.read', 'Consultar reportes operativos')
on conflict (code) do update set description = excluded.description;

insert into public.role_permissions (role_code, permission_code) values
  ('administrator', 'reports.read'),
  ('manager', 'reports.read')
on conflict do nothing;

alter table public.products add column if not exists unit_cost numeric(14,4);
alter table public.products add column if not exists supplier text;
alter table public.products add column if not exists purchase_unit text;
alter table public.products add column if not exists conversion_factor numeric(14,6);

commit;
