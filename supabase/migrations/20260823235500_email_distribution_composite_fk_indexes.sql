-- Match the exact column order of composite foreign keys for advisor coverage.
create index if not exists email_group_recipients_recipient_org_idx
  on public.email_distribution_group_recipients (recipient_id, organization_id);

create index if not exists email_group_recipients_group_org_idx
  on public.email_distribution_group_recipients (group_id, organization_id);

create index if not exists email_rules_group_org_idx
  on public.email_distribution_rules (group_id, organization_id);

create index if not exists requisition_email_sends_group_org_idx
  on public.requisition_email_sends (distribution_group_id, organization_id)
  where distribution_group_id is not null;

create index if not exists requisition_email_sends_requisition_org_idx
  on public.requisition_email_sends (requisition_id, organization_id);
