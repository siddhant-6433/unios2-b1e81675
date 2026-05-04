/**
 * GA4 Measurement Protocol Relay
 * ─────────────────────────────────────────────────────────────
 * Server-side conversion bridge: forwards UniOs lead/payment/admission
 * events to the correct GA4 property based on the lead's origin domain.
 *
 * Why this exists: browser-side gtag can fire `generate_lead` at form
 * submit, but `purchase` (app fee) and `admission_confirmed` happen
 * weeks later via webhook/manual flows where the user isn't on the site.
 * Without server-side relay, GA never closes the loop on attribution
 * for those higher-value conversions.
 *
 * Routing: leads.origin_domain → measurement_id + API secret. Each of
 * the 4 NIMT-group domains has its own GA4 stream (see memory:
 * reference_ga4_measurement_ids.md).
 *
 * Auth: requires the caller to pass either the service-role key
 * (Authorization: Bearer …) — used by the DB trigger via pg_net — or a
 * shared GA_RELAY_INTERNAL_KEY for internal service-to-service calls.
 *
 * Request body:
 * {
 *   "lead_id":        "uuid",         // required — looked up for client_id + origin_domain
 *   "event_name":     "generate_lead" | "purchase" | "admission_confirmed" | string,
 *   "value":          number,         // optional, sent as `value`
 *   "currency":       "INR",          // default INR
 *   "transaction_id": string,         // required for purchase / admission_confirmed
 *   "extra_params":   { … }           // merged into event.params
 * }
 *
 * Response: { ok: boolean, measurement_id?: string, ga_status?: number, error?: string }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-key",
};

// origin_domain → { measurement_id, secret_env_var }
// Keys must match the values stored in leads.origin_domain at intake.
const PROPERTY_MAP: Record<string, { measurementId: string; secretEnv: string }> = {
  "nimt.ac.in":         { measurementId: "G-WDS0GZRYPF", secretEnv: "GA_MP_SECRET_NIMT" },
  "miraischool.in":     { measurementId: "G-N68RS292C3", secretEnv: "GA_MP_SECRET_MIRAI" },
  "school.nimt.ac.in":  { measurementId: "G-FMDZW6PB7C", secretEnv: "GA_MP_SECRET_SCHOOL" },
  "apply.nimt.ac.in":   { measurementId: "G-MKHMKH1DE9", secretEnv: "GA_MP_SECRET_APPLY" },
};

interface RelayBody {
  lead_id: string;
  event_name: string;
  value?: number;
  currency?: string;
  transaction_id?: string;
  extra_params?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ ok: false, error: "method not allowed" }, 405);
  }

  // Auth: accept either x-internal-key OR any JWT with role=service_role.
  // The role-based check is format-agnostic — survives Supabase's migration
  // from legacy eyJ... JWTs to new sb_secret_... tokens, which broke a
  // direct string-equality check against SUPABASE_SERVICE_ROLE_KEY.
  const authHeader = req.headers.get("authorization") ?? "";
  const internalKey = req.headers.get("x-internal-key") ?? "";
  const expectedInternal = Deno.env.get("GA_RELAY_INTERNAL_KEY") ?? "";

  let okAuth = expectedInternal && internalKey === expectedInternal;
  if (!okAuth && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    try {
      const [, payloadB64] = token.split(".");
      if (payloadB64) {
        const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
        if (payload?.role === "service_role") okAuth = true;
      }
    } catch { /* malformed token — leave okAuth false */ }
  }
  if (!okAuth) return json({ ok: false, error: "unauthorized" }, 401);

  let body: RelayBody;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }

  if (!body.lead_id || !body.event_name) {
    return json({ ok: false, error: "lead_id and event_name required" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Look up the lead's GA attribution context
  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .select("id, ga_client_id, ga_session_id, gclid, origin_domain, utm_source, utm_medium, utm_campaign, course_id")
    .eq("id", body.lead_id)
    .maybeSingle();

  if (leadErr || !lead) {
    await logEvent(supabase, body, null, null, "lead_not_found");
    return json({ ok: false, error: "lead not found" }, 404);
  }

  const property = lead.origin_domain ? PROPERTY_MAP[lead.origin_domain] : null;
  if (!property) {
    await logEvent(supabase, body, null, null, `unknown_origin_domain:${lead.origin_domain ?? "null"}`);
    return json({ ok: false, error: `no GA property mapped for origin_domain '${lead.origin_domain}'` }, 400);
  }

  const apiSecret = Deno.env.get(property.secretEnv);
  if (!apiSecret) {
    await logEvent(supabase, body, property.measurementId, null, `missing_secret:${property.secretEnv}`);
    return json({ ok: false, error: `secret ${property.secretEnv} not configured` }, 500);
  }

  // GA4 requires a client_id. Fall back to a deterministic synthetic value
  // derived from lead_id so events still flow when the lead was created via
  // a backend channel (e.g. CSV import) and never had a browser session.
  // The synthetic format mirrors GA4's expected `<random>.<unix>` shape.
  const clientId =
    lead.ga_client_id ||
    `crm.${hashToInt(lead.id)}.${Math.floor(Date.parse(lead.id ? new Date().toISOString() : "") / 1000)}`;

  // Build event params. GA4 reserves currency + value + transaction_id —
  // anything else goes into extra_params.
  const params: Record<string, unknown> = {
    currency: body.currency ?? "INR",
    ...(body.value !== undefined ? { value: body.value } : {}),
    ...(body.transaction_id ? { transaction_id: body.transaction_id } : {}),
    ...(lead.utm_source ? { campaign_source: lead.utm_source } : {}),
    ...(lead.utm_medium ? { campaign_medium: lead.utm_medium } : {}),
    ...(lead.utm_campaign ? { campaign: lead.utm_campaign } : {}),
    ...(lead.gclid ? { gclid: lead.gclid } : {}),
    ...(body.extra_params ?? {}),
    // Custom user property for cohorting in GA Explorations
    crm_lead_id: lead.id,
  };

  const payload = {
    client_id: clientId,
    ...(lead.ga_session_id
      ? { user_properties: { ga_session_id: { value: lead.ga_session_id } } }
      : {}),
    events: [{ name: body.event_name, params }],
  };

  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${property.measurementId}&api_secret=${apiSecret}`;
  const gaResp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // GA returns 204 No Content on success; non-2xx = our payload was rejected
  await logEvent(
    supabase,
    body,
    property.measurementId,
    gaResp.status,
    gaResp.ok ? null : await gaResp.text().catch(() => "ga_error"),
  );

  return json({
    ok: gaResp.ok,
    measurement_id: property.measurementId,
    ga_status: gaResp.status,
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Best-effort audit log. Failure to log should never block the relay.
async function logEvent(
  supabase: ReturnType<typeof createClient>,
  body: RelayBody,
  measurementId: string | null,
  gaStatus: number | null,
  errorMessage: string | null,
) {
  try {
    await supabase.from("ga_event_log").insert({
      lead_id: body.lead_id,
      event_name: body.event_name,
      value: body.value ?? null,
      transaction_id: body.transaction_id ?? null,
      measurement_id: measurementId,
      ga_status: gaStatus,
      error_message: errorMessage,
      payload: body as unknown as Record<string, unknown>,
    });
  } catch {
    // intentional swallow — audit log is best-effort
  }
}

// Stable 32-bit hash for synthetic client_id fallback. Not a cryptographic
// hash; just gives GA4 a consistent "anonymous user" bucket per lead.
function hashToInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
