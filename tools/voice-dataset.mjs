import assert from "node:assert/strict";
import { DEFAULT_CATALOG, normalizeCatalog } from "../src/catalog.js";
import { parseRequisitionText } from "../src/parser.js";
import { processVoiceRequest } from "../src/voice-engine.js";
import { VOICE_COMMAND_DATASET, VOICE_DATASET } from "../tests/voice-dataset.mjs";

const catalog = normalizeCatalog(DEFAULT_CATALOG);
const stats = new Map();
let passed = 0;
const failures = [];
const total = VOICE_DATASET.length + VOICE_COMMAND_DATASET.length;

for (const testCase of VOICE_DATASET) {
  const parsed = parseRequisitionText(testCase.phrase, catalog);
  let ok = false;
  if (testCase.review) {
    ok = parsed.items.length === 1 && parsed.items[0].needsReview;
  } else {
    ok = parsed.items.length === testCase.expected.length && testCase.expected.every((expected, index) => {
      const actual = parsed.items[index];
      return actual?.productName === expected.productName
        && actual.quantity === expected.quantity
        && actual.unit === expected.unit
        && (!testCase.inferred || actual.unitInferred);
    });
  }
  record(testCase.category, ok);
  if (ok) passed += 1;
  else failures.push({ category: testCase.category, phrase: testCase.phrase, actual: parsed.items });
}

for (const testCase of VOICE_COMMAND_DATASET) {
  const interpreted = processVoiceRequest(testCase.phrase, testCase.initial, catalog);
  const ok = interpreted.action === testCase.action
    && (testCase.count === undefined || interpreted.items.length === testCase.count)
    && (testCase.quantity === undefined || interpreted.items[0]?.quantity === testCase.quantity);
  record(testCase.category, ok);
  if (ok) passed += 1;
  else failures.push({ category: testCase.category, phrase: testCase.phrase, actual: interpreted });
}

const accuracy = passed / total;
if (failures.length) console.error("Voice dataset failures:", failures.slice(0, 25));
assert.ok(total >= 150, `Dataset insuficiente: ${total}`);
assert.ok(accuracy >= 0.95, `Accuracy ${(accuracy * 100).toFixed(2)}% (${passed}/${total})`);

console.log(`Voice dataset OK: ${(accuracy * 100).toFixed(2)}% (${passed}/${total})`);
for (const [category, values] of [...stats.entries()].sort()) {
  console.log(`  ${category}: ${values.passed}/${values.total} (${(values.passed / values.total * 100).toFixed(2)}%)`);
}

function record(category, ok) {
  const values = stats.get(category) || { passed: 0, total: 0 };
  values.total += 1;
  if (ok) values.passed += 1;
  stats.set(category, values);
}
