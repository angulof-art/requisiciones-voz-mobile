import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCustomSelection,
  buildGroupSelection,
  dedupeRecipients,
  detectDistributionSuggestions,
  hasRequisitionChangedSinceSend,
  isValidEmail,
  setRecipientSelected,
  splitItemsByDistribution,
  validateDistribution
} from "../src/email/distribution.js";
import { buildEmailPreview, buildEmailSubject } from "../src/email/preview.js";
import { emailPermissionMatrix } from "../src/email/permissions.js";

const groups = [
  { id: "warehouse-group", code: "WAREHOUSE", name: "Almacen / Abarrotes", active: true },
  { id: "vegetables-group", code: "VEGETABLES", name: "Verduras", active: true },
  { id: "event-group", code: "SPECIAL_EVENT", name: "Evento especial", active: true }
];
const recipients = [
  recipient("warehouse", "Almacen", "almacen@example.test"),
  recipient("purchasing", "Compras", "compras@example.test"),
  recipient("security", "Seguridad", "seguridad@example.test"),
  recipient("controller", "Contraloria", "contraloria@example.test"),
  recipient("costs", "Costos", "costos@example.test"),
  recipient("management", "Gerencia", "gerencia@example.test")
];
const groupRecipients = [
  link("warehouse-group", "warehouse", "to"),
  link("vegetables-group", "purchasing", "to"),
  link("vegetables-group", "security", "cc"),
  link("vegetables-group", "controller", "cc"),
  link("vegetables-group", "warehouse", "cc"),
  link("vegetables-group", "costs", "cc"),
  link("event-group", "purchasing", "to"),
  link("event-group", "costs", "cc"),
  link("event-group", "controller", "cc"),
  link("event-group", "warehouse", "cc")
];
const rules = [
  { id: "rule-veg", rule_type: "category", match_value: "Verduras", group_id: "vegetables-group", active: true },
  { id: "rule-dry", rule_type: "category", match_value: "Abarrotes", group_id: "warehouse-group", active: true },
  { id: "rule-event", rule_type: "explicit_event", match_value: "Evento especial", group_id: "event-group", active: true }
];
const configuration = { groups, recipients, groupRecipients, rules };

const warehouse = buildGroupSelection(configuration, "warehouse-group");
assert.deepEqual(warehouse.recipients.filter((entry) => entry.selected).map((entry) => entry.name), ["Almacen"]);

const vegetables = buildGroupSelection(configuration, "vegetables-group");
assert.deepEqual(vegetables.recipients.filter((entry) => entry.selected).map((entry) => entry.name), [
  "Compras", "Seguridad", "Contraloria", "Almacen", "Costos"
]);

const event = buildGroupSelection(configuration, "event-group");
assert.deepEqual(event.recipients.filter((entry) => entry.selected).map((entry) => entry.name).sort(), [
  "Compras", "Costos", "Contraloria", "Almacen"
].sort());
assert.equal(event.recipients.find((entry) => entry.name === "Seguridad").selected, false);

const custom = buildCustomSelection(configuration);
assert.equal(custom.recipients.filter((entry) => entry.selected).length, 0);
assert.equal(custom.recipients.length, 6);

const requiredConfig = {
  ...configuration,
  groupRecipients: groupRecipients.map((entry) => entry.recipient_id === "controller" && entry.group_id === "vegetables-group"
    ? { ...entry, required: true }
    : entry)
};
const requiredSelection = buildGroupSelection(requiredConfig, "vegetables-group");
const afterUncheck = setRecipientSelected(requiredSelection.recipients, "controller", false);
assert.equal(afterUncheck.find((entry) => entry.id === "controller").selected, true);

const duplicated = dedupeRecipients([
  { id: "a", name: "Compras", email: " COMPRAS@example.test ", deliveryType: "cc" },
  { id: "b", name: "Compras 2", email: "compras@example.test", deliveryType: "to" }
]);
assert.equal(duplicated.length, 1);
assert.equal(duplicated[0].deliveryType, "to");

const items = [
  { id: "tomato", productName: "Tomate", category: "Verduras" },
  { id: "lettuce", productName: "Lechuga", category: "Verduras" },
  { id: "rice", productName: "Arroz", category: "Abarrotes" },
  { id: "oil", productName: "Aceite", category: "Abarrotes" }
];
const suggestions = detectDistributionSuggestions(items, rules, groups);
assert.equal(suggestions.mixed, true);
assert.equal(suggestions.groups.length, 2);
const split = splitItemsByDistribution(items, rules, groups);
assert.equal(split.distributions.length, 2);
assert.equal(split.unassigned.length, 0);
assert.deepEqual(split.distributions.flatMap((entry) => entry.items.map((item) => item.id)).sort(), ["lettuce", "oil", "rice", "tomato"]);

const requisition = {
  id: "req-test", requisitionNumber: "REQ-20260823-0041", revisionNumber: 3,
  requestedBy: "Chef QA", status: "submitted", syncStatus: "synced",
  priority: "urgent", createdAt: "2026-08-23T18:00:00Z", requiredAt: "2026-08-24T15:00:00Z",
  items: [{ id: "line-1", productName: "Tomate <script>alert(1)</script>", quantity: 10, unit: "kg", notes: '<img src=x onerror="x">' }]
};
const validation = validateDistribution({
  requisition,
  recipients: vegetables.recipients,
  permissions: ["email.send"],
  maxRecipients: 25
});
assert.equal(validation.ok, true);
assert.equal(validation.recipients.length, 5);
assert.equal(validateDistribution({ requisition, recipients: [], permissions: ["email.send"] }).ok, false);
assert.equal(validateDistribution({ requisition, recipients: warehouse.recipients, permissions: [] }).ok, false);
assert.equal(validateDistribution({ requisition, recipients: warehouse.recipients, externalRecipients: [{ email: "outside@example.test" }], permissions: ["email.send"], allowExternal: false }).ok, false);

const preview = buildEmailPreview({
  requisition,
  distributionName: "Verduras",
  originName: "Cocina\r\nBcc: injected@example.test",
  destinationName: "Bodega",
  requestedBy: "Chef QA",
  recipients: validation.recipients,
  customNote: '<script>alert("x")</script>'
});
assert.ok(preview.subject.startsWith("URGENTE | REQ-20260823-0041"));
assert.equal(preview.subject.includes("\r"), false);
assert.equal(preview.subject.includes("\n"), false);
assert.equal(preview.html.includes("<script>alert"), false);
assert.equal(preview.html.includes("onerror=\"x\""), false);
assert.ok(preview.html.includes("&lt;script&gt;"));
assert.ok(buildEmailSubject({ requisitionNumber: "REQ-1", originName: "Cocina", destinationName: "Bodega", distributionName: "Evento", priority: "emergency" }).startsWith("EMERGENCIA"));
assert.ok(buildEmailSubject({ requisitionNumber: "REQ-1", originName: "Cocina", destinationName: "Bodega", distributionName: "Verduras", isUpdate: true }).startsWith("ACTUALIZACION"));
assert.equal(isValidEmail("bad\r\nBcc:x@example.test"), false);
assert.equal(isValidEmail("valid@example.test"), true);
assert.equal(hasRequisitionChangedSinceSend(requisition, [{ status: "sent", requisition_revision: 2, sent_at: "2026-08-23T19:00:00Z" }]), true);

const matrix = emailPermissionMatrix();
assert.ok(matrix.requester.includes("email.send"));
assert.equal(matrix.receiver.includes("email.send"), false);
assert.ok(matrix.administrator.includes("email.recipients.manage"));
assert.ok(matrix.manager.includes("email.groups.manage"));

globalThis.Deno = { env: { get: (key) => ({ RESEND_API_KEY: "provider-test-key", REQUISITION_EMAIL_FROM: "sender@example.test" }[key] || "") } };
const originalFetch = globalThis.fetch;
const { ResendEmailProvider } = await import("../supabase/functions/send-requisition-email/provider.ts");
const {
  buildEmailIdempotencyKey,
  buildRecipientFingerprint,
  buildRecipientSnapshots
} = await import("../supabase/functions/send-requisition-email/database.ts");
let providerPayload = null;
globalThis.fetch = async (_url, request) => {
  providerPayload = JSON.parse(request.body);
  return new Response(JSON.stringify({ id: "provider-message-1" }), { status: 200, headers: { "Content-Type": "application/json" } });
};
const providerSuccess = await new ResendEmailProvider().sendEmail({ to: ["valid@example.test"], cc: [], bcc: [], subject: "REQ", html: "<b>ok</b>", idempotencyKey: "idempotency-test" });
assert.equal(providerSuccess.messageId, "provider-message-1");
assert.deepEqual(providerPayload.to, ["valid@example.test"]);
globalThis.fetch = async () => new Response("provider error body", { status: 500 });
await assert.rejects(() => new ResendEmailProvider().sendEmail({ to: ["valid@example.test"], cc: [], bcc: [], subject: "REQ", html: "ok", idempotencyKey: "idempotency-test" }), /proveedor no acepto/i);
globalThis.fetch = originalFetch;

const auditedRecipients = [
  { id: "purchasing", name: "Compras", email: " Compras@example.test ", deliveryType: "to" },
  { id: null, name: "Externo QA", email: "external@example.test", deliveryType: "cc" }
];
const fingerprint = await buildRecipientFingerprint(auditedRecipients);
const idempotencyInput = {
  requisitionId: "req-test",
  revisionNumber: 3,
  distributionGroupId: "vegetables-group",
  recipientFingerprint: fingerprint,
  clientOperationId: "operation-00000001"
};
assert.equal(await buildEmailIdempotencyKey(idempotencyInput), await buildEmailIdempotencyKey(idempotencyInput));
assert.notEqual(
  await buildEmailIdempotencyKey(idempotencyInput),
  await buildEmailIdempotencyKey({ ...idempotencyInput, clientOperationId: "operation-00000002" })
);
const snapshots = buildRecipientSnapshots("send-1", auditedRecipients);
assert.deepEqual(snapshots, [
  {
    send_id: "send-1",
    recipient_id: "purchasing",
    recipient_name_snapshot: "Compras",
    email_snapshot: "compras@example.test",
    delivery_type: "to"
  },
  {
    send_id: "send-1",
    recipient_id: null,
    recipient_name_snapshot: "Externo QA",
    email_snapshot: "external@example.test",
    delivery_type: "cc"
  }
]);

const migration = readFileSync("supabase/migrations/20260823230508_email_distribution.sql", "utf8");
const edge = readFileSync("supabase/functions/send-requisition-email/database.ts", "utf8");
const index = readFileSync("supabase/functions/send-requisition-email/index.ts", "utf8");
const config = readFileSync("supabase/config.toml", "utf8");
assert.ok(migration.includes("enable row level security"));
assert.ok(migration.includes("from public, anon, authenticated"));
assert.equal(migration.includes("using (true)"), false);
assert.ok(migration.includes("email.send_external"));
assert.ok(migration.includes("unique (organization_id, idempotency_key)"));
assert.ok(migration.includes("requisition_email_send_recipients"));
assert.ok(migration.includes("grant select on public.requisition_email_sends"));
assert.equal(migration.includes("grant insert on public.requisition_email_sends"), false);
assert.ok(edge.includes('requirePermission(permissions, "email.send")'));
assert.ok(edge.includes("recipient_not_authorized"));
assert.ok(edge.includes("Idempotency-Key") === false);
assert.ok(index.includes('auth: "user"'));
assert.ok(index.includes("admin: context.supabaseAdmin"));
assert.equal(edge.includes("SUPABASE_SECRET_KEYS"), false);
assert.ok(config.includes("verify_jwt = true"));
assert.equal(/@(aloft|marriott)\./i.test(`${migration}\n${edge}\n${index}`), false);

console.log("Email distribution smoke OK");

function recipient(id, name, email) {
  return { id, name, email, recipient_type: id, department_label: name, active: true };
}

function link(groupId, recipientId, deliveryType) {
  return { id: `${groupId}-${recipientId}`, group_id: groupId, recipient_id: recipientId, delivery_type: deliveryType, default_selected: true, required: false, sort_order: groupRecipientsOrder(recipientId) };
}

function groupRecipientsOrder(id) {
  return ["purchasing", "security", "controller", "warehouse", "costs"].indexOf(id) * 10 + 10;
}
