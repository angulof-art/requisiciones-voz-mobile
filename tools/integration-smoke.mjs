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
  isMeaningfulRequisition,
  markConfirmed,
  mergeRequisitionHistories,
  normalizeRequisition,
  validateRequisition,
  validateRequisitionItem
} from "../src/requisitions.js";
import { loadCatalog, loadSettings, STORAGE_KEYS } from "../src/storage.js";
import {
  fetchRequisitionsFromSupabase,
  makeConflictSafeRequisitionNumber,
  setSupabaseSessionContext,
  syncAllToSupabase,
  syncRequisitionToSupabase
} from "../src/supabase.js";

const authContext = {
  userId: "00000000-0000-4000-8000-000000000001",
  displayName: "Usuario QA",
  organizationId: "00000000-0000-4000-8000-000000000010",
  locationId: "00000000-0000-4000-8000-000000000020",
  departmentId: "00000000-0000-4000-8000-000000000030",
  permissions: ["catalog.manage", "requisitions.create", "requisitions.read", "requisitions.update"]
};
setSupabaseSessionContext({ access_token: "authenticated-user-token" }, authContext);

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
assert.equal(isMeaningfulRequisition(invalid), true);
assert.equal(isMeaningfulRequisition(createRequisition([])), false);

const localHistory = createRequisition([], new Date("2026-08-10T12:00:00Z"));
localHistory.requestedBy = "Pedido local";
localHistory.updatedAt = "2026-08-10T13:00:00Z";
const remoteHistory = normalizeRequisition({
  ...localHistory,
  requestedBy: "Pedido remoto anterior",
  updatedAt: "2026-08-10T12:30:00Z"
});
const cloudOnlyHistory = createRequisition([localHistory], new Date("2026-08-11T12:00:00Z"));
cloudOnlyHistory.requestedBy = "Solo nube";
const mergedHistory = mergeRequisitionHistories(
  [localHistory],
  [remoteHistory, cloudOnlyHistory],
  [localHistory.id]
);
assert.equal(mergedHistory.length, 2);
assert.equal(mergedHistory.find((entry) => entry.id === localHistory.id).requestedBy, "Pedido local");
assert.equal(mergedHistory[0].id, cloudOnlyHistory.id);

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
assert.ok((await loadCatalog()).some((product) => product.code === "VEG-003"));
assert.equal((await loadCatalog()).length, 327);
assert.equal((await loadSettings()).supabase.autoSync, true);
storage.set(
  STORAGE_KEYS.settings,
  JSON.stringify({ supabase: { enabled: true, autoSync: false } })
);
assert.equal((await loadSettings()).supabase.autoSync, false);

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
assert.ok(requests.every((request) => request.options.headers.Authorization === "Bearer authenticated-user-token"));

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

globalThis.fetch = async (url) => {
  const requestUrl = String(url);
  if (requestUrl.includes("/requisitions?")) {
    return new Response(
      JSON.stringify([
        {
          id: "req-cloud-history",
          workspace_id: "main",
          requisition_number: "REQ-20260812-0001",
          requested_by: "Chef nube",
          status: "confirmed",
          original_transcript: "2 kg de tomate",
          created_at: "2026-08-12T12:00:00Z",
          updated_at: "2026-08-12T12:05:00Z"
        }
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  if (requestUrl.includes("/requisition_items?")) {
    return new Response(
      JSON.stringify([
        {
          id: "item-cloud-history",
          requisition_id: "req-cloud-history",
          product_name: "Tomate",
          quantity: 2,
          unit: "kg",
          sort_order: 0
        }
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
};
const downloadedHistory = await fetchRequisitionsFromSupabase({
  enabled: true,
  url: "https://example.supabase.co",
  publishableKey: "sb_publishable_test",
  workspaceId: "main"
});
globalThis.fetch = originalFetch;
assert.equal(downloadedHistory.length, 1);
assert.equal(downloadedHistory[0].requestedBy, "Chef nube");
assert.equal(downloadedHistory[0].items[0].productName, "Tomate");
assert.equal(downloadedHistory[0].syncStatus, "synced");
assert.ok(requests.every((request) => request.options.headers.Authorization !== "Bearer sb_publishable_test"));

setSupabaseSessionContext(null, null);

console.log("Integration smoke OK");
