import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";
import { validateDistribution } from "../src/email/distribution.js";
import {
  setSupabaseSessionContext,
  syncRequisitionToSupabase
} from "../src/supabase.js";
import {
  initializeStorage,
  loadSyncQueue,
  queueSyncChange,
  resetStorageForTests,
  resolveSyncQueueEntries,
  setStorageContext
} from "../src/storage.js";

const SETTINGS = {
  enabled: true,
  url: "https://example.supabase.co",
  publishableKey: "sb_publishable_sync_qa",
  workspaceId: "main"
};
const CONTEXT = {
  userId: "user-sync-qa",
  organizationId: "org-sync-qa",
  locationId: "location-sync-qa",
  departmentId: "department-sync-qa",
  permissions: []
};
const originalFetch = globalThis.fetch;

setSupabaseSessionContext({ access_token: "qa-access-token" }, CONTEXT);
await testInvalidLegacyTransitionReconciles();
await testNormalTransitionStillSyncs();
await testExplicitOfflineSequenceUsesValidSteps();
await testQueueSurvivesReconnectAndResolves();
testEmailAvailabilityAfterReconciliation();
setSupabaseSessionContext(null, null);
globalThis.fetch = originalFetch;

console.log("Sync reconciliation smoke OK");

async function testInvalidLegacyTransitionReconciles() {
  const remote = makeRemote({ status: "submitted", revision_number: 4 });
  const local = makeLocal({ status: "accepted", revisionNumber: 5, lastSyncedRevision: 4 });
  local.changes = [
    {
      id: "change-stale-status",
      action: "flujo_accepted",
      previousValue: { status: "delivered" },
      newValue: { status: "accepted" },
      changedAt: "2026-08-26T13:03:00.000Z",
      changedByUserId: CONTEXT.userId
    },
    {
      id: "change-valid-item",
      action: "editar_linea",
      previousValue: { quantity: 1 },
      newValue: { quantity: 2 },
      changedAt: "2026-08-26T13:02:00.000Z",
      changedByUserId: CONTEXT.userId
    }
  ];
  const originalItems = structuredClone(local.items);
  const harness = createSupabaseHarness(remote);
  globalThis.fetch = harness.fetch;

  const result = await syncRequisitionToSupabase(SETTINGS, local, []);

  assert.equal(result.reconciliation?.previousStatus, "accepted");
  assert.equal(result.reconciliation?.status, "submitted");
  assert.equal(local.status, "submitted");
  assert.equal(local.syncStatus, "synced");
  assert.equal(local.lastSyncedRevision, 5);
  assert.equal(local.requisitionNumber, remote.requisition_number);
  assert.deepEqual(local.items, originalItems);
  assert.deepEqual(harness.patchStatuses(), ["submitted"]);
  assert.equal(harness.patchStatuses().includes("accepted"), false);
  assert.equal(harness.itemWrites(), 1);
  const changeIds = harness.changeWrites().map((entry) => entry.id);
  assert.equal(changeIds.includes("change-valid-item"), true);
  assert.equal(changeIds.includes("change-stale-status"), false);
}

async function testNormalTransitionStillSyncs() {
  const remote = makeRemote({ status: "submitted", revision_number: 8 });
  const local = makeLocal({ status: "received", revisionNumber: 9, lastSyncedRevision: 8 });
  const harness = createSupabaseHarness(remote);
  globalThis.fetch = harness.fetch;

  const result = await syncRequisitionToSupabase(SETTINGS, local, []);

  assert.equal(result.reconciliation, null);
  assert.equal(local.status, "received");
  assert.equal(local.syncStatus, "synced");
  assert.deepEqual(harness.patchStatuses(), ["received"]);
}

async function testExplicitOfflineSequenceUsesValidSteps() {
  const remote = makeRemote({ status: "submitted", revision_number: 10 });
  const local = makeLocal({ status: "delivered", revisionNumber: 13, lastSyncedRevision: 10 });
  const originalItems = structuredClone(local.items);
  const harness = createSupabaseHarness(remote);
  globalThis.fetch = harness.fetch;

  const result = await syncRequisitionToSupabase(SETTINGS, local, [], {
    workflowTransitions: [
      { from: "submitted", to: "received", changedAt: "2026-08-26T13:01:00.000Z" },
      { from: "received", to: "preparing", changedAt: "2026-08-26T13:02:00.000Z" },
      { from: "preparing", to: "delivered", changedAt: "2026-08-26T13:03:00.000Z" }
    ]
  });

  assert.equal(result.reconciliation, null);
  assert.equal(local.status, "delivered");
  assert.equal(local.syncStatus, "synced");
  assert.deepEqual(harness.patchStatuses(), ["received", "preparing", "delivered", "delivered"]);
  assert.deepEqual(local.items, originalItems);
}

async function testQueueSurvivesReconnectAndResolves() {
  const storage = createMemoryStorage();
  globalThis.localStorage = storage;
  resetStorageForTests();
  await initializeStorage({
    indexedDBFactory: indexedDB,
    dbName: `sync-reconciliation-${Date.now()}-${Math.random()}`,
    storage
  });
  setStorageContext(CONTEXT);

  let queue = await queueSyncChange("requisition", {
    id: "req-sync-qa",
    workflowTransition: { from: "submitted", to: "received", changedAt: "2026-08-26T13:01:00.000Z" }
  }, []);
  queue = await queueSyncChange("requisition", {
    id: "req-sync-qa",
    workflowTransition: { from: "received", to: "preparing", changedAt: "2026-08-26T13:02:00.000Z" }
  }, queue);

  assert.equal(queue.length, 1);
  assert.deepEqual(queue[0].payload.workflowTransitions.map(({ from, to }) => ({ from, to })), [
    { from: "submitted", to: "received" },
    { from: "received", to: "preparing" }
  ]);
  assert.equal((await loadSyncQueue()).length, 1);

  queue = await resolveSyncQueueEntries(queue, [queue[0].id]);
  assert.equal(queue.length, 0);
  assert.equal((await loadSyncQueue()).length, 0);

  delete globalThis.localStorage;
  resetStorageForTests();
}

function testEmailAvailabilityAfterReconciliation() {
  const requisition = makeLocal({ status: "submitted", syncStatus: "synced" });
  requisition.lastSyncedAt = "2026-08-26T13:05:00.000Z";
  const result = validateDistribution({
    requisition,
    recipients: [{ id: "qa", email: "qa@example.test", selected: true, deliveryType: "to" }],
    permissions: ["email.send"]
  });
  assert.equal(result.ok, true);

  requisition.syncStatus = "pending";
  requisition.lastSyncedAt = "";
  assert.equal(validateDistribution({
    requisition,
    recipients: [{ id: "qa", email: "qa@example.test", selected: true, deliveryType: "to" }],
    permissions: ["email.send"]
  }).ok, false);
}

function createSupabaseHarness(initialRemote) {
  let remote = { ...initialRemote };
  const requests = [];
  return {
    requests,
    patchStatuses: () => requests
      .filter((entry) => entry.method === "PATCH" && entry.url.includes("/requisitions?"))
      .map((entry) => entry.body.status),
    itemWrites: () => requests.filter(
      (entry) => entry.method === "POST" && entry.url.includes("/requisition_items?")
    ).length,
    changeWrites: () => requests
      .filter((entry) => entry.method === "POST" && entry.url.includes("/requisition_changes?"))
      .flatMap((entry) => entry.body || []),
    fetch: async (url, options = {}) => {
      const requestUrl = String(url);
      const method = options.method || "GET";
      const body = options.body ? JSON.parse(options.body) : null;
      requests.push({ url: requestUrl, method, body });

      if (method === "GET" && requestUrl.includes("/requisitions?")) {
        if (requestUrl.includes("requisition_number=eq.")) {
          return jsonResponse([{ id: remote.id, requisition_number: remote.requisition_number }]);
        }
        return jsonResponse([remote]);
      }
      if (method === "PATCH" && requestUrl.includes("/requisitions?")) {
        remote = {
          ...remote,
          ...body,
          revision_number: body.revision_number,
          status: body.status,
          updated_at: body.updated_at
        };
        return jsonResponse([remote]);
      }
      if (method === "DELETE") return new Response(null, { status: 204 });
      if (method === "POST") return new Response(null, { status: 204 });
      return jsonResponse([]);
    }
  };
}

function makeRemote(overrides = {}) {
  return {
    id: "req-sync-qa",
    requisition_number: "REQ-20260826-0099",
    revision_number: 4,
    status: "submitted",
    updated_at: "2026-08-26T13:00:00.000Z",
    department_id: CONTEXT.departmentId,
    destination_department_id: "destination-sync-qa",
    required_at: "2026-08-27T15:00:00.000Z",
    priority: "normal",
    submitted_at: "2026-08-26T13:00:00.000Z",
    received_at: null,
    preparing_at: null,
    delivered_at: null,
    accepted_at: null,
    closed_at: null,
    rejected_at: null,
    ...overrides
  };
}

function makeLocal(overrides = {}) {
  return {
    id: "req-sync-qa",
    requisitionNumber: "REQ-LOCAL-0099",
    requestedBy: "QA Sync",
    requestedByName: "QA Sync",
    requestedByUserId: CONTEXT.userId,
    organizationId: CONTEXT.organizationId,
    locationId: CONTEXT.locationId,
    departmentId: CONTEXT.departmentId,
    destinationDepartmentId: "destination-sync-qa",
    revisionNumber: 5,
    lastSyncedRevision: 4,
    status: "accepted",
    priority: "normal",
    requiredAt: "2026-08-27T15:00:00.000Z",
    originalTranscript: "2 kg de tomate y 1 lechuga",
    items: [
      { id: "item-tomate", productName: "Tomate", quantity: 2, requestedQuantity: 2, unit: "kg", notes: "maduro" },
      { id: "item-lechuga", productName: "Lechuga", quantity: 1, requestedQuantity: 1, unit: "und", notes: "" }
    ],
    changes: [],
    createdAt: "2026-08-26T12:55:00.000Z",
    updatedAt: "2026-08-26T13:04:00.000Z",
    acceptedAt: "2026-08-26T13:04:00.000Z",
    syncStatus: "pending",
    deviceInfo: "qa",
    ...overrides
  };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    key: (index) => [...data.keys()][index] || null,
    get length() { return data.size; }
  };
}
