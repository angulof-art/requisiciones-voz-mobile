import assert from "node:assert/strict";
import { setSupabaseSessionContext, syncRequisitionToSupabase } from "../src/supabase.js";

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (options.method === "PATCH") {
    assert.ok(String(url).includes("revision_number=eq.2"));
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
};

setSupabaseSessionContext(
  { access_token: "qa-token" },
  { userId: "user-a", organizationId: "org-a", locationId: "loc-a", departmentId: "dept-a", permissions: [] }
);

const requisition = {
  id: "req-conflict",
  requisitionNumber: "REQ-20260823-0001",
  requestedBy: "QA",
  requestedByUserId: "user-a",
  organizationId: "org-a",
  locationId: "loc-a",
  departmentId: "dept-a",
  revisionNumber: 3,
  lastSyncedRevision: 2,
  status: "draft",
  items: [],
  changes: [],
  createdAt: "2026-08-23T12:00:00Z",
  updatedAt: "2026-08-23T13:00:00Z"
};

await assert.rejects(
  () => syncRequisitionToSupabase({ enabled: true, url: "https://example.supabase.co", publishableKey: "sb_publishable_qa", workspaceId: "main" }, requisition, []),
  (error) => error.code === "sync_conflict" && /otro dispositivo/.test(error.message)
);

globalThis.fetch = async (url, options = {}) => {
  if (options.method === "PATCH") {
    return new Response('[{"revision_number":4,"updated_at":"2026-08-23T13:01:00Z"}]', {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  if (options.method === "DELETE" && String(url).includes("requisition_items")) {
    return new Response('{"message":"temporary item failure"}', {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
  return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
};

await assert.rejects(
  () => syncRequisitionToSupabase({ enabled: true, url: "https://example.supabase.co", publishableKey: "sb_publishable_qa", workspaceId: "main" }, requisition, []),
  (error) => error.status === 500 && error.technical.includes("temporary item failure")
);
assert.equal(requisition.lastSyncedRevision, 4);
assert.equal(requisition.syncStatus, "pending");

globalThis.fetch = originalFetch;
console.log("Concurrency smoke OK");
