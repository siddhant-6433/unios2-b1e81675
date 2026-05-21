/**
 * Meta Conversions API Relay
 * ─────────────────────────────────────────────────────────────
 * Server-side conversion bridge for the three apply-portal Meta Pixels
 * (one per brand: nimt / beacon / mirai). Companion to the browser-side
 * fbq() fires in index.html + analytics.ts. The brand is resolved from
 * leads.portal_brand, picking the matching pixel + access token out of
 * PIXEL_MAP below.
 *
 * Why this exists:
 *   1. iOS Safari ITP / ad blockers / corporate firewalls drop ~10–40% of
 *      browser Pixel events. CAPI fires server-to-server and survives all
 *      that.
 *   2. Pure server-side events (lead_payments.confirmed via webhook, manual
 *      reconciliation, status flips weeks later) never had a browser to
 *      fire from in the first place.
 *   3. Sending hashed phone / email / external_id from the DB lifts Match
 *      Quality from "Good" to "Great" — Meta's optimizer + lookalike models
 *      converge faster on smaller spend.
 *
 * Dedup: every event carries an `event_id`. The browser Pixel sends the
 * SAME id for the same conversion (Lead → "lead_<uuid>", CompleteRegistration
 * → "reg_<application_id>"). Meta dedupes on (pixel_id, event_name,
 * event_id) inside a ~7-day window. So both sides fire freely; users with
 * a working browser get rich UA signals from the Pixel and users behind a
 * blocker get the server-side fire — no double-counting.
 *
 * Auth: same shape as ga-conversions — service-role bearer or
 * META_CAPI_INTERNAL_KEY.
 *
 * Request body:
 * {
 *   "lead_id":        "uuid",      // required — looked up for fbc/fbp/phone/email
 *   "event_name":     "Lead" | "CompleteRegistration" | "AdmissionConfirmed" | string,
 *   "event_id":       string,      // required for dedup with browser fires
 *   "event_time":     number,      // optional unix seconds; defaults to now
 *   "value":          number,      // optional
 *   "currency":       "INR",       // default INR
 *   "transaction_id": string,      // optional (logged only; Meta uses event_id for dedup)
 *   "custom_data":    { ... }      // merged into the event's custom_data block
 * }
 *
 * Response: { ok: boolean, pixel_id?: string, http_status?: number,
 *             fb_trace_id?: string, error?: string }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-key",
};

// Brand → pixel_id. The same SPA serves three apply portals (resolved via
// detectPortal() in src/components/apply/portalConfig.ts), each with its
// own ad account + pixel. leads.portal_brand is the routing key.
//
// nimt → parent NIMT Educational Institutions pixel (also the default for
// leads whose intake path didn't set a brand)
// beacon → NIMT Beacon School pixel
// mirai → Mirai School pixel
//
// A single META_CAPI_ACCESS_TOKEN env var covers all three pixels — the
// token was generated against a Business System User with manage_pages
// scope on all three datasets, so one token authorizes any of them. If
// the brands split between Business accounts in the future, switch this
// to per-brand secretEnv keys.
const PIXEL_MAP: Record<string, string> = {
  nimt:   "2580313152286928",
  beacon: "511947283685367",
  mirai:  "1461957365199748",
};
const DEFAULT_BRAND = "nimt";

interface RelayBody {
  lead_id: string;
  event_name: string;
  event_id?: string;
  event_time?: number;
  value?: number;
  currency?: string;
  transaction_id?: string;
  custom_data?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  // Same auth pattern as ga-conversions: x-internal-key OR a service-role bearer
  const authHeader = req.headers.get("authorization") ?? "";
  const internalKey = req.headers.get("x-internal-key") ?? "";
  const expectedInternal = Deno.env.get("META_CAPI_INTERNAL_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  let okAuth = expectedInternal && internalKey === expectedInternal;
  if (!okAuth && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (serviceRoleKey && token === serviceRoleKey) {
      okAuth = true;
    } else {
      try {
        const [, payloadB64] = token.split(".");
        if (payloadB64) {
          const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
          if (payload?.role === "service_role") okAuth = true;
        }
      } catch { /* malformed token */ }
    }
  }
  if (!okAuth) return json({ ok: false, error: "unauthorized" }, 401);

  let body: RelayBody;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid json" }, 400); }

  if (!body.lead_id || !body.event_name) {
    return json({ ok: false, error: "lead_id and event_name required" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Pull the lead's match-quality fields + brand routing key. email/phone
  // are hashed before sending.
  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .select("id, name, phone, email, fbc, fbp, origin_domain, portal_brand")
    .eq("id", body.lead_id)
    .maybeSingle();

  if (leadErr || !lead) {
    await logEvent(supabase, body, null, null, null, "lead_not_found");
    return json({ ok: false, error: "lead not found" }, 404);
  }

  // Resolve which pixel to fire on. Falls back to NIMT for leads without
  // a brand (legacy / pre-portal-aware intake paths).
  const brand = (lead.portal_brand as string | null) || DEFAULT_BRAND;
  const pixelId = PIXEL_MAP[brand];
  if (!pixelId) {
    await logEvent(supabase, body, null, null, null, `unknown_brand:${brand}`);
    return json({ ok: false, error: `no pixel mapped for portal_brand '${brand}'` }, 400);
  }

  const accessToken = Deno.env.get("META_CAPI_ACCESS_TOKEN");
  if (!accessToken) {
    await logEvent(supabase, body, pixelId, null, null, "missing_token:META_CAPI_ACCESS_TOKEN");
    return json({ ok: false, error: "META_CAPI_ACCESS_TOKEN not configured" }, 500);
  }

  const userData: Record<string, unknown> = {};

  if (lead.phone) {
    const normalized = normalizePhone(lead.phone);
    if (normalized) userData.ph = [await sha256Hex(normalized)];
  }
  if (lead.email) {
    userData.em = [await sha256Hex(lead.email.trim().toLowerCase())];
  }
  // external_id = stable lead-level identifier. Meta requires it hashed if
  // it could be PII — uuids aren't PII but hashing is required by the API.
  userData.external_id = [await sha256Hex(lead.id)];

  if (lead.fbc) userData.fbc = lead.fbc;
  if (lead.fbp) userData.fbp = lead.fbp;

  const eventTime = body.event_time ?? Math.floor(Date.now() / 1000);
  const eventId = body.event_id ?? `${body.event_name}_${lead.id}_${eventTime}`;

  const customData: Record<string, unknown> = {
    currency: body.currency ?? "INR",
    ...(body.value !== undefined ? { value: body.value } : {}),
    ...(body.transaction_id ? { order_id: body.transaction_id } : {}),
    ...(body.custom_data ?? {}),
  };

  // event_source_url helps Meta's attribution — use the lead's actual
  // origin where known, else fall back to the canonical apply domain.
  const eventSourceUrl = lead.origin_domain
    ? `https://${lead.origin_domain}/`
    : "https://apply.nimt.ac.in/";

  const payload = {
    data: [{
      event_name: body.event_name,
      event_time: eventTime,
      event_id: eventId,
      action_source: "website",
      event_source_url: eventSourceUrl,
      user_data: userData,
      custom_data: customData,
    }],
  };

  // v18.0 is the current stable Marketing API version as of 2026-05.
  // Meta deprecates minor versions on a ~2yr cadence; bump on warning.
  const url = `https://graph.facebook.com/v18.0/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // Parse response: success → { events_received, messages, fbtrace_id }
  //                error   → { error: { message, type, code, fbtrace_id } }
  let fbTraceId: string | null = null;
  let errorMessage: string | null = null;
  try {
    const respJson = await resp.json();
    fbTraceId = respJson?.fbtrace_id ?? respJson?.error?.fbtrace_id ?? null;
    if (!resp.ok) errorMessage = respJson?.error?.message ?? JSON.stringify(respJson);
  } catch {
    if (!resp.ok) errorMessage = `non-json response, status ${resp.status}`;
  }

  await logEvent(supabase, body, pixelId, resp.status, fbTraceId, errorMessage, eventId);

  return json({
    ok: resp.ok,
    pixel_id: pixelId,
    http_status: resp.status,
    fb_trace_id: fbTraceId,
    ...(errorMessage ? { error: errorMessage } : {}),
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Normalize phone to E.164 digits-only (no +, no spaces). Meta wants
// "919876543210" not "+91 98765-43210". Drops everything non-digit.
function normalizePhone(p: string): string | null {
  const digits = p.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function logEvent(
  supabase: ReturnType<typeof createClient>,
  body: RelayBody,
  pixelId: string | null,
  httpStatus: number | null,
  fbTraceId: string | null,
  errorMessage: string | null,
  eventId?: string,
) {
  try {
    await supabase.from("meta_event_log").insert({
      lead_id: body.lead_id,
      event_name: body.event_name,
      event_id: eventId ?? body.event_id ?? null,
      value: body.value ?? null,
      transaction_id: body.transaction_id ?? null,
      pixel_id: pixelId,
      http_status: httpStatus,
      fb_trace_id: fbTraceId,
      error_message: errorMessage,
      payload: body as unknown as Record<string, unknown>,
    });
  } catch {
    // best-effort
  }
}
