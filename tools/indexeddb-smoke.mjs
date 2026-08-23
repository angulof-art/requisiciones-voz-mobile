import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";
import { IndexedDbRepository, STORES } from "../src/db/indexeddb.js";
import { migrateV10ToIndexedDb } from "../src/db/migrate-v10.js";
import {
  STORAGE_KEYS,
  getStorageDiagnostics,
  initializeStorage,
  loadAppState,
  markSyncQueueFailed,
  queueSyncChange,
  resetStorageForTests,
  saveCurrentRequisition,
  setStorageContext,
  upsertRequisition
} from "../src/storage.js";

await testNormalAndRepeatedMigration();
await testMigrationWithoutData();
await testPartiallyCorruptData();
await testInterruptedMigration();
await testReopenAndLargeVolumes();
await testQueueDedupeAndBackoff();
await testUserAndOrganizationIsolation();
await testCompatibilityFallbackAndWriteError();

console.log("IndexedDB migration smoke OK");

async function testNormalAndRepeatedMigration() {
  const storage = createMemoryStorage();
  const source = seedLegacy(storage, 3, 5);
  const before = storage.snapshot();
  const repository = createRepository("normal");
  const result = await migrateV10ToIndexedDb({
    repository,
    storage,
    storageKeys: STORAGE_KEYS
  });

  assert.equal(result.status, "completed");
  assert.equal((await repository.getRequisitions()).length, 3);
  assert.equal((await repository.getCatalog()).length, 5);
  assert.equal((await repository.getSyncQueue()).length, 1);
  assert.equal((await repository.getCurrentRequisition()).id, source.current.id);
  assert.deepEqual(await repository.getSettings(), source.settings);
  assert.deepEqual(await repository.getRecentNames(), source.recentNames);
  assert.equal(await repository.getMetadata("migration_v10_completed"), true);
  assert.deepEqual(storage.snapshot(), before, "La migración no debe modificar localStorage V10");

  const repeated = await migrateV10ToIndexedDb({
    repository,
    storage,
    storageKeys: STORAGE_KEYS
  });
  assert.equal(repeated.alreadyCompleted, true);
  assert.equal((await repository.getRequisitions()).length, 3);
  assert.equal((await repository.getCatalog()).length, 5);
  const reopened = new IndexedDbRepository({ indexedDBFactory: indexedDB, dbName: repository.dbName });
  repository.close();
  assert.equal((await reopened.getSyncQueue()).length, 1);
  reopened.close();
}

async function testMigrationWithoutData() {
  const repository = createRepository("empty");
  const result = await migrateV10ToIndexedDb({
    repository,
    storage: createMemoryStorage(),
    storageKeys: STORAGE_KEYS
  });
  assert.equal(result.status, "completed");
  assert.equal(await repository.count(STORES.requisitions), 0);
  assert.equal(await repository.count(STORES.catalog), 0);
  repository.close();
}

async function testPartiallyCorruptData() {
  const storage = createMemoryStorage();
  const valid = makeRequisition(1);
  storage.setItem(
    STORAGE_KEYS.requisitions,
    JSON.stringify([valid, { requestedBy: "Sin ID" }, valid])
  );
  storage.setItem(STORAGE_KEYS.catalog, JSON.stringify([makeProduct(1), { officialName: "Sin ID" }]));
  storage.setItem(STORAGE_KEYS.current, "{json roto");
  storage.setItem(
    STORAGE_KEYS.syncQueue,
    JSON.stringify([makeQueueEntry(1), { id: "queue-invalida" }])
  );
  storage.setItem(STORAGE_KEYS.settings, JSON.stringify({ hourFormat: "12" }));
  const repository = createRepository("corrupt");
  const result = await migrateV10ToIndexedDb({
    repository,
    storage,
    storageKeys: STORAGE_KEYS
  });

  assert.equal(result.status, "completed_with_warnings");
  assert.ok(result.report.issues.length >= 4);
  assert.equal((await repository.getRequisitions()).length, 1);
  assert.equal((await repository.getCatalog()).length, 1);
  assert.equal((await repository.getSyncQueue()).length, 1);
  assert.equal(await repository.getCurrentRequisition(), null);
  assert.ok(storage.getItem(STORAGE_KEYS.current), "El JSON corrupto debe permanecer respaldado");
  repository.close();
}

async function testInterruptedMigration() {
  const storage = createMemoryStorage();
  seedLegacy(storage, 4, 4);
  const repository = createRepository("interrupted");
  await assert.rejects(
    migrateV10ToIndexedDb({
      repository,
      storage,
      storageKeys: STORAGE_KEYS,
      interruptAfterImport: true
    }),
    /Interrupción/
  );
  assert.notEqual(await repository.getMetadata("migration_v10_completed"), true);

  const resumed = await migrateV10ToIndexedDb({
    repository,
    storage,
    storageKeys: STORAGE_KEYS
  });
  assert.equal(resumed.status, "completed");
  assert.equal((await repository.getRequisitions()).length, 4);
  assert.equal(new Set((await repository.getRequisitions()).map((entry) => entry.id)).size, 4);
  repository.close();
}

async function testReopenAndLargeVolumes() {
  const dbName = uniqueDbName("volume");
  const repository = new IndexedDbRepository({ indexedDBFactory: indexedDB, dbName });
  const requisitions = Array.from({ length: 5_000 }, (_, index) => makeRequisition(index));
  const catalog = Array.from({ length: 1_000 }, (_, index) => makeProduct(index));
  await repository.saveRequisitions(requisitions);
  await repository.saveCatalog(catalog);
  await repository.saveCurrentRequisition(requisitions[4_999]);
  repository.close();

  const reopened = new IndexedDbRepository({ indexedDBFactory: indexedDB, dbName });
  assert.equal((await reopened.getCurrentRequisition()).id, "req-4999");
  assert.equal(await reopened.count(STORES.requisitions), 5_000);
  assert.equal(await reopened.count(STORES.catalog), 1_000);
  const firstPage = await reopened.getRequisitions({ limit: 20, offset: 0 });
  assert.equal(firstPage.items.length, 20);
  assert.equal(firstPage.hasMore, true);
  const secondPage = await reopened.getRequisitions({ limit: 20, offset: firstPage.nextOffset });
  assert.equal(secondPage.items.length, 20);
  assert.equal(new Set([...firstPage.items, ...secondPage.items].map((entry) => entry.id)).size, 40);
  reopened.close();
}

async function testCompatibilityFallbackAndWriteError() {
  const storage = createMemoryStorage();
  seedLegacy(storage, 1, 1);
  globalThis.localStorage = storage;
  resetStorageForTests();
  await initializeStorage({ indexedDBFactory: {}, storage });
  const state = await loadAppState();
  assert.equal(getStorageDiagnostics().mode, "compatibility");
  assert.equal(state.requisitions.length, 1);
  await saveCurrentRequisition(state.current);
  assert.ok(storage.getItem(STORAGE_KEYS.current));

  const failingStorage = createMemoryStorage();
  failingStorage.setItem = () => {
    throw new Error("quota");
  };
  globalThis.localStorage = failingStorage;
  resetStorageForTests();
  await initializeStorage({ indexedDBFactory: {}, storage: failingStorage });
  await assert.rejects(saveCurrentRequisition(makeRequisition(9)), /No se pudo guardar/);
  delete globalThis.localStorage;
  resetStorageForTests();
}

async function testQueueDedupeAndBackoff() {
  const storage = createMemoryStorage();
  globalThis.localStorage = storage;
  resetStorageForTests();
  await initializeStorage({
    indexedDBFactory: indexedDB,
    dbName: uniqueDbName("queue"),
    storage
  });
  let queue = await queueSyncChange("requisition", { id: "req-dedupe" }, []);
  queue = await queueSyncChange("requisition", { id: "req-dedupe" }, queue);
  assert.equal(queue.length, 1);
  queue = await markSyncQueueFailed(queue, new Error("sin red"));
  assert.equal(queue[0].status, "failed");
  assert.equal(queue[0].attempts, 1);
  const delay = Date.parse(queue[0].nextRetryAt) - Date.parse(queue[0].updatedAt);
  assert.equal(delay, 60_000);
  delete globalThis.localStorage;
  resetStorageForTests();
}

async function testUserAndOrganizationIsolation() {
  const storage = createMemoryStorage();
  globalThis.localStorage = storage;
  resetStorageForTests();
  await initializeStorage({
    indexedDBFactory: indexedDB,
    dbName: uniqueDbName("user-isolation"),
    storage
  });
  const contextA = makeContext("user-a", "org-a");
  const contextB = makeContext("user-b", "org-b");
  setStorageContext(contextA);
  const requisitionA = makeRequisition(7000);
  requisitionA.requestedByUserId = contextA.userId;
  requisitionA.organizationId = contextA.organizationId;
  requisitionA.locationId = contextA.locationId;
  requisitionA.departmentId = contextA.departmentId;
  await upsertRequisition(requisitionA, []);
  await saveCurrentRequisition(requisitionA);
  await queueSyncChange("requisition", { id: requisitionA.id }, []);

  setStorageContext(contextB);
  const stateB = await loadAppState();
  assert.equal(stateB.requisitions.length, 0);
  assert.equal(stateB.syncQueue.length, 0);
  assert.notEqual(stateB.current.id, requisitionA.id);

  setStorageContext(contextA);
  const stateA = await loadAppState();
  assert.equal(stateA.requisitions.length, 1);
  assert.equal(stateA.syncQueue.length, 1);
  assert.equal(stateA.current.id, requisitionA.id);
  delete globalThis.localStorage;
  resetStorageForTests();
}

function makeContext(userId, organizationId) {
  return {
    userId,
    organizationId,
    locationId: `${organizationId}-location`,
    departmentId: `${organizationId}-department`,
    departmentIds: [`${organizationId}-department`],
    displayName: userId,
    roles: ["requester"],
    permissions: ["requisitions.create", "requisitions.read", "requisitions.update"]
  };
}

function seedLegacy(storage, requisitionCount, productCount) {
  const requisitions = Array.from({ length: requisitionCount }, (_, index) => makeRequisition(index));
  const catalog = Array.from({ length: productCount }, (_, index) => makeProduct(index));
  const current = requisitions.at(-1) || makeRequisition(99);
  const settings = {
    hourFormat: "24",
    textSize: "normal",
    supabase: { enabled: true, autoSync: true, workspaceId: "main" }
  };
  const recentNames = ["Chef Uno", "Bodega Dos"];
  const syncQueue = [makeQueueEntry(1)];
  storage.setItem(STORAGE_KEYS.requisitions, JSON.stringify(requisitions));
  storage.setItem(STORAGE_KEYS.catalog, JSON.stringify(catalog));
  storage.setItem(STORAGE_KEYS.current, JSON.stringify(current));
  storage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  storage.setItem(STORAGE_KEYS.recentNames, JSON.stringify(recentNames));
  storage.setItem(STORAGE_KEYS.syncQueue, JSON.stringify(syncQueue));
  return { requisitions, catalog, current, settings, recentNames, syncQueue };
}

function makeRequisition(index) {
  const day = String((index % 28) + 1).padStart(2, "0");
  const timestamp = `2026-08-${day}T12:${String(index % 60).padStart(2, "0")}:00.000Z`;
  return {
    id: `req-${index}`,
    requisitionNumber: `REQ-202608${day}-${String(index + 1).padStart(4, "0")}`,
    requestedBy: `Responsable ${index % 25}`,
    status: index % 2 ? "draft" : "confirmed",
    originalTranscript: `${index + 1} kg de producto`,
    items: [
      {
        id: `item-${index}`,
        productName: `Producto ${index}`,
        quantity: index + 1,
        unit: "kg",
        notes: ""
      }
    ],
    changes: [{ id: `change-${index}`, action: "crear", changedAt: timestamp }],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function makeProduct(index) {
  return {
    id: `product-${index}`,
    code: `PRO-${String(index).padStart(4, "0")}`,
    officialName: `Producto ${index}`,
    defaultUnit: "kg",
    allowedUnits: ["kg"],
    synonyms: [],
    active: true
  };
}

function makeQueueEntry(index) {
  return {
    id: `queue-${index}`,
    type: "requisition",
    payload: { id: `req-${index}` },
    status: "pending",
    createdAt: "2026-08-03T12:00:00.000Z"
  };
}

function createRepository(label) {
  return new IndexedDbRepository({ indexedDBFactory: indexedDB, dbName: uniqueDbName(label) });
}

function uniqueDbName(label) {
  return `pedidos-voz-test-${label}-${Date.now()}-${Math.random()}`;
}

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    snapshot() {
      return Object.fromEntries(values);
    }
  };
}
