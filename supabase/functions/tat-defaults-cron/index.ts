/**
 * TAT Defaults Cron — runs every 2 hours (9 AM - 5 PM IST)
 *
 * 1. Queries counsellor_tat_defaults view
 * 2. Groups by team leader
 * 3. Sends WhatsApp + in-app notification to each leader with defaulting counsellors
 * 4. Also sends in-app notification to each counsellor with their own defaults
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const cronSecret = req.headers.get("x-cron-secret");
    const expectedSecret = Deno.env.get("CRON_SECRET");
    const authHeader = req.headers.get("Authorization");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const token = authHeader?.replace("Bearer ", "") || "";

    if (cronSecret !== expectedSecret && token !== serviceRoleKey && !authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const db = createClient(supabaseUrl, serviceRoleKey);

    // 1. Get team leader defaults summary
    const { data: leaderDefaults } = await db
      .from("team_leader_defaults_summary" as any)
      .select("*");

    // 2. Get ALL counsellor defaults (for individual notifications)
    const { data: allDefaults } = await db
      .from("counsellor_tat_defaults" as any)
      .select("*");

    let leaderNotifications = 0;
    let counsellorNotifications = 0;
    let whatsappSent = 0;

    // 3. Notify each counsellor about their own defaults
    for (const d of (allDefaults || []) as any[]) {
      if (d.total_defaults === 0) continue;

      const parts: string[] = [];
      if (d.new_leads_overdue > 0) parts.push(`${d.new_leads_overdue} new leads pending first contact`);
      if (d.overdue_followups > 0) parts.push(`${d.overdue_followups} overdue follow-ups`);
      if (d.app_checkins_overdue > 0) parts.push(`${d.app_checkins_overdue} application check-ins due`);

      await db.from("notifications").insert({
        user_id: d.user_id,
        type: "tat_defaults_report",
        title: `You have ${d.total_defaults} TAT default(s)`,
        body: parts.join(", ") + ". Please clear these immediately.",
        link: "/admissions",
      });
      counsellorNotifications++;
    }

    // 4. Group leader defaults by leader and send WhatsApp + notification
    const byLeader = new Map<string, any[]>();
    for (const row of (leaderDefaults || []) as any[]) {
      const existing = byLeader.get(row.leader_user_id) || [];
      existing.push(row);
      byLeader.set(row.leader_user_id, existing);
    }

    for (const [leaderUserId, counsellorRows] of byLeader) {
      const leader = counsellorRows[0];
      const totalDefaults = counsellorRows.reduce((s: number, d: any) => s + d.total_defaults, 0);

      // Build summary text
      const lines = counsellorRows.map((d: any) => {
        const parts: string[] = [];
        if (d.new_leads_overdue > 0) parts.push(`${d.new_leads_overdue} new`);
        if (d.overdue_followups > 0) parts.push(`${d.overdue_followups} FU`);
        if (d.app_checkins_overdue > 0) parts.push(`${d.app_checkins_overdue} app`);
        return `${d.counsellor_name}: ${parts.join(", ")}`;
      });
      const summaryText = lines.join("\n");

      // In-app notification to leader
      await db.from("notifications").insert({
        user_id: leaderUserId,
        type: "tat_defaults_report",
        title: `TAT Defaults: ${totalDefaults} pending across your team`,
        body: `${counsellorRows.length} counsellor(s) have pending tasks:\n${summaryText}\n\nPlease ensure clearance within 2 hours.`,
        link: "/counsellor-dashboard",
      });
      leaderNotifications++;

      // WhatsApp to leader
      if (leader.leader_phone) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({
              template_key: "team_leader_defaults",
              phone: leader.leader_phone,
              params: [leader.leader_name, String(totalDefaults), summaryText],
            }),
          });
          whatsappSent++;
        } catch (e: any) {
          console.error(`WhatsApp to leader failed:`, e.message);
        }
      }
    }

    return new Response(JSON.stringify({
      counsellor_notifications: counsellorNotifications,
      leader_notifications: leaderNotifications,
      whatsapp_sent: whatsappSent,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("tat-defaults-cron error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
