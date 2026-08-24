begin;

grant select, insert, update on public.product_alias_learning to authenticated;
revoke all on public.product_alias_learning from anon, public;

commit;
