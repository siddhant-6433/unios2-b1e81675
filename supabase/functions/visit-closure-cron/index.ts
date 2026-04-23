import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Visit Closure Cron — runs at 4:30 PM IST
 * 1. Warns counsellors about unclosed visits from today
 * 2. Applies -10 score penalty for visits left unclosed past the day
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: unclosed, error } = await supabase
      .from("visits_unclosed_today")
      .select("*");

    if (error) throw error;
    if (!unclosed?.length) {
      return new Response(JSON.stringify({ message: "No unclosed visits", count: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    let warnings = 0;
    let penalties = 0;

    for (const visit of unclosed as any[]) {
      if (!visit.counsellor_id) continue;

      const visitDate = new Date(visit.visit_date);
      const isToday = visitDate.toISOString().slice(0, 10) === today;
      const daysPast = Math.floor((Date.now() - visitDate.getTime()) / 86400000);

      // Always send notification
      if (visit.counsellor_user_id) {
        await supabase.from("notifications").insert({
          user_id: visit.counsellor_user_id,
          type: "visit_closure_warning",
          title: isToday
            ? `Close visit: ${visit.lead_name}`
            : `Overdue: ${visit.lead_name} (${daysPast}d ago)`,
          body: isToday
            ? `Visit at ${visit.campus_name || "campus"} needs to be marked completed, no-show, or cancelled before end of day.`
            : `Visit from ${daysPast} day(s) ago was never closed. Mark it now to avoid further penalties.`,
          link: `/admissions/${visit.lead_id}`,
          lead_id: visit.lead_id,
        });
        warnings++;
      }

      // Apply penalty for visits from PAST days (not today — they still have time)
      if (!isToday) {
        const { count: penaltyExists } = await supabase
          .from("score_penalty_log")
          .select("id", { count: "exact", head: true })
          .eq("counsellor_id", visit.counsellor_id)
          .eq("lead_id", visit.lead_id)
          .eq("penalty_type", "visit_unclosed")
          .eq("penalty_date", today);

        if ((penaltyExists || 0) === 0) {
          await supabase.from("counsellor_score_events").insert({
            counsellor_id: visit.counsellor_id,
            lead_id: visit.lead_id,
            action_type: "visit_unclosed",
            points: -10,
            metadata: { visit_id: visit.visit_id, days_past: daysPast },
          });
          await supabase.from("score_penalty_log").insert({
            counsellor_id: visit.counsellor_id,
            lead_id: visit.lead_id,
            penalty_type: "visit_unclosed",
          });
          penalties++;
        }
      }
    }

    return new Response(
      JSON.stringify({ message: `Warnings: ${warnings}, Penalties: ${penalties}`, warnings, penalties }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Visit closure cron error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
