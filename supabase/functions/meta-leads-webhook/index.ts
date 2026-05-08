// Meta (Facebook / Instagram) Lead Ads webhook receiver.
//
// Flow:
//   1. GET  → Meta verification handshake. Echo hub.challenge if the
//      hub.verify_token matches META_VERIFY_TOKEN.
//   2. POST → Meta event payload. Verify x-hub-signature-256 with HMAC
//      SHA-256 over the raw body using META_APP_SECRET, then for each
//      `leadgen` change fetch the full lead via Graph API (Meta only
//      sends a leadgen_id in the webhook itself), enrich with form / ad /
//      adset / campaign metadata, and forward to lead-ingest where the
//      existing dedup, attribution, counsellor-assignment, and AI-call
//      pipeline takes over.
//
// Required env:
//   META_VERIFY_TOKEN       — random string shared with Meta during webhook setup
//   META_APP_SECRET         — Facebook App secret for signature verification
//   META_PAGE_ACCESS_TOKEN  — long-lived Page access token to call Graph API
//                             (multi-page deployments can later switch to a
//                             page_id → token map; one token is fine for now)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — already present
//
// Webhook URL to register on Meta:
//   https://<project>.supabase.co/functions/v1/meta-leads-webhook
//
// Subscribe the page to the `leadgen` field on the App Dashboard, then
// connect the Page in the same App so the webhook fires when a Lead
// Form is submitted on any FB/IG ad linked to that Page.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
};

const GRAPH_VERSION = "v21.0";

async function verifySignature(rawBody: string, signatureHeader: string | null, appSecret: string): Promise<boolean> {
  if (!signatureHeader || !appSecret) return false;
  const expected = signatureHeader.startsWith("sha256=") ? signatureHeader.slice(7) : signatureHeader;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const hex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, "0")).join("");
  // Constant-time-ish compare
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function fetchLead(leadgenId: string, accessToken: string) {
  // Single Graph call with deep `field` selection — pulls everything
  // we need to attribute the lead. ad/adset/campaign/form objects
  // expand inline so we don't pay for separate round-trips.
  const fields = [
    "id",
    "created_time",
    "field_data",
    "platform",
    "form_id",
    "ad_id",
    "adset_id",
    "campaign_id",
    "ad_name",
    "adset_name",
    "campaign_name",
    "form_name",
  ].join(",");
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${leadgenId}?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, error: body?.error?.message || "graph fetch failed", body };
  }
  return { ok: true, lead: body };
}

Deno.serve(async (req) => {
  // ── Meta webhook verification (GET) ───────────────────────────────
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode      = url.searchParams.get("hub.mode");
    const token     = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const verifyToken = Deno.env.get("META_VERIFY_TOKEN");
    if (mode === "subscribe" && token && verifyToken && token === verifyToken) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const rawBody = await req.text();

    // Signature verification — block any unsigned / mis-signed payload
    // because this endpoint is public (no JWT). Meta signs with the App
    // secret so we can be sure the payload originated from Meta.
    const appSecret = Deno.env.get("META_APP_SECRET") || "";
    const sigHeader = req.headers.get("x-hub-signature-256");
    if (appSecret) {
      const ok = await verifySignature(rawBody, sigHeader, appSecret);
      if (!ok) {
        console.warn("[meta-leads-webhook] Bad signature");
        return new Response("Bad signature", { status: 401 });
      }
    } else {
      console.warn("[meta-leads-webhook] META_APP_SECRET not set — accepting unsigned payload (dev only)");
    }

    let payload: any;
    try { payload = JSON.parse(rawBody); }
    catch { return new Response("Invalid JSON", { status: 400 }); }

    if (payload?.object !== "page") {
      // Ignore non-page events (Meta also sends user / instagram events
      // here for unrelated subscriptions; we only care about page leadgens).
      return new Response(JSON.stringify({ ok: true, ignored: payload?.object || null }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const pageAccessToken = Deno.env.get("META_PAGE_ACCESS_TOKEN") || "";

    if (!pageAccessToken) {
      console.error("[meta-leads-webhook] META_PAGE_ACCESS_TOKEN missing — cannot fetch lead detail");
      // Return 200 anyway so Meta doesn't retry indefinitely (we'd want to
      // backfill from the activity log if this happens).
      return new Response(JSON.stringify({ ok: false, error: "no_page_token" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const results: any[] = [];

    for (const entry of payload.entry || []) {
      const pageId = entry.id;
      for (const change of entry.changes || []) {
        if (change.field !== "leadgen") continue;
        const v = change.value || {};
        const leadgenId: string | null = v.leadgen_id ? String(v.leadgen_id) : null;
        if (!leadgenId) continue;

        // Idempotency: if we already have this lead, skip the Graph call
        // entirely. The unique index on meta_leadgen_id would also catch
        // it on insert, but skipping early saves an external API hit.
        const { data: existing } = await admin
          .from("leads")
          .select("id")
          .eq("meta_leadgen_id", leadgenId)
          .maybeSingle();
        if (existing) {
          results.push({ leadgen_id: leadgenId, status: "duplicate", lead_id: existing.id });
          continue;
        }

        // Persist the raw event so we always have a record even if Graph
        // is unreachable. This row gets paired up with the lead later.
        await admin.from("meta_lead_events").insert({
          leadgen_id:  leadgenId,
          page_id:     pageId,
          form_id:     v.form_id ? String(v.form_id) : null,
          ad_id:       v.ad_id   ? String(v.ad_id)   : null,
          adgroup_id:  v.adgroup_id ? String(v.adgroup_id) : null,
          created_time: v.created_time || null,
          raw_event:   change,
          status:      "received",
        }).then(() => {}, () => {/* table may not exist yet — non-blocking */});

        // Pull full lead from Graph API
        const fetched = await fetchLead(leadgenId, pageAccessToken);
        if (!fetched.ok) {
          console.error(`[meta-leads-webhook] Graph error for ${leadgenId}:`, fetched.error);
          results.push({ leadgen_id: leadgenId, status: "graph_error", error: fetched.error });
          continue;
        }

        const lead = fetched.lead;

        // Forward to lead-ingest with source=meta_ads. lead-ingest's
        // parseMetaAds reads field_data + the meta_* attribution we
        // attach as top-level fields here.
        const ingestPayload = {
          field_data:      lead.field_data || [],
          leadgen_id:      lead.id || leadgenId,
          form_id:         lead.form_id,
          form_name:       lead.form_name,
          ad_id:           lead.ad_id,
          ad_name:         lead.ad_name,
          adset_id:        lead.adset_id,
          adset_name:      lead.adset_name,
          campaign_id:     lead.campaign_id,
          campaign_name:   lead.campaign_name,
          page_id:         pageId,
          platform:        lead.platform,
          created_time:    lead.created_time,
        };

        const ingestRes = await fetch(`${supabaseUrl}/functions/v1/lead-ingest?source=meta_ads`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // service-role auth — lead-ingest accepts both apikey and Bearer
            "apikey":        serviceKey,
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify(ingestPayload),
        });

        const ingestJson = await ingestRes.json().catch(() => ({}));
        if (!ingestRes.ok) {
          console.error(`[meta-leads-webhook] lead-ingest failed for ${leadgenId}:`, ingestJson);
          results.push({ leadgen_id: leadgenId, status: "ingest_error", detail: ingestJson });
        } else {
          results.push({ leadgen_id: leadgenId, status: ingestJson?.status || "ok", lead_id: ingestJson?.lead_id });
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[meta-leads-webhook] error:", err);
    // Always 200 to Meta — they retry on non-2xx and bombard the endpoint.
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
