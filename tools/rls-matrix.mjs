import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
const credentials = JSON.parse(process.env.RLS_USERS_JSON || "{}");
for (const name of ["adminA", "managerA", "requesterA", "receiverA", "requesterB"]) {
  if (!credentials[name]?.email || !credentials[name]?.password) {
    throw new Error(`Faltan credenciales QA para ${name}.`);
  }
}

const actors = Object.fromEntries(
  await Promise.all(Object.entries(credentials).map(async ([name, credential]) => {
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.signInWithPassword(credential);
    if (error) throw new Error(`${name}: ${error.message}`);
    return [name, { client, user: data.user }];
  }))
);

const contexts = {};
for (const [name, actor] of Object.entries(actors)) {
  contexts[name] = await loadContext(actor.client, actor.user.id);
}

assert.equal(contexts.adminA.organizationId, contexts.requesterA.organizationId);
assert.equal(contexts.managerA.organizationId, contexts.requesterA.organizationId);
assert.notEqual(contexts.requesterA.organizationId, contexts.requesterB.organizationId);
assert.ok(contexts.adminA.roles.includes("administrator"));
assert.ok(contexts.managerA.roles.includes("manager"));
assert.ok(contexts.requesterA.roles.includes("requester"));
assert.ok(contexts.receiverA.roles.includes("receiver"));

const requester = contexts.requesterA;
const receiver = contexts.receiverA;
const testId = `req-rls-${Date.now()}`;
const testNumber = `REQ-RLS-${Date.now()}`;
const { data: created, error: createError } = await actors.requesterA.client
  .from("requisitions")
  .insert({
    id: testId,
    workspace_id: "main",
    organization_id: requester.organizationId,
    location_id: requester.locationId,
    department_id: requester.departmentId,
    destination_department_id: receiver.departmentId,
    requested_by_user_id: actors.requesterA.user.id,
    requisition_number: testNumber,
    requested_by: "Solicitante QA A",
    status: "draft",
    original_transcript: "1 kg de producto QA RLS",
    device_info: "phase3-rls-matrix"
  })
  .select("id,organization_id,destination_department_id")
  .single();
assert.ifError(createError);
assert.equal(created.id, testId);

const { error: itemError } = await actors.requesterA.client.from("requisition_items").insert({
  id: `item-${testId}`,
  requisition_id: testId,
  product_name: "Producto QA RLS",
  quantity: 1,
  unit: "kg",
  notes: "",
  original_text: "1 kg de producto QA RLS",
  confidence: 1,
  needs_review: false,
  unit_override: false,
  sort_order: 0
});
assert.ifError(itemError);

await assertVisible(actors.requesterA.client, testId, true, "requester A own");
await assertVisible(actors.receiverA.client, testId, true, "receiver destination");
await assertVisible(actors.managerA.client, testId, true, "manager A");
await assertVisible(actors.adminA.client, testId, true, "admin A");
await assertVisible(actors.requesterB.client, testId, false, "organization B isolation");

const { data: receiverUpdate, error: receiverUpdateError } = await actors.receiverA.client
  .from("requisitions")
  .update({ status: "confirmed" })
  .eq("id", testId)
  .select("id");
assert.equal(receiverUpdateError, null);
assert.equal(receiverUpdate.length, 0, "receiver must not update in Phase 3");

const foreign = contexts.requesterB;
const { error: maliciousError } = await actors.requesterB.client.from("requisitions").insert({
  id: `malicious-${testId}`,
  workspace_id: "main",
  organization_id: requester.organizationId,
  location_id: foreign.locationId,
  department_id: foreign.departmentId,
  requested_by_user_id: actors.requesterB.user.id,
  requisition_number: `MAL-${Date.now()}`,
  requested_by: "Ataque QA",
  status: "draft",
  original_transcript: "foreign ids"
});
assert.ok(maliciousError, "foreign organization IDs must be rejected");

const { data: productsA, error: productsAError } = await actors.requesterA.client
  .from("products").select("id").limit(1);
assert.ifError(productsAError);
assert.equal(productsA.length, 1);
const { data: productsB, error: productsBError } = await actors.requesterB.client
  .from("products").select("id").limit(1);
assert.ifError(productsBError);
assert.equal(productsB.length, 0);

const { error: voidError } = await actors.requesterA.client
  .from("requisitions")
  .update({ status: "voided" })
  .eq("id", testId);
assert.ifError(voidError);

if (process.env.EXPECT_ANON_BLOCKED === "1") {
  const response = await fetch(`${url}/rest/v1/requisitions?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  const body = response.ok ? await response.json() : null;
  assert.ok(!response.ok || body.length === 0, "anonymous role must not read requisitions");
}

console.log(JSON.stringify({
  ok: true,
  testRequisitionId: testId,
  organizations: {
    A: requester.organizationId,
    B: foreign.organizationId
  },
  checks: 16
}));

async function loadContext(client, userId) {
  const { data: membership, error: membershipError } = await client
    .from("organization_memberships")
    .select("id,organization_id")
    .eq("user_id", userId)
    .eq("active", true)
    .single();
  assert.ifError(membershipError);
  const [{ data: roles, error: rolesError }, { data: locations, error: locationsError },
    { data: departments, error: departmentsError }] = await Promise.all([
    client.from("membership_roles").select("role_code").eq("membership_id", membership.id),
    client.from("locations").select("id").eq("organization_id", membership.organization_id).limit(1),
    client.from("departments").select("id,location_id").eq("organization_id", membership.organization_id).limit(1)
  ]);
  assert.ifError(rolesError);
  assert.ifError(locationsError);
  assert.ifError(departmentsError);
  assert.ok(locations.length && departments.length);
  return {
    organizationId: membership.organization_id,
    locationId: departments[0].location_id || locations[0].id,
    departmentId: departments[0].id,
    roles: roles.map((entry) => entry.role_code)
  };
}

async function assertVisible(client, id, expected, label) {
  const { data, error } = await client.from("requisitions").select("id").eq("id", id);
  assert.ifError(error);
  assert.equal(data.length === 1, expected, label);
}
