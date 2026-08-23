import assert from "node:assert/strict";
import { selectActiveContext } from "../src/auth/context.js";
import {
  canSeeRequisitionLocally,
  hasPermission,
  hasRole
} from "../src/auth/permissions.js";

const orgA = "00000000-0000-4000-8000-00000000000a";
const orgB = "00000000-0000-4000-8000-00000000000b";
const locationA = "00000000-0000-4000-8000-00000000001a";
const locationA2 = "00000000-0000-4000-8000-00000000002a";
const departmentA = "00000000-0000-4000-8000-00000000003a";
const departmentA2 = "00000000-0000-4000-8000-00000000004a";

const requester = makeContext({ roles: ["requester"], userId: "user-requester" });
const receiver = makeContext({ roles: ["receiver"], userId: "user-receiver" });
const manager = makeContext({ roles: ["manager"], userId: "user-manager" });
const administrator = makeContext({ roles: ["administrator"], userId: "user-admin" });

const ownRequest = makeRequisition({ requestedByUserId: requester.userId });
const departmentRequest = makeRequisition({ requestedByUserId: "another-user" });
const destinationRequest = makeRequisition({
  requestedByUserId: "another-user",
  locationId: locationA2,
  departmentId: departmentA2,
  destinationDepartmentId: departmentA
});
const foreignRequest = makeRequisition({ organizationId: orgB });

assert.equal(canSeeRequisitionLocally(requester, ownRequest), true);
assert.equal(canSeeRequisitionLocally(requester, departmentRequest), true);
assert.equal(canSeeRequisitionLocally(receiver, destinationRequest), true);
assert.equal(canSeeRequisitionLocally(manager, departmentRequest), true);
assert.equal(canSeeRequisitionLocally(administrator, departmentRequest), true);
assert.equal(canSeeRequisitionLocally(administrator, foreignRequest), false);
assert.equal(canSeeRequisitionLocally(requester, foreignRequest), false);
assert.equal(hasRole(administrator, "administrator"), true);
assert.equal(hasPermission(requester, "requisitions.create"), true);
assert.equal(hasPermission(requester, "config.technical"), false);

const switched = selectActiveContext(
  {
    ...administrator,
    organizations: [{ id: orgA, name: "A" }],
    organization: { id: orgA, name: "A" },
    locations: [
      { id: locationA, organization_id: orgA, name: "Sede A" },
      { id: locationA2, organization_id: orgA, name: "Sede A2" }
    ],
    location: { id: locationA, organization_id: orgA, name: "Sede A" },
    departments: [
      { id: departmentA, organization_id: orgA, location_id: locationA, name: "Cocina" },
      { id: departmentA2, organization_id: orgA, location_id: locationA2, name: "Bodega" }
    ],
    department: { id: departmentA, organization_id: orgA, location_id: locationA, name: "Cocina" }
  },
  { organizationId: orgA, locationId: locationA2, departmentId: departmentA2 }
);
assert.equal(switched.locationId, locationA2);
assert.equal(switched.departmentId, departmentA2);

console.log("Auth and permissions smoke OK");

function makeContext({ roles, userId }) {
  return {
    userId,
    organizationId: orgA,
    locationId: locationA,
    departmentId: departmentA,
    departmentIds: [departmentA],
    roles,
    permissions: roles.includes("requester") ? ["requisitions.create"] : []
  };
}

function makeRequisition(overrides = {}) {
  return {
    id: "req-test",
    organizationId: orgA,
    locationId: locationA,
    departmentId: departmentA,
    destinationDepartmentId: "",
    requestedByUserId: "another-user",
    ...overrides
  };
}
