const PRIORITY_LABELS = Object.freeze({ normal: "Normal", urgent: "Urgente", emergency: "Emergencia" });

export function buildEmailPreview({
  requisition,
  distributionName,
  originName,
  destinationName,
  requestedBy,
  recipients,
  customNote = "",
  eventName = "",
  isUpdate = false,
  formatDate = defaultDateFormatter
}) {
  const subject = buildEmailSubject({
    requisitionNumber: requisition.requisitionNumber,
    originName,
    destinationName,
    distributionName,
    priority: requisition.priority,
    isUpdate
  });
  const buckets = groupRecipients(recipients);
  const rows = (requisition.items || []).map((item) => ({
    product: String(item.productName || ""),
    quantity: Number(item.quantity),
    unit: String(item.unit || ""),
    notes: String(item.notes || "")
  }));
  const model = {
    subject,
    to: buckets.to,
    cc: buckets.cc,
    bcc: buckets.bcc,
    requisitionNumber: requisition.requisitionNumber,
    requestedBy: requestedBy || requisition.requestedByName || requisition.requestedBy,
    originName,
    destinationName,
    distributionName,
    orderDate: formatDate(requisition.createdAt),
    requiredDate: formatDate(requisition.requiredAt),
    priority: PRIORITY_LABELS[requisition.priority] || "Normal",
    customNote: String(customNote || ""),
    eventName: String(eventName || ""),
    rows
  };
  return { ...model, html: renderEmailHtml(model) };
}

export function buildEmailSubject({
  requisitionNumber,
  originName,
  destinationName,
  distributionName,
  priority = "normal",
  isUpdate = false
}) {
  const prefix = isUpdate
    ? "ACTUALIZACION"
    : priority === "emergency"
      ? "EMERGENCIA"
      : priority === "urgent" ? "URGENTE" : "";
  return [prefix, requisitionNumber, `${originName} -> ${destinationName}`, distributionName]
    .filter(Boolean)
    .map(stripHeaderBreaks)
    .join(" | ")
    .slice(0, 240);
}

export function renderEmailHtml(model) {
  const rows = model.rows.map((row) => `
    <tr>
      <td style="padding:9px;border-bottom:1px solid #d7e0dd">${escapeHtml(row.product)}</td>
      <td style="padding:9px;border-bottom:1px solid #d7e0dd;text-align:right">${escapeHtml(formatQuantity(row.quantity))}</td>
      <td style="padding:9px;border-bottom:1px solid #d7e0dd">${escapeHtml(row.unit)}</td>
      <td style="padding:9px;border-bottom:1px solid #d7e0dd">${escapeHtml(row.notes)}</td>
    </tr>`).join("");
  const eventBlock = model.eventName
    ? `<p style="margin:6px 0"><strong>Evento:</strong> ${escapeHtml(model.eventName)}</p>`
    : "";
  const noteBlock = model.customNote
    ? `<div style="margin-top:18px;padding:12px;background:#f3f7f6"><strong>Observaciones</strong><p style="margin:6px 0 0">${escapeHtml(model.customNote).replace(/\n/g, "<br>")}</p></div>`
    : "";
  return `<!doctype html>
<html lang="es"><body style="margin:0;background:#f4f7f6;color:#17211f;font-family:Arial,sans-serif">
  <div style="max-width:720px;margin:0 auto;padding:24px 16px">
    <div style="background:#ffffff;border:1px solid #d7e0dd">
      <div style="padding:18px 20px;background:#0f766e;color:#ffffff">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase">Pedidos por voz</div>
        <h1 style="margin:6px 0 0;font-size:22px">Requisicion ${escapeHtml(model.requisitionNumber)}</h1>
      </div>
      <div style="padding:20px">
        <p style="margin:6px 0"><strong>Solicitado por:</strong> ${escapeHtml(model.requestedBy)}</p>
        <p style="margin:6px 0"><strong>Departamento:</strong> ${escapeHtml(model.originName)}</p>
        <p style="margin:6px 0"><strong>Destino:</strong> ${escapeHtml(model.destinationName)}</p>
        <p style="margin:6px 0"><strong>Tipo de distribucion:</strong> ${escapeHtml(model.distributionName)}</p>
        <p style="margin:6px 0"><strong>Fecha del pedido:</strong> ${escapeHtml(model.orderDate)}</p>
        <p style="margin:6px 0"><strong>Fecha requerida:</strong> ${escapeHtml(model.requiredDate)}</p>
        <p style="margin:6px 0"><strong>Prioridad:</strong> ${escapeHtml(model.priority)}</p>
        ${eventBlock}
        <h2 style="margin:22px 0 8px;font-size:16px">Productos</h2>
        <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">
          <thead><tr style="background:#eaf2f0;text-align:left"><th style="padding:9px">Producto</th><th style="padding:9px;text-align:right">Cantidad</th><th style="padding:9px">Unidad</th><th style="padding:9px">Notas</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${noteBlock}
        <p style="margin:20px 0 0;color:#586965;font-size:12px">Esta requisicion fue generada mediante Pedidos por Voz.</p>
      </div>
    </div>
  </div>
</body></html>`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function groupRecipients(recipients) {
  const buckets = { to: [], cc: [], bcc: [] };
  for (const recipient of recipients || []) {
    const type = ["to", "cc", "bcc"].includes(recipient.deliveryType) ? recipient.deliveryType : "to";
    buckets[type].push(recipient);
  }
  return buckets;
}

function stripHeaderBreaks(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function formatQuantity(value) {
  return Number.isFinite(Number(value)) ? new Intl.NumberFormat("es-CR", { maximumFractionDigits: 3 }).format(Number(value)) : "";
}

function defaultDateFormatter(value) {
  if (!value) return "No indicada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No indicada";
  return new Intl.DateTimeFormat("es-CR", {
    timeZone: "America/Costa_Rica",
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}
