export const PERMISSIONS = Object.freeze({
  manageOrganization: "org.manage",
  manageLocations: "locations.manage",
  manageDepartments: "departments.manage",
  manageUsers: "users.manage",
  readCatalog: "catalog.read",
  manageCatalog: "catalog.manage",
  createRequisitions: "requisitions.create",
  readRequisitions: "requisitions.read",
  updateRequisitions: "requisitions.update",
  receiveRequisitions: "requisitions.receive",
  readReports: "reports.read",
  technicalConfig: "config.technical"
});

export function hasPermission(context, permission) {
  return Boolean(context?.permissions?.includes(permission));
}

export function hasRole(context, role) {
  return Boolean(context?.roles?.includes(role));
}

export function canSeeRequisitionLocally(context, requisition) {
  if (!context || !requisition) return false;
  const organizationId = requisition.organizationId || requisition.organization_id;
  if (organizationId !== context.organizationId) return false;
  const locationId = requisition.locationId || requisition.location_id;
  const destinationId = requisition.destinationDepartmentId || requisition.destination_department_id;
  const isAssignedDestination = hasRole(context, "receiver") && context.departmentIds.includes(destinationId);
  if (locationId && locationId !== context.locationId && !hasRole(context, "administrator") && !isAssignedDestination) return false;
  if (hasRole(context, "administrator") || hasRole(context, "manager")) return true;
  const requestedByUserId = requisition.requestedByUserId || requisition.requested_by_user_id;
  if (requestedByUserId === context.userId) return true;
  const departmentId = requisition.departmentId || requisition.department_id;
  if (context.departmentIds.includes(departmentId)) return true;
  return isAssignedDestination;
}
