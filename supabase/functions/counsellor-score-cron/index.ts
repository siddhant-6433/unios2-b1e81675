import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/*
  Counsellor Score Cron — Daily Penalty Assessment
  Runs once daily at 10pm IST.

  Penalties:
  1. Overdue follow-ups (24h+ past scheduled): -5 per lead per day
  2. Inactive assigned leads (no activity 3+ days): -5 per lead per day
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

  const today = new Date().toISOString().slice(0, 10);
  let penalties = 0;

  try {
    // 1. Overdue follow-ups (pending, 24h+ past scheduled)
    const { data: overdueFollowups } = await supabase
      .from("overdue_followups")
      .select("id, lead_id, counsellor_id, days_overdue")
      .gt("days_overdue", 0);

    for (const fu of (overdueFollowups || []) as any[]) {
      if (!fu.counsellor_id) continue;

      // Dedup: one penalty per lead per day for this type
      const { count } = await supabase
        .from("score_penalty_log")
        .select("id", { count: "exact", head: true })
        .eq("counsellor_id", fu.counsellor_id)
        .eq("lead_id", fu.lead_id)
        .eq("penalty_type", "followup_overdue")
        .eq("penalty_date", today);

      if ((count || 0) > 0) continue;

      await supabase.from("counsellor_score_events").insert({
        counsellor_id: fu.counsellor_id,
        lead_id: fu.lead_id,
        action_type: "followup_overdue_penalty",
        points: -5,
        metadata: { days_overdue: fu.days_overdue },
      });

      await supabase.from("score_penalty_log").insert({
        counsellor_id: fu.counsellor_id,
        lead_id: fu.lead_id,
        penalty_type: "followup_overdue",
      });

      penalties++;
    }

    // 2. Inactive leads (no update in 3+ days, active stages)
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const { data: inactiveLeads } = await supabase
      .from("leads")
      .select("id, counsellor_id, stage, updated_at")
      .not("counsellor_id", "is", null)
      .not("stage", "in", "(admitted,rejected,not_interested)")
      .lt("updated_at", threeDaysAgo.toISOString())
      .limit(200);

    for (const lead of (inactiveLeads || []) as any[]) {
      // Dedup
      const { count } = await supabase
        .from("score_penalty_log")
        .select("id", { count: "exact", head: true })
        .eq("counsellor_id", lead.counsellor_id)
        .eq("lead_id", lead.id)
        .eq("penalty_type", "inactive_lead")
        .eq("penalty_date", today);

      if ((count || 0) > 0) continue;

      const daysInactive = Math.floor((Date.now() - new Date(lead.updated_at).getTime()) / 86400000);

      await supabase.from("counsellor_score_events").insert({
        counsellor_id: lead.counsellor_id,
        lead_id: lead.id,
        action_type: "inactive_lead_penalty",
        points: -5,
        metadata: { days_inactive: daysInactive, stage: lead.stage },
      });

      await supabase.from("score_penalty_log").insert({
        counsellor_id: lead.counsellor_id,
        lead_id: lead.id,
        penalty_type: "inactive_lead",
      });

      penalties++;
    }

    return new Response(
      JSON.stringify({ message: `Applied ${penalties} penalties`, penalties }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Score cron error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
