import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/*
  Post-Visit Nudge Cron
  Runs every 2 hours during business hours.

  Tiered escalation:
  Tier 1 (4h+):   In-app notification to counsellor
  Tier 2 (24h+):  WhatsApp to counsellor
  Tier 3 (48h+):  In-app to counsellor + team leader
  Tier 4 (72h+):  WhatsApp to team leader, score penalty
  Tier 5 (5d+):   Escalate to admin
*/

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
    // Fetch all pending post-visit followups
    const { data: pending, error: pendingErr } = await supabase
      .from("post_visit_pending_followups")
      .select("*");

    if (pendingErr) throw pendingErr;
    if (!pending?.length) {
      return new Response(JSON.stringify({ message: "No pending post-visit followups", nudges: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get counsellor user_ids and phones for notifications
    const counsellorIds = [...new Set(pending.map((p: any) => p.counsellor_id))];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, user_id, display_name, phone")
      .in("id", counsellorIds);

    const profileMap = new Map<string, any>();
    for (const p of profiles || []) profileMap.set(p.id, p);

    // Get team leaders for escalation
    const { data: teamMembers } = await supabase
      .from("team_members")
      .select("user_id, teams!inner(leader_id, profiles:leader_id(id, user_id, display_name, phone))")
      .in("user_id", (profiles || []).map((p: any) => p.user_id));

    // Map counsellor profile_id -> team leader profile
    const leaderMap = new Map<string, any>();
    for (const tm of (teamMembers || []) as any[]) {
      const leader = tm.teams?.profiles;
      if (!leader) continue;
      // Find counsellor profile_id from user_id
      const counsellor = (profiles || []).find((p: any) => p.user_id === tm.user_id);
      if (counsellor) leaderMap.set(counsellor.id, leader);
    }

    let nudgeCount = 0;

    for (const visit of pending as any[]) {
      const hoursSinceVisit = (Date.now() - new Date(visit.visit_date).getTime()) / 3600000;
      const counsellor = profileMap.get(visit.counsellor_id);
      if (!counsellor) continue;

      const leader = leaderMap.get(visit.counsellor_id);

      // Determine applicable tier
      let tier = 0;
      if (hoursSinceVisit >= 120) tier = 5;       // 5 days
      else if (hoursSinceVisit >= 72) tier = 4;    // 3 days
      else if (hoursSinceVisit >= 48) tier = 3;    // 2 days
      else if (hoursSinceVisit >= 24) tier = 2;    // 1 day
      else if (hoursSinceVisit >= 4) tier = 1;     // 4 hours

      if (tier === 0) continue;

      // Check if this tier was already sent for this visit
      const { count: existing } = await supabase
        .from("visit_followup_nudges")
        .select("id", { count: "exact", head: true })
        .eq("visit_id", visit.visit_id)
        .eq("tier", tier);

      if ((existing || 0) > 0) continue;

      // Record nudge
      await supabase.from("visit_followup_nudges").insert({
        visit_id: visit.visit_id,
        lead_id: visit.lead_id,
        counsellor_id: visit.counsellor_id,
        tier,
      });

      const daysText = visit.days_since_visit === 0 ? "today" : `${visit.days_since_visit} day${visit.days_since_visit > 1 ? "s" : ""} ago`;

      // Tier 1: In-app to counsellor
      if (tier >= 1) {
        await supabase.from("notifications").insert({
          user_id: counsellor.user_id,
          type: "post_visit_nudge",
          title: `Follow up: ${visit.lead_name}`,
          body: `Campus visit was ${daysText}. Call now to maintain momentum.`,
          link: `/admissions/${visit.lead_id}`,
          lead_id: visit.lead_id,
        });
      }

      // Tier 2: WhatsApp to counsellor
      if (tier >= 2 && counsellor.phone) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({
              template_key: "counsellor_followup_overdue",
              phone: counsellor.phone,
              params: [visit.lead_name, new Date(visit.visit_date).toLocaleDateString("en-IN")],
            }),
          });
        } catch (e) {
          console.error("WhatsApp send failed for counsellor:", e);
        }
      }

      // Tier 3: Notify team leader
      if (tier >= 3 && leader) {
        await supabase.from("notifications").insert({
          user_id: leader.user_id,
          type: "post_visit_nudge",
          title: `Escalation: ${counsellor.display_name} — ${visit.lead_name}`,
          body: `Post-visit follow-up pending ${daysText}. ${counsellor.display_name} hasn't followed up since the campus visit.`,
          link: `/admissions/${visit.lead_id}`,
          lead_id: visit.lead_id,
        });
      }

      // Tier 4: WhatsApp to team leader + score penalty
      if (tier >= 4) {
        // Score penalty for post-visit overdue
        const today = new Date().toISOString().slice(0, 10);
        const { count: penaltyExists } = await supabase
          .from("score_penalty_log")
          .select("id", { count: "exact", head: true })
          .eq("counsellor_id", visit.counsellor_id)
          .eq("lead_id", visit.lead_id)
          .eq("penalty_type", "post_visit_overdue")
          .eq("penalty_date", today);

        if ((penaltyExists || 0) === 0) {
          await supabase.from("counsellor_score_events").insert({
            counsellor_id: visit.counsellor_id,
            lead_id: visit.lead_id,
            action_type: "post_visit_overdue",
            points: -10,
            metadata: { days_since_visit: visit.days_since_visit, tier },
          });
          await supabase.from("score_penalty_log").insert({
            counsellor_id: visit.counsellor_id,
            lead_id: visit.lead_id,
            penalty_type: "post_visit_overdue",
          });
        }

        // WhatsApp to team leader
        if (leader?.phone) {
          try {
            await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceRoleKey}`,
              },
              body: JSON.stringify({
                template_key: "counsellor_followup_overdue",
                phone: leader.phone,
                params: [
                  `${visit.lead_name} (${counsellor.display_name}'s lead)`,
                  new Date(visit.visit_date).toLocaleDateString("en-IN"),
                ],
              }),
            });
          } catch (e) {
            console.error("WhatsApp send failed for leader:", e);
          }
        }
      }

      nudgeCount++;
    }

    return new Response(
      JSON.stringify({ message: `Processed ${nudgeCount} nudges`, nudges: nudgeCount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Post-visit nudge error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
