import { productAllowsUnit } from "./catalog.js?v=8";

export const STATUS = {
  draft: "Borrador",
  review: "Pendiente de revisión",
  confirmed: "Confirmado",
  exported: "Exportado",
  voided: "Anulado"
};

export const COSTA_RICA_TIME_ZONE = "America/Costa_Rica";

export function createRequisition(existing = [], now = new Date()) {
  const iso = now.toISOString();
  return {
    id: createId("req"),
    requisitionNumber: generateRequisitionNumber(existing, now),
    requestedBy: "",
    status: "draft",
    originalTranscript: "",
    items: [],
    changes: [],
    createdAt: iso,
    updatedAt: iso,
    confirmedAt: "",
    exportedAt: "",
    syncStatus: "local",
    deviceInfo: getDeviceInfo()
  };
}

export function generateRequisitionNumber(existing = [], now = new Date()) {
  const day = formatDateParts(now).compact;
  const prefix = `REQ-${day}-`;
  const maxForDay = existing
    .map((req) => String(req.requisitionNumber || ""))
    .filter((number) => number.startsWith(prefix))
    .map((number) => Number(number.slice(prefix.length)))
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), 0);
  return `${prefix}${String(maxForDay + 1).padStart(4, "0")}`;
}

export function normalizeRequisition(requisition) {
  const now = new Date().toISOString();
  return {
    id: requisition.id || createId("req"),
    requisitionNumber: requisition.requisitionNumber || requisition.requisition_number || "REQ",
    requestedBy: String(requisition.requestedBy || requisition.requested_by || "").trim(),
    status: requisition.status || "draft",
    originalTranscript: requisition.originalTranscript || requisition.original_transcript || "",
    items: (requisition.items || []).map(normalizeItem),
    changes: normalizeChanges(requisition.changes || []),
    createdAt: requisition.createdAt || requisition.created_at || now,
    updatedAt: requisition.updatedAt || requisition.updated_at || now,
    confirmedAt: requisition.confirmedAt || requisition.confirmed_at || "",
    exportedAt: requisition.exportedAt || requisition.exported_at || "",
    syncStatus: requisition.syncStatus || "local",
    deviceInfo: requisition.deviceInfo || requisition.device_info || getDeviceInfo()
  };
}

export function normalizeItem(item) {
  return {
    id: item.id || createId("item"),
    productId: item.productId || item.product_id || "",
    productCode: item.productCode || item.product_code || "",
    productName: String(item.productName || item.product_name || "").trim(),
    rawProductName: item.rawProductName || "",
    quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : null,
    unit: item.unit || "",
    notes: item.notes || "",
    originalText: item.originalText || item.original_text || "",
    confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : 0,
    needsReview: Boolean(item.needsReview || item.needs_review),
    unitAllowed: item.unitAllowed !== false,
    unitOverride: Boolean(item.unitOverride || item.unit_override),
    unitExplicit: Boolean(item.unitExplicit || item.unit_explicit)
  };
}

export function addChange(requisition, action, previousValue, newValue) {
  requisition.changes = requisition.changes || [];
  requisition.changes.unshift({
    id: createId("chg"),
    action,
    previousValue: compactChangeValue(previousValue),
    newValue: compactChangeValue(newValue),
    changedAt: new Date().toISOString(),
    changedBy: requisition.requestedBy || ""
  });
  requisition.changes = requisition.changes.slice(0, 100);
  requisition.updatedAt = new Date().toISOString();
  return requisition;
}

export function validateRequisition(requisition, catalog = [], mode = "confirm") {
  const errors = [];
  const fieldErrors = {};
  const requestedBy = String(requisition.requestedBy || "").trim();

  if (!requestedBy) {
    fieldErrors.requestedBy =
      "Ingrese el nombre de la persona responsable del pedido para continuar.";
    errors.push(fieldErrors.requestedBy);
  }

  if (!requisition.items?.length) {
    errors.push("Agregue al menos un producto.");
  }

  requisition.items?.forEach((item, index) => {
    const label = item.productName || `Linea ${index + 1}`;
    errors.push(...validateRequisitionItem(item, index));
    if (item.needsReview && mode !== "draft") {
      errors.push(`${label}: necesita revisión antes de confirmar o exportar.`);
    }
    const catalogProduct = catalog.find((product) => product.code && product.code === item.productCode);
    if (catalogProduct && !productAllowsUnit(catalogProduct, item.unit) && !item.unitOverride) {
      errors.push(`${label}: la unidad no es habitual. Marque autorización explícita.`);
    }
  });

  return { ok: errors.length === 0, errors, fieldErrors };
}

export function validateRequisitionItem(item, index = 0) {
  const errors = [];
  const label = String(item?.productName || "").trim() || `Linea ${index + 1}`;
  if (!String(item?.productName || "").trim()) errors.push(`${label}: falta el producto.`);
  if (!Number.isFinite(Number(item?.quantity)) || Number(item.quantity) <= 0) {
    errors.push(`${label}: la cantidad debe ser mayor que cero.`);
  }
  if (!String(item?.unit || "").trim()) errors.push(`${label}: falta la unidad.`);
  return errors;
}

export function findDuplicateGroups(items) {
  const groups = new Map();
  for (const item of items || []) {
    const key = `${(item.productCode || item.productName).toLowerCase()}|${item.unit}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

export function combineDuplicateItems(requisition) {
  const groups = findDuplicateGroups(requisition.items);
  if (!groups.length) return requisition;
  const groupedIds = new Set(groups.flat().map((item) => item.id));
  const combined = groups.map((group) => {
    const first = { ...group[0] };
    first.quantity = roundQuantity(group.reduce((total, item) => total + Number(item.quantity || 0), 0));
    first.notes = group.map((item) => item.notes).filter(Boolean).join("; ");
    first.originalText = group.map((item) => item.originalText).filter(Boolean).join(" | ");
    first.needsReview = group.some((item) => item.needsReview);
    first.confidence = Math.min(...group.map((item) => Number(item.confidence || 0)));
    return first;
  });
  requisition.items = [
    ...requisition.items.filter((item) => !groupedIds.has(item.id)),
    ...combined
  ];
  addChange(requisition, "combinar_duplicados", groups, combined);
  return requisition;
}

export function markConfirmed(requisition) {
  const iso = new Date().toISOString();
  const previous = clone(requisition);
  requisition.status = "confirmed";
  requisition.confirmedAt = requisition.confirmedAt || iso;
  requisition.updatedAt = iso;
  requisition.confirmedSnapshot = clone(requisition.items);
  return addChange(requisition, "confirmar", previous, requisition);
}

export function markExported(requisition) {
  const previous = clone(requisition);
  requisition.status = requisition.status === "voided" ? "voided" : "exported";
  requisition.exportedAt = new Date().toISOString();
  requisition.updatedAt = requisition.exportedAt;
  return addChange(requisition, "exportar", previous, requisition);
}

export function markVoided(requisition) {
  const previous = clone(requisition);
  requisition.status = "voided";
  requisition.updatedAt = new Date().toISOString();
  return addChange(requisition, "anular", previous, requisition);
}

export function formatDateParts(dateInput, hourFormat = "24") {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput || Date.now());
  const parts = new Intl.DateTimeFormat("es-CR", {
    timeZone: COSTA_RICA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: hourFormat === "12"
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${value("day")}/${value("month")}/${value("year")}`,
    time: `${value("hour")}:${value("minute")}${hourFormat === "12" ? ` ${value("dayPeriod") || ""}` : ""}`.trim(),
    compact: `${value("year")}${value("month")}${value("day")}`
  };
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeChanges(changes) {
  return (changes || []).slice(0, 100).map((change) => ({
    id: change.id || createId("chg"),
    action: change.action || "cambio",
    previousValue: compactChangeValue(change.previousValue ?? change.previous_value),
    newValue: compactChangeValue(change.newValue ?? change.new_value),
    changedAt: change.changedAt || change.changed_at || new Date().toISOString(),
    changedBy: change.changedBy || change.changed_by || ""
  }));
}

function compactChangeValue(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.slice(0, 120).map(compactChangeValue);
  if (typeof value !== "object") return value;

  if ("productName" in value || "product_name" in value || "quantity" in value) {
    return compactItemSnapshot(value);
  }

  if ("requisitionNumber" in value || "requisition_number" in value || "items" in value) {
    return {
      id: value.id || "",
      requisitionNumber: value.requisitionNumber || value.requisition_number || "",
      requestedBy: value.requestedBy || value.requested_by || "",
      status: value.status || "",
      itemCount: Array.isArray(value.items) ? value.items.length : 0,
      items: Array.isArray(value.items) ? value.items.slice(0, 120).map(compactItemSnapshot) : []
    };
  }

  const compact = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "changes" || key === "previousValue" || key === "newValue") continue;
    compact[key] = compactChangeValue(entry);
  }
  return compact;
}

function compactItemSnapshot(item) {
  return {
    id: item.id || "",
    productCode: item.productCode || item.product_code || "",
    productName: item.productName || item.product_name || "",
    quantity: item.quantity ?? null,
    unit: item.unit || "",
    notes: item.notes || "",
    needsReview: Boolean(item.needsReview || item.needs_review)
  };
}

export function roundQuantity(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

export function createId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getDeviceInfo() {
  if (typeof navigator === "undefined") return "node";
  return navigator.userAgent || "browser";
}
