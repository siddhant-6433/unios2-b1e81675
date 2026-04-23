import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Visit Confirmation Cron — runs daily at 9 AM IST
 * Notifies counsellors about visits needing confirmation (today + tomorrow).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: visits, error } = await supabase
      .from("visits_needing_confirmation")
      .select("*");

    if (error) throw error;
    if (!visits?.length) {
      return new Response(JSON.stringify({ message: "No visits needing confirmation", count: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get counsellor profiles
    const counsellorIds = [...new Set(visits.map((v: any) => v.counsellor_id).filter(Boolean))];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, user_id, display_name, phone")
      .in("id", counsellorIds);

    const profileMap = new Map<string, any>();
    for (const p of profiles || []) profileMap.set(p.id, p);

    let notified = 0;

    for (const visit of visits as any[]) {
      const counsellor = profileMap.get(visit.counsellor_id);
      if (!counsellor) continue;

      const urgencyLabel = visit.urgency === "same_day" ? "TODAY" : "TOMORROW";
      const visitDate = new Date(visit.visit_date).toLocaleDateString("en-IN", {
        weekday: "short", day: "numeric", month: "short",
      });

      // In-app notification
      await supabase.from("notifications").insert({
        user_id: counsellor.user_id,
        type: "visit_confirmation_due",
        title: `Confirm visit: ${visit.lead_name}`,
        body: `Visit ${urgencyLabel} (${visitDate}) at ${visit.campus_name || "campus"}. Call to confirm attendance.`,
        link: `/admissions/${visit.lead_id}`,
        lead_id: visit.lead_id,
      });

      // WhatsApp to counsellor
      if (counsellor.phone) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({
              template_key: "counsellor_visit_confirmation",
              phone: counsellor.phone,
              params: [visit.lead_name, visitDate, visit.campus_name || "NIMT campus"],
            }),
          });
        } catch (e) {
          console.error("WhatsApp failed:", e);
        }
      }

      notified++;
    }

    return new Response(
      JSON.stringify({ message: `Notified ${notified} visit confirmations`, count: notified }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Visit confirmation cron error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
