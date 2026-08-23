import { STORES } from "./indexeddb.js";

export const MIGRATION_ID = "v10_to_indexeddb_v1";

const META = Object.freeze({
  schemaVersion: "schema_version",
  migrationStatus: "migration_v10_status",
  migrationStartedAt: "migration_v10_started_at",
  migrationCompleted: "migration_v10_completed",
  migrationCompletedAt: "migration_v10_completed_at",
  migrationReport: "migration_v10_report",
  legacyBackup: "migration_v10_backup"
});

export async function migrateV10ToIndexedDb(options) {
  const { repository, storage, storageKeys, logger = quietLogger, interruptAfterImport = false } = options;
  if (!repository) throw new TypeError("Falta el repositorio IndexedDB.");
  const completed = await repository.getMetadata(META.migrationCompleted);
  if (completed === true) {
    return {
      status: (await repository.getMetadata(META.migrationStatus)) || "completed",
      alreadyCompleted: true,
      report: (await repository.getMetadata(META.migrationReport)) || null
    };
  }

  const startedAt = new Date().toISOString();
  await repository.setMetadata(META.schemaVersion, 1);
  await repository.setMetadata(META.migrationStatus, "running");
  await repository.setMetadata(META.migrationStartedAt, startedAt);
  logger.info("Migración V10 iniciada");

  const { snapshot, report, sourceBackup } = readLegacySnapshot(storage, storageKeys);
  logger.info(`${snapshot.catalog.length} productos encontrados`);
  logger.info(`${snapshot.requisitions.length} requisiciones encontradas`);

  await repository.importV10Snapshot(snapshot, [
    metadataRecord(META.legacyBackup, sourceBackup),
    metadataRecord(META.migrationReport, report)
  ]);

  if (interruptAfterImport) {
    throw new Error("Interrupción de migración simulada.");
  }

  const verification = await verifySnapshot(repository, snapshot);
  const finalReport = {
    ...report,
    verification,
    completedAt: new Date().toISOString()
  };
  if (!verification.ok) {
    await repository.setMetadata(META.migrationStatus, "verification_failed");
    await repository.setMetadata(META.migrationReport, finalReport);
    throw new Error(`La migración local no superó la verificación: ${verification.errors.join(" ")}`);
  }

  const status = report.issues.length ? "completed_with_warnings" : "completed";
  const completedAt = new Date().toISOString();
  await repository.setMetadata(META.migrationReport, finalReport);
  await repository.setMetadata(META.migrationCompletedAt, completedAt);
  await repository.setMetadata(META.migrationStatus, status);
  await repository.setMetadata(META.migrationCompleted, true);
  logger.info("Migración validada");
  return { status, alreadyCompleted: false, report: finalReport };
}

export function readLegacySnapshot(storage, storageKeys) {
  const issues = [];
  const raw = {};
  const sourcePresence = {};
  for (const [name, key] of Object.entries(storageKeys)) {
    const value = safeGetItem(storage, key, issues);
    raw[name] = parseLegacyValue(value, name, issues);
    sourcePresence[name] = value !== null;
  }

  const requisitions = validUniqueRecords(raw.requisitions, "requisición", issues, validateRequisition);
  const catalog = validUniqueRecords(raw.catalog, "producto", issues, validateCatalogProduct);
  const syncQueue = validUniqueRecords(raw.syncQueue, "entrada de cola", issues, validateQueueEntry).map(
    normalizeQueueEntry
  );
  const currentRequisition = validateRequisition(raw.current)
    ? raw.current
    : recordInvalidSingleton(raw.current, "pedido actual", issues);
  const settings = isPlainObject(raw.settings)
    ? raw.settings
    : recordInvalidSingleton(raw.settings, "configuración", issues);
  const recentNames = Array.isArray(raw.recentNames)
    ? uniqueNames(raw.recentNames, issues)
    : recordInvalidList(raw.recentNames, "nombres recientes", issues);

  const snapshot = {
    requisitions,
    currentRequisition,
    catalog,
    settings,
    recentNames,
    syncQueue
  };
  const counts = {
    requisitions: requisitions.length,
    catalog: catalog.length,
    syncQueue: syncQueue.length,
    recentNames: recentNames.length,
    currentRequisition: currentRequisition ? 1 : 0,
    settings: settings ? 1 : 0
  };
  return {
    snapshot,
    report: {
      migrationId: MIGRATION_ID,
      sourcePresence,
      validCounts: counts,
      issues
    },
    sourceBackup: {
      retainedInLocalStorage: true,
      keys: { ...storageKeys },
      sourcePresence,
      validCounts: counts,
      capturedAt: new Date().toISOString()
    }
  };
}

export async function verifySnapshot(repository, snapshot) {
  const errors = [];
  const [requisitions, catalog, queue, current, settings, recentNames] = await Promise.all([
    repository.getAll(STORES.requisitions),
    repository.getAll(STORES.catalog),
    repository.getAll(STORES.syncQueue),
    repository.getCurrentRequisition(),
    repository.getSettings(),
    repository.getRecentNames()
  ]);

  compareCollection("requisiciones", snapshot.requisitions, requisitions, errors, validateRequisitionDetails);
  compareCollection("catálogo", snapshot.catalog, catalog, errors);
  compareCollection("cola", snapshot.syncQueue, queue, errors);
  if ((snapshot.currentRequisition?.id || null) !== (current?.id || null)) {
    errors.push("El ID del pedido actual no coincide.");
  }
  if (snapshot.settings && !fundamentalSettingsMatch(snapshot.settings, settings)) {
    errors.push("La configuración fundamental no coincide.");
  }
  if (JSON.stringify(snapshot.recentNames) !== JSON.stringify(recentNames)) {
    errors.push("Los nombres recientes no coinciden.");
  }

  return {
    ok: errors.length === 0,
    errors,
    destinationCounts: {
      requisitions: requisitions.length,
      catalog: catalog.length,
      syncQueue: queue.length,
      currentRequisition: current ? 1 : 0,
      settings: settings ? 1 : 0,
      recentNames: recentNames.length
    }
  };
}

function compareCollection(label, source, destination, errors, detailValidator = null) {
  if (source.length !== destination.length) {
    errors.push(`El conteo de ${label} no coincide (${source.length}/${destination.length}).`);
  }
  const destinationById = new Map(destination.map((record) => [record.id, record]));
  for (const sourceRecord of source) {
    const destinationRecord = destinationById.get(sourceRecord.id);
    if (!destinationRecord) {
      errors.push(`Falta ${label}: ${sourceRecord.id}.`);
      continue;
    }
    if (detailValidator && !detailValidator(sourceRecord, destinationRecord)) {
      errors.push(`El detalle de ${label} ${sourceRecord.id} no coincide.`);
    }
  }
}

function validateRequisitionDetails(source, destination) {
  if ((source.items || []).length !== (destination.items || []).length) return false;
  if ((source.changes || []).length !== (destination.changes || []).length) return false;
  const sourceItemIds = (source.items || []).map((item) => item.id);
  const destinationItemIds = (destination.items || []).map((item) => item.id);
  return JSON.stringify(sourceItemIds) === JSON.stringify(destinationItemIds);
}

function fundamentalSettingsMatch(source, destination) {
  if (!destination) return false;
  for (const key of ["hourFormat", "textSize"]) {
    if (key in source && source[key] !== destination[key]) return false;
  }
  if (source.supabase) {
    for (const key of ["url", "workspaceId", "enabled", "autoSync"]) {
      if (key in source.supabase && source.supabase[key] !== destination.supabase?.[key]) return false;
    }
  }
  return true;
}

function validUniqueRecords(value, label, issues, validator) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    issues.push(`La estructura de ${label} no es una lista.`);
    return [];
  }
  const records = [];
  const ids = new Set();
  value.forEach((record, index) => {
    if (!validator(record)) {
      issues.push(`${label} inválida en posición ${index}; permanece en el respaldo V10.`);
      return;
    }
    if (ids.has(record.id)) {
      issues.push(`ID duplicado ${record.id} en ${label}; se conservó una sola copia en IndexedDB.`);
      return;
    }
    ids.add(record.id);
    records.push(record);
  });
  return records;
}

function validateRequisition(record) {
  if (!isPlainObject(record) || !isNonEmptyString(record.id)) return false;
  if (record.items != null && !Array.isArray(record.items)) return false;
  if (record.changes != null && !Array.isArray(record.changes)) return false;
  const itemIds = new Set();
  for (const item of record.items || []) {
    if (!isPlainObject(item) || !isNonEmptyString(item.id) || itemIds.has(item.id)) return false;
    itemIds.add(item.id);
  }
  const changeIds = new Set();
  for (const change of record.changes || []) {
    if (!isPlainObject(change) || !isNonEmptyString(change.id) || changeIds.has(change.id)) {
      return false;
    }
    changeIds.add(change.id);
  }
  return true;
}

function validateCatalogProduct(record) {
  return isPlainObject(record) && isNonEmptyString(record.id);
}

function validateQueueEntry(record) {
  return isPlainObject(record) && isNonEmptyString(record.id) && isNonEmptyString(record.type);
}

function normalizeQueueEntry(entry) {
  const now = new Date().toISOString();
  return {
    ...entry,
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

function uniqueNames(value, issues) {
  const names = [];
  const seen = new Set();
  for (const entry of value) {
    const name = String(entry || "").trim();
    const key = name.toLocaleLowerCase("es");
    if (!name) {
      issues.push("Se omitió un nombre reciente vacío; permanece en el respaldo V10.");
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

function parseLegacyValue(raw, name, issues) {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    issues.push(`La clave ${name} contiene JSON inválido; se conserva sin cambios en localStorage.`);
    return null;
  }
}

function safeGetItem(storage, key, issues) {
  if (!storage?.getItem) return null;
  try {
    return storage.getItem(key);
  } catch (error) {
    issues.push(`No se pudo leer ${key}: ${error.message}`);
    return null;
  }
}

function recordInvalidSingleton(value, label, issues) {
  if (value != null) issues.push(`La estructura de ${label} es inválida; permanece en el respaldo V10.`);
  return null;
}

function recordInvalidList(value, label, issues) {
  if (value != null) issues.push(`La estructura de ${label} es inválida; permanece en el respaldo V10.`);
  return [];
}

function metadataRecord(key, value) {
  return { key, value, updatedAt: new Date().toISOString() };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

const quietLogger = { info() {} };
