import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

const SUPABASE_URL = "https://cgfxvrpqcwjafvfcccnj.supabase.co";
const SUPABASE_KEY = "sb_publishable_pe1NEaytwaY1YD-6p10ePg_2fCWJP-K";
const ALOFT_ORGANIZATION_ID = "de18f510-70eb-43b2-b5b9-5c2e595e6eab";
const ALOFT_LOCATION_ID = "c4b55231-dd7a-4c99-a74b-e3ddc7b72e1d";
const COCINA_DEPARTMENT_ID = "bd1d77f4-a428-49fd-bff0-4b812cde909c";
const BODEGA_DEPARTMENT_ID = "3d8ca1f3-9106-4b33-94d2-7f7847b70a0e";
const FOREIGN_ID = "00000000-0000-4000-8000-000000000099";
const QA_ORGANIZATION_ID = "00000000-0000-4000-8000-000000001001";

const output = document.querySelector("#output");
document.querySelector("#run").addEventListener("click", run);
document.querySelector("#runIsolation").addEventListener("click", runIsolation);
document.querySelector("#runAnon").addEventListener("click", runAnon);
document.querySelector("#runCrossUser").addEventListener("click", runCrossUser);

async function runCrossUser() {
  const report = { startedAt: new Date().toISOString(), checks: [] };
  const marker = `Tomate QA local ${Date.now()}`;
  output.textContent = "Running cross-user local test...";
  try {
    const frame = document.createElement("iframe");
    frame.title = "Cross-user application test";
    frame.style.width = "390px";
    frame.style.height = "720px";
    frame.src = `../index.html?rc-cross-user=${Date.now()}`;
    document.querySelector("#frameHost").replaceChildren(frame);
    await waitUntil(() => frame.contentDocument?.readyState === "complete", "frame load");
    const app = frame.contentWindow;
    app.confirm = () => true;

    await ensureLoggedOut(app);
    await loginInApp(app, "requester");
    pass(report, "cross-user.requester-login");
    await click(app, "[data-target='new']");
    await click(app, "[data-new-order]");
    const transcript = app.document.querySelector("#transcriptInput");
    transcript.value = `1 kg de tomate, observación ${marker}`;
    transcript.dispatchEvent(new Event("input", { bubbles: true }));
    await click(app, "#processTranscriptButton");
    await waitUntil(() => Number(app.document.querySelector("#itemCount")?.textContent) === 1, "requester draft item");
    assert(app.document.body.textContent.includes("Tomate"), "cross-user.requester-draft-created");
    pass(report, "cross-user.requester-draft-created");

    await logoutInApp(app);
    await loginInApp(app, "receiver");
    await click(app, "[data-target='new']");
    assert(!app.document.body.textContent.includes(marker), "cross-user.receiver-private-draft-hidden");
    pass(report, "cross-user.receiver-private-draft-hidden");

    await logoutInApp(app);
    await loginInApp(app, "requester");
    await click(app, "[data-target='new']");
    await waitUntil(() => app.document.body.textContent.includes("Tomate"), "requester draft restored");
    pass(report, "cross-user.requester-draft-restored");
    report.ok = true;
    report.finishedAt = new Date().toISOString();
  } catch (error) {
    report.ok = false;
    report.failure = safeError(error);
  }
  output.textContent = JSON.stringify(report, null, 2);
}

async function ensureLoggedOut(app) {
  await waitUntil(() => app.document.querySelector("#authGate") || app.document.querySelector("#appShell"), "app boot");
  if (!app.document.querySelector("#appShell")?.hidden) await logoutInApp(app);
  await waitUntil(() => !app.document.querySelector("#authGate")?.hidden, "login screen");
}

async function loginInApp(app, role) {
  await waitUntil(() => !app.document.querySelector("#authGate")?.hidden, `${role} login screen`);
  app.document.querySelector("#loginEmail").value = value(`${role}Email`);
  app.document.querySelector("#loginPassword").value = value(`${role}Password`);
  app.document.querySelector("#loginForm").requestSubmit();
  await waitUntil(() => !app.document.querySelector("#appShell")?.hidden, `${role} app activation`, 30000);
  assert(app.document.querySelector("#identityName")?.textContent.includes(role === "requester" ? "Requester" : "Receiver"), `${role} identity`);
}

async function logoutInApp(app) {
  await click(app, "#profileButton");
  await click(app, "#logoutButton");
  await waitUntil(() => !app.document.querySelector("#authGate")?.hidden, "logout", 15000);
}

async function click(app, selector) {
  await waitUntil(() => app.document.querySelector(selector), `element ${selector}`);
  app.document.querySelector(selector).click();
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function waitUntil(predicate, label, timeout = 15000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error(`${label}: timeout`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function runAnon() {
  const report = { startedAt: new Date().toISOString(), checks: [], visible: {} };
  output.textContent = "Running anonymous cutoff...";
  try {
    const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    for (const table of ["products", "requisitions", "requisition_items", "requisition_changes"]) {
      const result = await client.from(table).select("id").limit(1);
      report.visible[table] = result.error ? 0 : (result.data || []).length;
      equal(report.visible[table], 0, `anon.${table}.select`);
      pass(report, `anon.${table}.select-zero`);
    }

    const product = {
      id: `qa-anon-${Date.now()}`, workspace_id: "main", code: `QA-ANON-${Date.now()}`,
      official_name: "QA anonymous denied", category: "QA", default_unit: "und",
      allowed_units: ["und"], synonyms: [], active: true, organization_id: ALOFT_ORGANIZATION_ID
    };
    await mustError(report, "anon.product.insert", client.from("products").insert(product));
    await mustError(report, "anon.product.update", client.from("products").update({ active: false }).eq("id", "prod-fru-001"));
    await mustError(report, "anon.product.delete", client.from("products").delete().eq("id", "prod-fru-001"));

    const requisition = baseRequisition({
      id: `qa-anon-req-${Date.now()}`, requestedByUserId: FOREIGN_ID,
      departmentId: COCINA_DEPARTMENT_ID, destinationId: BODEGA_DEPARTMENT_ID
    });
    await mustError(report, "anon.requisition.insert", client.from("requisitions").insert(requisition));
    await mustError(report, "anon.requisition.update", client.from("requisitions").update({ priority: "urgent" }).eq("id", "req-rc-never"));
    await mustError(report, "anon.requisition.delete", client.from("requisitions").delete().eq("id", "req-rc-never"));
    report.ok = true;
    report.finishedAt = new Date().toISOString();
  } catch (error) {
    report.ok = false;
    report.failure = safeError(error);
  }
  output.textContent = JSON.stringify(report, null, 2);
}

async function runIsolation() {
  const report = { startedAt: new Date().toISOString(), checks: [] };
  output.textContent = "Running isolation...";
  try {
    const manager = await login("manager");
    const requester = await login("requester");
    const managerOrganizations = await rows(manager.client.from("organizations").select("id"), "isolation.manager-organizations");
    assert(managerOrganizations.some((row) => row.id === QA_ORGANIZATION_ID), "isolation.manager-qa-visible");
    assert(!managerOrganizations.some((row) => row.id === ALOFT_ORGANIZATION_ID), "isolation.manager-aloft-denied");
    const managerAloftProducts = await rows(manager.client.from("products").select("id").eq("organization_id", ALOFT_ORGANIZATION_ID), "isolation.manager-aloft-products");
    equal(managerAloftProducts.length, 0, "isolation.manager-aloft-products-denied");
    const managerAloftRequisitions = await rows(manager.client.from("requisitions").select("id").eq("organization_id", ALOFT_ORGANIZATION_ID), "isolation.manager-aloft-requisitions");
    equal(managerAloftRequisitions.length, 0, "isolation.manager-aloft-requisitions-denied");
    pass(report, "qa-user-to-aloft-denied");

    const requesterOrganizations = await rows(requester.client.from("organizations").select("id"), "isolation.requester-organizations");
    assert(requesterOrganizations.some((row) => row.id === ALOFT_ORGANIZATION_ID), "isolation.requester-aloft-visible");
    assert(!requesterOrganizations.some((row) => row.id === QA_ORGANIZATION_ID), "isolation.requester-qa-denied");
    const requesterQaProducts = await rows(requester.client.from("products").select("id").eq("organization_id", QA_ORGANIZATION_ID), "isolation.requester-qa-products");
    equal(requesterQaProducts.length, 0, "isolation.requester-qa-products-denied");
    pass(report, "aloft-user-to-qa-denied");
    report.ok = true;
    report.finishedAt = new Date().toISOString();
  } catch (error) {
    report.ok = false;
    report.failure = safeError(error);
  }
  output.textContent = JSON.stringify(report, null, 2);
}

async function run() {
  const report = { startedAt: new Date().toISOString(), checks: [], requisitionId: "" };
  output.textContent = "Running...";
  try {
    const actors = {};
    for (const role of ["manager", "requester", "receiver"]) {
      actors[role] = await login(role);
      pass(report, `${role}.login`);
      await verifyContext(report, role, actors[role]);
    }

    await verifyRoleBoundaries(report, actors);
    await runWorkflow(report, actors);
    report.finishedAt = new Date().toISOString();
    report.ok = report.checks.every((check) => check.result === "PASS");
  } catch (error) {
    report.ok = false;
    report.failure = safeError(error);
  }
  output.textContent = JSON.stringify(report, null, 2);
}

async function login(role) {
  const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const email = value(`${role}Email`);
  const password = value(`${role}Password`);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`${role}.login: ${error?.message || "missing user"}`);
  return { client, user: data.user };
}

async function verifyContext(report, role, actor) {
  const membership = await one(actor.client.from("organization_memberships")
    .select("id,organization_id").eq("user_id", actor.user.id).eq("active", true), `${role}.membership`);
  equal(membership.organization_id, ALOFT_ORGANIZATION_ID, `${role}.organization`);
  const roleRows = await rows(actor.client.from("membership_roles").select("role_code")
    .eq("membership_id", membership.id), `${role}.roles`);
  assert(roleRows.some((row) => row.role_code === role), `${role}.role`);
  pass(report, `${role}.context`);

  const locations = await rows(actor.client.from("locations").select("id").eq("id", ALOFT_LOCATION_ID), `${role}.location`);
  equal(locations.length, 1, `${role}.location visible`);
  const products = await rows(actor.client.from("products").select("id").limit(1), `${role}.catalog`);
  equal(products.length, 1, `${role}.catalog read`);
  pass(report, `${role}.catalog-read`);
}

async function verifyRoleBoundaries(report, actors) {
  const requester = actors.requester.client;
  await denied(report, "requester.catalog-manage", () => requester.from("products").insert({
    id: `qa-denied-${Date.now()}`, workspace_id: "main", code: `QA-DENIED-${Date.now()}`,
    official_name: "QA denied product", category: "QA", default_unit: "kg",
    allowed_units: ["kg"], synonyms: [], active: true, organization_id: ALOFT_ORGANIZATION_ID
  }).select("id"));
  await denied(report, "requester.organization-update", () => requester.from("organizations")
    .update({ name: "QA unauthorized rename" }).eq("id", ALOFT_ORGANIZATION_ID).select("id"));
  await denied(report, "requester.roles-manage", () => requester.from("membership_roles").insert({
    membership_id: FOREIGN_ID, organization_id: ALOFT_ORGANIZATION_ID,
    user_id: actors.requester.user.id, role_code: "administrator"
  }).select("membership_id"));

  const receiver = actors.receiver.client;
  await denied(report, "receiver.requester-action", () => receiver.from("requisitions").insert(baseRequisition({
    id: `qa-rx-denied-${Date.now()}`, requestedByUserId: actors.receiver.user.id,
    departmentId: BODEGA_DEPARTMENT_ID, destinationId: COCINA_DEPARTMENT_ID
  })).select("id"));
  await denied(report, "receiver.users-manage", () => receiver.from("organization_memberships").insert({
    organization_id: ALOFT_ORGANIZATION_ID, user_id: FOREIGN_ID, active: true
  }).select("id"));

  const manager = actors.manager.client;
  const reportRows = await rows(manager.from("requisitions").select("id").limit(1), "manager.reports");
  assert(Array.isArray(reportRows), "manager.reports");
  pass(report, "manager.reports-read");
  await denied(report, "manager.role-escalation", () => manager.from("membership_roles").insert({
    membership_id: FOREIGN_ID, organization_id: ALOFT_ORGANIZATION_ID,
    user_id: actors.manager.user.id, role_code: "administrator"
  }).select("membership_id"));
  await denied(report, "manager.organization-external", () => manager.from("organizations")
    .select("id").eq("id", FOREIGN_ID).single(), { allowEmpty: false });
}

async function runWorkflow(report, actors) {
  const stamp = Date.now();
  const requisitionId = `req-rc-e2e-${stamp}`;
  report.requisitionId = requisitionId;
  const requester = actors.requester.client;
  const receiver = actors.receiver.client;

  const numberResult = await requester.rpc("next_requisition_number", { target_organization_id: ALOFT_ORGANIZATION_ID });
  if (numberResult.error) throw new Error(`number: ${numberResult.error.message}`);
  let insertResult = await requester.from("requisitions").insert(baseRequisition({
    id: requisitionId,
    number: numberResult.data,
    requestedByUserId: actors.requester.user.id,
    departmentId: COCINA_DEPARTMENT_ID,
    destinationId: BODEGA_DEPARTMENT_ID
  })).select("id,revision_number").single();
  if (insertResult.error?.code === "23505") {
    insertResult = await requester.from("requisitions").insert(baseRequisition({
      id: requisitionId,
      number: `REQ-RC-E2E-${stamp}`,
      requestedByUserId: actors.requester.user.id,
      departmentId: COCINA_DEPARTMENT_ID,
      destinationId: BODEGA_DEPARTMENT_ID
    })).select("id,revision_number").single();
    pass(report, "requester.number-conflict-fallback");
  }
  if (insertResult.error) throw new Error(`requester.create: ${insertResult.error.message}`);
  pass(report, "requester.requisition-create");

  const itemIds = [`item-rc-chicken-${stamp}`, `item-rc-tomato-${stamp}`, `item-rc-scallion-${stamp}`];
  const items = [
    item(itemIds[0], requisitionId, "Pechuga de pollo", 10, "kg"),
    item(itemIds[1], requisitionId, "Tomate", 5, "kg"),
    item(itemIds[2], requisitionId, "Cebollín", 3, "rollo")
  ];
  const itemsInsert = await requester.from("requisition_items").insert(items);
  if (itemsInsert.error) throw new Error(`requester.items: ${itemsInsert.error.message}`);
  pass(report, "requester.items-create");

  await denied(report, "requester.idor-organization", () => requester.from("requisitions")
    .update({ organization_id: FOREIGN_ID }).eq("id", requisitionId).select("id"));
  await denied(report, "requester.idor-location", () => requester.from("requisitions")
    .update({ location_id: FOREIGN_ID }).eq("id", requisitionId).select("id"));
  await denied(report, "requester.idor-requester", () => requester.from("requisitions")
    .update({ requested_by_user_id: actors.receiver.user.id }).eq("id", requisitionId).select("id"));
  await denied(report, "requester.invalid-draft-delivered", () => requester.from("requisitions")
    .update({ status: "delivered" }).eq("id", requisitionId));

  await updateOne(requester.from("requisitions").update({ status: "submitted" }).eq("id", requisitionId)
    .select("id,submitted_at,revision_number"), "requester.submit");
  pass(report, "requester.submit");

  const receiverVisible = await rows(receiver.from("requisitions").select("id").eq("id", requisitionId), "receiver.visible");
  equal(receiverVisible.length, 1, "receiver.incoming-visible");
  pass(report, "receiver.incoming-visible");
  await denied(report, "receiver.invalid-submitted-closed", () => receiver.from("requisitions")
    .update({ status: "closed" }).eq("id", requisitionId));
  await updateOne(receiver.from("requisitions").update({ status: "received" }).eq("id", requisitionId)
    .select("id,received_at,revision_number"), "receiver.received");
  await updateOne(receiver.from("requisitions").update({ status: "preparing" }).eq("id", requisitionId)
    .select("id,preparing_at,revision_number"), "receiver.preparing");

  await updateOne(receiver.from("requisition_items").update({
    delivered_quantity: 4, fulfillment_status: "partial", notes: "QA entrega parcial"
  }).eq("id", itemIds[1]).select("id"), "receiver.partial");
  await updateOne(receiver.from("requisition_items").update({
    delivered_quantity: 0, fulfillment_status: "unavailable", unavailable_reason: "QA sin existencia"
  }).eq("id", itemIds[2]).select("id"), "receiver.unavailable");
  await updateOne(receiver.from("requisition_items").update({
    delivered_quantity: 10, fulfillment_status: "delivered"
  }).eq("id", itemIds[0]).select("id"), "receiver.delivered-item");
  pass(report, "receiver.fulfillment");

  await updateOne(receiver.from("requisitions").update({ status: "partial" }).eq("id", requisitionId)
    .select("id,revision_number"), "receiver.partial-status");
  await updateOne(receiver.from("requisitions").update({ status: "delivered" }).eq("id", requisitionId)
    .select("id,delivered_at,revision_number"), "receiver.delivered");
  pass(report, "receiver.workflow");

  const deliveredItems = await rows(requester.from("requisition_items")
    .select("id,delivered_quantity,fulfillment_status,unavailable_reason,notes")
    .eq("requisition_id", requisitionId), "requester.delivery-view");
  equal(deliveredItems.length, 3, "requester.delivery-lines");
  assert(deliveredItems.some((row) => row.fulfillment_status === "partial"), "requester.partial-visible");
  assert(deliveredItems.some((row) => row.fulfillment_status === "unavailable"), "requester.unavailable-visible");
  pass(report, "requester.delivery-visible");

  await updateOne(requester.from("requisitions").update({ status: "accepted" }).eq("id", requisitionId)
    .select("id,accepted_at,revision_number"), "requester.accepted");
  await updateOne(requester.from("requisitions").update({ status: "closed" }).eq("id", requisitionId)
    .select("id,closed_at,revision_number"), "requester.closed");
  await denied(report, "requester.invalid-closed-preparing", () => requester.from("requisitions")
    .update({ status: "preparing" }).eq("id", requisitionId));

  const audit = await rows(requester.from("requisition_changes")
    .select("action,changed_by_user_id,new_value,changed_at").eq("requisition_id", requisitionId), "audit");
  const workflowActors = new Set(audit.filter((row) => row.action === "workflow_transition").map((row) => row.changed_by_user_id));
  assert(workflowActors.has(actors.requester.user.id), "audit.requester");
  assert(workflowActors.has(actors.receiver.user.id), "audit.receiver");
  assert(audit.filter((row) => row.action === "workflow_transition").length >= 7, "audit.transitions");
  pass(report, "workflow.audit");

  const finalRow = await one(requester.from("requisitions")
    .select("status,submitted_at,received_at,preparing_at,delivered_at,accepted_at,closed_at,revision_number")
    .eq("id", requisitionId), "workflow.final");
  equal(finalRow.status, "closed", "workflow.closed");
  for (const field of ["submitted_at", "received_at", "preparing_at", "delivered_at", "accepted_at", "closed_at"]) {
    assert(Boolean(finalRow[field]), `workflow.${field}`);
  }
  pass(report, "workflow.e2e");
}

function baseRequisition({ id, number = `REQ-RC-${Date.now()}`, requestedByUserId, departmentId, destinationId }) {
  return {
    id, workspace_id: "main", organization_id: ALOFT_ORGANIZATION_ID,
    location_id: ALOFT_LOCATION_ID, department_id: departmentId,
    destination_department_id: destinationId, requested_by_user_id: requestedByUserId,
    requisition_number: number, requested_by: "QA RC Requester", requested_by_name: "QA RC Requester",
    required_at: new Date(Date.now() + 86_400_000).toISOString(), priority: "normal",
    status: "draft", original_transcript: "10 kg Pechuga de pollo, 5 kg Tomate, 3 rollos Cebollín",
    device_info: "rc-live-harness"
  };
}

function item(id, requisitionId, productName, quantity, unit) {
  return {
    id, requisition_id: requisitionId, product_name: productName, quantity,
    requested_quantity: quantity, delivered_quantity: 0, fulfillment_status: "requested",
    unit, notes: "", unavailable_reason: "", original_text: `${quantity} ${unit} ${productName}`,
    confidence: 1, needs_review: false, unit_override: false, sort_order: 0
  };
}

async function denied(report, name, operation, options = {}) {
  const result = await operation();
  const emptyDenied = !result.error && Array.isArray(result.data) && result.data.length === 0;
  if (!result.error && !emptyDenied) throw new Error(`${name}: operation unexpectedly allowed`);
  pass(report, name);
}

async function rows(builder, label) {
  const { data, error } = await builder;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data || [];
}

async function one(builder, label) {
  const { data, error } = await builder.single();
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function updateOne(builder, label) {
  const { data, error } = await builder;
  if (error) throw new Error(`${label}: ${error.message}`);
  if (!Array.isArray(data) || data.length !== 1) throw new Error(`${label}: no row updated`);
  return data[0];
}

async function mustError(report, name, builder) {
  const { error } = await builder;
  if (!error) throw new Error(`${name}: operation unexpectedly allowed`);
  pass(report, name);
}

function pass(report, name) {
  report.checks.push({ name, result: "PASS" });
}

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function equal(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function value(id) {
  return document.querySelector(`#${id}`).value;
}

function safeError(error) {
  return String(error?.message || error).replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}
