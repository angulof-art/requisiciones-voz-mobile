import { getSupabaseClient } from "../auth/client.js?v=2.0.0-rc.1";

export async function loadEmailConfiguration(organizationId, options = {}) {
  const client = getSupabaseClient();
  const activeOnly = options.activeOnly !== false;
  let recipientsQuery = client.from("email_recipients").select("*")
    .eq("organization_id", organizationId).order("name");
  let groupsQuery = client.from("email_distribution_groups").select("*")
    .eq("organization_id", organizationId).order("name");
  let rulesQuery = client.from("email_distribution_rules").select("*")
    .eq("organization_id", organizationId).order("priority");
  if (activeOnly) {
    recipientsQuery = recipientsQuery.eq("active", true);
    groupsQuery = groupsQuery.eq("active", true);
    rulesQuery = rulesQuery.eq("active", true);
  }
  const [settings, recipients, groups, groupRecipients, rules] = await Promise.all([
    client.from("email_distribution_settings").select("*").eq("organization_id", organizationId).maybeSingle(),
    recipientsQuery,
    groupsQuery,
    client.from("email_distribution_group_recipients").select("*")
      .eq("organization_id", organizationId).order("sort_order"),
    rulesQuery
  ]);
  for (const result of [settings, recipients, groups, groupRecipients, rules]) throwResultError(result);
  return {
    settings: settings.data || { organization_id: organizationId, enabled: false, max_recipients: 25, allow_external: false },
    recipients: recipients.data || [],
    groups: groups.data || [],
    groupRecipients: groupRecipients.data || [],
    rules: rules.data || []
  };
}

export async function loadEmailSendHistory(requisitionId) {
  const { data, error } = await getSupabaseClient()
    .from("requisition_email_sends")
    .select("*,requisition_email_send_recipients(*)")
    .eq("requisition_id", requisitionId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function saveEmailSettings(organizationId, values) {
  const { data, error } = await getSupabaseClient().from("email_distribution_settings")
    .update({
      enabled: Boolean(values.enabled),
      allow_external: Boolean(values.allowExternal),
      max_recipients: Number(values.maxRecipients) || 25
    })
    .eq("organization_id", organizationId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function saveEmailRecipient(organizationId, userId, recipient) {
  const payload = {
    organization_id: organizationId,
    name: String(recipient.name || "").trim(),
    department_label: String(recipient.departmentLabel || "").trim(),
    email: String(recipient.email || "").trim().toLowerCase(),
    recipient_type: recipient.recipientType || "other",
    active: recipient.active !== false
  };
  if (!recipient.id) payload.created_by = userId;
  const query = recipient.id
    ? getSupabaseClient().from("email_recipients").update(payload).eq("id", recipient.id)
    : getSupabaseClient().from("email_recipients").insert(payload);
  const { data, error } = await query.select("*").single();
  if (error) throw error;
  return data;
}

export async function saveDistributionGroup(organizationId, userId, group) {
  const payload = {
    organization_id: organizationId,
    name: String(group.name || "").trim(),
    code: String(group.code || "").trim().toUpperCase(),
    description: String(group.description || "").trim(),
    active: group.active !== false
  };
  if (!group.id) payload.created_by = userId;
  const query = group.id
    ? getSupabaseClient().from("email_distribution_groups").update(payload).eq("id", group.id)
    : getSupabaseClient().from("email_distribution_groups").insert(payload);
  const { data, error } = await query.select("*").single();
  if (error) throw error;
  return data;
}

export async function saveGroupRecipients(organizationId, groupId, desired, current = []) {
  const client = getSupabaseClient();
  const desiredByRecipient = new Map(desired.map((entry) => [entry.recipientId, entry]));
  const currentByRecipient = new Map(current.map((entry) => [entry.recipient_id, entry]));
  const removed = current.filter((entry) => !desiredByRecipient.has(entry.recipient_id));
  const changed = desired.filter((entry) => currentByRecipient.has(entry.recipientId));
  const added = desired.filter((entry) => !currentByRecipient.has(entry.recipientId));

  for (const entry of removed) {
    const result = await client.from("email_distribution_group_recipients").delete().eq("id", entry.id);
    throwResultError(result);
  }
  for (const entry of changed) {
    const existing = currentByRecipient.get(entry.recipientId);
    const result = await client.from("email_distribution_group_recipients").update({
      delivery_type: entry.deliveryType,
      default_selected: entry.defaultSelected,
      required: entry.required,
      sort_order: entry.sortOrder
    }).eq("id", existing.id);
    throwResultError(result);
  }
  if (added.length) {
    const result = await client.from("email_distribution_group_recipients").insert(added.map((entry) => ({
      organization_id: organizationId,
      group_id: groupId,
      recipient_id: entry.recipientId,
      delivery_type: entry.deliveryType,
      default_selected: entry.defaultSelected,
      required: entry.required,
      sort_order: entry.sortOrder
    })));
    throwResultError(result);
  }
}

export async function saveDistributionRule(organizationId, userId, rule) {
  const payload = {
    organization_id: organizationId,
    name: String(rule.name || "").trim(),
    rule_type: rule.ruleType,
    match_value: String(rule.matchValue || "").trim(),
    group_id: rule.groupId,
    priority: Number(rule.priority) || 100,
    active: rule.active !== false
  };
  if (!rule.id) payload.created_by = userId;
  const query = rule.id
    ? getSupabaseClient().from("email_distribution_rules").update(payload).eq("id", rule.id)
    : getSupabaseClient().from("email_distribution_rules").insert(payload);
  const { data, error } = await query.select("*").single();
  if (error) throw error;
  return data;
}

export async function sendRequisitionEmail(payload) {
  const { data, error } = await getSupabaseClient().functions.invoke("send-requisition-email", { body: payload });
  if (error) throw error;
  return data;
}

function throwResultError(result) {
  if (result?.error) throw result.error;
}
