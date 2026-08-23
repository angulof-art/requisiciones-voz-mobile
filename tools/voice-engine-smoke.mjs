import assert from "node:assert/strict";
import { DEFAULT_CATALOG, normalizeCatalog } from "../src/catalog.js";
import { parseRequisitionText } from "../src/parser.js";
import { processVoiceRequest } from "../src/voice-engine.js";

const catalog = normalizeCatalog(DEFAULT_CATALOG);

for (const [phrase, quantity] of [
  ["medio kilo de tomate", 0.5],
  ["un cuarto de kilo de tomate", 0.25],
  ["tres cuartos de kilo de tomate", 0.75],
  ["1/2 kg de tomate", 0.5],
  ["kilo y medio de tomate", 1.5],
  ["dos coma cinco kilos de tomate", 2.5],
  ["dos punto cinco kilos de tomate", 2.5]
]) {
  const item = parseRequisitionText(phrase, catalog).items[0];
  assert.equal(item.productName, "Tomate", phrase);
  assert.equal(item.quantity, quantity, phrase);
  assert.equal(item.unit, "kg", phrase);
}

let items = processVoiceRequest("Agregue diez kilos de tomate", [], catalog).items;
assert.equal(items[0].quantity, 10);

let result = processVoiceRequest("Mejor póngale doce", items, catalog);
assert.equal(result.action, "set-context");
assert.equal(result.items[0].quantity, 12);

result = processVoiceRequest("Y otros tres", result.items, catalog);
assert.equal(result.action, "add-context");
assert.equal(result.items[0].quantity, 15);

result = processVoiceRequest("Póngale 7 al tomate", result.items, catalog);
assert.equal(result.action, "change");
assert.equal(result.items[0].quantity, 7);

result = processVoiceRequest("Agregue 5 kilos más de tomate", result.items, catalog);
assert.equal(result.action, "add-more");
assert.equal(result.items[0].quantity, 12);

result = processVoiceRequest("Duplique el tomate", result.items, catalog);
assert.equal(result.action, "duplicate");
assert.equal(result.items.length, 2);

result = processVoiceRequest("Quite el tomate", result.items, catalog);
assert.equal(result.action, "remove");
assert.equal(result.items.length, 1);

result = processVoiceRequest("Borre el último producto", result.items, catalog);
assert.equal(result.action, "remove-last");
assert.equal(result.items.length, 0);

result = processVoiceRequest("Deshaga el último cambio", [], catalog);
assert.equal(result.action, "undo");

console.log("Voice engine smoke OK");
