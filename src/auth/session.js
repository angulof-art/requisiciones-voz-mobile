import { getSupabaseClient } from "./client.js?v=2.0.0-rc.3";

export class AuthSessionError extends Error {
  constructor(message, code = "auth_error", cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "AuthSessionError";
    this.code = code;
  }
}

export async function restoreSession() {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw mapAuthError(error);
  const session = data.session;
  if (!session) return null;
  if (session.expires_at && session.expires_at * 1000 <= Date.now() + 30_000 && !navigator.onLine) {
    throw new AuthSessionError(
      "La sesión guardada venció. Conéctese a Internet para iniciar sesión nuevamente.",
      "offline_session_expired"
    );
  }
  return session;
}

export async function signInWithPassword(email, password) {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: String(email || "").trim(),
    password: String(password || "")
  });
  if (error) throw mapAuthError(error);
  if (!data.session) throw new AuthSessionError("No se recibió una sesión válida.");
  return data.session;
}

export async function signOut() {
  const client = getSupabaseClient();
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) throw mapAuthError(error);
}

export function onAuthStateChange(callback) {
  const client = getSupabaseClient();
  return client.auth.onAuthStateChange((event, session) => callback(event, session)).data.subscription;
}

export function requireAccessToken(session) {
  if (!session?.access_token) {
    throw new AuthSessionError("Su sesión venció. Inicie sesión nuevamente.", "session_missing");
  }
  return session.access_token;
}

function mapAuthError(error) {
  const status = Number(error?.status || 0);
  const raw = String(error?.message || "").toLowerCase();
  if (status === 400 || raw.includes("invalid login")) {
    return new AuthSessionError("Correo o contraseña incorrectos.", "invalid_credentials", error);
  }
  if (raw.includes("email not confirmed")) {
    return new AuthSessionError("El correo todavía no ha sido confirmado.", "email_unconfirmed", error);
  }
  if (!navigator.onLine) {
    return new AuthSessionError("No hay conexión para validar la sesión.", "offline", error);
  }
  return new AuthSessionError("No se pudo iniciar sesión. Inténtelo nuevamente.", "auth_error", error);
}

