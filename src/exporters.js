import { csvCell } from "./catalog.js?v=2.0.0-rc.2";
import { STATUS, formatDateParts } from "./requisitions.js?v=2.0.0-rc.2";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const ORDER_HEADERS = [
  "Producto",
  "Cantidad",
  "Unidad de compra"
];

export function requisitionToExcelRows(requisition, catalog = [], hourFormat = "24") {
  const rows = [ORDER_HEADERS];

  for (const item of requisition.items || []) {
    rows.push([
      item.productName,
      Number(item.quantity || 0),
      item.unit
    ]);
  }

  return rows;
}

export function requisitionToCsv(requisition, catalogOrHourFormat = [], hourFormat = "24") {
  const { resolvedHourFormat } = resolveExportArgs(catalogOrHourFormat, hourFormat);
  return rowsToCsv(requisitionToOperationalRows(requisition, resolvedHourFormat));
}

export function requisitionToOperationalRows(requisition, hourFormat = "24") {
  const created = formatDateParts(requisition.createdAt, hourFormat);
  const required = formatDateParts(requisition.requiredAt || requisition.createdAt, hourFormat);
  const headers = [
    "Número", "Fecha", "Hora", "Organización", "Sede", "Origen", "Destino",
    "Responsable", "Prioridad", "Fecha requerida", "Estado", "Código",
    "Producto", "Solicitado", "Entregado", "Unidad", "Cumplimiento", "Observaciones"
  ];
  return [headers, ...(requisition.items || []).map((item) => [
    requisition.requisitionNumber,
    created.date,
    created.time,
    requisition.organizationName || "",
    requisition.locationName || "",
    requisition.departmentName || "",
    requisition.destinationDepartmentName || "",
    requisition.requestedByName || requisition.requestedBy || "",
    requisition.priority || "normal",
    `${required.date} ${required.time}`,
    STATUS[requisition.status] || requisition.status,
    item.productCode || "",
    item.productName,
    Number(item.requestedQuantity || item.quantity || 0),
    Number(item.deliveredQuantity || 0),
    item.unit,
    item.fulfillmentStatus || "requested",
    fulfillmentDetail(item)
  ])];
}

export function downloadCsv(requisition, catalogOrHourFormat = [], hourFormat = "24") {
  const { catalog, resolvedHourFormat } = resolveExportArgs(catalogOrHourFormat, hourFormat);
  const csv = requisitionToCsv(requisition, catalog, resolvedHourFormat);
  downloadBlob(
    new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
    `${safeFileName(requisition.requisitionNumber)}.csv`
  );
}

export function requisitionToXlsxBlob(requisition, catalog = [], hourFormat = "24") {
  const rows = requisitionToExcelRows(requisition, catalog, hourFormat);
  const files = buildWorkbookFiles(
    [
      { name: safeSheetName(requisition.requisitionNumber || "Pedido"), rows },
      { name: "Detalle operativo", rows: requisitionToOperationalRows(requisition, hourFormat) }
    ],
    {
      title: `Pedido ${requisition.requisitionNumber || ""}`.trim(),
      creator: "Pedidos por Voz"
    }
  );
  return createZipBlob(files, XLSX_MIME);
}

export function downloadExcel(requisition, catalogOrHourFormat = [], hourFormat = "24") {
  const { catalog, resolvedHourFormat } = resolveExportArgs(catalogOrHourFormat, hourFormat);
  downloadBlob(
    requisitionToXlsxBlob(requisition, catalog, resolvedHourFormat),
    `${safeFileName(requisition.requisitionNumber)}.xlsx`
  );
}

export function requisitionToPdfBlob(requisition, hourFormat = "24") {
  const items = requisition.items || [];
  const pageSize = 22;
  const pages = [];
  for (let index = 0; index < Math.max(items.length, 1); index += pageSize) {
    pages.push(buildPdfPage(requisition, items.slice(index, index + pageSize), hourFormat, pages.length + 1));
  }
  return new Blob([buildPdfDocument(pages)], { type: "application/pdf" });
}

export function downloadPdf(requisition, hourFormat = "24") {
  downloadBlob(requisitionToPdfBlob(requisition, hourFormat), `${safeFileName(requisition.requisitionNumber)}.pdf`);
}

export function printPdf(requisition, hourFormat = "24") {
  const html = buildPrintableHtml(requisition, hourFormat);
  const popup = window.open("", "_blank");
  if (!popup) {
    throw new Error("El navegador bloqueo la ventana del PDF. Permita ventanas emergentes para esta app.");
  }
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  const print = () => {
    try { popup.print(); } catch {}
  };
  popup.document.querySelector("#printButton")?.addEventListener("click", print);
  window.setTimeout(print, 500);
  popup.focus();
}

export function buildPrintableHtml(requisition, hourFormat = "24") {
  const created = formatDateParts(requisition.createdAt, hourFormat);
  const generated = formatDateParts(new Date(), hourFormat);
  const status = STATUS[requisition.status] || requisition.status;
  const required = formatDateParts(requisition.requiredAt || requisition.createdAt, hourFormat);
  const rows =
    (requisition.items || [])
      .map(
        (item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(item.productCode || "")}</td>
          <td>${escapeHtml(item.productName)}</td>
          <td class="num">${formatNumber(item.requestedQuantity || item.quantity)}</td>
          <td class="num">${formatNumber(item.deliveredQuantity || 0)}</td>
          <td>${escapeHtml(item.unit)}</td>
          <td>${escapeHtml(item.fulfillmentStatus || "Solicitado")}</td>
          <td>${escapeHtml(fulfillmentDetail(item))}</td>
        </tr>`
      )
      .join("") || '<tr><td colspan="8">Sin productos.</td></tr>';

  return `<!doctype html>
  <html lang="es">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHtml(requisition.requisitionNumber)}</title>
      <style>
        body { font-family: Arial, sans-serif; color: #111827; margin: 28px; }
        .print-action { background: #0f766e; border: 0; border-radius: 8px; color: white; cursor: pointer; font-size: 14px; font-weight: 700; margin-bottom: 18px; padding: 10px 14px; }
        header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 3px solid #0f766e; padding-bottom: 14px; }
        h1 { margin: 0 0 8px; font-size: 24px; }
        p { margin: 3px 0; }
        table { width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 12px; }
        th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }
        th { background: #0f766e; color: white; }
        .num { text-align: right; }
        .signature { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 48px; }
        .line { border-top: 1px solid #111827; padding-top: 8px; min-height: 44px; }
        @media print {
          body { margin: 18mm; }
          .print-action { display: none; }
        }
      </style>
    </head>
    <body>
      <button class="print-action" id="printButton" type="button">Guardar como PDF</button>
      <header>
        <div>
          <h1>Pedido o Requisicion</h1>
          <p><strong>Numero:</strong> ${escapeHtml(requisition.requisitionNumber)}</p>
          <p><strong>Organizacion:</strong> ${escapeHtml(requisition.organizationName || "")}</p>
          <p><strong>Sede:</strong> ${escapeHtml(requisition.locationName || "")}</p>
          <p><strong>Ruta:</strong> ${escapeHtml(requisition.departmentName || "Origen")} → ${escapeHtml(requisition.destinationDepartmentName || "Destino")}</p>
          <p><strong>Responsable:</strong> ${escapeHtml(requisition.requestedByName || requisition.requestedBy)}</p>
        </div>
        <div>
          <p><strong>Fecha:</strong> ${created.date}</p>
          <p><strong>Hora:</strong> ${created.time}</p>
          <p><strong>Estado:</strong> ${escapeHtml(status)}</p>
          <p><strong>Prioridad:</strong> ${escapeHtml(requisition.priority || "normal")}</p>
          <p><strong>Requerido:</strong> ${required.date} ${required.time}</p>
          <p><strong>Generado:</strong> ${generated.date} ${generated.time}</p>
        </div>
      </header>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Codigo</th>
            <th>Producto</th>
            <th>Solicitado</th>
            <th>Entregado</th>
            <th>Unidad</th>
            <th>Cumplimiento</th>
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

export function buildShareText(requisition) {
  const route = [requisition.departmentName || "Origen", requisition.destinationDepartmentName || "Destino"].join(" → ");
  const lines = (requisition.items || []).map((item) => {
    const base = `${formatNumber(item.requestedQuantity || item.quantity)} ${item.unit} ${item.productName}`;
    const detail = fulfillmentDetail(item);
    return detail ? `${base} | ${detail}` : base;
  });
  return [requisition.requisitionNumber, route, "", ...lines].join("\n");
}

export async function shareRequisition(requisition) {
  const text = buildShareText(requisition);
  if (navigator.share) {
    await navigator.share({ title: requisition.requisitionNumber, text });
    return "shared";
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return "copied";
  }
  throw new Error("Este navegador no permite compartir ni copiar automáticamente.");
}

function buildPdfPage(requisition, items, hourFormat, pageNumber) {
  const created = formatDateParts(requisition.createdAt, hourFormat);
  const required = formatDateParts(requisition.requiredAt || requisition.createdAt, hourFormat);
  const status = STATUS[requisition.status] || requisition.status;
  const commands = [
    textCommand(42, 800, 17, "PEDIDO O REQUISICION", true),
    textCommand(42, 778, 10, `${requisition.requisitionNumber}   Pagina ${pageNumber}`),
    textCommand(42, 758, 9, `Organizacion: ${requisition.organizationName || "-"}   Sede: ${requisition.locationName || "-"}`),
    textCommand(42, 743, 9, `Ruta: ${requisition.departmentName || "Origen"} -> ${requisition.destinationDepartmentName || "Destino"}`),
    textCommand(42, 728, 9, `Responsable: ${requisition.requestedByName || requisition.requestedBy || "-"}`),
    textCommand(42, 713, 9, `Creado: ${created.date} ${created.time}   Requerido: ${required.date} ${required.time}`),
    textCommand(42, 698, 9, `Prioridad: ${requisition.priority || "normal"}   Estado: ${status}`),
    "0.06 0.47 0.37 RG 1.5 w 42 687 m 553 687 l S",
    textCommand(44, 669, 8, "PRODUCTO", true),
    textCommand(305, 669, 8, "SOLICITADO", true),
    textCommand(375, 669, 8, "ENTREGADO", true),
    textCommand(445, 669, 8, "UNIDAD", true),
    textCommand(495, 669, 8, "ESTADO", true)
  ];
  let y = 650;
  const safeItems = items.length ? items : [{ productName: "Sin productos", quantity: 0, unit: "" }];
  safeItems.forEach((item) => {
    commands.push("0.82 0.86 0.85 RG 0.5 w 42 " + (y - 5) + " m 553 " + (y - 5) + " l S");
    commands.push(textCommand(44, y + 5, 8, truncatePdfText(item.productName, 46)));
    commands.push(textCommand(305, y + 5, 8, formatNumber(item.requestedQuantity || item.quantity || 0)));
    commands.push(textCommand(375, y + 5, 8, formatNumber(item.deliveredQuantity || 0)));
    commands.push(textCommand(445, y + 5, 8, item.unit || ""));
    commands.push(textCommand(495, y + 5, 7, truncatePdfText(item.fulfillmentStatus || "requested", 14)));
    const note = fulfillmentDetail(item);
    if (note) commands.push(textCommand(44, y - 7, 7, truncatePdfText(`Nota: ${note}`, 80)));
    y -= 25;
  });
  commands.push("0.2 0.2 0.2 RG 0.7 w 42 75 m 250 75 l S", "0.2 0.2 0.2 RG 0.7 w 340 75 m 553 75 l S");
  commands.push(textCommand(42, 60, 8, "Revisado por"), textCommand(340, 60, 8, "Firma / recibido"));
  return commands.join("\n");
}

function fulfillmentDetail(item) {
  return [
    item.notes ? `Nota: ${item.notes}` : "",
    item.unavailableReason ? `Sin existencia: ${item.unavailableReason}` : "",
    item.substitutionProductName || item.substitutionProductId
      ? `Sustitución: ${item.substitutionProductName || item.substitutionProductId}`
      : ""
  ].filter(Boolean).join(" | ");
}

function buildPdfDocument(pageContents) {
  const objects = [];
  const pageRefs = pageContents.map((_, index) => `${4 + index * 2} 0 R`).join(" ");
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageRefs}] /Count ${pageContents.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  pageContents.forEach((content, index) => {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;
    const contentBytes = latin1Bytes(content);
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${contentBytes.length} >>\nstream\n${content}\nendstream`;
  });
  const chunks = [latin1Bytes("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
  const offsets = [0];
  let offset = chunks[0].length;
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = offset;
    const chunk = latin1Bytes(`${id} 0 obj\n${objects[id]}\nendobj\n`);
    chunks.push(chunk);
    offset += chunk.length;
  }
  const xrefOffset = offset;
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(latin1Bytes(xref));
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let cursor = 0;
  chunks.forEach((chunk) => { output.set(chunk, cursor); cursor += chunk.length; });
  return output;
}

function textCommand(x, y, size, text, bold = false) {
  return `BT /F1 ${bold ? size + 1 : size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`;
}

function escapePdfText(value) {
  return String(value ?? "")
    .replace(/[^\x20-\xFF]/g, "?")
    .replace(/([\\()])/g, "\\$1");
}

function truncatePdfText(value, length) {
  const text = String(value || "");
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function latin1Bytes(value) {
  const text = String(value || "");
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
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
  return escapeXml(value);
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number.toLocaleString("es-CR", { maximumFractionDigits: 3 });
}

function rowsToCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function resolveExportArgs(catalogOrHourFormat, hourFormat) {
  if (Array.isArray(catalogOrHourFormat)) {
    return { catalog: catalogOrHourFormat, resolvedHourFormat: hourFormat };
  }
  return { catalog: [], resolvedHourFormat: catalogOrHourFormat || hourFormat };
}

function buildWorkbookFiles(sheets, options = {}) {
  const now = new Date().toISOString();
  const worksheetOverrides = sheets
    .map(
      (_, index) =>
        `  <Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join("\n");
  const workbookSheetXml = sheets
    .map(
      (sheet, index) =>
        `    <sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
    )
    .join("\n");
  const worksheetRelationships = sheets
    .map(
      (_, index) =>
        `  <Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
    )
    .join("\n");
  const styleRelationshipId = sheets.length + 1;
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${worksheetOverrides}
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
    "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(options.title || "Pedido")}</dc:title>
  <dc:creator>${escapeXml(options.creator || "Pedidos por Voz")}</dc:creator>
  <cp:lastModifiedBy>${escapeXml(options.creator || "Pedidos por Voz")}</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`,
    "docProps/app.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Pedidos por Voz</Application>
</Properties>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
${workbookSheetXml}
  </sheets>
</workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${worksheetRelationships}
  <Relationship Id="rId${styleRelationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF10775F"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
  };

  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = buildWorksheetXml(sheet.rows);
  });

  return files;
}

function buildWorksheetXml(rows) {
  const widths = [34, 14, 20];
  const columnCount = Math.max(rows[0]?.length || 1, 1);
  const columnsXml = Array.from({ length: columnCount }, (_, index) => {
    const column = index + 1;
    const width = widths[index] || 16;
    return `    <col min="${column}" max="${column}" width="${width}" customWidth="1"/>`;
  }).join("\n");
  const rowXml = rows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = row
        .map((value, columnIndex) => buildCellXml(value, rowNumber, columnIndex, rowIndex === 0))
        .join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");
  const lastRow = Math.max(rows.length, 1);
  const lastColumn = columnName(columnCount);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>
${columnsXml}
  </cols>
  <sheetData>${rowXml}</sheetData>
  <autoFilter ref="A1:${lastColumn}${lastRow}"/>
</worksheet>`;
}

function buildCellXml(value, rowNumber, columnIndex, isHeader) {
  const cellReference = `${columnName(columnIndex + 1)}${rowNumber}`;
  const style = isHeader ? ' s="1"' : "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${cellReference}"${style}><v>${value}</v></c>`;
  }
  return `<c r="${cellReference}" t="inlineStr"${style}><is><t>${escapeXml(value)}</t></is></c>`;
}

function columnName(index) {
  let name = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function createZipBlob(files, mimeType) {
  const encoder = new TextEncoder();
  const chunks = [];
  const records = [];
  let offset = 0;

  for (const [path, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(path);
    const dataBytes = encoder.encode(content);
    const crc = crc32(dataBytes);
    const { time, date } = dosTimestamp(new Date());
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);

    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, time, true);
    view.setUint16(12, date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, dataBytes.length, true);
    view.setUint32(22, dataBytes.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    chunks.push(localHeader, dataBytes);
    records.push({ nameBytes, dataBytes, crc, offset, time, date });
    offset += localHeader.length + dataBytes.length;
  }

  const centralDirectoryOffset = offset;
  for (const record of records) {
    const centralHeader = new Uint8Array(46 + record.nameBytes.length);
    const view = new DataView(centralHeader.buffer);

    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, record.time, true);
    view.setUint16(14, record.date, true);
    view.setUint32(16, record.crc, true);
    view.setUint32(20, record.dataBytes.length, true);
    view.setUint32(24, record.dataBytes.length, true);
    view.setUint16(28, record.nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, record.offset, true);
    centralHeader.set(record.nameBytes, 46);

    chunks.push(centralHeader);
    offset += centralHeader.length;
  }

  const centralDirectorySize = offset - centralDirectoryOffset;
  const endRecord = new Uint8Array(22);
  const view = new DataView(endRecord.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, records.length, true);
  view.setUint16(10, records.length, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, 0, true);
  chunks.push(endRecord);

  return new Blob(chunks, { type: mimeType });
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[index]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function dosTimestamp(date) {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function safeSheetName(value) {
  const fallback = "Pedido";
  const cleaned = String(value || fallback)
    .replace(/[\\/?*[\]:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback).slice(0, 31);
}

function safeFileName(value) {
  return (
    String(value || "pedido")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "pedido"
  );
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
