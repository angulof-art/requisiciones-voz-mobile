import assert from "node:assert/strict";
import { buildOperationalReport } from "../src/reports.js";

const requisitions = [
  {
    id: "r1", status: "closed", priority: "urgent", departmentId: "kitchen", locationId: "location-a",
    createdAt: "2026-08-23T12:00:00Z", submittedAt: "2026-08-23T12:00:00Z", deliveredAt: "2026-08-23T14:00:00Z",
    items: [{ productId: "tomato", productName: "Tomate", unit: "kg", quantity: 10, requestedQuantity: 10, fulfillmentStatus: "delivered" }]
  },
  {
    id: "r2", status: "partial", priority: "normal", departmentId: "kitchen", destinationDepartmentId: "warehouse", locationId: "location-b",
    createdAt: "2026-08-22T12:00:00Z",
    items: [{ productId: "tomato", productName: "Tomate", unit: "kg", quantity: 5, requestedQuantity: 5, fulfillmentStatus: "unavailable" }]
  }
];

const report = buildOperationalReport(requisitions, {}, { departments: [{ id: "kitchen", name: "Cocina" }] });
assert.equal(report.kpis.partial, 1);
assert.equal(report.kpis.delivered, 1);
assert.equal(report.kpis.urgent, 1);
assert.equal(report.kpis.unavailable, 1);
assert.equal(report.kpis.averageAttentionHours, 2);
assert.equal(report.requestedProducts[0].value, 15);
assert.equal(report.departments[0].fulfillmentPercent, 50);
assert.equal(buildOperationalReport(requisitions, { status: "closed" }).rows.length, 1);
assert.equal(buildOperationalReport(requisitions, { locationId: "location-a" }).rows.length, 1);
assert.equal(buildOperationalReport(requisitions, { departmentId: "warehouse" }).rows.length, 1);
assert.equal(buildOperationalReport(requisitions, { dateFrom: "2026-08-23", dateTo: "2026-08-23" }).rows.length, 1);
console.log("Reports smoke OK");
