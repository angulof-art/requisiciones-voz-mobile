import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";
import { resetSupabaseClientForTests } from "../src/auth/client.js";
import { IndexedDbRepository } from "../src/db/indexeddb.js";
import {
  emailErrorMessage,
  normalizeEmailFunctionError,
  sendRequisitionEmail,
  unsendableStatusMessage
} from "../src/email/api.js";
import { validateDistribution } from "../src/email/distribution.js";
import { buildEmailPreview } from "../src/email/preview.js";
import { acquireEmailSendLock, releaseEmailSendLock } from "../src/email/ui.js";
import { buildPrintableHtml, buildShareText, requisitionToCsv } from "../src/exporters.js";
import { dedupeRequisitionItemsById, normalizeRequisition } from "../src/requisitions.js";
import {
  applyCanonicalRequisitionFields,
  setSupabaseSessionContext,
  syncRequisitionToSupabase
} from "../src/supabase.js";

const draft = requisition({ status: "draft" });
const draftValidation = validateDistribution({
  requisition: draft,
  recipients: [],
  permissions: ["email.send"]
});
assert.equal(draftValidation.ok, false);
assert.ok(draftValidation.errors.includes(
  "Este pedido todavía es un borrador. Envíe primero el pedido antes de distribuirlo por correo."
));
assert.equal(unsendableStatusMessage("review"),
  "Este pedido todavía está en revisión. Complete el envío del pedido antes de distribuirlo por correo.");

globalThis.supabase = {
  createClient: () => ({
    functions: {
      invoke: async () => ({ data: { status: "sent", recipientCount: 2 }, error: null })
    }
  })
};
resetSupabaseClientForTests();
assert.deepEqual(await sendRequisitionEmail({ requisitionId: "req-test" }), {
  status: "sent",
  recipientCount: 2
});

const local = requisition({
  requisitionNumber: "TEMP-123",
  status: "submitted",
  revisionNumber: 1
});
applyCanonicalRequisitionFields(local, {
  requisition_number: "REQ-20260825-0001",
  status: "submitted",
  revision_number: 1,
  updated_at: "2026-08-25T12:00:00Z",
  department_id: "kitchen",
  destination_department_id: "purchasing",
  required_at: "2026-08-26T15:00:00Z",
  priority: "urgent"
});
assert.equal(local.requisitionNumber, "REQ-20260825-0001");
const repository = new IndexedDbRepository({ indexedDBFactory: indexedDB, dbName: `email-incident-${Date.now()}` });
await repository.saveRequisition(normalizeRequisition(local));
assert.equal((await repository.getRequisition(local.id)).requisitionNumber, "REQ-20260825-0001");
repository.close();
await repository.deleteDatabase();

const preview = buildEmailPreview({
  requisition: local,
  distributionName: "Compras",
  originName: "Cocina",
  destinationName: "Compras",
  requestedBy: "QA",
  recipients: [{ name: "Compras", email: "compras@example.test", deliveryType: "to" }]
});
assert.ok(preview.subject.includes("REQ-20260825-0001"));
assert.ok(requisitionToCsv(local).includes("REQ-20260825-0001"));
assert.ok(buildPrintableHtml(local).includes("REQ-20260825-0001"));
assert.ok(buildShareText(local).includes("REQ-20260825-0001"));

local.items[0].notes = "Sin madurar";
local.revisionNumber = 2;
assert.equal(local.requisitionNumber, "REQ-20260825-0001");
assert.equal(local.revisionNumber, 2);

setSupabaseSessionContext(
  { access_token: "test-access-token" },
  { userId: "user-test", organizationId: "org-test", departmentId: "kitchen", locationId: "location-test", permissions: [] }
);
const edited = requisition({
  id: "req-edit",
  requisitionNumber: "TEMP-EDIT",
  revisionNumber: 2,
  lastSyncedRevision: 1,
  status: "submitted"
});
const originalFetch = globalThis.fetch;
let patchBody = null;
globalThis.fetch = async (url, options = {}) => {
  const requestUrl = String(url);
  if ((options.method || "GET") === "GET" && requestUrl.includes("id=eq.req-edit")) {
    return jsonResponse([{
      id: "req-edit",
      requisition_number: "REQ-20260825-0001",
      revision_number: 1,
      status: "draft",
      updated_at: "2026-08-25T12:00:00Z",
      department_id: "kitchen",
      destination_department_id: "purchasing",
      required_at: "2026-08-26T15:00:00Z",
      priority: "normal"
    }]);
  }
  if ((options.method || "GET") === "GET" && requestUrl.includes("requisition_number=eq.")) {
    return jsonResponse([{ id: "req-edit", requisition_number: "REQ-20260825-0001" }]);
  }
  if (options.method === "PATCH") {
    patchBody = JSON.parse(options.body);
    return jsonResponse([{
      id: "req-edit",
      requisition_number: "REQ-20260825-0001",
      revision_number: 2,
      status: "submitted",
      updated_at: "2026-08-25T13:00:00Z",
      department_id: "kitchen",
      destination_department_id: "purchasing",
      required_at: "2026-08-26T15:00:00Z",
      priority: "normal"
    }]);
  }
  return new Response(null, { status: 204 });
};
await syncRequisitionToSupabase({
  enabled: true,
  url: "https://example.supabase.co",
  publishableKey: "sb_publishable_test",
  workspaceId: "main"
}, edited, []);
globalThis.fetch = originalFetch;
assert.equal(patchBody.requisition_number, "REQ-20260825-0001");
assert.equal(edited.requisitionNumber, "REQ-20260825-0001");
assert.equal(edited.revisionNumber, 2);
assert.equal(edited.status, "submitted");

const revisionError = await normalizeEmailFunctionError({
  message: "Edge Function returned a non-2xx status code",
  context: new Response(JSON.stringify({ error: "technical", code: "revision_changed" }), {
    status: 409,
    headers: { "Content-Type": "application/json" }
  })
});
assert.equal(revisionError.code, "revision_changed");
assert.equal(revisionError.message,
  "El pedido cambió desde que abrió esta vista. Actualice la vista previa antes de enviarlo.");
assert.equal(revisionError.message.includes("non-2xx"), false);
assert.equal(revisionError.message.includes("409"), false);

for (const code of [
  "requisition_not_sendable", "email_disabled", "provider_not_configured", "duplicate_send",
  "recipient_required", "required_recipient_missing", "recipient_not_authorized",
  "external_not_allowed", "invalid_email", "rate_limit", "permission_denied",
  "membership_required", "unknown_error"
]) {
  const message = emailErrorMessage(code, "draft");
  assert.ok(message.length > 20);
  assert.equal(/non-2xx|http 4|http 5|exception|postgrest|supabaseerror/i.test(message), false);
}

const sendState = { sending: false };
assert.equal(acquireEmailSendLock(sendState), true);
assert.equal(acquireEmailSendLock(sendState), false);
releaseEmailSendLock(sendState);
assert.equal(acquireEmailSendLock(sendState), true);
releaseEmailSendLock(sendState);

const duplicateIdItems = [
  { id: "line-1", productName: "Banano", quantity: 1, unit: "und" },
  { id: "line-1", productName: "Banano", quantity: 1, unit: "und" },
  { id: "line-2", productName: "Banano", quantity: 2, unit: "und" }
];
const uniqueItems = dedupeRequisitionItemsById(duplicateIdItems);
assert.deepEqual(uniqueItems.map((item) => item.id), ["line-1", "line-2"]);
assert.equal(buildEmailPreview({
  requisition: requisition({ status: "submitted", items: uniqueItems }),
  distributionName: "Compras",
  originName: "Cocina",
  destinationName: "Compras",
  requestedBy: "QA",
  recipients: []
}).rows.length, 2);

console.log("Email incident regression smoke OK");

function requisition(overrides = {}) {
  return {
    id: "req-test",
    requisitionNumber: "REQ-20260825-0001",
    revisionNumber: 1,
    requestedBy: "QA",
    status: "submitted",
    syncStatus: "synced",
    createdAt: "2026-08-25T12:00:00Z",
    updatedAt: "2026-08-25T12:00:00Z",
    items: [{ id: "line-1", productName: "Banano", quantity: 10, unit: "und", notes: "" }],
    ...overrides
  };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
