import assert from "node:assert/strict";
import { DEFAULT_CATALOG, normalizeCatalog } from "../src/catalog.js";
import { parseRequisitionText } from "../src/parser.js";

const catalog = normalizeCatalog(DEFAULT_CATALOG);

const cases = [
  {
    phrase: "Bananos 30 unidades",
    item: { productName: "Banano", quantity: 30, unit: "und", needsReview: false }
  },
  {
    phrase: "30 unidades de banano",
    item: { productName: "Banano", quantity: 30, unit: "und", needsReview: false }
  },
  {
    phrase: "10 kilos de sandía",
    item: { productName: "Sandía negra", quantity: 10, unit: "kg", needsReview: false }
  },
  {
    phrase: "Sandía, diez kilos",
    item: { productName: "Sandía negra", quantity: 10, unit: "kg", needsReview: false }
  },
  {
    phrase: "20 kg de papaya y 30 kg de melón",
    count: 2,
    items: [
      { productName: "Papaya madura", quantity: 20, unit: "kg" },
      { productName: "Melón", quantity: 30, unit: "kg" }
    ]
  },
  {
    phrase: "14 unidades de papaya",
    item: { productName: "Papaya madura", quantity: 14, unit: "und", needsReview: false }
  },
  {
    phrase: "50 plátanos maduros",
    item: { productName: "Plátano maduro", quantity: 50, unit: "und", needsReview: false }
  },
  {
    phrase: "Agregue cinco cajas de tomate",
    item: { productName: "Tomate", quantity: 5, unit: "caja", needsReview: false }
  },
  {
    phrase: "10 cajas de leche, 5 kg de azúcar, 12 paquetes de arroz",
    count: 3,
    items: [
      { productName: "Leche", quantity: 10, unit: "caja", needsReview: false },
      { productName: "Azúcar", quantity: 5, unit: "kg", needsReview: false },
      { productName: "Arroz", quantity: 12, unit: "paquete", needsReview: false }
    ]
  },
  {
    phrase: "10 lechugas 4 kg de tomate",
    count: 2,
    items: [
      { productName: "Lechuga", quantity: 10, unit: "und", needsReview: false },
      { productName: "Tomate", quantity: 4, unit: "kg", needsReview: false }
    ]
  },
  {
    phrase: "diez lechugas y cuatro kilos de tomate",
    count: 2,
    items: [
      { productName: "Lechuga", quantity: 10, unit: "und", needsReview: false },
      { productName: "Tomate", quantity: 4, unit: "kg", needsReview: false }
    ]
  },
  {
    phrase: "treinta y cinco unidades de banano",
    item: { productName: "Banano", quantity: 35, unit: "und", needsReview: false }
  },
  {
    phrase: "10 kilos de pechuga de pollo",
    item: {
      productName: "Filete de Pechuga de Pollo Fresco",
      quantity: 10,
      unit: "kg",
      needsReview: false
    }
  },
  {
    phrase: "6 kilos de carne molida",
    item: { productName: "Carne Molida", quantity: 6, unit: "kg", needsReview: false }
  },
  {
    phrase: "3 rollos de cebollín",
    item: { productName: "Cebollín", quantity: 3, unit: "rollo", needsReview: false }
  },
  {
    phrase: "2 tamugas de culantro coyote",
    item: { productName: "Culantro coyote", quantity: 2, unit: "tamuga", needsReview: false }
  },
  {
    phrase: "4 paquetes de queso mozzarella rebanado",
    item: {
      productName: "Queso mozzarella rebanado",
      quantity: 4,
      unit: "paquete",
      needsReview: false
    }
  },
  {
    phrase: "5 unidades de pasta wasabi y 8 unidades de volován",
    count: 2,
    items: [
      { productName: "Pasta wasabi", quantity: 5, unit: "und", needsReview: false },
      { productName: "Vol au vent", quantity: 8, unit: "und", needsReview: false }
    ]
  },
  {
    phrase: "Quite dos kilos de cebolla",
    command: "remove",
    item: { productName: "Cebolla", quantity: 2, unit: "kg" }
  },
  {
    phrase: "Cambie la papaya de 10 a 15 kilos",
    command: "change",
    item: { productName: "Papaya madura", quantity: 15, unit: "kg" }
  },
  {
    phrase: "Borre el último producto",
    command: "remove-last",
    count: 0
  },
  {
    phrase: "Repita el pedido anterior y agregue 20 unidades de banano",
    command: "repeat",
    item: { productName: "Banano", quantity: 20, unit: "und" }
  }
];

for (const testCase of cases) {
  const result = parseRequisitionText(testCase.phrase, catalog);
  if (testCase.command) {
    assert.equal(result.command?.type, testCase.command, testCase.phrase);
  }
  if (Number.isFinite(testCase.count)) {
    assert.equal(result.items.length, testCase.count, testCase.phrase);
  }
  if (testCase.item) {
    assert.ok(result.items.length >= 1, testCase.phrase);
    assertItem(result.items[0], testCase.item, testCase.phrase);
  }
  if (testCase.items) {
    assert.equal(result.items.length, testCase.items.length, testCase.phrase);
    testCase.items.forEach((expected, index) => assertItem(result.items[index], expected, testCase.phrase));
  }
}

const multi = parseRequisitionText(
  "Necesito 30 unidades de banano, 10 kilos de sandía y 14 unidades de papaya madura.",
  catalog
);
assert.equal(multi.items.length, 3);
assert.equal(multi.items[2].productName, "Papaya madura");
assert.equal(multi.items[2].notes, "");

console.log("Parser smoke OK");

function assertItem(actual, expected, phrase) {
  assert.equal(actual.productName, expected.productName, phrase);
  assert.equal(actual.quantity, expected.quantity, phrase);
  assert.equal(actual.unit, expected.unit, phrase);
  if (typeof expected.needsReview === "boolean") {
    assert.equal(actual.needsReview, expected.needsReview, phrase);
  }
}
