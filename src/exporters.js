import { csvCell } from "./catalog.js";
import { formatDateParts } from "./requisitions.js";

export function requisitionToCsv(requisition, hourFormat = "24") {
  const created = formatDateParts(requisition.createdAt, hourFormat);
  const rows = [
    [
      "Numero de pedido",
      "Fecha",
      "Hora",
      "Responsable",
      "Codigo del producto",
      "Producto",
      "Cantidad",
      "Unidad",
      "Observaciones",
      "Estado"
    ],
    ...(requisition.items || []).map((item) => [
      requisition.requisitionNumber,
      created.date,
      created.time,
      requisition.requestedBy,
      item.productCode || "",
      item.productName,
      Number(item.quantity || 0),
      item.unit,
      item.notes || "",
      requisition.status
    ])
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function downloadCsv(requisition, hourFormat = "24") {
  const csv = requisitionToCsv(requisition, hourFormat);
  downloadBlob(
    new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
    `${requisition.requisitionNumber}.csv`
  );
}

export function printPdf(requisition, hourFormat = "24") {
  const html = buildPrintableHtml(requisition, hourFormat);
  const popup = window.open("", "_blank", "noopener,noreferrer");
  if (!popup) {
    throw new Error("El navegador bloqueo la ventana de impresion.");
  }
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  popup.print();
}

export function buildPrintableHtml(requisition, hourFormat = "24") {
  const created = formatDateParts(requisition.createdAt, hourFormat);
  const generated = formatDateParts(new Date(), hourFormat);
  const rows = (requisition.items || [])
    .map(
      (item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(item.productCode || "")}</td>
          <td>${escapeHtml(item.productName)}</td>
          <td class="num">${Number(item.quantity || 0).toLocaleString("es-CR")}</td>
          <td>${escapeHtml(item.unit)}</td>
          <td>${escapeHtml(item.notes || "")}</td>
        </tr>`
    )
    .join("");

  return `<!doctype html>
  <html lang="es">
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(requisition.requisitionNumber)}</title>
      <style>
        body { font-family: Arial, sans-serif; color: #111827; margin: 28px; }
        header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #0f766e; padding-bottom: 14px; }
        h1 { margin: 0 0 8px; font-size: 24px; }
        p { margin: 3px 0; }
        table { width: 100%; border-collapse: collapse; margin-top: 24px; }
        th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }
        th { background: #e7f5f2; }
        .num { text-align: right; }
        .signature { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 48px; }
        .line { border-top: 1px solid #111827; padding-top: 8px; min-height: 44px; }
        @media print { body { margin: 18mm; } }
      </style>
    </head>
    <body>
      <header>
        <div>
          <h1>Pedido o Requisición</h1>
          <p><strong>Número:</strong> ${escapeHtml(requisition.requisitionNumber)}</p>
          <p><strong>Responsable:</strong> ${escapeHtml(requisition.requestedBy)}</p>
        </div>
        <div>
          <p><strong>Fecha:</strong> ${created.date}</p>
          <p><strong>Hora:</strong> ${created.time}</p>
          <p><strong>Estado:</strong> ${escapeHtml(requisition.status)}</p>
          <p><strong>Generado:</strong> ${generated.date} ${generated.time}</p>
        </div>
      </header>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Código</th>
            <th>Producto</th>
            <th>Cantidad</th>
            <th>Unidad</th>
            <th>Observaciones</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <section class="signature">
        <div class="line">Revisado por</div>
        <div class="line">Firma / recibido</div>
      </section>
    </body>
  </html>`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
