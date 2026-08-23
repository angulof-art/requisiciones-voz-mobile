import { normalizeText, scoreProductName } from "./catalog.js?v=2.0.0-beta.2";
import { parseRequisitionText } from "./parser.js?v=2.0.0-beta.2";

export function processVoiceRequest(text, currentItems = [], catalog = []) {
  const originalText = String(text || "").trim();
  const normalized = normalizeText(originalText);
  const items = structuredCloneSafe(currentItems);
  if (!normalized) return result("none", items, [], null, "No hay texto para procesar.");

  if (/\b(deshaga|deshacer|deshace)\b/.test(normalized)) {
    return result("undo", items, [], { type: "undo" }, "Deshacer la ultima accion.");
  }

  if (/\b(borre|elimine|quite)\s+(el\s+)?ultimo\s+producto\b/.test(normalized)) {
    if (!items.length) return result("none", items, [], { type: "remove-last" }, "No hay productos para borrar.");
    const removed = items.pop();
    return result("remove-last", items, [removed], { type: "remove-last" }, `${removed.productName} eliminado.`);
  }

  const contextualSet = normalized.match(/^mejor\s+(?:pongale|ponga|cambie(?:lo)?)\s+(.+)$/);
  if (contextualSet) {
    return updateContextItem("set-context", contextualSet[1], items, catalog, false);
  }

  const contextualAdd = normalized.match(/^(?:y\s+)?otros?\s+(.+)$/);
  if (contextualAdd) {
    return updateContextItem("add-context", contextualAdd[1], items, catalog, true);
  }

  const addMore = normalized.match(/\b(?:agregue|agrega|sume|sumar|ponga)\s+(.+?)\s+mas\s+(?:de\s+|al\s+|a\s+la\s+)?(.+)$/);
  if (addMore) {
    const target = findItem(items, addMore[2]);
    if (!target) return result("none", items, [], { type: "add-more" }, "No encontre el producto que desea aumentar.");
    const parsed = parseRequisitionText(`${addMore[1]} de ${target.productName}`, catalog).items[0];
    if (!parsed?.quantity) return result("none", items, [], { type: "add-more" }, "No pude identificar la cantidad adicional.");
    target.quantity = Number(target.quantity) + parsed.quantity;
    target.requestedQuantity = target.quantity;
    if (parsed.unitExplicit) target.unit = parsed.unit;
    return result("add-more", items, [target], { type: "add-more" }, `${target.productName} actualizado a ${target.quantity} ${target.unit}.`);
  }

  const explicitSet = normalized.match(/\b(?:pongale|ponga)\s+(.+?)\s+(?:al|a\s+la|a\s+los|a\s+las)\s+(.+)$/);
  if (explicitSet) {
    return updateNamedItem("change", explicitSet[2], explicitSet[1], items, catalog);
  }

  const duplicate = normalized.match(/\b(?:duplique|duplicar)\s+(?:el|la|los|las)?\s*(.+)$/);
  if (duplicate) {
    const target = findItem(items, duplicate[1]);
    if (!target) return result("none", items, [], { type: "duplicate" }, "No encontre el producto que desea duplicar.");
    const copy = { ...structuredCloneSafe(target), id: createLineId() };
    items.splice(items.indexOf(target) + 1, 0, copy);
    return result("duplicate", items, [copy], { type: "duplicate" }, `${target.productName} duplicado.`);
  }

  const parsed = parseRequisitionText(originalText, catalog);
  if (parsed.command?.type === "change") {
    const replacement = parsed.items[0];
    return updateNamedItem("change", parsed.command.productText, parsed.command.toText, items, catalog, replacement);
  }

  if (parsed.command?.type === "remove") {
    const query = parsed.command.rest.replace(/^(el|la|los|las)\s+/, "");
    const target = findItem(items, query) || findItem(items, parsed.items[0]?.productName || "");
    if (!target) return result("none", items, [], parsed.command, "No encontre el producto que desea quitar.");
    items.splice(items.indexOf(target), 1);
    return result("remove", items, [target], parsed.command, `${target.productName} eliminado.`);
  }

  if (!parsed.items.length) return result("none", items, [], parsed.command, "No pude identificar productos.", parsed);
  items.push(...structuredCloneSafe(parsed.items));
  return result("add", items, parsed.items, parsed.command, `${parsed.items.length} producto(s) agregado(s).`, parsed);
}

export function enrichCatalogWithAliases(catalog = [], aliases = {}) {
  const phrasesByProduct = new Map();
  for (const [phrase, productId] of Object.entries(aliases || {})) {
    if (!phrasesByProduct.has(productId)) phrasesByProduct.set(productId, []);
    phrasesByProduct.get(productId).push(phrase);
  }
  return catalog.map((product) => ({
    ...product,
    synonyms: [...new Set([...(product.synonyms || []), ...(phrasesByProduct.get(product.id) || [])])]
  }));
}

function updateContextItem(action, quantityText, items, catalog, add) {
  const target = items.at(-1);
  if (!target) return result("none", items, [], { type: action }, "No hay un producto anterior como referencia.");
  const parsed = parseRequisitionText(`${quantityText} de ${target.productName}`, catalog).items[0];
  if (!parsed?.quantity) return result("none", items, [], { type: action }, "No pude identificar la cantidad.");
  target.quantity = add ? Number(target.quantity) + parsed.quantity : parsed.quantity;
  target.requestedQuantity = target.quantity;
  if (parsed.unitExplicit) target.unit = parsed.unit;
  return result(action, items, [target], { type: action }, `${target.productName} actualizado a ${target.quantity} ${target.unit}.`);
}

function updateNamedItem(action, query, quantityText, items, catalog, replacement = null) {
  const target = findItem(items, query);
  if (!target) return result("none", items, [], { type: action }, "No encontre el producto que desea cambiar.");
  const parsed = replacement || parseRequisitionText(`${quantityText} de ${target.productName}`, catalog).items[0];
  if (!parsed?.quantity) return result("none", items, [], { type: action }, "No pude identificar la cantidad nueva.");
  target.quantity = parsed.quantity;
  target.requestedQuantity = parsed.quantity;
  if (parsed.unit) target.unit = parsed.unit;
  target.needsReview = Boolean(parsed.needsReview && !target.productId);
  return result(action, items, [target], { type: action }, `${target.productName} actualizado a ${target.quantity} ${target.unit}.`);
}

function findItem(items, query) {
  const normalized = normalizeText(query);
  if (!normalized) return null;
  return items
    .map((item) => ({ item, score: scoreProductName(normalized, normalizeText(item.productName || item.rawProductName)) }))
    .sort((left, right) => right.score - left.score)
    .find((entry) => entry.score >= 0.55)?.item || null;
}

function result(action, items, affectedItems, command, message, parsed = null) {
  return { action, items, affectedItems, command, message, parsed };
}

function structuredCloneSafe(value) {
  return globalThis.structuredClone ? globalThis.structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function createLineId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `line-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
