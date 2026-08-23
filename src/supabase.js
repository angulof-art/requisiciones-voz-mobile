import { normalizeRequisition } from "./requisitions.js?v=2.0.0-beta.2";

const REST_PATH = "/rest/v1";
const TABLES = ["products", "requisitions", "requisition_items", "requisition_changes"];
let activeSession = null;
let activeContext = null;

export function setSupabaseSessionContext(session, context) {
  activeSession = session || null;
  activeContext = context || null;
}

export function normalizeSupabaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    url.pathname = url.pathname.replace(/\/+$/g, "").replace(/\/rest\/v1$/i, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/g, "");
  } catch {
    return withProtocol.replace(/\/+$/g, "").replace(/\/rest\/v1$/i, "");
  }
}

export function validatePublishableKey(value) {
  const key = String(value || "").trim();
  const lower = key.toLowerCase();
  if (!key) {
    return {
      ok: false,
      message: "Falta la publishable key de Supabase.",
      technical: "Campo vacio."
    };
  }
  if (lower.includes("service_role") || lower.startsWith("sb_secret_") || lower.includes("secret")) {
    return {
      ok: false,
      message: "Pegaste una llave secreta. Usa solo publishable key o anon public.",
      technical: "La llave parece secret o service_role."
    };
  }
  if (lower.startsWith("sb_publishable_")) return { ok: true, kind: "publishable" };
  if (key.startsWith("eyJ")) {
    const payload = decodeJwtPayload(key);
    if (payload?.role === "anon") return { ok: true, kind: "legacy-anon" };
    return {
      ok: false,
      message: "La llave JWT no es anon public.",
      technical: `Rol detectado: ${payload?.role || "desconocido"}.`
    };
  }
  return {
    ok: false,
    message: "La llave no parece una publishable key valida.",
    technical: "Debe iniciar con sb_publishable_ o ser una JWT anon legacy."
  };
}

export function isSupabaseReady(settings) {
  return Boolean(
    settings?.enabled &&
      normalizeSupabaseUrl(settings.url) &&
      validatePublishableKey(settings.publishableKey).ok
  );
}

export async function testSupabase(settings) {
  for (const table of TABLES) {
    await supabaseRequest(settings, table, { query: "select=id&limit=1" });
  }
  return true;
}

export async function syncRequisitionToSupabase(settings, requisition, catalog) {
  if (!isSupabaseReady(settings)) throw new Error("Supabase no esta configurado.");
  const workspaceId = settings.workspaceId || "main";
  if (activeContext?.permissions?.includes("catalog.manage")) {
    await upsertRows(settings, "products", catalog.map((product) => productToRow(product, workspaceId)));
  }
  const rename = await upsertRequisitionWithUniqueNumber(settings, requisition, workspaceId);
  await supabaseRequest(settings, "requisition_items", {
    method: "DELETE",
    query: `requisition_id=eq.${encodeURIComponent(requisition.id)}`,
    prefer: "return=minimal"
  });
  await upsertRows(
    settings,
    "requisition_items",
    requisition.items.map((item, index) => itemToRow(item, requisition.id, index))
  );
  if (requisition.changes?.length) {
    await insertAuditRows(
      settings,
      "requisition_changes",
      requisition.changes
        .filter((change) => !change.changedByUserId || change.changedByUserId === activeContext?.userId)
        .map((change) => changeToRow(change, requisition.id, workspaceId))
    );
  }
  return { rename };
}

export async function syncAllToSupabase(settings, requisitions, catalog) {
  if (!isSupabaseReady(settings)) throw new Error("Supabase no esta configurado.");
  const workspaceId = settings.workspaceId || "main";
  if (activeContext?.permissions?.includes("catalog.manage")) {
    await upsertRows(settings, "products", catalog.map((product) => productToRow(product, workspaceId)));
  }
  const renames = [];
  for (const requisition of requisitions) {
    const result = await syncRequisitionToSupabase(settings, requisition, []);
    if (result.rename) renames.push(result.rename);
  }
  return { renames };
}

export async function fetchRequisitionsFromSupabase(settings) {
  if (!isSupabaseReady(settings)) throw new Error("Supabase no esta configurado.");
  if (!activeContext?.organizationId) throw new Error("Falta el contexto de organización.");
  const requisitions = await supabaseRequest(settings, "requisitions", {
    query: [
      "select=*",
      `organization_id=eq.${encodeURIComponent(activeContext.organizationId)}`,
      "order=updated_at.desc",
      "limit=500"
    ].join("&")
  });
  if (!Array.isArray(requisitions) || !requisitions.length) return [];

  const requisitionIds = new Set(requisitions.map((row) => row.id));
  const requisitionFilter = encodeURIComponent(`(${[...requisitionIds].join(",")})`);
  const [items, changes] = await Promise.all([
    supabaseRequest(settings, "requisition_items", {
      query: [
        "select=*",
        `requisition_id=in.${requisitionFilter}`,
        "order=sort_order.asc",
        "limit=5000"
      ].join("&")
    }),
    supabaseRequest(settings, "requisition_changes", {
      query: [
        "select=*",
        `organization_id=eq.${encodeURIComponent(activeContext.organizationId)}`,
        "order=changed_at.desc",
        "limit=5000"
      ].join("&")
    })
  ]);

  const itemsByRequisition = groupRowsByRequisition(items, requisitionIds);
  const changesByRequisition = groupRowsByRequisition(changes, requisitionIds);
  return requisitions.map((row) =>
    normalizeRequisition({
      ...row,
      items: itemsByRequisition.get(row.id) || [],
      changes: changesByRequisition.get(row.id) || [],
      syncStatus: "synced"
    })
  );
}

function groupRowsByRequisition(rows, allowedIds) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!allowedIds.has(row.requisition_id)) continue;
    if (!grouped.has(row.requisition_id)) grouped.set(row.requisition_id, []);
    grouped.get(row.requisition_id).push(row);
  }
  return grouped;
}

export function makeConflictSafeRequisitionNumber(requisition, now = new Date(), attempt = 0) {
  const current = String(requisition.requisitionNumber || "");
  const datePart = current.match(/^REQ-(\d{8})/)?.[1] || compactUtcDate(now);
  const timePart = now.toISOString().slice(11, 19).replace(/:/g, "");
  const idPart = String(requisition.id || "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(-6)
    .toUpperCase()
    .padStart(6, "0");
  const retryPart = attempt ? `-${attempt}` : "";
  return `REQ-${datePart}-${timePart}-${idPart}${retryPart}`;
}

async function upsertRequisitionWithUniqueNumber(settings, requisition, workspaceId) {
  let rename = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const owner = await findRequisitionNumberOwner(
      settings,
      workspaceId,
      requisition.requisitionNumber
    );
    if (owner && owner.id !== requisition.id) {
      rename = renameRequisitionAfterConflict(requisition, rename, attempt);
    }

    try {
      await upsertRows(settings, "requisitions", [requisitionToRow(requisition, workspaceId)]);
      return rename;
    } catch (error) {
      if (!isDuplicateRequisitionNumberError(error) || attempt === 3) throw error;
      rename = renameRequisitionAfterConflict(requisition, rename, attempt + 1);
    }
  }
  return rename;
}

async function findRequisitionNumberOwner(settings, workspaceId, requisitionNumber) {
  const rows = await supabaseRequest(settings, "requisitions", {
    query: [
      "select=id,requisition_number",
      `organization_id=eq.${encodeURIComponent(activeContext?.organizationId || "")}`,
      `requisition_number=eq.${encodeURIComponent(requisitionNumber)}`,
      "limit=1"
    ].join("&")
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

function renameRequisitionAfterConflict(requisition, existingRename, attempt) {
  const previousNumber = requisition.requisitionNumber;
  const nextNumber = makeConflictSafeRequisitionNumber(requisition, new Date(), attempt);
  requisition.requisitionNumber = nextNumber;
  requisition.updatedAt = new Date().toISOString();
  requisition.changes = requisition.changes || [];
  requisition.changes.unshift({
    id: createSyncChangeId(),
    action: "numero_ajustado_por_sincronizacion",
    previousValue: { requisitionNumber: previousNumber },
    newValue: { requisitionNumber: nextNumber },
    changedAt: requisition.updatedAt,
    changedBy: requisition.requestedBy || ""
  });
  requisition.changes = requisition.changes.slice(0, 100);
  return {
    id: requisition.id,
    previousNumber: existingRename?.previousNumber || previousNumber,
    requisitionNumber: nextNumber
  };
}

function isDuplicateRequisitionNumberError(error) {
  const technical = String(error?.technical || error?.message || "").toLowerCase();
  return (
    technical.includes("23505") &&
    (technical.includes("requisition_number") ||
      technical.includes("requisitions_workspace_id_requisition_number_key"))
  );
}

function compactUtcDate(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function createSyncChangeId() {
  if (globalThis.crypto?.randomUUID) return `chg-${globalThis.crypto.randomUUID()}`;
  return `chg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function upsertRows(settings, table, rows) {
  if (!rows.length) return;
  await supabaseRequest(settings, table, {
    method: "POST",
    query: "on_conflict=id",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: rows
  });
}

async function insertAuditRows(settings, table, rows) {
  if (!rows.length) return;
  await supabaseRequest(settings, table, {
    method: "POST",
    query: "on_conflict=id",
    prefer: "resolution=ignore-duplicates,return=minimal",
    body: rows
  });
}

export async function supabaseRequest(settings, table, options = {}) {
  const { method = "GET", query = "", body = null, prefer = "" } = options;
  const projectUrl = normalizeSupabaseUrl(settings.url);
  const keyValidation = validatePublishableKey(settings.publishableKey);
  if (!projectUrl || !keyValidation.ok) {
    const error = new Error(keyValidation.message || "Supabase incompleto.");
    error.technical = keyValidation.technical || "Falta URL o publishable key.";
    error.status = 401;
    throw error;
  }

  const url = `${projectUrl}${REST_PATH}/${table}${query ? `?${query}` : ""}`;
  const accessToken = activeSession?.access_token;
  if (!accessToken) {
    const error = new Error("Su sesión venció. Inicie sesión nuevamente.");
    error.status = 401;
    error.code = "session_missing";
    throw error;
  }
  const headers = {
    apikey: settings.publishableKey,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
  if (prefer) headers.Prefer = prefer;

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`${response.status} ${response.statusText}`);
    error.status = response.status;
    error.technical = text;
    throw error;
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export function classifySupabaseError(error) {
  const technical = String(error.technical || error.message || "").toLowerCase();
  if (!navigator.onLine || (!error.status && error instanceof TypeError)) {
    return {
      label: "Sin conexión",
      message: "No hay conexión con Supabase.",
      technical: error.technical || error.message || ""
    };
  }
  if (error.status === 401) {
    return {
      label: "Sesión vencida",
      message: "Inicie sesión nuevamente para sincronizar.",
      technical: error.technical || error.message || ""
    };
  }
  if (error.status === 403 || technical.includes("permission denied") || technical.includes("42501")) {
    return {
      label: "Error de permisos",
      message: "Revisa RLS, Auth y la migración SQL.",
      technical: error.technical || error.message || ""
    };
  }
  return {
    label: "Error de sincronización",
    message: "Supabase respondió con error.",
    technical: error.technical || error.message || ""
  };
}

function productToRow(product, workspaceId) {
  return {
    id: product.id,
    workspace_id: workspaceId,
    organization_id: product.organizationId || activeContext?.organizationId,
    location_id: product.locationId || null,
    code: product.code,
    official_name: product.officialName,
    category: product.category,
    default_unit: product.defaultUnit,
    allowed_units: product.allowedUnits,
    synonyms: product.synonyms,
    active: product.active !== false,
    updated_at: product.updatedAt || new Date().toISOString()
  };
}

function requisitionToRow(requisition, workspaceId) {
  return {
    id: requisition.id,
    workspace_id: workspaceId,
    organization_id: requisition.organizationId || activeContext?.organizationId,
    location_id: requisition.locationId || activeContext?.locationId,
    department_id: requisition.departmentId || activeContext?.departmentId,
    destination_department_id: requisition.destinationDepartmentId || null,
    requested_by_user_id: requisition.requestedByUserId || activeContext?.userId,
    revision_number: Math.max(1, Number(requisition.revisionNumber) || 1),
    requisition_number: requisition.requisitionNumber,
    requested_by: requisition.requestedBy,
    status: requisition.status,
    original_transcript: requisition.originalTranscript,
    device_info: requisition.deviceInfo,
    created_at: requisition.createdAt,
    updated_at: requisition.updatedAt,
    confirmed_at: requisition.confirmedAt || null,
    exported_at: requisition.exportedAt || null
  };
}

function itemToRow(item, requisitionId, index) {
  return {
    id: item.id,
    requisition_id: requisitionId,
    product_id: item.productId || null,
    product_code: item.productCode || "",
    product_name: item.productName,
    quantity: item.quantity,
    unit: item.unit,
    notes: item.notes,
    original_text: item.originalText,
    confidence: item.confidence,
    needs_review: item.needsReview,
    unit_override: item.unitOverride,
    sort_order: index
  };
}

function changeToRow(change, requisitionId, workspaceId) {
  return {
    id: change.id,
    workspace_id: workspaceId,
    organization_id: activeContext?.organizationId,
    requisition_id: requisitionId,
    action: change.action,
    previous_value: change.previousValue || null,
    new_value: change.newValue || null,
    changed_at: change.changedAt,
    changed_by: change.changedBy || activeContext?.displayName || "",
    changed_by_user_id: change.changedByUserId || activeContext?.userId
  };
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}
