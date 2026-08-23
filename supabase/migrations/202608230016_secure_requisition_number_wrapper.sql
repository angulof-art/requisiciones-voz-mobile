alter function public.next_requisition_number(uuid) security definer;
alter function public.next_requisition_number(uuid) set search_path = '';

revoke all on function public.next_requisition_number(uuid) from public, anon;
grant execute on function public.next_requisition_number(uuid) to authenticated;

revoke all on function app_private.next_requisition_number(uuid, date) from public, anon, authenticated;
grant execute on function app_private.next_requisition_number(uuid, date) to postgres;
