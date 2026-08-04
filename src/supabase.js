const REST_PATH = "/rest/v1";
const TABLES = ["products", "requisitions", "requisition_items", "requisition_changes"];

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
  await upsertRows(settings, "products", catalog.map((product) => productToRow(product, workspaceId)));
  await upsertRows(settings, "requisitions", [requisitionToRow(requisition, workspaceId)]);
  await upsertRows(
    settings,
    "requisition_items",
    requisition.items.map((item, index) => itemToRow(item, requisition.id, index))
  );
  if (requisition.changes?.length) {
    await upsertRows(
      settings,
      "requisition_changes",
      requisition.changes.map((change) => changeToRow(change, requisition.id, workspaceId))
    );
  }
}

export async function syncAllToSupabase(settings, requisitions, catalog) {
  for (const requisition of requisitions) {
    await syncRequisitionToSupabase(settings, requisition, catalog);
  }
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
  const headers = {
    apikey: settings.publishableKey,
    Authorization: `Bearer ${settings.publishableKey}`,
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
      label: "Error de autenticación",
      message: "La publishable key no fue aceptada.",
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
    requisition_id: requisitionId,
    action: change.action,
    previous_value: change.previousValue || null,
    new_value: change.newValue || null,
    changed_at: change.changedAt,
    changed_by: change.changedBy || ""
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
