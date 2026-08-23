import assert from "node:assert/strict";
import {
  allowedTransitions,
  canTransition,
  deriveRequisitionFulfillmentStatus,
  resolveRequiredAt,
  transitionRequisition,
  updateItemFulfillment
} from "../src/workflow.js";

assert.equal(canTransition("draft", "submitted"), true);
assert.equal(canTransition("draft", "delivered"), false);
assert.deepEqual(allowedTransitions("accepted"), ["closed"]);
const requisition = { status: "draft", revisionNumber: 1 };
transitionRequisition(requisition, "submitted", { now: "2026-08-23T12:00:00.000Z" });
assert.equal(requisition.status, "submitted");
assert.equal(requisition.submittedAt, "2026-08-23T12:00:00.000Z");
assert.equal(requisition.revisionNumber, 2);
assert.throws(() => transitionRequisition(requisition, "delivered"), /No se permite/);

const item = { quantity: 10, requestedQuantity: 10, unit: "kg" };
updateItemFulfillment(item, { deliveredQuantity: 7, fulfillmentStatus: "partial" });
assert.equal(item.deliveredQuantity, 7);
assert.equal(deriveRequisitionFulfillmentStatus([item]), "partial");
assert.throws(
  () => updateItemFulfillment({ quantity: 10 }, { deliveredQuantity: 11, fulfillmentStatus: "partial" }),
  /superar/
);
assert.throws(
  () => updateItemFulfillment({ quantity: 10 }, { fulfillmentStatus: "unavailable" }),
  /razón/
);
const delivered = { quantity: 5 };
updateItemFulfillment(delivered, { fulfillmentStatus: "delivered" });
assert.equal(delivered.deliveredQuantity, 5);
assert.equal(deriveRequisitionFulfillmentStatus([delivered]), "delivered");

const tomorrow = resolveRequiredAt("tomorrow-am", new Date("2026-08-23T10:00:00-06:00"));
assert.ok(tomorrow.startsWith("2026-08-24"));

console.log("Workflow smoke OK");

