const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const DELIVERY_ORDER = Object.freeze({ to: 0, cc: 1, bcc: 2 });
const UNSENDABLE_STATUSES = new Set(["draft", "review", "voided", "rejected"]);

export const CUSTOM_GROUP_CODE = "CUSTOM";
export const MAX_CUSTOM_NOTE_LENGTH = 2000;
export const DEFAULT_MAX_RECIPIENTS = 25;

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function isValidEmail(value) {
  const email = normalizeEmail(value);
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

export function normalizeCustomNote(value) {
  return String(value || "").trim().slice(0, MAX_CUSTOM_NOTE_LENGTH);
}

export function buildGroupSelection(configuration, groupId) {
  const groups = configuration?.groups || [];
  const recipients = configuration?.recipients || [];
  const links = configuration?.groupRecipients || [];
  const group = groups.find((entry) => entry.id === groupId) || null;
  if (!group) return { group: null, recipients: [], missingRequired: [] };

  const recipientMap = new Map(recipients.map((entry) => [entry.id, entry]));
  const missingRequired = [];
  const selected = [];
  for (const link of links.filter((entry) => entry.group_id === group.id)) {
    const recipient = recipientMap.get(link.recipient_id);
    if (!recipient || recipient.active === false || !isValidEmail(recipient.email)) {
      if (link.required) missingRequired.push(link.recipient_id);
      continue;
    }
    selected.push({
      ...recipient,
      deliveryType: normalizeDeliveryType(link.delivery_type),
      selected: Boolean(link.default_selected || link.required),
      required: Boolean(link.required),
      suggested: true,
      sortOrder: Number(link.sort_order) || 0
    });
  }

  const linkedIds = new Set(selected.map((entry) => entry.id));
  for (const recipient of recipients) {
    if (linkedIds.has(recipient.id) || recipient.active === false || !isValidEmail(recipient.email)) continue;
    selected.push({
      ...recipient,
      deliveryType: "to",
      selected: false,
      required: false,
      suggested: false,
      sortOrder: 10000
    });
  }

  selected.sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "es"));
  return { group, recipients: dedupeRecipients(selected), missingRequired };
}

export function buildCustomSelection(configuration) {
  return {
    group: { id: "", code: CUSTOM_GROUP_CODE, name: "Personalizado" },
    missingRequired: [],
    recipients: dedupeRecipients((configuration?.recipients || [])
      .filter((entry) => entry.active !== false && isValidEmail(entry.email))
      .map((entry) => ({
        ...entry,
        deliveryType: "to",
        selected: false,
        required: false,
        suggested: false,
        sortOrder: 0
      })))
  };
}

export function dedupeRecipients(recipients) {
  const unique = new Map();
  for (const recipient of recipients || []) {
    const email = normalizeEmail(recipient.email);
    if (!isValidEmail(email)) continue;
    const normalized = {
      ...recipient,
      email,
      deliveryType: normalizeDeliveryType(recipient.deliveryType || recipient.delivery_type),
      selected: recipient.selected !== false,
      required: Boolean(recipient.required)
    };
    const current = unique.get(email);
    if (!current) {
      unique.set(email, normalized);
      continue;
    }
    current.required = current.required || normalized.required;
    current.selected = current.selected || normalized.selected || current.required;
    if (DELIVERY_ORDER[normalized.deliveryType] < DELIVERY_ORDER[current.deliveryType]) {
      current.deliveryType = normalized.deliveryType;
    }
  }
  return [...unique.values()];
}

export function setRecipientSelected(recipients, recipientId, selected) {
  return (recipients || []).map((recipient) => {
    if (recipient.id !== recipientId) return recipient;
    if (recipient.required) return { ...recipient, selected: true };
    return { ...recipient, selected: Boolean(selected) };
  });
}

export function setRecipientDeliveryType(recipients, recipientId, deliveryType) {
  const normalized = normalizeDeliveryType(deliveryType);
  return (recipients || []).map((recipient) =>
    recipient.id === recipientId ? { ...recipient, deliveryType: normalized } : recipient
  );
}

export function validateDistribution({
  requisition,
  recipients,
  externalRecipients = [],
  missingRequired = [],
  permissions = [],
  allowExternal = false,
  maxRecipients = DEFAULT_MAX_RECIPIENTS
}) {
  const errors = [];
  if (!permissions.includes("email.send")) errors.push("No tiene permiso para enviar correos.");
  if (!requisition?.id) errors.push("La requisicion no existe.");
  if (UNSENDABLE_STATUSES.has(requisition?.status)) {
    errors.push("Guarde y envie la requisicion antes de distribuirla por correo.");
  }
  if (requisition?.syncStatus !== "synced" && !requisition?.lastSyncedAt) {
    errors.push("Sincronice la requisicion antes de enviarla por correo.");
  }
  if (missingRequired.length) errors.push("Faltan destinatarios requeridos por la regla de distribucion.");

  const selected = dedupeRecipients((recipients || []).filter((entry) => entry.selected));
  const external = dedupeRecipients((externalRecipients || []).map((entry) => ({
    ...entry,
    id: "",
    selected: true,
    required: false,
    deliveryType: entry.deliveryType || "to"
  })));
  if (external.length && (!allowExternal || !permissions.includes("email.send_external"))) {
    errors.push("No tiene permiso para agregar correos externos.");
  }
  const combined = dedupeRecipients([...selected, ...external]);
  if (!combined.length) errors.push("Seleccione al menos un destinatario.");
  if (combined.length > maxRecipients) errors.push(`El maximo permitido es ${maxRecipients} destinatarios.`);
  if (combined.some((entry) => !isValidEmail(entry.email))) errors.push("Hay un correo con formato invalido.");
  if (recipients?.some((entry) => entry.required && !entry.selected)) {
    errors.push("No puede quitar un destinatario requerido.");
  }
  return { ok: errors.length === 0, errors, recipients: combined };
}

export function detectDistributionSuggestions(items, rules, groups, options = {}) {
  const groupMap = new Map((groups || []).map((group) => [group.id, group]));
  const categoryValues = new Set((items || [])
    .map((item) => normalizeMatch(item.category || item.productCategory))
    .filter(Boolean));
  const matches = [];
  for (const rule of (rules || []).filter((entry) => entry.active !== false)) {
    const isExplicitEvent = rule.rule_type === "explicit_event" && options.eventSpecial;
    const isCategory = rule.rule_type === "category" && categoryValues.has(normalizeMatch(rule.match_value));
    if (!isExplicitEvent && !isCategory) continue;
    const group = groupMap.get(rule.group_id);
    if (group && !matches.some((entry) => entry.id === group.id)) matches.push(group);
  }
  matches.sort((left, right) => left.name.localeCompare(right.name, "es"));
  return { groups: matches, mixed: matches.length > 1 };
}

export function splitItemsByDistribution(items, rules, groups) {
  const activeRules = (rules || []).filter((entry) => entry.active !== false && entry.rule_type === "category");
  const groupMap = new Map((groups || []).map((group) => [group.id, group]));
  const buckets = new Map();
  const unassigned = [];
  for (const item of items || []) {
    const category = normalizeMatch(item.category || item.productCategory);
    const rule = activeRules.find((entry) => normalizeMatch(entry.match_value) === category);
    const group = rule ? groupMap.get(rule.group_id) : null;
    if (!group) {
      unassigned.push(item);
      continue;
    }
    if (!buckets.has(group.id)) buckets.set(group.id, { group, items: [] });
    buckets.get(group.id).items.push(item);
  }
  return { distributions: [...buckets.values()], unassigned };
}

export function hasRequisitionChangedSinceSend(requisition, sends) {
  const latest = (sends || [])
    .filter((entry) => entry.status === "sent")
    .sort((left, right) => new Date(right.sent_at || right.created_at) - new Date(left.sent_at || left.created_at))[0];
  return Boolean(latest && Number(requisition?.revisionNumber || 0) > Number(latest.requisition_revision || 0));
}

export function makeClientOperationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

export function recipientRoleLabel(type) {
  return {
    warehouse: "Almacen",
    purchasing: "Compras",
    security: "Seguridad",
    controller: "Contraloria",
    costs: "Costos",
    management: "Gerencia",
    other: "Otro"
  }[type] || "Otro";
}

function normalizeDeliveryType(value) {
  return ["to", "cc", "bcc"].includes(value) ? value : "to";
}

function normalizeMatch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}
