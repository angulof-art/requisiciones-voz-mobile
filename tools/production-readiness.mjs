import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_CATALOG, normalizeCatalog } from "../src/catalog.js";
import { requisitionToPdfBlob, requisitionToXlsxBlob } from "../src/exporters.js";
import { parseRequisitionText } from "../src/parser.js";
import { buildOperationalReport } from "../src/reports.js";

const catalog = normalizeCatalog(DEFAULT_CATALOG);
const phrase = "Necesito diez kilos de pechuga de pollo, cinco kilos de tomate, tres rollos de cebollín, veinte unidades de aguacate, dos cajas de leche y cuatro paquetes de queso mozzarella rebanado.";
const parsed = parseRequisitionText(phrase, catalog);
assert.equal(parsed.items.length, 6);
assert.deepEqual(parsed.items.map((item) => item.quantity), [10, 5, 3, 20, 2, 4]);

const requisitions = Array.from({ length: 5000 }, (_, index) => ({
  id: `perf-${index}`,
  status: index % 5 === 0 ? "partial" : index % 3 === 0 ? "delivered" : "submitted",
  priority: index % 11 === 0 ? "urgent" : "normal",
  departmentId: `dept-${index % 8}`,
  createdAt: new Date(Date.now() - index * 60_000).toISOString(),
  submittedAt: new Date(Date.now() - index * 60_000).toISOString(),
  deliveredAt: index % 3 === 0 ? new Date(Date.now() - index * 60_000 + 3_600_000).toISOString() : "",
  items: Array.from({ length: 3 }, (_, itemIndex) => ({
    productId: `product-${itemIndex}`,
    productName: `Producto ${itemIndex}`,
    quantity: itemIndex + 1,
    requestedQuantity: itemIndex + 1,
    unit: "kg",
    fulfillmentStatus: index % 5 === 0 && itemIndex === 0 ? "unavailable" : "requested"
  }))
}));

const startedAt = performance.now();
const report = buildOperationalReport(requisitions);
const elapsed = performance.now() - startedAt;
assert.equal(report.rows.length, 5000);
assert.ok(elapsed < 3000, `Reporte de 5.000 pedidos lento: ${elapsed.toFixed(0)} ms`);

const exportRequisition = { ...requisitions[0], requisitionNumber: "REQ-QA-5000", requestedBy: "QA", items: requisitions[0].items };
const [pdf, xlsx] = await Promise.all([
  requisitionToPdfBlob(exportRequisition).arrayBuffer(),
  requisitionToXlsxBlob(exportRequisition, catalog).arrayBuffer()
]);
assert.ok(pdf.byteLength > 1000);
assert.ok(xlsx.byteLength > 1000);

const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const worker = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");
assert.ok(index.includes("Content-Security-Policy"));
assert.ok(app.includes("rows.slice(0, historyVisibleLimit)"));
for (const moduleName of ["workflow.js", "voice-engine.js", "reports.js"]) assert.ok(worker.includes(moduleName));

console.log(`Production readiness smoke OK: 5.000 pedidos en ${elapsed.toFixed(1)} ms`);
