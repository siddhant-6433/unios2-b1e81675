import { createClient } from "npm:@supabase/supabase-js@2";
import { digits } from "../_shared/whatsapp-channel.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function envPresent(name: string | null | undefined): boolean {
  return !!name && !!Deno.env.get(name);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") || "";
  const cronSecret = Deno.env.get("CRON_SECRET");
  const cronHeader = req.headers.get("x-cron-secret");
  const cronAuthorised = !!cronSecret && cronHeader === cronSecret;
  if (!cronAuthorised && auth !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: channels, error } = await admin
    .from("whatsapp_channels")
    .select("id,label,provider,route,business_number,meta_phone_number_id,secret_token_name,is_active,allow_ai,allow_manual_reply,allow_bulk")
    .order("route", { ascending: true });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const routeRows = await Promise.all((channels || []).map(async (channel: any) => {
    const businessNumber = digits(channel.business_number || channel.meta_phone_number_id || "");
    const { data: lastSuccess } = await admin
      .from("whatsapp_automation_events")
      .select("event_type,decision,created_at")
      .eq("business_number", businessNumber)
      .in("event_type", ["ai_reply_sent", "inbound_received"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: lastFailure } = await admin
      .from("whatsapp_automation_events")
      .select("event_type,decision,reason,created_at")
      .eq("business_number", businessNumber)
      .eq("event_type", "send_failed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      id: channel.id,
      label: channel.label,
      route: channel.route,
      provider: channel.provider,
      is_active: channel.is_active,
      token_present: channel.provider === "meta" ? envPresent(channel.secret_token_name || "WHATSAPP_API_TOKEN") : envPresent("PLIVO_AUTH_TOKEN"),
      sender_present: channel.provider === "meta" ? !!channel.meta_phone_number_id : !!channel.business_number,
      fallback_status: channel.provider === "meta" && !channel.secret_token_name ? "default_token" : "configured",
      allow_ai: channel.allow_ai,
      allow_manual_reply: channel.allow_manual_reply,
      allow_bulk: channel.allow_bulk,
      last_success: lastSuccess || null,
      last_failure: lastFailure || null,
    };
  }));

  // window_minutes is overridable so the alert path can be exercised on demand
  // instead of only when an outage happens to land inside the default window.
  let reqBody: any = {};
  try { reqBody = await req.json(); } catch { reqBody = {}; }
  const windowMinutes = Number.isFinite(Number(reqBody?.window_minutes))
    ? Math.min(Math.max(Number(reqBody.window_minutes), 5), 1440)
    : ALERT_WINDOW_MINUTES;

  const alert = await evaluateAiHealthAndAlert(admin, supabaseUrl, serviceRoleKey, windowMinutes);
  const metaDelivery = await evaluateMetaDeliveryBlocks(admin, supabaseUrl, serviceRoleKey);

  return new Response(JSON.stringify({ ok: true, routes: routeRows, ai_health: alert, meta_delivery: metaDelivery }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

// ─── AI health verdict + one-shot email alert ───────────────────────────────
// The Gemini billing 403 of 2026-08-02 silently killed every auto-reply for
// three days. Verdict: over the last window, inbound arrived and sends failed
// but nothing was ever sent.
//
// ponytail: alert state lives in whatsapp_automation_events (event_type =
// 'route_alert_sent', decision = 'unhealthy' | 'recovered') instead of a new
// table — we only ever need the latest row.

const ALERT_WINDOW_MINUTES = 30;
const ALERT_EMAIL = "siddhant@nimt.ac.in";
const META_BLOCK_WINDOW_MINUTES = 30;
const META_BLOCK_MIN_FAILURES = 5;
const META_BLOCK_REMINDER_HOURS = 6;
const META_BLOCK_RECOVERY_QUIET_MINUTES = 60;

async function evaluateMetaDeliveryBlocks(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const { data: blocks, error } = await admin.rpc("fn_recent_whatsapp_meta_delivery_blocks", {
    p_window_minutes: META_BLOCK_WINDOW_MINUTES,
    p_minimum_failures: META_BLOCK_MIN_FAILURES,
  });
  if (error) {
    console.error("[route-health] Meta delivery block query failed:", error.message);
    return { checked: false, error: error.message, active_blocks: 0, emailed: 0 };
  }

  const { data: recipients, error: recipientError } = await admin.rpc("get_super_admin_emails");
  if (recipientError) {
    console.error("[route-health] Meta delivery alert recipient lookup failed:", recipientError.message);
    return { checked: false, error: recipientError.message, active_blocks: blocks?.length || 0, emailed: 0 };
  }
  const emails = ((recipients || []) as string[]).filter(Boolean);
  if (emails.length === 0) {
    return { checked: true, error: "No super-admin email recipients", active_blocks: blocks?.length || 0, emailed: 0 };
  }

  let emailed = 0;
  for (const block of (blocks || []) as Array<{
    phone_number_id: string;
    error_code: string;
    error_message: string;
    failure_count: number;
    first_failure_at: string;
    last_failure_at: string;
  }>) {
    const { data: previous } = await admin
      .from("whatsapp_meta_delivery_alert_state")
      .select("first_alerted_at,last_alerted_at,last_seen_at")
      .eq("phone_number_id", block.phone_number_id)
      .eq("error_code", block.error_code)
      .maybeSingle();

    const nowMs = Date.now();
    const quietMs = previous?.last_seen_at ? nowMs - new Date(previous.last_seen_at).getTime() : Infinity;
    const newIncident = !previous || quietMs > META_BLOCK_RECOVERY_QUIET_MINUTES * 60_000;
    const reminderDue = !previous?.last_alerted_at
      || nowMs - new Date(previous.last_alerted_at).getTime() >= META_BLOCK_REMINDER_HOURS * 60 * 60_000;

    if (!newIncident && !reminderDue) {
      await admin.from("whatsapp_meta_delivery_alert_state").update({
        last_seen_at: block.last_failure_at,
        last_failure_count: block.failure_count,
      }).eq("phone_number_id", block.phone_number_id).eq("error_code", block.error_code);
      continue;
    }

    let senderNumber: string | null = null;
    let senderLabel = block.phone_number_id;
    const { data: channel } = await admin
      .from("whatsapp_channels")
      .select("label,business_number")
      .eq("meta_phone_number_id", block.phone_number_id)
      .maybeSingle();
    if (channel) {
      senderLabel = channel.label || senderLabel;
      senderNumber = channel.business_number || null;
    }
    if (!senderNumber) {
      const { data: campaign } = await admin
        .from("whatsapp_campaigns")
        .select("business_phone_number")
        .eq("business_phone_number_id", block.phone_number_id)
        .not("business_phone_number", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      senderNumber = campaign?.business_phone_number || null;
    }

    const subject = `🔴 UniOs: Meta WhatsApp delivery blocked (${block.error_code})`;
    const html = `<div style="font-family:Arial,sans-serif;color:#0f172a">
      <h2 style="color:#b91c1c">Recurring Meta WhatsApp delivery block</h2>
      <p><strong>Sender:</strong> ${escapeHtml(senderNumber || senderLabel)} (${escapeHtml(block.phone_number_id)})</p>
      <p><strong>Meta error:</strong> ${escapeHtml(block.error_code)} — ${escapeHtml(block.error_message)}</p>
      <p><strong>Failures:</strong> ${block.failure_count} matching sends in the last ${META_BLOCK_WINDOW_MINUTES} minutes.</p>
      <p><strong>First / latest failure:</strong> ${escapeHtml(block.first_failure_at)} / ${escapeHtml(block.last_failure_at)}</p>
      <p>Check this sender's WhatsApp account in Meta Business Manager. Billing/eligibility errors require account-side action; retry after Meta confirms the block is cleared.</p>
      <p>While the issue continues, reminder emails are limited to one every ${META_BLOCK_REMINDER_HOURS} hours.</p>
    </div>`;

    let anySent = false;
    for (const to of emails) {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
          body: JSON.stringify({ to_email: to, custom_subject: subject, custom_body: html }),
        });
        if (res.ok) anySent = true;
        else console.error("[route-health] Meta delivery alert email failed:", res.status, (await res.text()).slice(0, 300));
      } catch (sendError) {
        console.error("[route-health] Meta delivery alert email threw:", sendError);
      }
    }

    if (anySent) {
      const alertedAt = new Date().toISOString();
      const { error: stateError } = await admin.from("whatsapp_meta_delivery_alert_state").upsert({
        phone_number_id: block.phone_number_id,
        error_code: block.error_code,
        first_alerted_at: newIncident ? alertedAt : (previous?.first_alerted_at || alertedAt),
        last_alerted_at: alertedAt,
        last_seen_at: block.last_failure_at,
        last_failure_count: block.failure_count,
      }, { onConflict: "phone_number_id,error_code" });
      if (stateError) console.error("[route-health] Meta delivery alert state save failed:", stateError.message);
      emailed++;
    }
  }

  return { checked: true, active_blocks: blocks?.length || 0, emailed };
}

async function countEvents(
  admin: ReturnType<typeof createClient>,
  eventType: string,
  sinceIso: string,
): Promise<number> {
  const { count } = await admin
    .from("whatsapp_automation_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", eventType)
    .gte("created_at", sinceIso);
  return count || 0;
}

async function evaluateAiHealthAndAlert(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceRoleKey: string,
  windowMinutes: number = ALERT_WINDOW_MINUTES,
) {
  const sinceIso = new Date(Date.now() - windowMinutes * 60_000).toISOString();

  const [inbound, sent, failed] = await Promise.all([
    countEvents(admin, "inbound_received", sinceIso),
    countEvents(admin, "ai_reply_sent", sinceIso),
    countEvents(admin, "send_failed", sinceIso),
  ]);

  const unhealthy = inbound > 0 && sent === 0 && failed > 0;

  const { data: lastAlert } = await admin
    .from("whatsapp_automation_events")
    .select("decision,created_at")
    .eq("event_type", "route_alert_sent")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const alerting = lastAlert?.decision === "unhealthy";
  const verdict = {
    window_minutes: windowMinutes,
    inbound,
    ai_replies_sent: sent,
    send_failures: failed,
    unhealthy,
    emailed: false,
  };

  // No transition — stay quiet. This is what keeps it to one email per incident.
  if (unhealthy === alerting) return verdict;

  let reason = "";
  if (unhealthy) {
    const { data: sample } = await admin
      .from("whatsapp_automation_events")
      .select("reason,decision,created_at")
      .eq("event_type", "send_failed")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    reason = (sample?.reason || sample?.decision || "unknown").slice(0, 1500);
  }

  const subject = unhealthy
    ? "🔴 UniOs: WhatsApp auto-replies are failing"
    : "🟢 UniOs: WhatsApp auto-replies have recovered";
  const body = unhealthy
    ? `<p>WhatsApp auto-replies (Navya) are failing.</p>
       <p>In the last ${windowMinutes} minutes: <b>${inbound}</b> inbound messages,
       <b>${failed}</b> send failures, <b>0</b> replies sent.</p>
       <p>Most recent failure reason:</p>
       <pre style="white-space:pre-wrap;font-size:12px">${escapeHtml(reason)}</pre>
       <p>You will not get another email about this incident until it recovers.</p>`
    : `<p>WhatsApp auto-replies are working again — <b>${sent}</b> replies sent in the last
       ${windowMinutes} minutes.</p>`;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ to_email: ALERT_EMAIL, custom_subject: subject, custom_body: body }),
    });
    if (!res.ok) {
      console.error("route-health alert email failed:", res.status, await res.text());
      return verdict; // no state row → we retry next run instead of silently swallowing
    }
  } catch (err) {
    console.error("route-health alert email threw:", err);
    return verdict;
  }

  await admin.from("whatsapp_automation_events").insert({
    phone: "system",
    event_type: "route_alert_sent",
    decision: unhealthy ? "unhealthy" : "recovered",
    reason: reason || null,
    metadata: { inbound, ai_replies_sent: sent, send_failures: failed },
  });

  return { ...verdict, emailed: true };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
