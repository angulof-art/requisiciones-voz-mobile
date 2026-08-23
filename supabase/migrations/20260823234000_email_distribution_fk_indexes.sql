-- Cover the foreign-key access paths reported by the Supabase database advisor.
create index if not exists email_group_recipients_org_recipient_idx
  on public.email_distribution_group_recipients (organization_id, recipient_id);

create index if not exists email_group_recipients_org_group_idx
  on public.email_distribution_group_recipients (organization_id, group_id);

create index if not exists email_groups_created_by_idx
  on public.email_distribution_groups (created_by)
  where created_by is not null;

create index if not exists email_rules_created_by_idx
  on public.email_distribution_rules (created_by)
  where created_by is not null;

create index if not exists email_rules_org_group_idx
  on public.email_distribution_rules (organization_id, group_id);

create index if not exists email_settings_created_by_idx
  on public.email_distribution_settings (created_by)
  where created_by is not null;

create index if not exists email_recipients_created_by_idx
  on public.email_recipients (created_by)
  where created_by is not null;

create index if not exists requisition_email_sends_org_group_idx
  on public.requisition_email_sends (organization_id, distribution_group_id)
  where distribution_group_id is not null;

create index if not exists requisition_email_sends_org_requisition_idx
  on public.requisition_email_sends (organization_id, requisition_id);

create index if not exists requisition_email_sends_resend_of_idx
  on public.requisition_email_sends (resend_of_send_id)
  where resend_of_send_id is not null;
