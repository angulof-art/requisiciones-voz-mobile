import { PUBLIC_APP_CONFIG } from "../config.js?v=2.0.0-rc.2";

let client = null;

export function getSupabaseClient() {
  if (client) return client;
  const factory = globalThis.supabase?.createClient;
  if (!factory) throw new Error("No se pudo cargar el cliente seguro de Supabase.");
  const { url, publishableKey } = PUBLIC_APP_CONFIG.supabase;
  client = factory(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "pedidos-voz-auth-v1"
    },
    global: {
      headers: { "X-Client-Info": "requisiciones-voz-mobile/2.0.0-rc.2" }
    }
  });
  return client;
}

export function resetSupabaseClientForTests() {
  client = null;
}

