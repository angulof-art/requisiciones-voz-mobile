import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [producePath, restaurantPath] = process.argv.slice(2);
if (!producePath || !restaurantPath) {
  throw new Error("Uso: node tools/generate-master-catalog.mjs <frutas.tsv> <restaurante.tsv>");
}

const existingProducts = [
  product("VEG-001", "Tomate", "Vegetales", "caja", ["caja", "kg", "und"], [
    "tomates",
    "tomate maduro"
  ]),
  product("VEG-003", "Lechuga", "Vegetales", "und", ["und", "kg", "caja"], [
    "lechugas"
  ]),
  product("VEG-002", "Cebolla", "Vegetales", "kg", ["kg", "und", "bolsa"], [
    "cebollas"
  ]),
  product("ABA-001", "Leche", "Abarrotes", "caja", ["caja", "L", "botella", "paquete"], [
    "leches",
    "caja de leche",
    "cajas de leche"
  ]),
  product("ABA-002", "Azúcar", "Abarrotes", "kg", ["kg", "g", "bolsa", "paquete"], [
    "azucar",
    "azúcares",
    "azucares"
  ]),
  product("ABA-003", "Arroz", "Abarrotes", "paquete", ["paquete", "kg", "g", "bolsa"], [
    "arroces",
    "paquete de arroz",
    "paquetes de arroz"
  ])
];

const stableProduce = new Map([
  ["banano", { code: "FRU-001", id: "prod-fru-001", allowedUnits: ["und", "kg"] }],
  ["sandia negra", { code: "FRU-002", id: "prod-fru-002", allowedUnits: ["kg", "und"] }],
  ["papaya madura", { code: "FRU-003", id: "prod-fru-003", allowedUnits: ["kg", "und"] }],
  ["platano maduro", { code: "FRU-004", id: "prod-fru-004", allowedUnits: ["und", "kg"] }],
  ["melon", { code: "FRU-005", id: "prod-fru-005", allowedUnits: ["kg", "und"] }]
]);

const canonicalOverrides = new Map([
  ["volauvent", "Vol au vent"],
  ["vol au vent", "Vol au vent"],
  ["pasta wasabi", "Pasta wasabi"],
  ["hierbas de provincia", "Hierbas de Provenza"],
  ["bocadillo de palmito", "Bocadillo de palmito"],
  ["bocadillo de strudel de manzana", "Bocadillo de strudel de manzana"],
  ["mini croissant pequenos", "Mini croissant"],
  ["mini croissant", "Mini croissant"],
  ["tartaletas medianas", "Tartaletas"],
  ["tartaletas", "Tartaletas"],
  ["queso mozarella rebanado", "Queso mozzarella rebanado"],
  ["queso mozzrella rebanado", "Queso mozzarella rebanado"],
  ["galleta chispas de chocolate c1 100", "Galleta chispas de chocolate C1/100"],
  ["330741 galleta chispas de chocolate c1 100", "Galleta chispas de chocolate C1/100"],
  ["chile escamas", "Chile en escamas"],
  ["chile en escamas 340 gr", "Chile en escamas"],
  ["aceite de oliva extravirgen galon", "Aceite de oliva extra virgen"],
  ["aceite oliva extra virgen 1 5 litros", "Aceite de oliva extra virgen"],
  ["bocadillo enchilada de papa y carne", "Bocadillo de papa y carne"],
  ["bocadillo de papa y carne", "Bocadillo de papa y carne"]
]);

const manualSynonyms = new Map([
  ["filete de pechuga de pollo fresco", ["pechuga de pollo", "filete de pollo", "pechuga fresca"]],
  ["fajitas de pollo", ["pollo en fajitas", "tiras de pollo"]],
  ["bistec res", ["bistec de res", "bistec"]],
  ["filete tilapia kg 4 54 kg cada caja", ["filete de tilapia", "tilapia"]],
  ["camaron 2 5 kg sin cola", ["camarón sin cola", "camarones sin cola", "camarón"]],
  ["picadura de corvina para ceviche", ["corvina para ceviche", "picadura de corvina"]],
  ["salmon salar", ["salmón", "salmón salar"]],
  ["torta angus", ["torta de res angus", "tortas angus"]],
  ["mariscada espanola 2 5 kg paq 500 grs", ["mariscada española", "mariscada"]],
  ["alas de pollo", ["alitas de pollo", "alas"]],
  ["lomito de res", ["lomito", "filete de res"]],
  ["lomo de cerdo", ["lomo cerdo"]],
  ["muslo entero", ["muslo de pollo", "muslos enteros"]],
  ["fajitas de res", ["res en fajitas", "tiras de res"]],
  ["posta de cerdo", ["posta cerdo"]],
  ["carne molida", ["molida", "carne de res molida"]],
  ["costilla de res picado", ["costilla de res picada", "costilla de res"]],
  ["salmon ahumado", ["salmón ahumado"]],
  ["atun sushi vietnan", ["atún para sushi", "atún sushi", "atún vietnam"]],
  ["tortilla de trigo gigante 33 cm malinche pq 1 10 ud", ["tortilla de trigo gigante", "tortilla malinche", "tortilla de 33 centímetros"]],
  ["queso mozarella rallado foodie pizza", ["queso mozzarella rallado", "mozzarella rallada", "queso para pizza"]],
  ["geingibre para sushi tipo gary japones", ["jengibre para sushi", "jengibre gari", "gari japonés"]],
  ["salsa soya ligth 2 0", ["salsa soya light", "soya ligera"]],
  ["bicarbotano", ["bicarbonato", "bicarbonato de sodio"]],
  ["siracha", ["sriracha", "salsa sriracha"]],
  ["surime", ["surimi"]],
  ["queso provolonne", ["queso provolone", "provolone"]],
  ["vol au vent", ["volauvent", "volován", "volovanes"]],
  ["hierbas de provenza", ["hierbas de provincia", "hierbas provenzales"]],
  ["queso mozzarella rebanado", ["mozzarella rebanada", "queso mozarella rebanado"]],
  ["galleta chispas de chocolate c1 100", ["galletas con chispas", "galleta de chocolate", "galletas choco chips"]]
]);

const produceRows = parseProduce(readFileSync(resolve(producePath), "utf8"));
const restaurantRows = parseRestaurant(readFileSync(resolve(restaurantPath), "utf8"));
const merged = mergeDuplicates([...existingProducts, ...produceRows, ...restaurantRows]);
const catalog = merged.products.sort(compareProducts);

writeFileSync("src/catalog-data.js", buildJavascript(catalog), "utf8");
writeFileSync("data/catalogo-productos-maestro.csv", buildCsv(catalog), "utf8");
writeFileSync("data/catalogo-productos-ejemplo.csv", buildCsv(catalog), "utf8");
writeFileSync("supabase/migrations/202608040003_seed_master_catalog.sql", buildSql(catalog), "utf8");
writeFileSync(
  "data/catalogo-productos-maestro-resumen.json",
  `${JSON.stringify({ products: catalog.length, duplicatesMerged: merged.duplicates }, null, 2)}\n`,
  "utf8"
);
adoptMasterCatalog();

console.log(`Catálogo generado: ${catalog.length} productos; ${merged.duplicates.length} duplicados consolidados.`);

function parseProduce(text) {
  const lines = linesOf(text);
  const headerIndex = lines.findIndex((line) => line.startsWith("Código\t"));
  return lines.slice(headerIndex + 1).map((line) => {
    const [sourceCode, rawName, rawDefault, rawAllowed, , rawSynonyms] = line.split("\t");
    const name = clean(rawName);
    const stable = stableProduce.get(normalizeKey(name));
    const defaultUnit = canonicalUnit(rawDefault) || "und";
    const allowedUnits = unique(
      [
        defaultUnit,
        ...String(rawAllowed || "").split(",").map(canonicalUnit),
        ...(stable?.allowedUnits || [])
      ].filter(Boolean)
    );
    return {
      id: stable?.id || idFromCode(sourceCode),
      code: stable?.code || sourceCode,
      officialName: name,
      category: "Frutas y vegetales",
      defaultUnit,
      allowedUnits,
      synonyms: enrichSynonyms(name, splitSynonyms(rawSynonyms)),
      active: true
    };
  });
}

function parseRestaurant(text) {
  const result = [];
  let category = "Proteínas";
  const counters = { Proteínas: 0, "Refrigerados y congelados": 0, Abarrotes: 99 };
  for (const line of linesOf(text)) {
    const [rawName, rawUnit] = line.split("\t");
    const section = normalizeKey(rawName);
    if (section === "proteinas" || section.startsWith("proteinas peso")) continue;
    if (section === "refrigeracion y congelacion") {
      category = "Refrigerados y congelados";
      continue;
    }
    if (section === "alimentos") {
      category = "Abarrotes";
      continue;
    }
    if (!clean(rawName)) continue;

    counters[category] += 1;
    const prefix = category === "Proteínas" ? "PRO" : category === "Abarrotes" ? "ABA" : "REF";
    const code = `${prefix}-${String(counters[category]).padStart(3, "0")}`;
    const name = canonicalName(rawName);
    const units = unitsFromSpec(rawUnit);
    result.push({
      id: idFromCode(code),
      code,
      officialName: name,
      category,
      defaultUnit: units[0],
      allowedUnits: units,
      synonyms: enrichSynonyms(name, [clean(rawName)]),
      active: true
    });
  }
  return result;
}

function mergeDuplicates(products) {
  const byName = new Map();
  const duplicates = [];
  for (const entry of products) {
    const key = normalizeKey(canonicalName(entry.officialName));
    const current = byName.get(key);
    if (!current) {
      byName.set(key, { ...entry, synonyms: [...entry.synonyms] });
      continue;
    }
    duplicates.push({ kept: current.officialName, merged: entry.officialName });
    current.allowedUnits = unique([...current.allowedUnits, ...entry.allowedUnits]);
    current.synonyms = unique([
      ...current.synonyms,
      entry.officialName,
      ...entry.synonyms
    ]).filter((synonym) => normalizeKey(synonym) !== normalizeKey(current.officialName));
  }
  return { products: [...byName.values()], duplicates };
}

function canonicalName(rawName) {
  const cleaned = clean(rawName).replace(/^\d{5,}\s+/, "");
  const override = canonicalOverrides.get(normalizeKey(cleaned));
  if (override) return override;
  return titleCase(
    cleaned
      .replace(/\bFILET\b/gi, "Filete")
      .replace(/\bCAMARON\b/gi, "Camarón")
      .replace(/\bSALMON\b/gi, "Salmón")
      .replace(/\bATUN\b/gi, "Atún")
      .replace(/\bJAMON\b/gi, "Jamón")
      .replace(/\bMOZARELLA|MOZZRELLA\b/gi, "Mozzarella")
      .replace(/\bPROVOLONNE\b/gi, "Provolone")
      .replace(/\bSURIME\b/gi, "Surimi")
      .replace(/\bSIRACHA\b/gi, "Sriracha")
      .replace(/\bBICARBOTANO\b/gi, "Bicarbonato")
      .replace(/\bGEINGIBRE\b/gi, "Jengibre")
      .replace(/\bGARY\b/gi, "Gari")
      .replace(/\bSADWICH\b/gi, "Sándwich")
  );
}

function enrichSynonyms(officialName, provided = []) {
  const key = normalizeKey(officialName);
  const voiceName = voiceAlias(officialName);
  const generated = [
    ...provided,
    voiceName,
    pluralizeVoiceAlias(voiceName),
    ...(manualSynonyms.get(key) || [])
  ];
  return unique(generated.map(clean).filter(Boolean)).filter(
    (synonym) => normalizeKey(synonym) !== key
  );
}

function voiceAlias(name) {
  return clean(name)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:caja|paq|paquete|env|bot|unidad|unid)\s*\d.*$/i, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|kilos?|grs?|gramos?|g|lbs?|litros?|lt|l|oz|ml|cm|und|unidades?|porc)\b.*$/i, " ")
    .replace(/\b(?:galón|galon|kilo|kg|unidad|unid|paquete|paq|caja)\s*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pluralizeVoiceAlias(value) {
  const words = clean(value).split(" ");
  if (!words.length || words[0].endsWith("s")) return value;
  const word = words[0];
  if (/z$/i.test(word)) {
    words[0] = `${word.slice(0, -1)}ces`;
  } else if (/[aeiouáéíóú]$/i.test(word)) {
    words[0] = `${word}s`;
  } else {
    words[0] = `${word.normalize("NFD").replace(/[\u0300-\u036f]/g, "")}es`;
  }
  return words.join(" ");
}

function unitsFromSpec(value) {
  const key = normalizeKey(value);
  const units = [];
  const add = (unit) => {
    if (!units.includes(unit)) units.push(unit);
  };
  if (/\b(caja|cajas)\b/.test(key)) add("caja");
  if (/\b(paq|paquete|paquetes)\b/.test(key)) add("paquete");
  if (/\b(galon|galones)\b/.test(key)) add("galón");
  if (/\bcubeta\b/.test(key)) add("cubeta");
  if (/\bpichinga\b/.test(key)) add("pichinga");
  if (/\bbulto\b/.test(key)) add("bulto");
  if (/\b(lata|latas)\b/.test(key)) add("lata");
  if (/\b(bot|botella|botellas)\b/.test(key)) add("botella");
  if (/\bfrasco\b/.test(key)) add("frasco");
  if (/\b(env|envase)\b/.test(key)) add("envase");
  if (/\b(gar|garrafa)\b/.test(key)) add("garrafa");
  if (/\b(emp|empaque)\b/.test(key)) add("empaque");
  if (/\b(block|bloque)\b/.test(key)) add("bloque");
  if (/\b(kg|kilo|kilos|kilogram|kilogramo)\b/.test(key)) add("kg");
  if (/\b(gr|grs|gramo|gramos)\b/.test(key)) add("g");
  if (/\b(liter|litro|litros|lts|lt)\b/.test(key)) add("L");
  if (/\b(ml|mililitro|mililitros)\b/.test(key)) add("ml");
  if (/\b(unidad|unidades|unid|uni)\b/.test(key)) add("und");
  return units.length ? units : ["und"];
}

function canonicalUnit(value) {
  const key = normalizeKey(value);
  if (["kg", "kilo", "kilos", "kilogramo", "kilogram"].includes(key)) return "kg";
  if (["g", "gr", "gramo", "gramos"].includes(key)) return "g";
  if (["und", "unidad", "unidades", "unid"].includes(key)) return "und";
  if (["l", "lt", "lts", "litro", "litros", "liter"].includes(key)) return "L";
  if (["rollo", "tamuga", "capsula", "bandeja", "caja", "paquete", "bolsa", "botella"].includes(key)) {
    return key === "capsula" ? "cápsula" : key;
  }
  return "";
}

function product(code, officialName, category, defaultUnit, allowedUnits, synonyms) {
  return {
    id: idFromCode(code),
    code,
    officialName,
    category,
    defaultUnit,
    allowedUnits,
    synonyms,
    active: true
  };
}

function idFromCode(code) {
  const known = {
    "VEG-001": "prod-veg-001",
    "VEG-002": "prod-veg-002",
    "VEG-003": "prod-veg-003",
    "ABA-001": "prod-aba-001",
    "ABA-002": "prod-aba-002",
    "ABA-003": "prod-aba-003"
  };
  return known[code] || `prod-${String(code).toLowerCase()}`;
}

function splitSynonyms(value) {
  return String(value || "").split(",").map(clean).filter(Boolean);
}

function linesOf(text) {
  return String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleCase(value) {
  const lowerWords = new Set(["a", "al", "con", "de", "del", "el", "en", "la", "las", "los", "para", "por", "sin", "y"]);
  return clean(value)
    .toLowerCase()
    .split(" ")
    .map((word, index) => {
      if (index > 0 && lowerWords.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = normalizeKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareProducts(left, right) {
  return left.category.localeCompare(right.category, "es") || left.officialName.localeCompare(right.officialName, "es");
}

function buildJavascript(products) {
  return `// Generado por tools/generate-master-catalog.mjs.\nexport const MASTER_CATALOG = ${JSON.stringify(products, null, 2)};\n`;
}

function adoptMasterCatalog() {
  const path = "src/catalog.js";
  let source = readFileSync(path, "utf8");
  if (!source.includes('import { MASTER_CATALOG } from "./catalog-data.js?v=10";')) {
    source = `import { MASTER_CATALOG } from "./catalog-data.js?v=10";\n\n${source}`;
  }
  source = source.replace(
    /export const DEFAULT_CATALOG = \[[\s\S]*?\n\];\n\nexport function normalizeText/,
    "export const DEFAULT_CATALOG = MASTER_CATALOG;\n\nexport function normalizeText"
  );
  writeFileSync(path, source, "utf8");
}

function buildCsv(products) {
  const rows = [
    ["code", "official_name", "category", "default_unit", "allowed_units", "synonyms", "active"],
    ...products.map((entry) => [
      entry.code,
      entry.officialName,
      entry.category,
      entry.defaultUnit,
      entry.allowedUnits.join(","),
      entry.synonyms.join(","),
      "true"
    ])
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildSql(products) {
  const values = products.map((entry) =>
    `(${sqlText(entry.id)}, 'main', ${sqlText(entry.code)}, ${sqlText(entry.officialName)}, ${sqlText(entry.category)}, ${sqlText(entry.defaultUnit)}, ${sqlArray(entry.allowedUnits)}, ${sqlArray(entry.synonyms)}, true)`
  );
  return `-- Catálogo maestro del restaurante. Generado; no editar manualmente.\ninsert into public.products (id, workspace_id, code, official_name, category, default_unit, allowed_units, synonyms, active)\nvalues\n  ${values.join(",\n  ")}\non conflict (id) do update set\n  workspace_id = excluded.workspace_id,\n  code = excluded.code,\n  official_name = excluded.official_name,\n  category = excluded.category,\n  default_unit = excluded.default_unit,\n  allowed_units = excluded.allowed_units,\n  synonyms = excluded.synonyms,\n  active = excluded.active,\n  updated_at = now();\n`;
}

function sqlText(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function sqlArray(values) {
  return `array[${values.map(sqlText).join(", ")}]::text[]`;
}
