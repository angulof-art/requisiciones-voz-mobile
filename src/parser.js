import {
  displayName,
  findProductMatch,
  findProductSuggestions,
  normalizeText,
  normalizeUnit,
  notesFromRawProduct,
  productAllowsUnit
} from "./catalog.js?v=2.0.0-beta.5";

const FILLER_WORDS = new Set([
  "necesito",
  "necesitamos",
  "ocupo",
  "ocupa",
  "favor",
  "por",
  "pedido",
  "requisicion",
  "requisición",
  "agregue",
  "agrega",
  "agregar",
  "anote",
  "incluya",
  "incluir",
  "quiero",
  "pongame",
  "ponga",
  "deme",
  "dame",
  "solicito",
  "solicitar"
]);

const ARTICLES = new Set(["de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas"]);

const NUMBER_WORDS = new Map([
  ["cero", 0],
  ["un", 1],
  ["uno", 1],
  ["una", 1],
  ["dos", 2],
  ["tres", 3],
  ["cuatro", 4],
  ["cinco", 5],
  ["seis", 6],
  ["siete", 7],
  ["ocho", 8],
  ["nueve", 9],
  ["diez", 10],
  ["once", 11],
  ["doce", 12],
  ["trece", 13],
  ["catorce", 14],
  ["quince", 15],
  ["dieciseis", 16],
  ["dieciséis", 16],
  ["diecisiete", 17],
  ["dieciocho", 18],
  ["diecinueve", 19],
  ["veinte", 20],
  ["veintiuno", 21],
  ["veintiun", 21],
  ["veintiún", 21],
  ["veintidos", 22],
  ["veintidós", 22],
  ["veintitres", 23],
  ["veintitrés", 23],
  ["veinticuatro", 24],
  ["veinticinco", 25],
  ["veintiseis", 26],
  ["veintiséis", 26],
  ["veintisiete", 27],
  ["veintiocho", 28],
  ["veintinueve", 29]
]);

const TENS = new Map([
  ["treinta", 30],
  ["cuarenta", 40],
  ["cincuenta", 50],
  ["sesenta", 60],
  ["setenta", 70],
  ["ochenta", 80],
  ["noventa", 90]
]);

const HUNDREDS = new Map([
  ["cien", 100],
  ["ciento", 100],
  ["doscientos", 200],
  ["trescientos", 300],
  ["cuatrocientos", 400],
  ["quinientos", 500],
  ["seiscientos", 600],
  ["setecientos", 700],
  ["ochocientos", 800],
  ["novecientos", 900]
]);

const DECIMAL_WORDS = new Set(["punto", "coma", "con"]);
const CONJUNCTIONS = new Set(["y", "e"]);

export function parseRequisitionText(text, catalog = []) {
  const originalText = String(text || "").trim();
  const command = detectCommand(originalText);
  const baseText = normalizeQuantityIdioms(command ? command.rest : originalText);
  const phrases = splitProductPhrases(baseText);
  const items = phrases
    .map((phrase) => parseProductPhrase(phrase, catalog))
    .filter((item) => item.originalText || item.productName || Number.isFinite(item.quantity));

  if (command?.type === "change" && command.productText) {
    const changed = parseChangeCommand(command, catalog);
    if (changed) return { originalText, command, items: [changed] };
  }

  return { originalText, command, items };
}

export function detectCommand(text) {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  if (/\b(borre|borrar|elimine|eliminar)\s+(el\s+)?ultimo\s+producto\b/.test(normalized)) {
    return { type: "remove-last", rest: "" };
  }

  const change = normalized.match(/\bcambie\s+(.+?)\s+de\s+(.+?)\s+a\s+(.+)$/);
  if (change) {
    return {
      type: "change",
      productText: change[1],
      fromText: change[2],
      toText: change[3],
      rest: text
    };
  }

  if (/\b(quite|quita|quitar|elimine|eliminar|borre|borrar)\b/.test(normalized)) {
    return {
      type: "remove",
      rest: normalized.replace(/\b(quite|quita|quitar|elimine|eliminar|borre|borrar)\b/g, " ")
    };
  }

  if (/\b(repita|repetir|duplique|duplicar)\b/.test(normalized)) {
    const addIndex = normalized.search(/\b(agregue|agrega|agregar|incluya|incluir)\b/);
    return {
      type: "repeat",
      rest: addIndex >= 0 ? normalized.slice(addIndex) : ""
    };
  }

  if (/\b(deshaga|deshacer|deshace)\b/.test(normalized)) {
    return { type: "undo", rest: "" };
  }

  return null;
}

export function splitProductPhrases(text) {
  const cleaned = normalizeText(text)
    .replace(/\b(por favor)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];

  const protectedDecimals = cleaned.replace(/(\d)[,.](\d)/g, "$1decimalmarker$2");
  const commaParts = protectedDecimals
    .split(/[.;\n,]+/)
    .map((part) => part.replace(/decimalmarker/g, ".").trim())
    .filter(Boolean);

  const merged = [];
  for (let index = 0; index < commaParts.length; index += 1) {
    const current = commaParts[index];
    const next = commaParts[index + 1];
    if (next && !findQuantityAt(tokenize(current)) && findQuantityAt(tokenize(next))) {
      merged.push(`${current} ${next}`);
      index += 1;
    } else {
      merged.push(current);
    }
  }

  return merged.flatMap(splitByProductConjunction).map(removeFillers).filter(Boolean);
}

export function parseProductPhrase(phrase, catalog = []) {
  const originalText = String(phrase || "").trim();
  const tokens = tokenize(removeFillers(phrase));
  const quantityMatch = findQuantityAt(tokens);

  if (!quantityMatch) {
    const productText = cleanProductTokens(tokens);
    const match = findProductMatch(productText, catalog);
    return buildParsedItem({
      originalText,
      rawProductName: productText,
      quantity: NaN,
      unit: match.product?.defaultUnit || "",
      unitExplicit: false,
      match,
      catalog
    });
  }

  const unitAfter = readUnitAt(tokens, quantityMatch.end);
  const unitBefore = readUnitAt(tokens, Math.max(0, quantityMatch.start - 1));
  const explicitUnit = unitAfter || (unitBefore && unitBefore.end === quantityMatch.start ? unitBefore : null);
  const unit = explicitUnit?.unit || "";

  let productTokens = [];
  if (quantityMatch.start === 0) {
    const productStart = skipArticles(tokens, explicitUnit ? explicitUnit.end : quantityMatch.end);
    productTokens = tokens.slice(productStart);
  } else {
    productTokens = tokens.slice(0, quantityMatch.start);
    if (explicitUnit && explicitUnit.start < quantityMatch.start) {
      productTokens = tokens.slice(0, explicitUnit.start);
    }
  }

  const rawProductName = cleanProductTokens(productTokens);
  const match = findProductMatch(rawProductName, catalog);
  const inferredUnit = unit || match.product?.defaultUnit || "";

  return buildParsedItem({
    originalText,
    rawProductName,
    quantity: quantityMatch.quantity,
    unit: inferredUnit,
    unitExplicit: Boolean(unit),
    match,
    catalog
  });
}

function buildParsedItem({ originalText, rawProductName, quantity, unit, unitExplicit, match, catalog }) {
  const product = match?.product || null;
  const matched = product && match.score >= 0.62;
  const productName = matched ? product.officialName : displayName(rawProductName);
  const productCode = matched ? product.code : "";
  const normalizedUnit = normalizeUnit(unit) || unit;
  const unitAllowed = productAllowsUnit(product, normalizedUnit);
  const hasQuantity = Number.isFinite(quantity) && quantity > 0;
  const hasUnit = Boolean(normalizedUnit);
  const matchScore = matched ? match.score : 0;
  const confidence = Math.round(
    Math.min(
      100,
      (hasQuantity ? 30 : 0) +
        (hasUnit ? (unitExplicit ? 26 : 18) : 0) +
        Math.round(matchScore * 38) +
        (unitAllowed ? 6 : 0)
    )
  );

  const suggestions = buildSuggestions(rawProductName, match, catalog);
  const ambiguous = suggestions.length > 1 && suggestions[0].score - suggestions[1].score < 0.08;
  const adjustedConfidence = ambiguous ? Math.min(confidence, 69) : confidence;
  return {
    id: createLineId(),
    productId: product?.id || "",
    productCode,
    productName,
    rawProductName: displayName(rawProductName),
    quantity: hasQuantity ? quantity : null,
    unit: normalizedUnit,
    notes: notesFromRawProduct(rawProductName, product),
    originalText,
    confidence: adjustedConfidence,
    confidenceBand: adjustedConfidence >= 90 ? "high" : adjustedConfidence >= 70 ? "medium" : "review",
    needsReview: !matched || !hasQuantity || !hasUnit || !unitAllowed || adjustedConfidence < 70,
    unitAllowed,
    unitExplicit,
    unitInferred: Boolean(hasUnit && !unitExplicit),
    ambiguous,
    suggestions: ambiguous || !matched ? suggestions : []
  };
}

function buildSuggestions(rawProductName, match, catalog) {
  const candidates = findProductSuggestions(rawProductName, catalog || [], 3)
    .filter((candidate) => candidate.score >= 0.36)
    .map((candidate) => ({
      code: candidate.product.code,
      name: candidate.product.officialName,
      productId: candidate.product.id,
      score: candidate.score
    }));
  if (candidates.length) return candidates;
  if (!match?.product || match.score < 0.36) return [];
  return [{ code: match.product.code, name: match.product.officialName, productId: match.product.id, score: match.score }];
}

function parseChangeCommand(command, catalog) {
  const toTokens = tokenize(command.toText);
  const quantityMatch = findQuantityAt(toTokens);
  const unitInfo = quantityMatch ? readUnitAt(toTokens, quantityMatch.end) : null;
  const match = findProductMatch(command.productText, catalog);
  return buildParsedItem({
    originalText: `cambie ${command.productText} a ${command.toText}`,
    rawProductName: command.productText,
    quantity: quantityMatch?.quantity ?? NaN,
    unit: unitInfo?.unit || match.product?.defaultUnit || "",
    unitExplicit: Boolean(unitInfo),
    match,
    catalog
  });
}

function splitByProductConjunction(text) {
  const tokens = tokenize(text);
  const chunks = [];
  let current = [];
  let currentHasQuantity = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    const previous = tokens[index - 1];
    const startsAfterConjunction =
      CONJUNCTIONS.has(token) &&
      next &&
      beginsQuantity(tokens.slice(index + 1)) &&
      !isNumberContinuation(previous);
    const startsImplicitProduct =
      currentHasQuantity &&
      beginsQuantity(tokens.slice(index)) &&
      !isNumberContinuation(previous);

    if (startsAfterConjunction) {
      if (current.length) chunks.push(current.join(" "));
      current = [];
      currentHasQuantity = false;
      continue;
    }

    if (startsImplicitProduct) {
      if (current.length) chunks.push(current.join(" "));
      current = [];
      currentHasQuantity = false;
    }

    current.push(token);
    if (beginsQuantity(tokens.slice(index))) {
      currentHasQuantity = true;
    }
  }
  if (current.length) chunks.push(current.join(" "));
  return chunks;
}

function removeFillers(text) {
  return tokenize(text)
    .filter((token) => !FILLER_WORDS.has(token))
    .join(" ")
    .trim();
}

function tokenize(text) {
  return normalizeText(text)
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function cleanProductTokens(tokens) {
  const cleaned = [...tokens];
  while (cleaned.length && ARTICLES.has(cleaned[0])) cleaned.shift();
  while (cleaned.length && ARTICLES.has(cleaned[cleaned.length - 1])) cleaned.pop();
  return cleaned.join(" ").trim();
}

function skipArticles(tokens, start) {
  let index = start;
  while (index < tokens.length && ARTICLES.has(tokens[index])) index += 1;
  return index;
}

function readUnitAt(tokens, start) {
  const token = tokens[start];
  if (!token) return null;
  const one = normalizeUnit(token);
  if (one) return { unit: one, start, end: start + 1 };
  const two = normalizeUnit(`${token} ${tokens[start + 1] || ""}`);
  if (two) return { unit: two, start, end: start + 2 };
  return null;
}

function findQuantityAt(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    const parsed = parseQuantityAt(tokens, index);
    if (parsed) return parsed;
  }
  return null;
}

function beginsQuantity(tokens) {
  return Boolean(parseQuantityAt(tokens, 0));
}

export function parseQuantityAt(tokens, start) {
  const token = tokens[start];
  if (!token) return null;

  const numeric = parseNumericToken(token);
  if (Number.isFinite(numeric)) {
    return { quantity: numeric, start, end: start + 1 };
  }

  if (token === "medio" || token === "media") return { quantity: 0.5, start, end: start + 1 };
  if (token === "cuarto" || token === "cuarta") return { quantity: 0.25, start, end: start + 1 };
  if (token === "tres" && tokens[start + 1] === "cuartos") {
    return { quantity: 0.75, start, end: start + 2 };
  }

  const words = [];
  for (let index = start; index < Math.min(tokens.length, start + 7); index += 1) {
    const word = tokens[index];
    if (isNumberWord(word) || DECIMAL_WORDS.has(word) || word === "y") {
      words.push(word);
      const quantity = parseQuantityWords(words);
      if (Number.isFinite(quantity)) {
        const next = tokens[index + 1];
        if (!isNumberContinuation(next)) {
          return { quantity, start, end: index + 1 };
        }
      }
    } else {
      break;
    }
  }
  return null;
}

export function parseQuantityWords(words) {
  if (!Array.isArray(words) || !words.length) return NaN;
  const decimalIndex = words.findIndex((word) => DECIMAL_WORDS.has(word));
  if (decimalIndex >= 0) {
    const integer = parseIntegerWords(words.slice(0, decimalIndex));
    const decimal = words
      .slice(decimalIndex + 1)
      .map((word) => NUMBER_WORDS.get(word))
      .filter((value) => Number.isFinite(value) && value >= 0 && value <= 9)
      .join("");
    if (!Number.isFinite(integer) || !decimal) return NaN;
    return Number(`${integer}.${decimal}`);
  }
  return parseIntegerWords(words);
}

function parseIntegerWords(words) {
  const filtered = words.filter((word) => word !== "y");
  if (!filtered.length) return NaN;
  let total = 0;
  let used = false;
  for (let index = 0; index < filtered.length; index += 1) {
    const word = filtered[index];
    if (NUMBER_WORDS.has(word)) {
      total += NUMBER_WORDS.get(word);
      used = true;
    } else if (TENS.has(word)) {
      total += TENS.get(word);
      used = true;
    } else if (HUNDREDS.has(word)) {
      total += HUNDREDS.get(word);
      used = true;
    } else if (word === "mil") {
      total = Math.max(1, total) * 1000;
      used = true;
    } else {
      return NaN;
    }
  }
  return used ? total : NaN;
}

function parseNumericToken(token) {
  const normalized = String(token || "").replace(",", ".");
  const fraction = normalized.match(/^(\d+)\/(\d+)$/);
  if (fraction && Number(fraction[2]) !== 0) return Number(fraction[1]) / Number(fraction[2]);
  if (!/^\d+(\.\d+)?$/.test(normalized)) return NaN;
  return Number(normalized);
}

function isNumberWord(word) {
  return NUMBER_WORDS.has(word) || TENS.has(word) || HUNDREDS.has(word) || word === "mil";
}

function isNumberContinuation(word) {
  return Boolean(word && (word === "y" || DECIMAL_WORDS.has(word) || isNumberWord(word)));
}

function normalizeQuantityIdioms(text) {
  let normalized = normalizeText(text);
  normalized = normalized.replace(/\b(?:un|uno)?\s*kilos?\s+y\s+medio\b/g, "1.5 kilo");
  normalized = normalized.replace(/\b(\d+)\s+kilos?\s+y\s+medio\b/g, (_, value) => `${Number(value) + 0.5} kilo`);
  normalized = normalized.replace(/\btres\s+cuartos(?:\s+de)?\b/g, "0.75 ");
  normalized = normalized.replace(/\b(?:un\s+)?cuarto(?:\s+de)?\b/g, "0.25 ");
  normalized = normalized.replace(/\bmedi[oa](?:\s+de)?\b/g, "0.5 ");
  return normalized.replace(/\s+/g, " ").trim();
}

function createLineId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `line-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
