export function buildOperationalReport(requisitions = [], filters = {}, directory = {}) {
  const rows = requisitions.filter((requisition) => matchesFilters(requisition, filters));
  const today = dateKey(new Date());
  const kpis = {
    today: rows.filter((requisition) => dateKey(requisition.createdAt) === today).length,
    pending: rows.filter((requisition) => ["submitted", "received"].includes(requisition.status)).length,
    preparing: rows.filter((requisition) => requisition.status === "preparing").length,
    partial: rows.filter((requisition) => requisition.status === "partial").length,
    delivered: rows.filter((requisition) => ["delivered", "accepted", "closed"].includes(requisition.status)).length,
    urgent: rows.filter((requisition) => ["urgent", "emergency"].includes(requisition.priority)).length,
    unavailable: rows.flatMap((requisition) => requisition.items || []).filter((item) => item.fulfillmentStatus === "unavailable").length,
    averageAttentionHours: averageAttentionHours(rows)
  };
  return {
    rows,
    kpis,
    requestedProducts: aggregateProducts(rows, () => true, (item) => item.requestedQuantity || item.quantity),
    unavailableProducts: aggregateProducts(rows, (item) => item.fulfillmentStatus === "unavailable", () => 1),
    substitutions: aggregateProducts(rows, (item) => item.fulfillmentStatus === "substituted", () => 1),
    departments: aggregateDepartments(rows, directory.departments || [])
  };
}

function matchesFilters(requisition, filters) {
  const created = Date.parse(requisition.createdAt);
  if (filters.dateFrom && created < Date.parse(`${filters.dateFrom}T00:00:00`)) return false;
  if (filters.dateTo && created > Date.parse(`${filters.dateTo}T23:59:59.999`)) return false;
  if (filters.status && filters.status !== "all" && requisition.status !== filters.status) return false;
  if (filters.departmentId && filters.departmentId !== "all"
    && requisition.departmentId !== filters.departmentId
    && requisition.destinationDepartmentId !== filters.departmentId) return false;
  if (filters.locationId && filters.locationId !== "all" && requisition.locationId !== filters.locationId) return false;
  return true;
}

function aggregateProducts(requisitions, predicate, value) {
  const values = new Map();
  requisitions.forEach((requisition) => (requisition.items || []).forEach((item) => {
    if (!predicate(item)) return;
    const key = item.productId || item.productCode || `${item.productName}|${item.unit}`;
    const entry = values.get(key) || { productName: item.productName, unit: item.unit, value: 0, occurrences: 0 };
    entry.value += Number(value(item) || 0);
    entry.occurrences += 1;
    values.set(key, entry);
  }));
  return [...values.values()].sort((left, right) => right.value - left.value).slice(0, 10);
}

function aggregateDepartments(requisitions, departments) {
  const values = new Map();
  requisitions.forEach((requisition) => {
    const id = requisition.departmentId || "unclassified";
    const department = departments.find((entry) => entry.id === id);
    const entry = values.get(id) || { id, name: department?.name || "Sin clasificar", count: 0, delivered: 0, attentionHours: [] };
    entry.count += 1;
    if (["delivered", "accepted", "closed"].includes(requisition.status)) entry.delivered += 1;
    const hours = attentionHours(requisition);
    if (Number.isFinite(hours)) entry.attentionHours.push(hours);
    values.set(id, entry);
  });
  return [...values.values()].map((entry) => ({
    id: entry.id,
    name: entry.name,
    count: entry.count,
    fulfillmentPercent: entry.count ? Math.round(entry.delivered / entry.count * 100) : 0,
    averageAttentionHours: average(entry.attentionHours)
  })).sort((left, right) => right.count - left.count);
}

function averageAttentionHours(requisitions) {
  return average(requisitions.map(attentionHours).filter(Number.isFinite));
}

function attentionHours(requisition) {
  const start = Date.parse(requisition.submittedAt || requisition.createdAt);
  const end = Date.parse(requisition.deliveredAt || requisition.acceptedAt || requisition.closedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return NaN;
  return (end - start) / 3_600_000;
}

function average(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10;
}

function dateKey(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}
