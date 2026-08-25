import { getSupabaseClient } from "../auth/client.js?v=2.0.0-rc.2";

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
  if (error) {
    const normalized = await normalizeEmailFunctionError(error);
    console.error("Error técnico de send-requisition-email", {
      code: normalized.code,
      status: normalized.status,
      technical: normalized.technical
    });
    throw normalized;
  }
  return data;
}

export async function normalizeEmailFunctionError(error) {
  const body = await readFunctionErrorBody(error);
  const code = String(body?.code || error?.code || "unknown_error");
  const normalized = new Error(emailErrorMessage(code));
  normalized.code = code;
  normalized.isSafeForUser = true;
  normalized.status = Number(error?.context?.status || error?.status) || 0;
  normalized.technical = JSON.stringify({
    code,
    status: normalized.status,
    message: body?.error || error?.message || ""
  });
  return normalized;
}

export function emailErrorMessage(code, status = "") {
  if (code === "requisition_not_sendable") return unsendableStatusMessage(status);
  return {
    revision_changed: "El pedido cambió desde que abrió esta vista. Actualice la vista previa antes de enviarlo.",
    email_disabled: "El envío por correo todavía no está habilitado. Contacte al administrador.",
    provider_not_configured: "El servicio de correo todavía no está configurado. Contacte al administrador.",
    duplicate_send: "Esta versión del pedido ya fue enviada a estos destinatarios.",
    recipient_required: "Seleccione al menos un destinatario.",
    required_recipient_missing: "Falta un destinatario obligatorio para esta distribución.",
    recipient_not_authorized: "Uno de los destinatarios ya no está autorizado.",
    external_not_allowed: "No tiene permiso para enviar correos a destinatarios externos.",
    invalid_email: "Hay una dirección de correo inválida. Revise los destinatarios.",
    rate_limit: "Se realizaron varios envíos en poco tiempo. Espere un momento e inténtelo nuevamente.",
    permission_denied: "No tiene permiso para enviar este pedido por correo.",
    membership_required: "Su cuenta no tiene una membresía activa para enviar correos. Contacte al administrador."
  }[code] || "No se pudo enviar el correo. Inténtelo nuevamente o contacte al administrador.";
}

export function unsendableStatusMessage(status) {
  return {
    draft: "Este pedido todavía es un borrador. Envíe primero el pedido antes de distribuirlo por correo.",
    review: "Este pedido todavía está en revisión. Complete el envío del pedido antes de distribuirlo por correo.",
    voided: "Este pedido está anulado y no puede enviarse por correo.",
    rejected: "Este pedido fue rechazado y no puede enviarse por correo."
  }[status] || "Este pedido todavía no está listo para distribuirlo por correo.";
}

async function readFunctionErrorBody(error) {
  const response = error?.context;
  if (!response) return {};
  try {
    const readable = typeof response.clone === "function" ? response.clone() : response;
    return await readable.json();
  } catch {
    return {};
  }
}

function throwResultError(result) {
  if (result?.error) throw result.error;
}
