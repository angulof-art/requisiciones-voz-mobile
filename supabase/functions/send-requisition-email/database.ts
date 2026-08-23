import { createClient } from "@supabase/supabase-js";
import { HttpError, normalizeEmail, validEmail } from "./validation.ts";

export function createAdminClient() {
  const url = String(Deno.env.get("SUPABASE_URL") || "");
  const secret = resolveSecretKey();
  if (!url || !secret) throw new HttpError(503, "server_not_configured", "El servicio de correo no esta configurado.");
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

export async function loadAuthorizedEmailRequest(client: any, input: any, userId: string) {
  const requisition = await one(client.from("requisitions").select([
    "id", "organization_id", "location_id", "department_id", "destination_department_id",
    "requested_by", "requested_by_name", "requested_by_user_id", "requisition_number",
    "revision_number", "priority", "required_at", "status", "created_at", "updated_at"
  ].join(",")).eq("id", input.requisitionId).single(), "requisition_not_found", "No puede consultar esta requisicion.");
  if (Number(requisition.revision_number) !== input.expectedRevision) {
    throw new HttpError(409, "revision_changed", "La requisicion cambio. Recargue la vista previa.");
  }
  if (["draft", "review", "voided", "rejected"].includes(requisition.status)) {
    throw new HttpError(409, "requisition_not_sendable", "La requisicion no esta lista para correo.");
  }

  const permissions = await loadPermissions(client, requisition.organization_id, userId);
  requirePermission(permissions, "email.send");
  const settings = await one(client.from("email_distribution_settings").select("*")
    .eq("organization_id", requisition.organization_id).single(), "email_not_configured", "El envio por correo todavia no esta configurado.");
  if (!settings.enabled) throw new HttpError(503, "email_disabled", "El envio por correo todavia no esta configurado.");

  const allItems = await many(client.from("requisition_items").select("id,product_id,product_code,product_name,quantity,unit,notes,sort_order")
    .eq("requisition_id", requisition.id).order("sort_order"), "items_unavailable", "No se pudieron cargar los productos.");
  if (!allItems.length) throw new HttpError(409, "empty_requisition", "La requisicion no tiene productos.");
  const itemIds = input.itemIds.length ? new Set(input.itemIds) : new Set(allItems.map((item: any) => item.id));
  const items = allItems.filter((item: any) => itemIds.has(item.id));
  if (!items.length || items.length !== itemIds.size) throw new HttpError(400, "invalid_items", "Hay productos que no pertenecen a la requisicion.");

  const departments = await many(client.from("departments").select("id,name")
    .in("id", [requisition.department_id, requisition.destination_department_id]), "departments_unavailable", "No se pudieron cargar los departamentos.");
  const origin = departments.find((entry: any) => entry.id === requisition.department_id);
  const destination = departments.find((entry: any) => entry.id === requisition.destination_department_id);
  if (!origin || !destination) throw new HttpError(409, "routing_missing", "La ruta operativa esta incompleta.");

  const group = input.distributionGroupId
    ? await one(client.from("email_distribution_groups").select("id,organization_id,name,code,active")
      .eq("id", input.distributionGroupId).eq("organization_id", requisition.organization_id).eq("active", true).single(),
    "group_not_found", "El grupo de distribucion no esta disponible.")
    : null;
  const links = group
    ? await many(client.from("email_distribution_group_recipients").select("recipient_id,delivery_type,required,default_selected")
      .eq("group_id", group.id).eq("organization_id", requisition.organization_id), "group_unavailable", "No se pudo validar el grupo.")
    : [];
  const requiredIds = links.filter((entry: any) => entry.required).map((entry: any) => entry.recipient_id);
  if (requiredIds.some((id: string) => !input.recipientIds.includes(id))) {
    throw new HttpError(400, "required_recipient_missing", "Falta un destinatario requerido por la regla.");
  }

  const recipients = input.recipientIds.length
    ? await many(client.from("email_recipients").select("id,organization_id,name,email,recipient_type,department_label,active")
      .eq("organization_id", requisition.organization_id).eq("active", true).in("id", input.recipientIds),
    "recipient_lookup_failed", "No se pudieron validar los destinatarios.")
    : [];
  if (recipients.length !== input.recipientIds.length) {
    throw new HttpError(403, "recipient_not_authorized", "Uno de los destinatarios no esta autorizado.");
  }
  const requestedType = new Map(input.recipientSelections.map((entry: any) => [entry.id, entry.deliveryType]));
  const linkType = new Map(links.map((entry: any) => [entry.recipient_id, entry.delivery_type]));
  const resolved = recipients.map((recipient: any) => ({
    id: recipient.id,
    name: recipient.name,
    email: normalizeEmail(recipient.email),
    deliveryType: linkType.get(recipient.id) || requestedType.get(recipient.id) || "to"
  }));

  if (input.externalRecipients.length) {
    if (!settings.allow_external || !permissions.includes("email.send_external")) {
      throw new HttpError(403, "external_not_allowed", "No tiene permiso para correos externos.");
    }
    resolved.push(...input.externalRecipients);
  }
  const uniqueRecipients = dedupeRecipients(resolved);
  if (!uniqueRecipients.length) throw new HttpError(400, "recipient_required", "Seleccione al menos un destinatario.");
  if (uniqueRecipients.length > Number(settings.max_recipients || 25)) {
    throw new HttpError(400, "too_many_recipients", `El maximo permitido es ${settings.max_recipients} destinatarios.`);
  }
  if (uniqueRecipients.some((entry: any) => !validEmail(entry.email))) {
    throw new HttpError(400, "invalid_email", "Hay un correo invalido.");
  }

  return { requisition, items, origin, destination, group, recipients: uniqueRecipients, permissions, settings };
}

export async function persistEmailAttempt({ admin, provider, authorized, input, rendered, userId }: any) {
  if (!provider.configured()) throw new HttpError(503, "provider_not_configured", "El proveedor de correo todavia no esta configurado.");
  await enforceRateLimit(admin, userId);
  const fingerprint = await buildRecipientFingerprint(authorized.recipients);
  const idempotencyKey = await buildEmailIdempotencyKey({
    requisitionId: authorized.requisition.id,
    revisionNumber: authorized.requisition.revision_number,
    distributionGroupId: authorized.group?.id || null,
    recipientFingerprint: fingerprint,
    clientOperationId: input.clientOperationId
  });

  const existing = await maybeOne(admin.from("requisition_email_sends").select("id,status")
    .eq("organization_id", authorized.requisition.organization_id).eq("idempotency_key", idempotencyKey).maybeSingle());
  if (existing) return { ...existing, recipientCount: authorized.recipients.length, duplicate: true };

  let previousQuery = admin.from("requisition_email_sends")
    .select("id,requisition_revision,status,sent_at")
    .eq("requisition_id", authorized.requisition.id)
    .eq("recipient_fingerprint", fingerprint)
    .eq("status", "sent")
    .order("sent_at", { ascending: false }).limit(1);
  previousQuery = authorized.group?.id
    ? previousQuery.eq("distribution_group_id", authorized.group.id)
    : previousQuery.is("distribution_group_id", null);
  const previous = await maybeOne(previousQuery.maybeSingle());
  if (previous && Number(previous.requisition_revision) === Number(authorized.requisition.revision_number) && !input.forceResend) {
    throw new HttpError(409, "duplicate_send", "Esta revision ya fue enviada a este grupo.");
  }
  const isUpdate = Boolean(previous && Number(previous.requisition_revision) < Number(authorized.requisition.revision_number));
  const subject = isUpdate && !rendered.subject.startsWith("ACTUALIZACION")
    ? `ACTUALIZACION | ${rendered.subject}`.slice(0, 240)
    : rendered.subject;
  const sendRow = {
    organization_id: authorized.requisition.organization_id,
    requisition_id: authorized.requisition.id,
    requisition_revision: authorized.requisition.revision_number,
    sender_user_id: userId,
    distribution_group_id: authorized.group?.id || null,
    distribution_group_name_snapshot: authorized.group?.name || "Personalizado",
    subject,
    custom_note: input.customNote,
    status: "sending",
    provider: "resend",
    idempotency_key: idempotencyKey,
    recipient_fingerprint: fingerprint,
    resend_of_send_id: input.forceResend ? previous?.id || null : null,
    is_update: isUpdate
  };

  let send;
  try {
    send = await one(admin.from("requisition_email_sends").insert(sendRow).select("id,status").single(),
      "audit_create_failed", "No se pudo crear la auditoria del envio.");
  } catch (error: any) {
    if (String(error?.code || error?.message).includes("23505")) {
      const raced = await maybeOne(admin.from("requisition_email_sends").select("id,status")
        .eq("organization_id", authorized.requisition.organization_id).eq("idempotency_key", idempotencyKey).maybeSingle());
      if (raced) return { ...raced, recipientCount: authorized.recipients.length, duplicate: true };
    }
    throw error;
  }

  try {
    await many(admin.from("requisition_email_send_recipients")
      .insert(buildRecipientSnapshots(send.id, authorized.recipients)).select("id"),
    "snapshot_failed", "No se pudo guardar la auditoria de destinatarios.");

    const buckets = { to: [] as string[], cc: [] as string[], bcc: [] as string[] };
    for (const recipient of authorized.recipients) buckets[recipient.deliveryType as "to" | "cc" | "bcc"].push(recipient.email);
    if (!buckets.to.length) {
      const promoted = buckets.cc.shift() || buckets.bcc.shift();
      if (promoted) buckets.to.push(promoted);
    }
    const providerResult = await provider.sendEmail({ ...buckets, subject, html: rendered.html, idempotencyKey });
    const sent = await one(admin.from("requisition_email_sends").update({
      status: "sent",
      provider_message_id: providerResult.messageId || null,
      sent_at: new Date().toISOString(),
      failed_at: null,
      error_code: null,
      error_message_safe: null
    }).eq("id", send.id).select("id,status").single(), "audit_update_failed", "El correo fue aceptado, pero la auditoria necesita revision.");
    return { ...sent, recipientCount: authorized.recipients.length };
  } catch (error: any) {
    await admin.from("requisition_email_sends").update({
      status: "failed",
      failed_at: new Date().toISOString(),
      error_code: safeCode(error),
      error_message_safe: safeMessage(error)
    }).eq("id", send.id);
    throw error;
  }
}

async function loadPermissions(client: any, organizationId: string, userId: string) {
  const membership = await one(client.from("organization_memberships").select("id")
    .eq("organization_id", organizationId).eq("user_id", userId).eq("active", true).single(),
  "membership_required", "No tiene una membresia activa.");
  const roles = await many(client.from("membership_roles").select("role_code").eq("membership_id", membership.id),
    "roles_unavailable", "No se pudieron validar los permisos.");
  if (!roles.length) return [];
  const rolePermissions = await many(client.from("role_permissions").select("permission_code")
    .in("role_code", roles.map((entry: any) => entry.role_code)), "permissions_unavailable", "No se pudieron validar los permisos.");
  return [...new Set(rolePermissions.map((entry: any) => entry.permission_code))];
}

function requirePermission(permissions: string[], permission: string) {
  if (!permissions.includes(permission)) throw new HttpError(403, "permission_denied", "No tiene permiso para enviar correos.");
}

async function enforceRateLimit(admin: any, userId: string) {
  const minute = new Date(Date.now() - 60_000).toISOString();
  const day = new Date(Date.now() - 86_400_000).toISOString();
  const [minuteResult, dayResult] = await Promise.all([
    admin.from("requisition_email_sends").select("id", { count: "exact", head: true }).eq("sender_user_id", userId).gte("created_at", minute),
    admin.from("requisition_email_sends").select("id", { count: "exact", head: true }).eq("sender_user_id", userId).gte("created_at", day)
  ]);
  if (minuteResult.error || dayResult.error) throw new HttpError(500, "rate_limit_unavailable", "No se pudo validar el limite de envios.");
  if (Number(minuteResult.count) >= 5 || Number(dayResult.count) >= 50) {
    throw new HttpError(429, "rate_limit", "Espere antes de realizar otro envio.");
  }
}

function dedupeRecipients(recipients: any[]) {
  const order: Record<string, number> = { to: 0, cc: 1, bcc: 2 };
  const result = new Map<string, any>();
  for (const recipient of recipients) {
    const email = normalizeEmail(recipient.email);
    const current = result.get(email);
    if (!current) result.set(email, { ...recipient, email });
    else if (order[recipient.deliveryType] < order[current.deliveryType]) current.deliveryType = recipient.deliveryType;
  }
  return [...result.values()];
}

export async function buildRecipientFingerprint(recipients: any[]) {
  return sha256(recipients
    .map((entry: any) => `${entry.deliveryType}:${normalizeEmail(entry.email)}`)
    .sort().join("|"));
}

export async function buildEmailIdempotencyKey({
  requisitionId,
  revisionNumber,
  distributionGroupId,
  recipientFingerprint,
  clientOperationId
}: any) {
  return sha256([
    requisitionId,
    revisionNumber,
    distributionGroupId || "custom",
    recipientFingerprint,
    clientOperationId
  ].join("|"));
}

export function buildRecipientSnapshots(sendId: string, recipients: any[]) {
  return recipients.map((recipient: any) => ({
    send_id: sendId,
    recipient_id: recipient.id || null,
    recipient_name_snapshot: recipient.name,
    email_snapshot: normalizeEmail(recipient.email),
    delivery_type: recipient.deliveryType
  }));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function resolveSecretKey() {
  try {
    const keys = JSON.parse(String(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"));
    if (keys.default) return String(Deno.env.get(keys.default) || keys.default);
  } catch {
    // Legacy platform variables remain a controlled fallback.
  }
  return String(Deno.env.get("SUPABASE_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
}

async function one(query: any, code: string, message: string) {
  const { data, error } = await query;
  if (error || !data) throw new HttpError(error?.code === "PGRST116" ? 403 : 500, code, message);
  return data;
}

async function many(query: any, code: string, message: string) {
  const { data, error } = await query;
  if (error) throw new HttpError(500, code, message);
  return data || [];
}

async function maybeOne(query: any) {
  const { data, error } = await query;
  if (error) throw new HttpError(500, "audit_lookup_failed", "No se pudo validar la auditoria.");
  return data || null;
}

function safeCode(error: any) {
  return String(error?.code || "provider_error").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
}

function safeMessage(error: any) {
  if (error instanceof HttpError) return error.message.slice(0, 300);
  return "El proveedor no acepto el envio.";
}
