import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { corsHeaders, isAllowedOrigin } from "./cors.ts";
import { loadAuthorizedEmailRequest, persistEmailAttempt } from "./database.ts";
import { renderRequisitionEmail } from "./render.ts";
import { ResendEmailProvider } from "./provider.ts";
import { HttpError, parseSendRequest, safeErrorResponse } from "./validation.ts";

const authenticatedHandler = withSupabase({ auth: "user" }, async (request, context) => {
  const origin = request.headers.get("origin") || "";
  if (!isAllowedOrigin(origin)) return json({ error: "Origen no autorizado." }, 403, origin);
  if (request.method !== "POST") return json({ error: "Metodo no permitido." }, 405, origin);

  try {
    const input = parseSendRequest(await request.json());
    const { data: userData, error: userError } = await context.supabase.auth.getUser();
    if (userError || !userData.user) throw new HttpError(401, "auth_required", "La sesion no es valida.");

    const authorized = await loadAuthorizedEmailRequest(context.supabase, input, userData.user.id);
    const result = await persistEmailAttempt({
      admin: context.supabaseAdmin,
      provider: new ResendEmailProvider(),
      authorized,
      input,
      rendered: renderRequisitionEmail(authorized, input),
      userId: userData.user.id
    });
    return json({
      id: result.id,
      status: result.status,
      recipientCount: result.recipientCount,
      providerAccepted: result.status === "sent",
      duplicate: Boolean(result.duplicate)
    }, 200, origin);
  } catch (error) {
    const safe = safeErrorResponse(error);
    return json(safe.body, safe.status, origin);
  }
});

export default {
  fetch(request: Request) {
    const origin = request.headers.get("origin") || "";
    if (request.method === "OPTIONS") {
      if (!isAllowedOrigin(origin)) return json({ error: "Origen no autorizado." }, 403, origin);
      return new Response("ok", { headers: corsHeaders(origin) });
    }
    return authenticatedHandler(request);
  }
};

function json(body: unknown, status: number, origin: string) {
  return Response.json(body, { status, headers: corsHeaders(origin) });
}
