import { DEFAULT_CATALOG, normalizeCatalog, normalizeText } from "./catalog.js?v=2.0.0-beta.2";
import { PUBLIC_APP_CONFIG } from "./config.js?v=2.0.0-beta.2";
import { IndexedDbRepository, IndexedDbUnavailableError } from "./db/indexeddb.js?v=2.0.0-beta.2";
import { migrateV10ToIndexedDb } from "./db/migrate-v10.js?v=2.0.0-beta.2";
import { createRequisition, normalizeRequisition } from "./requisitions.js?v=2.0.0-beta.2";

export const STORAGE_KEYS = Object.freeze({
  requisitions: "requisiciones-voz:requisitions:v1",
  current: "requisiciones-voz:current:v1",
  catalog: "requisiciones-voz:catalog:v1",
  recentNames: "requisiciones-voz:recent-names:v1",
  settings: "requisiciones-voz:settings:v1",
  syncQueue: "requisiciones-voz:sync-queue:v1"
});

const RETRY_DELAYS = [60_000, 300_000, 900_000, 3_600_000];
let repository = null;
let initialization = null;
let diagnostics = {
  mode: "initializing",
  label: "Comprobando almacenamiento",
  migrationStatus: "pending",
  error: ""
};

export class LocalStorageWriteError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "LocalStorageWriteError";
  }
}

export async function initializeStorage(options = {}) {
  if (initialization) return initialization;
  initialization = initializeStorageInternal(options);
  return initialization;
}

async function initializeStorageInternal(options) {
  const storage = options.storage || getStorage();
  try {
    repository = new IndexedDbRepository({
      indexedDBFactory: options.indexedDBFactory || globalThis.indexedDB,
      dbName: options.dbName
    });
    await repository.open();
    const migration = await migrateV10ToIndexedDb({
      repository,
      storage,
      storageKeys: STORAGE_KEYS,
      logger: options.logger
    });
    diagnostics = {
      mode: "indexeddb",
      label: "IndexedDB — correcto",
      migrationStatus: migration.status,
      error: ""
    };
  } catch (error) {
    repository?.close();
    repository = null;
    diagnostics = {
      mode: "compatibility",
      label: "Modo compatibilidad",
      migrationStatus: "failed",
      error:
        error instanceof IndexedDbUnavailableError
          ? "IndexedDB no está disponible; se usará el almacenamiento compatible."
          : error.message || "No se pudo iniciar IndexedDB."
    };
  }
  return getStorageDiagnostics();
}

export async function loadAppState() {
  await initializeStorage();
  if (!repository) return loadLegacyAppState();

  const [storedRequisitions, storedCatalog, storedCurrent, recentNames, storedSettings, storedQueue] =
    await Promise.all([
      repository.getRequisitions(),
      repository.getCatalog(),
      repository.getCurrentRequisition(),
      repository.getRecentNames(),
      repository.getSettings(),
      repository.getSyncQueue()
    ]);
  const requisitions = storedRequisitions.map(normalizeRequisition);
  const catalog = mergeCatalogWithSeed(storedCatalog);
  const current = storedCurrent?.id
    ? normalizeRequisition(storedCurrent)
    : createRequisition(requisitions);
  if (catalog.length !== storedCatalog.length) await repository.saveCatalog(catalog);
  if (!storedCurrent?.id) await repository.saveCurrentRequisition(current);
  return {
    requisitions,
    catalog,
    current,
    recentNames,
    settings: normalizeSettings(storedSettings || {}),
    syncQueue: storedQueue.map(normalizeQueueEntry)
  };
}

export async function loadRequisitions(options = {}) {
  await initializeStorage();
  if (!repository) {
    const requisitions = loadLegacyRequisitions();
    if (options.limit == null) return requisitions;
    const offset = Math.max(0, Number(options.offset) || 0);
    const limit = Math.max(1, Number(options.limit) || 20);
    const items = requisitions.slice(offset, offset + limit);
    return {
      items,
      offset,
      nextOffset: offset + items.length < requisitions.length ? offset + items.length : null,
      hasMore: offset + items.length < requisitions.length
    };
  }
  const result = await repository.getRequisitions(options);
  if (Array.isArray(result)) return result.map(normalizeRequisition);
  return { ...result, items: result.items.map(normalizeRequisition) };
}

export async function getRequisition(id) {
  await initializeStorage();
  if (repository) {
    const requisition = await repository.getRequisition(id);
    return requisition ? normalizeRequisition(requisition) : null;
  }
  return loadLegacyRequisitions().find((entry) => entry.id === id) || null;
}

export async function saveRequisitions(requisitions) {
  const normalized = requisitions.map(normalizeRequisition);
  await initializeStorage();
  if (repository) await repository.saveRequisitions(normalized);
  else writeJson(STORAGE_KEYS.requisitions, normalized);
  return normalized;
}

export async function loadCurrentRequisition(existing = null) {
  await initializeStorage();
  const requisitions = existing || (await loadRequisitions());
  const saved = repository
    ? await repository.getCurrentRequisition()
    : readJson(STORAGE_KEYS.current, null);
  if (saved?.id) return normalizeRequisition(saved);
  return createRequisition(requisitions);
}

export async function saveCurrentRequisition(requisition) {
  const normalized = normalizeRequisition(requisition);
  await initializeStorage();
  if (repository) await repository.saveCurrentRequisition(normalized);
  else writeJson(STORAGE_KEYS.current, normalized);
  return normalized;
}

export async function clearCurrentRequisition() {
  await initializeStorage();
  if (repository) await repository.clearCurrentRequisition();
  else removeItem(STORAGE_KEYS.current);
}

export async function upsertRequisition(requisition, existing = null) {
  const normalized = normalizeRequisition(requisition);
  await initializeStorage();
  if (repository) await repository.saveRequisition(normalized);
  const requisitions = existing ? [...existing] : await loadRequisitions();
  const index = requisitions.findIndex((entry) => entry.id === normalized.id);
  if (index >= 0) requisitions[index] = normalized;
  else requisitions.unshift(normalized);
  if (!repository) writeJson(STORAGE_KEYS.requisitions, requisitions);
  return requisitions;
}

export async function loadCatalog() {
  await initializeStorage();
  const saved = repository ? await repository.getCatalog() : readJson(STORAGE_KEYS.catalog, null);
  return mergeCatalogWithSeed(saved);
}

export async function saveCatalog(catalog) {
  const normalized = normalizeCatalog(catalog);
  await initializeStorage();
  if (repository) await repository.saveCatalog(normalized);
  else writeJson(STORAGE_KEYS.catalog, normalized);
  return normalized;
}

export async function loadRecentNames() {
  await initializeStorage();
  return repository ? repository.getRecentNames() : readJson(STORAGE_KEYS.recentNames, []);
}

export async function rememberName(name, existing = null) {
  const clean = String(name || "").trim();
  const current = existing || (await loadRecentNames());
  if (!clean) return current;
  const next = [
    clean,
    ...current.filter((entry) => entry.toLocaleLowerCase("es") !== clean.toLocaleLowerCase("es"))
  ].slice(0, 12);
  await initializeStorage();
  if (repository) await repository.saveRecentNames(next);
  else writeJson(STORAGE_KEYS.recentNames, next);
  return next;
}

export async function loadSettings() {
  await initializeStorage();
  const saved = repository ? await repository.getSettings() : readJson(STORAGE_KEYS.settings, {});
  return normalizeSettings(saved || {});
}

export async function saveSettings(settings) {
  await initializeStorage();
  if (repository) await repository.saveSettings(settings);
  else writeJson(STORAGE_KEYS.settings, settings);
  return settings;
}

export async function loadSyncQueue() {
  await initializeStorage();
  const queue = repository ? await repository.getSyncQueue() : readJson(STORAGE_KEYS.syncQueue, []);
  return Array.isArray(queue) ? queue.map(normalizeQueueEntry) : [];
}

export async function queueSyncChange(type, payload, existing = null) {
  const payloadId = payload?.id || "";
  const dedupeKey = payloadId ? `${type}:${payloadId}` : type;
  const now = new Date().toISOString();
  const queue = (existing || (await loadSyncQueue())).filter(
    (entry) => (entry.dedupeKey || queueEntryDedupeKey(entry)) !== dedupeKey
  );
  queue.unshift({
    id: createQueueId(),
    type,
    payload,
    dedupeKey,
    status: "pending",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    lastError: "",
    nextRetryAt: ""
  });
  const next = queue.slice(0, 500);
  await saveSyncQueue(next);
  return next;
}

export async function saveSyncQueue(queue) {
  const normalized = queue.map(normalizeQueueEntry);
  await initializeStorage();
  if (repository) await repository.saveSyncQueue(normalized);
  else writeJson(STORAGE_KEYS.syncQueue, normalized);
  return normalized;
}

export async function markSyncQueueSyncing(queue) {
  const now = new Date().toISOString();
  const next = queue.map((entry) => ({ ...normalizeQueueEntry(entry), status: "syncing", updatedAt: now }));
  return saveSyncQueue(next);
}

export async function markSyncQueueFailed(queue, error) {
  const now = Date.now();
  const message = String(error?.message || error || "Error de sincronización").slice(0, 500);
  const next = queue.map((entry) => {
    const attempts = Math.max(0, Number(entry.attempts) || 0) + 1;
    const delay = RETRY_DELAYS[Math.min(attempts - 1, RETRY_DELAYS.length - 1)];
    return {
      ...normalizeQueueEntry(entry),
      status: "failed",
      attempts,
      updatedAt: new Date(now).toISOString(),
      lastError: message,
      nextRetryAt: new Date(now + delay).toISOString()
    };
  });
  return saveSyncQueue(next);
}

export function hasDueSyncEntries(queue, now = Date.now()) {
  return queue.some(
    (entry) =>
      ["pending", "syncing"].includes(entry.status) ||
      (entry.status === "failed" && (!entry.nextRetryAt || Date.parse(entry.nextRetryAt) <= now))
  );
}

export function getStorageDiagnostics() {
  return { ...diagnostics };
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
  const storage = getStorage();
  if (!storage?.setItem) {
    throw new LocalStorageWriteError("El almacenamiento local no está disponible.");
  }
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (error) {
    throw new LocalStorageWriteError(`No se pudo guardar ${key} localmente.`, error);
  }
}

export function resetStorageForTests() {
  repository?.close();
  repository = null;
  initialization = null;
  diagnostics = {
    mode: "initializing",
    label: "Comprobando almacenamiento",
    migrationStatus: "pending",
    error: ""
  };
}

function loadLegacyAppState() {
  const requisitions = loadLegacyRequisitions();
  const savedCurrent = readJson(STORAGE_KEYS.current, null);
  return {
    requisitions,
    catalog: mergeCatalogWithSeed(readJson(STORAGE_KEYS.catalog, null)),
    current: savedCurrent?.id ? normalizeRequisition(savedCurrent) : createRequisition(requisitions),
    recentNames: readJson(STORAGE_KEYS.recentNames, []),
    settings: normalizeSettings(readJson(STORAGE_KEYS.settings, {})),
    syncQueue: readJson(STORAGE_KEYS.syncQueue, []).map(normalizeQueueEntry)
  };
}

function loadLegacyRequisitions() {
  const value = readJson(STORAGE_KEYS.requisitions, []);
  return Array.isArray(value) ? value.map(normalizeRequisition) : [];
}

function mergeCatalogWithSeed(saved) {
  const seedCatalog = normalizeCatalog(DEFAULT_CATALOG);
  if (!Array.isArray(saved) || !saved.length) return seedCatalog;
  return mergeSeedCatalog(seedCatalog, normalizeCatalog(saved));
}

function mergeSeedCatalog(seedCatalog, savedCatalog) {
  const byKey = new Map(seedCatalog.map((product) => [catalogMergeKey(product), product]));
  const seedIds = new Set(seedCatalog.map((product) => product.id));
  const seedNames = new Set(seedCatalog.map((product) => normalizeText(product.officialName)));
  for (const product of savedCatalog) {
    if (byKey.has(catalogMergeKey(product)) || seedIds.has(product.id)) continue;
    if (seedNames.has(normalizeText(product.officialName))) continue;
    byKey.set(catalogMergeKey(product), product);
  }
  return Array.from(byKey.values());
}

function catalogMergeKey(product) {
  return product.code || product.id || product.officialName.toLowerCase();
}

function normalizeSettings(saved) {
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
      publishableKey: savedSupabase.publishableKey || PUBLIC_APP_CONFIG.supabase.publishableKey,
      enabled: shouldSeedIntegration
        ? PUBLIC_APP_CONFIG.supabase.enabled
        : savedSupabase.enabled !== false,
      autoSync:
        typeof savedSupabase.autoSync === "boolean"
          ? savedSupabase.autoSync
          : PUBLIC_APP_CONFIG.supabase.autoSync !== false,
      integrationVersion: PUBLIC_APP_CONFIG.integrationVersion,
      lastSyncAt: savedSupabase.lastSyncAt || ""
    }
  };
}

function normalizeQueueEntry(entry) {
  const now = new Date().toISOString();
  return {
    ...entry,
    id: entry.id || createQueueId(),
    type: entry.type || "unknown",
    payload: entry.payload || {},
    dedupeKey: entry.dedupeKey || queueEntryDedupeKey(entry),
    status: ["pending", "syncing", "failed", "synced"].includes(entry.status)
      ? entry.status
      : "pending",
    attempts: Math.max(0, Number(entry.attempts) || 0),
    createdAt: entry.createdAt || now,
    updatedAt: entry.updatedAt || entry.createdAt || now,
    lastError: String(entry.lastError || ""),
    nextRetryAt: entry.nextRetryAt || ""
  };
}

function queueEntryDedupeKey(entry) {
  return entry.payload?.id ? `${entry.type}:${entry.payload.id}` : entry.type || "unknown";
}

function removeItem(key) {
  const storage = getStorage();
  if (!storage?.removeItem) {
    throw new LocalStorageWriteError("El almacenamiento local no está disponible.");
  }
  try {
    storage.removeItem(key);
  } catch (error) {
    throw new LocalStorageWriteError(`No se pudo limpiar ${key}.`, error);
  }
}

function getStorage() {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

function createQueueId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `queue-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
