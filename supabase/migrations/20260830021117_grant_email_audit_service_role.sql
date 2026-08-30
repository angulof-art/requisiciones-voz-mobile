begin;

grant select, insert, update on public.requisition_email_sends to service_role;
grant select, insert on public.requisition_email_send_recipients to service_role;

commit;
