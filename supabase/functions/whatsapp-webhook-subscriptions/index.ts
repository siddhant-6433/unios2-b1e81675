// Diagnose (and optionally repair) WhatsApp webhook subscriptions per WABA.
//
// Sending and receiving are independent in the Cloud API: a send needs only a
// phone_number_id + token, but delivery receipts and inbound messages only
// arrive if the WABA is subscribed to an app whose webhook points at us.
// Seralis Diagnostics 9599931471 sent 256 messages and received ZERO webhook
// events of any kind — no receipts, and no inbound replies either. Nothing in
// our DB can show that, so this reports it straight from Meta.
//
// GET  → report only (subscribed_apps + which app each channel's token belongs to)
// POST {"subscribe": true} → additionally POST /{waba}/subscribed_apps for any
//                            WABA that has no subscription yet.
//
// Service-role or cron caller only: it echoes app ids and token metadata.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isServiceCaller } from "../_shared/service-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const GRAPH = "https://graph.facebook.com/v21.0";

async function graph(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${GRAPH}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
  });
  let body: unknown;
  try { body = await res.json(); } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  if (!(await isServiceCaller(req, admin))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let subscribe = false;
  let probeTokenEnv = "WHATSAPP_API_TOKEN";
  let target: { waba_id?: string; token_env?: string } | null = null;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      subscribe = Boolean(body?.subscribe);
      if (typeof body?.probe_token_env === "string") probeTokenEnv = body.probe_token_env;
      if (body?.waba_id) target = { waba_id: String(body.waba_id), token_env: String(body.token_env || probeTokenEnv) };
    } catch { /* no body */ }
  }

  // Targeted mode: subscribe ONE waba using a specific app's token. Used to bind
  // a WABA that is subscribed to the wrong app (its events go to that app's
  // webhook, which is indistinguishable from "never subscribed" on our side).
  if (target?.waba_id) {
    const tk = Deno.env.get(target.token_env!) || "";
    if (!tk) {
      return new Response(JSON.stringify({ error: `no token in env for ${target.token_env}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const owner = await graph(
      `${target.waba_id}?fields=id,name,owner_business_info,account_review_status`, tk,
    );
    const before = await graph(`${target.waba_id}/subscribed_apps`, tk);
    let post = null, after = null;
    if (subscribe && before.ok) {
      post = await graph(`${target.waba_id}/subscribed_apps`, tk, { method: "POST" });
      after = await graph(`${target.waba_id}/subscribed_apps`, tk);
    }
    return new Response(JSON.stringify({
      ok: true, mode: "targeted", waba_id: target.waba_id, token_env: target.token_env,
      owner: owner.body, before: before.body, subscribe_result: post?.body ?? null, after: after?.body ?? null,
    }, null, 2), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { data: channels, error } = await admin
    .from("whatsapp_channels")
    .select("label, business_number, meta_phone_number_id, waba_id, secret_token_name, is_active")
    .eq("provider", "meta")
    .eq("is_active", true)
    .not("waba_id", "is", null);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results = [];
  for (const ch of (channels || []) as Array<Record<string, string>>) {
    const token =
      (ch.secret_token_name ? Deno.env.get(ch.secret_token_name) : null) ||
      Deno.env.get("WHATSAPP_API_TOKEN") || "";

    if (!token) {
      results.push({ ...ch, error: `no token in env for ${ch.secret_token_name}` });
      continue;
    }

    // Which app does this token belong to? Two WABAs under different apps is
    // the case that looks identical to "not subscribed" from our side.
    const dbg = await graph(
      `debug_token?input_token=${encodeURIComponent(token)}`, token,
    );
    const appId = (dbg.body as any)?.data?.app_id ?? null;
    const appName = (dbg.body as any)?.data?.application ?? null;
    const scopes = (dbg.body as any)?.data?.scopes ?? null;

    const subs = await graph(`${ch.waba_id}/subscribed_apps`, token);
    const subscribedApps = ((subs.body as any)?.data || []).map(
      (d: any) => ({ id: d?.whatsapp_business_api_data?.id, name: d?.whatsapp_business_api_data?.name }),
    );

    const entry: Record<string, unknown> = {
      label: ch.label,
      business_number: ch.business_number,
      waba_id: ch.waba_id,
      token_env: ch.secret_token_name,
      token_app_id: appId,
      token_app_name: appName,
      token_scopes: scopes,
      subscribed_apps: subscribedApps,
      subscribed_ok: subs.ok,
      subscribed_error: subs.ok ? null : subs.body,
    };

    if (subscribe && subs.ok && subscribedApps.length === 0) {
      const post = await graph(`${ch.waba_id}/subscribed_apps`, token, { method: "POST" });
      entry.subscribe_attempted = true;
      entry.subscribe_result = post.body;
      entry.subscribe_ok = post.ok;
      if (post.ok) {
        const recheck = await graph(`${ch.waba_id}/subscribed_apps`, token);
        entry.subscribed_apps_after = ((recheck.body as any)?.data || []).map(
          (d: any) => ({ id: d?.whatsapp_business_api_data?.id, name: d?.whatsapp_business_api_data?.name }),
        );
      }
    }

    results.push(entry);
  }

  return new Response(JSON.stringify({ ok: true, subscribe, results }, null, 2), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
