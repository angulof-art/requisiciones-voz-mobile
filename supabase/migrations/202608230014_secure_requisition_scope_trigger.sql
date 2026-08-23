-- El trigger necesita resolver helpers de app_private sin exponer ese esquema al cliente.
alter function app_private.protect_requisition_scope() security definer;
alter function app_private.protect_requisition_scope() set search_path = '';

revoke all on function app_private.protect_requisition_scope() from public, anon, authenticated;
grant execute on function app_private.protect_requisition_scope() to postgres;
