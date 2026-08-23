const products = [
  { spoken: "tomate", productName: "Tomate", unit: "kg", unitSpoken: "kilos" },
  { spoken: "banano", productName: "Banano", unit: "und", unitSpoken: "unidades" },
  { spoken: "leche", productName: "Leche", unit: "caja", unitSpoken: "cajas" },
  { spoken: "arroz", productName: "Arroz", unit: "paquete", unitSpoken: "paquetes" },
  { spoken: "cebollin", productName: "Cebollín", unit: "rollo", unitSpoken: "rollos" },
  { spoken: "pechuga de pollo", productName: "Filete de Pechuga de Pollo Fresco", unit: "kg", unitSpoken: "kilos" },
  { spoken: "aguacate", productName: "Aguacate Hass", unit: "und", unitSpoken: "unidades" },
  { spoken: "azucar", productName: "Azúcar", unit: "kg", unitSpoken: "kilos" }
];

const quantities = [
  { spoken: "4", value: 4, category: "cantidades" },
  { spoken: "diez", value: 10, category: "numeros_escritos" },
  { spoken: "2.5", value: 2.5, category: "decimales" },
  { spoken: "medio", value: 0.5, category: "fracciones" },
  { spoken: "un cuarto", value: 0.25, category: "fracciones" }
];

const templates = [
  ({ quantity, product }) => `${quantity.spoken} ${product.unitSpoken} de ${product.spoken}`,
  ({ quantity, product }) => `${product.spoken} ${quantity.spoken} ${product.unitSpoken}`,
  ({ quantity, product }) => `necesito ${quantity.spoken} ${product.unitSpoken} ${product.spoken}`,
  ({ quantity, product }) => `pongame ${quantity.spoken} ${product.unitSpoken} de ${product.spoken}`
];

export const VOICE_DATASET = [];

for (const product of products) {
  for (const quantity of quantities) {
    for (const template of templates) {
      VOICE_DATASET.push({
        category: quantity.category,
        phrase: template({ quantity, product }),
        expected: [{ productName: product.productName, quantity: quantity.value, unit: product.unit }]
      });
    }
  }
}

VOICE_DATASET.push(
  {
    category: "multiples",
    phrase: "10 kilos de tomate, 5 unidades de banano y 2 cajas de leche",
    expected: [
      { productName: "Tomate", quantity: 10, unit: "kg" },
      { productName: "Banano", quantity: 5, unit: "und" },
      { productName: "Leche", quantity: 2, unit: "caja" }
    ]
  },
  {
    category: "multiples",
    phrase: "cuatro paquetes de arroz y tres rollos de cebollin",
    expected: [
      { productName: "Arroz", quantity: 4, unit: "paquete" },
      { productName: "Cebollín", quantity: 3, unit: "rollo" }
    ]
  },
  { category: "sinonimos", phrase: "5 unidades de bananas", expected: [{ productName: "Banano", quantity: 5, unit: "und" }] },
  { category: "sinonimos", phrase: "3 kilos de azucar", expected: [{ productName: "Azúcar", quantity: 3, unit: "kg" }] },
  { category: "errores_foneticos", phrase: "4 kilos de tomatte", expected: [{ productName: "Tomate", quantity: 4, unit: "kg" }] },
  { category: "errores_foneticos", phrase: "6 unidades de bannano", expected: [{ productName: "Banano", quantity: 6, unit: "und" }] },
  { category: "ambiguedad", phrase: "2 paquetes de mozzarella", review: true },
  { category: "unidad_inferida", phrase: "tomate diez", expected: [{ productName: "Tomate", quantity: 10, unit: "caja" }], inferred: true }
);

export const VOICE_COMMAND_DATASET = [
  { category: "comandos", phrase: "Quite el tomate", initial: [line("Tomate", 10, "kg")], action: "remove", count: 0 },
  { category: "comandos", phrase: "Borre el ultimo producto", initial: [line("Tomate", 10, "kg")], action: "remove-last", count: 0 },
  { category: "comandos", phrase: "Cambie el tomate de 10 a 12 kilos", initial: [line("Tomate", 10, "kg")], action: "change", quantity: 12 },
  { category: "comandos", phrase: "Pongale 12 al tomate", initial: [line("Tomate", 10, "kg")], action: "change", quantity: 12 },
  { category: "comandos", phrase: "Agregue 5 kilos mas de tomate", initial: [line("Tomate", 10, "kg")], action: "add-more", quantity: 15 },
  { category: "comandos", phrase: "Duplique el tomate", initial: [line("Tomate", 10, "kg")], action: "duplicate", count: 2 },
  { category: "comandos", phrase: "Deshaga el ultimo cambio", initial: [], action: "undo", count: 0 },
  { category: "contexto", phrase: "Mejor pongale doce", initial: [line("Tomate", 10, "kg")], action: "set-context", quantity: 12 },
  { category: "contexto", phrase: "Y otros tres", initial: [line("Tomate", 5, "kg")], action: "add-context", quantity: 8 }
];

function line(productName, quantity, unit) {
  return { id: `dataset-${productName}`, productName, quantity, requestedQuantity: quantity, unit, needsReview: false };
}
