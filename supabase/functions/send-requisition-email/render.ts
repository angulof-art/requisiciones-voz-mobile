import { stripHeaderBreaks } from "./validation.ts";

export function renderRequisitionEmail(authorized: any, input: any) {
  const requisition = authorized.requisition;
  const prefix = authorized.isUpdate
    ? "ACTUALIZACION"
    : requisition.priority === "emergency" ? "EMERGENCIA" : requisition.priority === "urgent" ? "URGENTE" : "";
  const subject = [prefix, requisition.requisition_number, `${authorized.origin.name} -> ${authorized.destination.name}`, authorized.group?.name || "Personalizado"]
    .filter(Boolean).map((entry) => stripHeaderBreaks(entry)).join(" | ").slice(0, 240);
  const rows = authorized.items.map((item: any) => `<tr><td style="padding:9px;border-bottom:1px solid #d7e0dd">${escapeHtml(item.product_name)}</td><td style="padding:9px;border-bottom:1px solid #d7e0dd;text-align:right">${escapeHtml(item.quantity)}</td><td style="padding:9px;border-bottom:1px solid #d7e0dd">${escapeHtml(item.unit)}</td><td style="padding:9px;border-bottom:1px solid #d7e0dd">${escapeHtml(item.notes || "")}</td></tr>`).join("");
  const event = input.eventName ? `<p><strong>Evento:</strong> ${escapeHtml(input.eventName)}</p>` : "";
  const note = input.customNote ? `<div style="margin-top:18px;padding:12px;background:#f3f7f6"><strong>Observaciones</strong><p>${escapeHtml(input.customNote).replace(/\n/g, "<br>")}</p></div>` : "";
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f4f7f6;color:#17211f;font-family:Arial,sans-serif"><div style="max-width:720px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border:1px solid #d7e0dd"><div style="padding:18px 20px;background:#0f766e;color:#fff"><div style="font-size:12px;font-weight:700;text-transform:uppercase">Pedidos por voz</div><h1 style="margin:6px 0 0;font-size:22px">Requisicion ${escapeHtml(requisition.requisition_number)}</h1></div><div style="padding:20px"><p><strong>Solicitado por:</strong> ${escapeHtml(requisition.requested_by_name || requisition.requested_by)}</p><p><strong>Departamento:</strong> ${escapeHtml(authorized.origin.name)}</p><p><strong>Destino:</strong> ${escapeHtml(authorized.destination.name)}</p><p><strong>Tipo de distribucion:</strong> ${escapeHtml(authorized.group?.name || "Personalizado")}</p><p><strong>Fecha del pedido:</strong> ${escapeHtml(formatDate(requisition.created_at))}</p><p><strong>Fecha requerida:</strong> ${escapeHtml(formatDate(requisition.required_at))}</p><p><strong>Prioridad:</strong> ${escapeHtml(priorityLabel(requisition.priority))}</p>${event}<h2 style="margin:22px 0 8px;font-size:16px">Productos</h2><table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr style="background:#eaf2f0;text-align:left"><th style="padding:9px">Producto</th><th style="padding:9px;text-align:right">Cantidad</th><th style="padding:9px">Unidad</th><th style="padding:9px">Notas</th></tr></thead><tbody>${rows}</tbody></table>${note}<p style="margin:20px 0 0;color:#586965;font-size:12px">Esta requisicion fue generada mediante Pedidos por Voz.</p></div></div></div></body></html>`;
  return { subject, html };
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function formatDate(value: string) {
  if (!value) return "No indicada";
  return new Intl.DateTimeFormat("es-CR", { timeZone: "America/Costa_Rica", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function priorityLabel(value: string) {
  return ({ normal: "Normal", urgent: "Urgente", emergency: "Emergencia" } as Record<string, string>)[value] || "Normal";
}
