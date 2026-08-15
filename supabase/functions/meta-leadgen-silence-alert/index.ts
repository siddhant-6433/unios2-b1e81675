// Meta lead-ingestion silence watchdog — EMAIL channel.
//
// Runs daily via pg_cron. If zero Meta ad-leads (leads.meta_leadgen_id NOT NULL)
// have entered the CRM in the last 24h, emails every super_admin so the outage
// is visible off the in-app notification feed (which nobody watches — the 08-05
// CRON_SECRET outage fired 39 in-app alerts, all unread for 13 days).
//
// The in-app notification path (report_meta_leadgen_silence + cron #72) is left
// untouched and independent, so a break here can't silence that channel too.
//
// Auth: x-cron-secret === CRON_SECRET (same model as meta-leads-poll).
// Email transport is the existing send-email function (Resend + email_messages
// logging), called with the service-role bearer.
//
// POST ?force=1 to send the alert regardless of the 24h count (manual test).

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const expected = Deno.env.get("CRON_SECRET");
  if (!expected || req.headers.get("x-cron-secret") !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const force = new URL(req.url).searchParams.get("force") === "1";

  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error: countErr } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .not("meta_leadgen_id", "is", null)
    .gte("created_at", sinceIso);

  if (countErr) {
    console.error("[silence-alert] lead count failed", countErr);
    return new Response(JSON.stringify({ error: countErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if ((count ?? 0) > 0 && !force) {
    return new Response(JSON.stringify({ ok: true, silent: false, leads_24h: count }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Silent (or forced). Get the last real Meta lead for context.
  const { data: last } = await supabase
    .from("leads")
    .select("created_at")
    .not("meta_leadgen_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: recipients, error: recErr } = await supabase.rpc("get_super_admin_emails");
  if (recErr) {
    console.error("[silence-alert] recipient lookup failed", recErr);
    return new Response(JSON.stringify({ error: recErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const emails: string[] = (recipients ?? []).filter(Boolean);
  if (emails.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: "no super_admin recipients" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const lastSeen = last?.created_at
    ? new Date(last.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    : "more than 24h ago";
  const subject = "⚠️ Meta lead ingestion has stopped";
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#0f172a">
      <h2 style="margin:0 0 8px;color:#b91c1c">Meta lead ingestion has stopped</h2>
      <p style="margin:0 0 12px;color:#334155">
        No Meta ad-leads have entered the CRM in the last 24 hours.
        Last Meta lead: <strong>${lastSeen}</strong>.
      </p>
      <p style="margin:0 0 12px;color:#334155">
        Common causes: the edge <code>CRON_SECRET</code> drifted (cron→function 401s),
        <code>verify_jwt</code> flipped true on a redeploy, <code>META_PAGE_ACCESS_TOKEN</code>
        expired, or the page's leadgen webhook subscription lapsed.
      </p>
      <p style="margin:0 0 12px;color:#334155">
        Check: <code>function_edge_logs</code> for <code>meta-leads-poll</code> (should be 200),
        Edge Function secrets, and the page's <code>subscribed_apps</code>.
        Backfill once fixed:
        <code>POST /functions/v1/meta-leads-poll?lookback_days=N&amp;throttle_ms=2000</code>.
      </p>
      <p style="margin:16px 0 0"><a href="https://uni.nimt.ac.in/leads?source=meta_ads">Open Meta leads →</a></p>
    </div>`;

  const results: Array<{ to: string; ok: boolean; error?: string }> = [];
  for (const to of emails) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ to_email: to, custom_subject: subject, custom_body: html }),
      });
      const json = await res.json().catch(() => ({}));
      results.push({ to, ok: res.ok, error: res.ok ? undefined : (json?.error || `HTTP ${res.status}`) });
    } catch (e: any) {
      results.push({ to, ok: false, error: e?.message });
    }
  }

  console.log("[silence-alert] sent", { leads_24h: count, force, results });
  return new Response(JSON.stringify({ ok: true, silent: true, leads_24h: count, last_meta_lead: last?.created_at ?? null, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
