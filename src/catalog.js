import { MASTER_CATALOG } from "./catalog-data.js?v=2.0.0-rc.2";

export const UNIT_DEFINITIONS = [
  { canonical: "kg", aliases: ["kg", "kilo", "kilos", "kilogramo", "kilogramos"] },
  { canonical: "g", aliases: ["g", "gr", "gramo", "gramos"] },
  { canonical: "und", aliases: ["und", "unidad", "unidades", "unid", "uds"] },
  { canonical: "L", aliases: ["l", "lt", "lts", "litro", "litros"] },
  { canonical: "ml", aliases: ["ml", "mililitro", "mililitros"] },
  { canonical: "caja", aliases: ["caja", "cajas"] },
  { canonical: "paquete", aliases: ["paquete", "paquetes", "paq"] },
  { canonical: "bolsa", aliases: ["bolsa", "bolsas"] },
  { canonical: "botella", aliases: ["botella", "botellas"] },
  { canonical: "galón", aliases: ["galon", "galones", "galón", "galónes"] },
  { canonical: "bandeja", aliases: ["bandeja", "bandejas"] },
  { canonical: "mano", aliases: ["mano", "manos"] },
  { canonical: "docena", aliases: ["docena", "docenas"] },
  { canonical: "rollo", aliases: ["rollo", "rollos"] },
  { canonical: "tamuga", aliases: ["tamuga", "tamugas"] },
  { canonical: "cápsula", aliases: ["capsula", "capsulas", "cápsula", "cápsulas"] },
  { canonical: "lata", aliases: ["lata", "latas"] },
  { canonical: "cubeta", aliases: ["cubeta", "cubetas"] },
  { canonical: "pichinga", aliases: ["pichinga", "pichingas"] },
  { canonical: "bulto", aliases: ["bulto", "bultos"] },
  { canonical: "frasco", aliases: ["frasco", "frascos"] },
  { canonical: "envase", aliases: ["envase", "envases", "env"] },
  { canonical: "garrafa", aliases: ["garrafa", "garrafas", "gar"] },
  { canonical: "empaque", aliases: ["empaque", "empaques", "emp"] },
  { canonical: "bloque", aliases: ["bloque", "bloques", "block"] }
];

export const DEFAULT_CATALOG = MASTER_CATALOG;

export function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s.,;/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function displayName(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text
    .toLowerCase()
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function normalizeUnit(value) {
  const key = normalizeText(value).replace(/\./g, "");
  if (!key) return "";
  for (const def of UNIT_DEFINITIONS) {
    if (def.aliases.map(normalizeText).includes(key)) return def.canonical;
  }
  return "";
}

export function isKnownUnit(value) {
  return Boolean(normalizeUnit(value));
}

export function unitOptions() {
  return UNIT_DEFINITIONS.map((unit) => unit.canonical);
}

export function parseList(value) {
  return String(value || "")
    .split(/[,\n;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function normalizeCatalogProduct(product) {
  const officialName = cleanName(product.officialName || product.official_name || product.name);
  const defaultUnit = normalizeUnit(product.defaultUnit || product.default_unit) || "und";
  const allowedUnits = parseList(product.allowedUnits || product.allowed_units || "")
    .map(normalizeUnit)
    .filter(Boolean);
  const synonyms = Array.isArray(product.synonyms)
    ? product.synonyms
    : parseList(product.synonyms || "");
  return {
    id: product.id || createCatalogId(product.code || officialName),
    code: String(product.code || "").trim().toUpperCase(),
    officialName,
    category: cleanName(product.category || "Sin categoría"),
    defaultUnit,
    allowedUnits: Array.from(new Set([defaultUnit, ...allowedUnits])),
    synonyms: Array.from(new Set(synonyms.map((item) => item.trim()).filter(Boolean))),
    active: product.active !== false && String(product.active).toLowerCase() !== "false",
    updatedAt: product.updatedAt || new Date().toISOString()
  };
}

export function normalizeCatalog(products) {
  return (products || []).map(normalizeCatalogProduct).filter((product) => product.officialName);
}

export function createCatalogId(seed) {
  const suffix = normalizeText(seed).replace(/\s+/g, "-").slice(0, 40) || "producto";
  return `prod-${suffix}`;
}

export function findProductMatch(rawName, catalog) {
  return findProductSuggestions(rawName, catalog, 1)[0] || { product: null, score: 0, matchedBy: "" };
}

export function findProductSuggestions(rawName, catalog, limit = 3) {
  const normalizedName = normalizeText(rawName);
  if (!normalizedName) return [];

  const byProduct = new Map();
  for (const product of (catalog || []).filter((entry) => entry.active !== false)) {
    const candidates = [product.officialName, ...(product.synonyms || [])];
    for (const candidate of candidates) {
      const candidateKey = normalizeText(candidate);
      const score = scoreProductName(normalizedName, candidateKey);
      const previous = byProduct.get(product.id);
      if (!previous || score > previous.score) {
        byProduct.set(product.id, { product, score, matchedBy: candidate });
      }
    }
  }
  return [...byProduct.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, limit));
}

export function scoreProductName(input, candidate) {
  if (!input || !candidate) return 0;
  const singularInput = singularize(input);
  const singularCandidate = singularize(candidate);
  if (singularInput === singularCandidate) return 1;
  if (singularInput.includes(singularCandidate) || singularCandidate.includes(singularInput)) {
    const small = Math.min(singularInput.length, singularCandidate.length);
    const large = Math.max(singularInput.length, singularCandidate.length);
    return Math.max(0.74, small / large);
  }

  const inputTokens = new Set(singularInput.split(" ").filter(Boolean));
  const candidateTokens = new Set(singularCandidate.split(" ").filter(Boolean));
  const intersection = [...inputTokens].filter((token) => candidateTokens.has(token)).length;
  const union = new Set([...inputTokens, ...candidateTokens]).size || 1;
  const tokenScore = intersection / union;
  const distance = levenshteinDistance(singularInput, singularCandidate);
  const characterScore = 1 - distance / Math.max(singularInput.length, singularCandidate.length, 1);
  return Math.max(tokenScore, characterScore >= 0.72 ? characterScore * 0.9 : 0);
}

function levenshteinDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function singularize(value) {
  return normalizeText(value)
    .split(" ")
    .map((word) => {
      if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
      if (word.endsWith("s") && word.length > 3) return word.slice(0, -1);
      return word;
    })
    .join(" ");
}

export function productAllowsUnit(product, unit) {
  if (!product || !unit) return true;
  return (product.allowedUnits || []).includes(unit);
}

export function notesFromRawProduct(rawName, product) {
  if (!product) return "";
  const rawTokens = singularize(rawName).split(" ").filter(Boolean);
  const officialTokens = new Set(singularize(product.officialName).split(" ").filter(Boolean));
  const extra = rawTokens.filter((token) => !officialTokens.has(token));
  if (!extra.length) return "";
  const extraText = extra.join(" ");
  const matchedSynonym = (product.synonyms || []).some((synonym) => singularize(synonym) === singularize(rawName));
  if (matchedSynonym && singularize(product.officialName) !== singularize(rawName)) {
    return displayName(extraText).toLowerCase();
  }
  return displayName(extraText).toLowerCase();
}

export function catalogToCsv(products) {
  const header = ["code", "official_name", "category", "default_unit", "allowed_units", "synonyms", "active"];
  const rows = (products || []).map((product) => [
    product.code,
    product.officialName,
    product.category,
    product.defaultUnit,
    (product.allowedUnits || []).join(","),
    (product.synonyms || []).join(","),
    product.active !== false ? "true" : "false"
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export function catalogFromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => normalizeText(header).replace(/\s+/g, "_"));
  return normalizeCatalog(
    rows.slice(1).map((row) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = row[index] || "";
      });
      return {
        code: record.code || record.codigo,
        officialName: record.official_name || record.producto_oficial || record.producto,
        category: record.category || record.categoria,
        defaultUnit: record.default_unit || record.unidad_habitual,
        allowedUnits: record.allowed_units || record.unidades_permitidas,
        synonyms: record.synonyms || record.sinonimos,
        active: record.active || record.activo
      };
    })
  );
}

export function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let quoted = false;

  for (let index = 0; index < String(text || "").length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(current);
      current = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }

  row.push(current);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

export function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
