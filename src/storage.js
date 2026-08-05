import { DEFAULT_CATALOG, normalizeCatalog } from "./catalog.js";
import { PUBLIC_APP_CONFIG } from "./config.js";
import { createRequisition, normalizeRequisition } from "./requisitions.js";

export const STORAGE_KEYS = {
  requisitions: "requisiciones-voz:requisitions:v1",
  current: "requisiciones-voz:current:v1",
  catalog: "requisiciones-voz:catalog:v1",
  recentNames: "requisiciones-voz:recent-names:v1",
  settings: "requisiciones-voz:settings:v1",
  syncQueue: "requisiciones-voz:sync-queue:v1"
};

export function loadAppState() {
  const requisitions = loadRequisitions();
  const catalog = loadCatalog();
  const current = loadCurrentRequisition(requisitions);
  return {
    requisitions,
    catalog,
    current,
    recentNames: loadRecentNames(),
    settings: loadSettings(),
    syncQueue: loadSyncQueue()
  };
}

export function loadRequisitions() {
  return readJson(STORAGE_KEYS.requisitions, []).map(normalizeRequisition);
}

export function saveRequisitions(requisitions) {
  writeJson(STORAGE_KEYS.requisitions, requisitions.map(normalizeRequisition));
}

export function loadCurrentRequisition(existing = loadRequisitions()) {
  const saved = readJson(STORAGE_KEYS.current, null);
  if (saved?.id) return normalizeRequisition(saved);
  return createRequisition(existing);
}

export function saveCurrentRequisition(requisition) {
  writeJson(STORAGE_KEYS.current, normalizeRequisition(requisition));
}

export function clearCurrentRequisition() {
  removeItem(STORAGE_KEYS.current);
}

export function upsertRequisition(requisition) {
  const normalized = normalizeRequisition(requisition);
  const requisitions = loadRequisitions();
  const index = requisitions.findIndex((entry) => entry.id === normalized.id);
  if (index >= 0) requisitions[index] = normalized;
  else requisitions.unshift(normalized);
  saveRequisitions(requisitions);
  return requisitions;
}

export function loadCatalog() {
  const saved = readJson(STORAGE_KEYS.catalog, null);
  const seedCatalog = normalizeCatalog(DEFAULT_CATALOG);
  if (Array.isArray(saved) && saved.length) {
    return mergeSeedCatalog(seedCatalog, normalizeCatalog(saved));
  }
  return seedCatalog;
}

export function saveCatalog(catalog) {
  writeJson(STORAGE_KEYS.catalog, normalizeCatalog(catalog));
}

function mergeSeedCatalog(seedCatalog, savedCatalog) {
  const byKey = new Map(seedCatalog.map((product) => [catalogMergeKey(product), product]));
  for (const product of savedCatalog) {
    byKey.set(catalogMergeKey(product), product);
  }
  return Array.from(byKey.values());
}

function catalogMergeKey(product) {
  return product.code || product.id || product.officialName.toLowerCase();
}

export function loadRecentNames() {
  return readJson(STORAGE_KEYS.recentNames, []);
}

export function rememberName(name) {
  const clean = String(name || "").trim();
  if (!clean) return loadRecentNames();
  const next = [clean, ...loadRecentNames().filter((entry) => entry.toLowerCase() !== clean.toLowerCase())].slice(0, 12);
  writeJson(STORAGE_KEYS.recentNames, next);
  return next;
}

export function loadSettings() {
  const saved = readJson(STORAGE_KEYS.settings, {});
  const savedSupabase = saved.supabase || {};
  const shouldSeedIntegration =
    savedSupabase.integrationVersion !== PUBLIC_APP_CONFIG.integrationVersion;
  return {
    hourFormat: "24",
    textSize: "normal",
    ...saved,
    supabase: {
      ...PUBLIC_APP_CONFIG.supabase,
      ...savedSupabase,
      url: savedSupabase.url || PUBLIC_APP_CONFIG.supabase.url,
      publishableKey:
        savedSupabase.publishableKey || PUBLIC_APP_CONFIG.supabase.publishableKey,
      enabled: shouldSeedIntegration
        ? PUBLIC_APP_CONFIG.supabase.enabled
        : savedSupabase.enabled !== false,
      integrationVersion: PUBLIC_APP_CONFIG.integrationVersion,
      lastSyncAt: savedSupabase.lastSyncAt || ""
    }
  };
}

export function saveSettings(settings) {
  writeJson(STORAGE_KEYS.settings, settings);
}

export function loadSyncQueue() {
  return readJson(STORAGE_KEYS.syncQueue, []);
}

export function queueSyncChange(type, payload) {
  const payloadId = payload?.id || "";
  const queue = loadSyncQueue().filter(
    (entry) => !(payloadId && entry.type === type && entry.payload?.id === payloadId)
  );
  queue.unshift({
    id: createQueueId(),
    type,
    payload,
    createdAt: new Date().toISOString(),
    status: "pending"
  });
  writeJson(STORAGE_KEYS.syncQueue, queue.slice(0, 500));
  return queue;
}

export function saveSyncQueue(queue) {
  writeJson(STORAGE_KEYS.syncQueue, queue);
}

export function readJson(key, fallback) {
  try {
    const raw = getStorage()?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  try {
    getStorage()?.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`No se pudo guardar ${key} localmente.`, error);
  }
}

function removeItem(key) {
  getStorage()?.removeItem(key);
}

function getStorage() {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

function createQueueId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `queue-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
