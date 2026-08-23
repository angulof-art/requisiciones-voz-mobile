const DEFAULT_ORIGINS = [
  "https://angulof-art.github.io",
  "http://127.0.0.1:4177",
  "http://localhost:4177"
];

export function isAllowedOrigin(origin: string) {
  if (!origin) return true;
  return allowedOrigins().includes(origin);
}

export function corsHeaders(origin: string) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Vary": "Origin"
  };
  if (origin && isAllowedOrigin(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function allowedOrigins() {
  const configured = String(Deno.env.get("REQUISITION_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ORIGINS;
}
