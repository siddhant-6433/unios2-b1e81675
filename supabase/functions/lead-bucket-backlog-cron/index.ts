import { createClient } from "npm:@supabase/supabase-js@2";

/*
  Lead Bucket Backlog Cron

  Pings team leaders + admission heads when unassigned leads in the bucket
  are decaying past their tier's threshold:

    paid    (meta_ads, google_ads)         → 30 minutes
    website (website, mirai_website)        → 2 hours
    other   (everything else)               → 4 hours

  Recipients are de-duped: one in-app notification per (recipient,
  alert_key) per hour. A persistent backlog re-notifies every hour, not
  every 30-minute cron tick.

  Runs every 30 min Mon-Sat, 9 AM-8 PM IST (scheduled by
  20260615092000_lead_bucket_backlog_cron.sql).
*/

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Tier = "paid" | "website" | "other";

function sourceTier(source: string | null | undefined): Tier {
  if (source === "meta_ads" || source === "google_ads") return "paid";
  if (source === "website" || source === "mirai_website") return "website";
  return "other";
}

const TIER_THRESHOLD_MS: Record<Tier, number> = {
  paid: 30 * 60 * 1000,
  website: 2 * 60 * 60 * 1000,
  other: 4 * 60 * 60 * 1000,
};

const TIER_LABEL: Record<Tier, string> = {
  paid: "Meta/Google Ads",
  website: "Website",
  other: "Other sources",
};

// 9 AM – 8 PM IST, Mon-Sat. pg_cron already restricts to this window, but
// double-guard at the function level for manual invocations.
function isBusinessHoursIST(now = new Date()): boolean {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const dow = ist.getUTCDay(); // 0=Sun, 6=Sat
  if (dow === 0) return false;
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return mins >= 540 && mins < 1200; // 9:00 – 20:00
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    if (!isBusinessHoursIST()) {
      return new Response(
        JSON.stringify({ message: "Outside business hours, skipping", alerts: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1. Pull unassigned leads bucketed by (bucket, source_tier), filter by age.
    const { data: unassigned, error: bucketErr } = await supabase
      .rpc("get_unassigned_leads_bucket");

    if (bucketErr) throw bucketErr;

    type Row = { id: string; source: string | null; created_at: string; bucket: string | null };
    const rows = (unassigned || []) as Row[];
    const now = Date.now();

    // bucket+tier → count of leads past the threshold
    const counts = new Map<string, number>();
    for (const r of rows) {
      const tier = sourceTier(r.source);
      const ageMs = now - new Date(r.created_at).getTime();
      if (ageMs < TIER_THRESHOLD_MS[tier]) continue;
      const bucket = r.bucket || "unclassified";
      const key = `${bucket}-${tier}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    if (counts.size === 0) {
      return new Response(
        JSON.stringify({ message: "No backlog past thresholds", alerts: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Gather recipient user_ids: distinct team leaders + supervisory roles.
    const recipientSet = new Set<string>();

    const { data: teams } = await supabase
      .from("teams")
      .select("leader_id");
    const leaderProfileIds = [...new Set((teams || []).map((t: any) => t.leader_id).filter(Boolean))];
    if (leaderProfileIds.length > 0) {
      const { data: leaderProfiles } = await supabase
        .from("profiles")
        .select("user_id")
        .in("id", leaderProfileIds);
      for (const p of leaderProfiles || []) {
        if ((p as any).user_id) recipientSet.add((p as any).user_id);
      }
    }

    const { data: supervisors } = await supabase
      .from("user_roles")
      .select("user_id")
      .in("role", ["super_admin", "campus_admin", "admission_head"]);
    for (const r of supervisors || []) {
      if ((r as any).user_id) recipientSet.add((r as any).user_id);
    }

    if (recipientSet.size === 0) {
      return new Response(
        JSON.stringify({ message: "No recipients found", alerts: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 3. For each (recipient, alert_key), check 1h cooldown then notify.
    const cutoff = new Date(now - 60 * 60 * 1000).toISOString();
    let alertsSent = 0;

    for (const recipient of recipientSet) {
      for (const [alertKey, count] of counts) {
        const { count: recent } = await supabase
          .from("lead_bucket_backlog_alerts")
          .select("id", { count: "exact", head: true })
          .eq("recipient_user_id", recipient)
          .eq("alert_key", alertKey)
          .gte("created_at", cutoff);

        if ((recent || 0) > 0) continue;

        const [bucket, tier] = alertKey.split("-") as [string, Tier];
        const tierLabel = TIER_LABEL[tier];
        const bucketLabel = bucket === "school" ? "School" : bucket === "college" ? "College" : bucket;

        await supabase.from("notifications").insert({
          user_id: recipient,
          type: "lead_bucket_backlog",
          title: `${count} ${tierLabel} ${count === 1 ? "lead" : "leads"} pending assignment`,
          body: `${bucketLabel} bucket has ${count} unassigned ${tierLabel} ${count === 1 ? "lead" : "leads"} past the assignment threshold. Assign to counsellors on urgent basis.`,
          link: `/lead-buckets?bucket=${encodeURIComponent(bucket)}`,
        });

        await supabase.from("lead_bucket_backlog_alerts").insert({
          recipient_user_id: recipient,
          alert_key: alertKey,
          pending_count: count,
        });

        alertsSent++;
      }
    }

    return new Response(
      JSON.stringify({
        message: `Sent ${alertsSent} backlog alerts`,
        alerts: alertsSent,
        backlog: Object.fromEntries(counts),
        recipients: recipientSet.size,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("Lead bucket backlog cron error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
