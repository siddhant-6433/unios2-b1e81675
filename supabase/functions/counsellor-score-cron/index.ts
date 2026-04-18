import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/*
  Counsellor Score Cron — Daily Penalty Assessment
  Runs once daily at 10pm IST.

  Penalties:
  1. Overdue follow-ups (past scheduled): -3 per lead per day
  2. New leads without first contact (assigned > 24h ago): -5 per lead per day
  3. Inactive assigned leads (no activity 3+ days): -3 per lead per day
  4. Post-visit pending (72h+ without followup): -8 per lead per day
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

  const applyPenalty = async (counsellorId: string, leadId: string, type: string, points: number, meta: any) => {
    // Dedup: one penalty per lead per day per type
    const { count } = await supabase
      .from("score_penalty_log")
      .select("id", { count: "exact", head: true })
      .eq("counsellor_id", counsellorId)
      .eq("lead_id", leadId)
      .eq("penalty_type", type)
      .eq("penalty_date", today);

    if ((count || 0) > 0) return false;

    await supabase.from("counsellor_score_events").insert({
      counsellor_id: counsellorId,
      lead_id: leadId,
      action_type: type,
      points,
      metadata: meta,
    });

    await supabase.from("score_penalty_log").insert({
      counsellor_id: counsellorId,
      lead_id: leadId,
      penalty_type: type,
    });

    return true;
  };

  try {
    // 1. Overdue follow-ups (-3 per lead per day)
    const { data: overdueFollowups } = await supabase
      .from("overdue_followups")
      .select("id, lead_id, counsellor_id, days_overdue")
      .gt("days_overdue", 0);

    for (const fu of (overdueFollowups || []) as any[]) {
      if (!fu.counsellor_id) continue;
      if (await applyPenalty(fu.counsellor_id, fu.lead_id, "followup_overdue", -3, { days_overdue: fu.days_overdue })) {
        penalties++;
      }
    }

    // 2. New leads without first contact (assigned > 24h ago, still at new_lead stage) — HEAVY penalty -5
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const { data: uncontactedLeads } = await supabase
      .from("leads")
      .select("id, counsellor_id, created_at")
      .not("counsellor_id", "is", null)
      .eq("stage", "new_lead")
      .is("first_contact_at", null)
      .lt("created_at", oneDayAgo.toISOString())
      .limit(500);

    for (const lead of (uncontactedLeads || []) as any[]) {
      const daysWaiting = Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 86400000);
      if (await applyPenalty(lead.counsellor_id, lead.id, "new_lead_uncontacted", -5, { days_waiting: daysWaiting })) {
        penalties++;
      }
    }

    // 3. Inactive leads — no update in 3+ days, active stages (-3 per lead per day)
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const { data: inactiveLeads } = await supabase
      .from("leads")
      .select("id, counsellor_id, stage, updated_at")
      .not("counsellor_id", "is", null)
      .not("stage", "in", "(admitted,rejected,not_interested,new_lead)")
      .lt("updated_at", threeDaysAgo.toISOString())
      .limit(500);

    for (const lead of (inactiveLeads || []) as any[]) {
      const daysInactive = Math.floor((Date.now() - new Date(lead.updated_at).getTime()) / 86400000);
      if (await applyPenalty(lead.counsellor_id, lead.id, "inactive_lead", -3, { days_inactive: daysInactive, stage: lead.stage })) {
        penalties++;
      }
    }

    // 4. Post-visit pending 72h+ without followup (-8 per lead per day)
    const { data: postVisitPending } = await supabase
      .from("post_visit_pending_followups")
      .select("visit_id, lead_id, counsellor_id, days_since_visit")
      .gte("days_since_visit", 3);

    for (const pv of (postVisitPending || []) as any[]) {
      if (!pv.counsellor_id) continue;
      if (await applyPenalty(pv.counsellor_id, pv.lead_id, "post_visit_overdue", -8, { days_since_visit: pv.days_since_visit })) {
        penalties++;
      }
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
