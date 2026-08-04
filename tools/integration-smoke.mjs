import assert from "node:assert/strict";
import { DEFAULT_CATALOG, normalizeCatalog } from "../src/catalog.js";
import { requisitionToCsv } from "../src/exporters.js";
import { parseRequisitionText } from "../src/parser.js";
import {
  createRequisition,
  markConfirmed,
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

const csv = requisitionToCsv(requisition);
assert.ok(csv.includes("REQ-20260803-0001"));
assert.ok(csv.includes("Chef Prueba"));
assert.ok(csv.includes("Banano"));
assert.ok(csv.includes(",30,und,"));

const invalid = createRequisition([requisition]);
invalid.items = parsed.items;
assert.equal(validateRequisition(invalid, catalog, "confirm").ok, false);

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
