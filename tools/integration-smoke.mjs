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
  validateRequisition,
  validateRequisitionItem
} from "../src/requisitions.js";
import { loadCatalog, STORAGE_KEYS } from "../src/storage.js";
import {
  makeConflictSafeRequisitionNumber,
  syncAllToSupabase,
  syncRequisitionToSupabase
} from "../src/supabase.js";

const catalog = normalizeCatalog(DEFAULT_CATALOG);
assert.equal(catalog.length, 327);
assert.equal(new Set(catalog.map((product) => product.id)).size, catalog.length);
assert.equal(new Set(catalog.map((product) => product.code)).size, catalog.length);
assert.equal(
  new Set(catalog.map((product) => product.officialName.toLocaleLowerCase("es"))).size,
  catalog.length
);
assert.ok(catalog.some((product) => product.officialName === "Filete de Pechuga de Pollo Fresco"));
assert.ok(catalog.some((product) => product.officialName === "Queso mozzarella rebanado"));
assert.equal(catalog.filter((product) => product.officialName === "Pasta wasabi").length, 1);
assert.equal(catalog.filter((product) => product.officialName === "Vol au vent").length, 1);
const requisition = createRequisition([], new Date("2026-08-03T15:20:00-06:00"));
requisition.requestedBy = "Chef Prueba";
const parsed = parseRequisitionText("30 unidades de banano, 10 kilos de sandía", catalog);
requisition.items = parsed.items;
requisition.originalTranscript = parsed.originalText;

const validation = validateRequisition(requisition, catalog, "confirm");
assert.equal(validation.ok, true, validation.errors.join(" | "));
assert.deepEqual(
  validateRequisitionItem({ productName: "", quantity: 20, unit: "kg" }, 1),
  ["Linea 2: falta el producto."]
);
assert.deepEqual(
  validateRequisitionItem({ productName: "Uva Verde", quantity: 1, unit: "kg" }, 2),
  []
);

markConfirmed(requisition);
assert.equal(requisition.status, "confirmed");
assert.ok(requisition.confirmedAt);

const rows = requisitionToExcelRows(requisition, catalog);
assert.deepEqual(rows[0], [
  "Producto",
  "Cantidad",
  "Unidad de compra"
]);
assert.deepEqual(rows[1], ["Banano", 30, "und"]);

const csv = requisitionToCsv(requisition, catalog);
assert.ok(csv.includes("Banano"));
assert.ok(csv.includes("Unidad de compra"));

const xlsx = await requisitionToXlsxBlob(requisition, catalog).arrayBuffer();
const bytes = new Uint8Array(xlsx);
const zipText = new TextDecoder().decode(bytes);
assert.equal(bytes[0], 0x50);
assert.equal(bytes[1], 0x4b);
assert.ok(zipText.includes("xl/worksheets/sheet1.xml"));
assert.ok(zipText.includes("autoFilter"));
assert.ok(zipText.includes("Unidad de compra"));

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
assert.equal(loadCatalog().length, 327);

const conflictRequisition = createRequisition([], new Date("2026-08-04T09:15:00-06:00"));
conflictRequisition.requisitionNumber = "REQ-20260804-0001";
conflictRequisition.requestedBy = "Prueba Supabase";
const deterministicConflictNumber = makeConflictSafeRequisitionNumber(
  conflictRequisition,
  new Date("2026-08-04T15:16:17.000Z")
);
assert.match(deterministicConflictNumber, /^REQ-20260804-151617-[A-Z0-9]{6}$/);

const originalFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url: String(url), options });
  if (options.method === "GET" || !options.method) {
    return new Response(
      JSON.stringify([{ id: "req-remota", requisition_number: "REQ-20260804-0001" }]),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  return new Response(null, { status: 204 });
};
const conflictResult = await syncRequisitionToSupabase(
  {
    enabled: true,
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_test",
    workspaceId: "main"
  },
  conflictRequisition,
  []
);
globalThis.fetch = originalFetch;
assert.ok(conflictResult.rename);
assert.notEqual(conflictRequisition.requisitionNumber, "REQ-20260804-0001");
assert.equal(conflictResult.rename.requisitionNumber, conflictRequisition.requisitionNumber);
assert.ok(
  requests.some(
    (request) =>
      request.options.method === "POST" &&
      String(request.options.body).includes(conflictRequisition.requisitionNumber)
  )
);

const batchRequests = [];
globalThis.fetch = async (url, options = {}) => {
  batchRequests.push({ url: String(url), options });
  if (options.method === "GET" || !options.method) {
    const body = String(url).includes("requisition_number=eq.") ? "[]" : "[]";
    return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response(null, { status: 204 });
};
await syncAllToSupabase(
  {
    enabled: true,
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_test",
    workspaceId: "main"
  },
  [createRequisition([]), createRequisition([])],
  catalog.slice(0, 3)
);
globalThis.fetch = originalFetch;
assert.equal(
  batchRequests.filter(
    (request) => request.options.method === "POST" && request.url.includes("/products?")
  ).length,
  1
);

console.log("Integration smoke OK");
