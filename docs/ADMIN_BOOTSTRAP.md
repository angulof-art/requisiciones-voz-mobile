# Bootstrap del primer administrador

No se crean usuarios insertando filas directamente en `auth.users` y nunca se
usa una service key en el navegador.

## Procedimiento seguro

1. En Supabase Dashboard abre `Authentication > Users`.
2. Usa `Add user > Create new user` con el correo real del administrador.
3. Marca el correo como confirmado solo si la identidad fue verificada.
4. Copia el UUID visible del usuario.
5. Ejecuta el siguiente bloque en SQL Editor reemplazando unicamente el UUID:

```sql
begin;

insert into public.organization_memberships (organization_id, user_id, active)
select o.id, '<USER_UUID>'::uuid, true
from public.organizations o
where o.slug = 'aloft-san-jose'
on conflict (organization_id, user_id) do update set active = true;

insert into public.membership_roles (membership_id, organization_id, user_id, role_code)
select m.id, m.organization_id, m.user_id, 'administrator'
from public.organization_memberships m
join public.organizations o on o.id = m.organization_id
where o.slug = 'aloft-san-jose' and m.user_id = '<USER_UUID>'::uuid
on conflict do nothing;

commit;
```

6. Inicia sesion en la app y confirma organizacion, sede y departamento.
7. Usa el panel Admin para revisar las membresias existentes.

Las altas posteriores deben realizarse desde Dashboard o desde una Edge
Function autenticada exclusiva para administradores en una fase futura.

