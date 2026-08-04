import assert from "node:assert/strict";
import { DEFAULT_CATALOG, normalizeCatalog } from "../src/catalog.js";
import {
  buildPrintableHtml,
  requisitionToCsv,
  requisitionToExcelRows,
  requisitionToXlsxBlob
} from "../src/exporters.js";
import { parseRequisitionText } from "../src/parser.js";
import {
  addChange,
  createRequisition,
  markConfirmed,
  normalizeRequisition,
  validateRequisition
} from "../src/requisitions.js";
import { loadCatalog, STORAGE_KEYS } from "../src/storage.js";

const catalog = normalizeCatalog(DEFAULT_CATALOG);
const requisition = createRequisition([], new Date("2026-08-03T15:20:00-06:00"));
requisition.requestedBy = "Chef Prueba";
const parsed = parseRequisitionText("30 unidades de banano, 10 kilos de sandía", catalog);
requisition.items = parsed.items;
requisition.originalTranscript = parsed.originalText;

const validation = validateRequisition(requisition, catalog, "confirm");
assert.equal(validation.ok, true, validation.errors.join(" | "));

markConfirmed(requisition);
assert.equal(requisition.status, "confirmed");
assert.ok(requisition.confirmedAt);

const rows = requisitionToExcelRows(requisition, catalog);
assert.deepEqual(rows[0].slice(0, 12), [
  "Codigo",
  "Categoria",
  "Nombre oficial",
  "Nombre corto",
  "Alias de voz",
  "Producto",
  "Cantidad",
  "Unidad de conteo",
  "Contenido por unidad",
  "Unidad base",
  "Cantidad total",
  "Costo unitario"
]);
assert.equal(rows[1][0], "FRU-001");
assert.equal(rows[1][1], "Frutas");
assert.equal(rows[1][5], "Banano");
assert.equal(rows[1][6], 30);
assert.equal(rows[1][7], "und");
assert.equal(rows[1][10], 30);
assert.equal(rows[1][24], "REQ-20260803-0001");

const csv = requisitionToCsv(requisition, catalog);
assert.ok(csv.includes("REQ-20260803-0001"));
assert.ok(csv.includes("Chef Prueba"));
assert.ok(csv.includes("Banano"));

const xlsx = await requisitionToXlsxBlob(requisition, catalog).arrayBuffer();
const bytes = new Uint8Array(xlsx);
const zipText = new TextDecoder().decode(bytes);
assert.equal(bytes[0], 0x50);
assert.equal(bytes[1], 0x4b);
assert.ok(zipText.includes("xl/worksheets/sheet1.xml"));
assert.ok(zipText.includes("autoFilter"));

const pdfHtml = buildPrintableHtml(requisition);
assert.ok(pdfHtml.includes("Guardar como PDF"));
assert.ok(pdfHtml.includes("window.print"));

const invalid = createRequisition([requisition]);
invalid.items = parsed.items;
assert.equal(validateRequisition(invalid, catalog, "confirm").ok, false);

const compact = createRequisition([]);
compact.requestedBy = "Historial";
compact.items = parsed.items;
for (let index = 0; index < 8; index += 1) {
  addChange(compact, "prueba", compact, compact);
}
const normalizedCompact = normalizeRequisition(compact);
const serializedLength = JSON.stringify(normalizedCompact.changes).length;
assert.ok(serializedLength < 50000, `Historial demasiado grande: ${serializedLength}`);
assert.equal(JSON.stringify(normalizedCompact.changes).includes('"changes"'), false);

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key)
};
storage.set(
  STORAGE_KEYS.catalog,
  JSON.stringify(catalog.filter((product) => product.code !== "VEG-003"))
);
assert.ok(loadCatalog().some((product) => product.code === "VEG-003"));

console.log("Integration smoke OK");
