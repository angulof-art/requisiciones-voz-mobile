export const WORKFLOW_STATUS = Object.freeze({
  draft: "Borrador",
  review: "Revisión",
  submitted: "Enviado",
  received: "Recibido por destino",
  preparing: "Preparando",
  partial: "Entrega parcial",
  delivered: "Entregado",
  accepted: "Recibido conforme",
  closed: "Cerrado",
  rejected: "Rechazado",
  voided: "Anulado",
  confirmed: "Confirmado (legado)",
  exported: "Exportado (legado)"
});

export const PRIORITIES = Object.freeze({
  normal: "Normal",
  urgent: "Urgente",
  emergency: "Emergencia"
});

export const FULFILLMENT_STATUS = Object.freeze({
  requested: "Solicitado",
  available: "Disponible",
  preparing: "Preparando",
  partial: "Parcial",
  delivered: "Entregado",
  unavailable: "Sin existencia",
  substituted: "Sustituido",
  rejected: "Rechazado"
});

const TRANSITIONS = Object.freeze({
  draft: ["review", "submitted", "voided"],
  review: ["draft", "submitted", "rejected", "voided"],
  submitted: ["received", "rejected", "voided"],
  received: ["preparing", "rejected", "voided"],
  preparing: ["partial", "delivered", "rejected", "voided"],
  partial: ["preparing", "delivered", "rejected", "voided"],
  delivered: ["accepted", "rejected"],
  accepted: ["closed"],
  closed: [],
  rejected: [],
  voided: [],
  confirmed: ["submitted", "voided"],
  exported: ["closed", "voided"]
});

export function canTransition(from, to) {
  if (from === to) return true;
  return Boolean(TRANSITIONS[from]?.includes(to));
}

export function allowedTransitions(status) {
  return [...(TRANSITIONS[status] || [])];
}

export function transitionRequisition(requisition, nextStatus, options = {}) {
  const previousStatus = requisition.status || "draft";
  if (!canTransition(previousStatus, nextStatus)) {
    throw new Error(`No se permite cambiar de ${WORKFLOW_STATUS[previousStatus] || previousStatus} a ${WORKFLOW_STATUS[nextStatus] || nextStatus}.`);
  }
  const now = options.now || new Date().toISOString();
  requisition.status = nextStatus;
  requisition.updatedAt = now;
  requisition.revisionNumber = Math.max(1, Number(requisition.revisionNumber) || 1) + 1;
  const timestampField = statusTimestampField(nextStatus);
  if (timestampField && !requisition[timestampField]) requisition[timestampField] = now;
  return requisition;
}

export function normalizeWorkflowFields(requisition) {
  return {
    priority: PRIORITIES[requisition.priority] ? requisition.priority : "normal",
    requiredAt: requisition.requiredAt || requisition.required_at || "",
    submittedAt: requisition.submittedAt || requisition.submitted_at || "",
    receivedAt: requisition.receivedAt || requisition.received_at || "",
    preparingAt: requisition.preparingAt || requisition.preparing_at || "",
    deliveredAt: requisition.deliveredAt || requisition.delivered_at || "",
    acceptedAt: requisition.acceptedAt || requisition.accepted_at || "",
    closedAt: requisition.closedAt || requisition.closed_at || "",
    rejectedAt: requisition.rejectedAt || requisition.rejected_at || ""
  };
}

export function normalizeFulfillmentFields(item) {
  const requestedQuantity = positiveNumber(item.requestedQuantity ?? item.requested_quantity ?? item.quantity);
  const deliveredQuantity = nonNegativeNumber(item.deliveredQuantity ?? item.delivered_quantity ?? 0);
  const fulfillmentStatus = FULFILLMENT_STATUS[item.fulfillmentStatus || item.fulfillment_status]
    ? item.fulfillmentStatus || item.fulfillment_status
    : "requested";
  return {
    requestedQuantity,
    deliveredQuantity,
    fulfillmentStatus,
    unavailableReason: String(item.unavailableReason || item.unavailable_reason || ""),
    substitutionProductId: item.substitutionProductId || item.substitution_product_id || ""
  };
}

export function updateItemFulfillment(item, changes) {
  const previous = { ...item };
  Object.assign(item, changes);
  const normalized = normalizeFulfillmentFields(item);
  Object.assign(item, normalized);
  if (item.deliveredQuantity > item.requestedQuantity) {
    throw new Error("La cantidad entregada no puede superar la solicitada.");
  }
  if (item.fulfillmentStatus === "partial" && !(item.deliveredQuantity > 0 && item.deliveredQuantity < item.requestedQuantity)) {
    throw new Error("Una entrega parcial debe ser mayor que cero y menor que lo solicitado.");
  }
  if (item.fulfillmentStatus === "delivered") item.deliveredQuantity = item.requestedQuantity;
  if (item.fulfillmentStatus === "unavailable" && !item.unavailableReason.trim()) {
    throw new Error("Indique la razón de falta de existencia.");
  }
  if (item.fulfillmentStatus === "substituted" && !item.substitutionProductId) {
    throw new Error("Seleccione el producto sustituto.");
  }
  return { previous, current: item };
}

export function deriveRequisitionFulfillmentStatus(items) {
  if (!items?.length) return "received";
  if (items.every((item) => ["delivered", "substituted"].includes(item.fulfillmentStatus))) return "delivered";
  if (items.some((item) => Number(item.deliveredQuantity) > 0 || item.fulfillmentStatus === "unavailable")) return "partial";
  if (items.some((item) => item.fulfillmentStatus === "preparing")) return "preparing";
  return "received";
}

export function resolveRequiredAt(preset, now = new Date(), customValue = "") {
  if (preset === "custom") return customValue ? new Date(customValue).toISOString() : "";
  const date = new Date(now);
  if (preset === "now") return date.toISOString();
  if (preset === "today") {
    date.setHours(18, 0, 0, 0);
    return date.toISOString();
  }
  date.setDate(date.getDate() + 1);
  date.setHours(preset === "tomorrow-pm" ? 15 : 9, 0, 0, 0);
  return date.toISOString();
}

function statusTimestampField(status) {
  return {
    submitted: "submittedAt",
    received: "receivedAt",
    preparing: "preparingAt",
    delivered: "deliveredAt",
    accepted: "acceptedAt",
    closed: "closedAt",
    rejected: "rejectedAt"
  }[status];
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

