-- Reconciles the early remote grant repair recorded as
-- fix_requisition_changes_upsert_grants. It is intentionally idempotent.
grant select, insert, update, delete on public.requisition_changes to authenticated, anon;
