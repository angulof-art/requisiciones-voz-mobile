import { DEFAULT_CATALOG, normalizeCatalog } from "../src/catalog.js";
import { PUBLIC_APP_CONFIG } from "../src/config.js";
import { supabaseRequest } from "../src/supabase.js";

const settings = PUBLIC_APP_CONFIG.supabase;
const workspaceId = settings.workspaceId || "main";
const updatedAt = new Date().toISOString();
const products = normalizeCatalog(DEFAULT_CATALOG);
const rows = products.map((product) => ({
  id: product.id,
  workspace_id: workspaceId,
  code: product.code,
  official_name: product.officialName,
  category: product.category,
  default_unit: product.defaultUnit,
  allowed_units: product.allowedUnits,
  synonyms: product.synonyms,
  active: product.active !== false,
  updated_at: updatedAt
}));

await supabaseRequest(settings, "products", {
  method: "POST",
  query: "on_conflict=id",
  prefer: "resolution=merge-duplicates,return=minimal",
  body: rows
});

console.log(`Supabase actualizado con ${rows.length} productos.`);
