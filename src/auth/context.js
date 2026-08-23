import { getSupabaseClient } from "./client.js?v=2.0.0-beta.3";

export class UserContextError extends Error {
  constructor(message, code = "context_error") {
    super(message);
    this.name = "UserContextError";
    this.code = code;
  }
}

export async function loadUserContext(session, cachedContext = null) {
  const userId = session?.user?.id;
  if (!userId) throw new UserContextError("No hay un usuario autenticado.", "user_missing");
  if (!navigator.onLine && cachedContext?.userId === userId) {
    return validateCachedContext(cachedContext);
  }

  const client = getSupabaseClient();
  const [profileResult, membershipsResult, rolesResult] = await Promise.all([
    client.from("profiles").select("id,display_name,first_name,last_name,active").eq("id", userId).single(),
    client.from("organization_memberships").select("id,organization_id,user_id,active").eq("user_id", userId).eq("active", true),
    client.from("membership_roles").select("membership_id,organization_id,user_id,role_code").eq("user_id", userId)
  ]);
  throwIfQueryFailed(profileResult.error, "No se pudo cargar el perfil.");
  throwIfQueryFailed(membershipsResult.error, "No se pudieron cargar las organizaciones.");
  throwIfQueryFailed(rolesResult.error, "No se pudieron cargar los roles.");
  if (!profileResult.data?.active) throw new UserContextError("Este usuario está inactivo.", "inactive_user");
  if (!membershipsResult.data?.length) {
    throw new UserContextError("El usuario no tiene una organización asignada.", "membership_missing");
  }

  const organizationIds = membershipsResult.data.map((entry) => entry.organization_id);
  const [organizationsResult, locationsResult, departmentsResult, locationMembershipsResult,
    departmentMembershipsResult, rolePermissionsResult] = await Promise.all([
    client.from("organizations").select("id,name,slug,active").in("id", organizationIds),
    client.from("locations").select("id,organization_id,name,code,timezone,active").in("organization_id", organizationIds).eq("active", true),
    client.from("departments").select("id,organization_id,location_id,name,code,active").in("organization_id", organizationIds).eq("active", true),
    client.from("location_memberships").select("organization_id,location_id,user_id,active").eq("user_id", userId).eq("active", true),
    client.from("department_memberships").select("organization_id,location_id,department_id,user_id,active").eq("user_id", userId).eq("active", true),
    client.from("role_permissions").select("role_code,permission_code")
  ]);
  for (const [result, message] of [
    [organizationsResult, "No se pudieron cargar las organizaciones."],
    [locationsResult, "No se pudieron cargar las sedes."],
    [departmentsResult, "No se pudieron cargar los departamentos."],
    [locationMembershipsResult, "No se pudieron validar las sedes asignadas."],
    [departmentMembershipsResult, "No se pudieron validar los departamentos asignados."],
    [rolePermissionsResult, "No se pudieron cargar los permisos."]
  ]) throwIfQueryFailed(result.error, message);

  const organizations = organizationsResult.data || [];
  const preferredOrganizationId = cachedContext?.organizationId;
  const organization = organizations.find((entry) => entry.id === preferredOrganizationId) || organizations[0];
  if (!organization) throw new UserContextError("No hay una organización activa disponible.");
  const roles = rolesResult.data
    .filter((entry) => entry.organization_id === organization.id)
    .map((entry) => entry.role_code);
  const isBroadRole = roles.includes("administrator") || roles.includes("manager");
  const explicitLocationIds = locationMembershipsResult.data
    .filter((entry) => entry.organization_id === organization.id)
    .map((entry) => entry.location_id);
  const explicitDepartmentIds = departmentMembershipsResult.data
    .filter((entry) => entry.organization_id === organization.id)
    .map((entry) => entry.department_id);
  const allLocations = (locationsResult.data || []).filter((entry) => entry.organization_id === organization.id);
  const locations = isBroadRole
    ? allLocations
    : allLocations.filter((entry) => explicitLocationIds.includes(entry.id) || departmentMembershipsResult.data.some((membership) => membership.location_id === entry.id));
  const location = locations.find((entry) => entry.id === cachedContext?.locationId) || locations[0];
  if (!location) throw new UserContextError("El usuario no tiene una sede activa asignada.", "location_missing");
  const organizationDepartments = (departmentsResult.data || []).filter((entry) => entry.organization_id === organization.id);
  const departments = isBroadRole
    ? organizationDepartments
    : organizationDepartments.filter((entry) => explicitDepartmentIds.includes(entry.id));
  const locationDepartments = departments.filter((entry) => entry.location_id === location.id);
  const department = locationDepartments.find((entry) => entry.id === cachedContext?.departmentId) || locationDepartments[0];
  if (!department) throw new UserContextError("El usuario no tiene un departamento activo asignado.", "department_missing");
  const permissions = [...new Set((rolePermissionsResult.data || [])
    .filter((entry) => roles.includes(entry.role_code))
    .map((entry) => entry.permission_code))];

  return {
    userId,
    email: session.user.email || "",
    profile: profileResult.data,
    displayName: profileResult.data.display_name,
    organizations,
    organizationId: organization.id,
    organization,
    locations,
    locationId: location.id,
    location,
    departments,
    departmentIds: departments.map((entry) => entry.id),
    departmentId: department.id,
    department,
    roles,
    permissions,
    loadedAt: new Date().toISOString()
  };
}

export function selectActiveContext(context, selection = {}) {
  const organization = context.organizations.find((entry) => entry.id === selection.organizationId) || context.organization;
  const locations = context.locations.filter((entry) => entry.organization_id === organization.id);
  const location = locations.find((entry) => entry.id === selection.locationId) || locations[0];
  const departments = context.departments.filter((entry) => entry.organization_id === organization.id && entry.location_id === location?.id);
  const department = departments.find((entry) => entry.id === selection.departmentId) || departments[0];
  if (!location || !department) throw new UserContextError("La selección ya no está autorizada.", "selection_invalid");
  return {
    ...context,
    organizationId: organization.id,
    organization,
    locationId: location.id,
    location,
    departmentId: department.id,
    department,
    departmentIds: departments.map((entry) => entry.id)
  };
}

function validateCachedContext(context) {
  if (!context.organizationId || !context.locationId || !context.departmentId || !context.displayName) {
    throw new UserContextError("El contexto offline guardado está incompleto.", "cached_context_invalid");
  }
  return { ...context, offline: true };
}

function throwIfQueryFailed(error, message) {
  if (!error) return;
  const contextError = new UserContextError(message, error.code || "query_failed");
  contextError.technical = error.message || "";
  throw contextError;
}
