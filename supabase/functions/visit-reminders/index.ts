/**
 * Visit Reminders
 * ─────────────────────────────────────────────────────────────
 * Sends WhatsApp reminders for all campus visits scheduled today.
 * Called daily by pg_cron at 08:00 IST (02:30 UTC).
 *
 * Auth: x-cron-secret header must match CRON_SECRET env var.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth
  const secret = req.headers.get("x-cron-secret");
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) {
    console.error("CRON_SECRET is not configured");
    return new Response("Server configuration error", { status: 500 });
  }
  if (!secret || secret !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Get today's date range (UTC)
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const todayEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));

  // Fetch today's scheduled visits with lead & campus info
  const { data: visits, error } = await supabase
    .from("campus_visits")
    .select(`
      id,
      visit_date,
      lead_id,
      leads ( id, name, phone ),
      campuses ( id, name, city )
    `)
    .eq("status", "scheduled")
    .gte("visit_date", todayStart.toISOString())
    .lte("visit_date", todayEnd.toISOString());

  if (error) {
    console.error("Failed to fetch visits:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!visits || visits.length === 0) {
    console.log("No visits scheduled for today.");
    return new Response(JSON.stringify({ sent: 0, message: "No visits today" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log(`Sending reminders for ${visits.length} visit(s)`);

  let sent = 0;
  let failed = 0;

  for (const visit of visits) {
    const lead = (visit as any).leads;
    const campus = (visit as any).campuses;
    if (!lead?.phone) {
      console.log(`Visit ${visit.id}: no phone for lead ${visit.lead_id}`);
      continue;
    }

    const visitTime = new Date(visit.visit_date).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });

    const campusLabel = campus?.name
      ? (campus.city ? `${campus.name}, ${campus.city}` : campus.name)
      : "our campus";

    // Send WhatsApp via the send-whatsapp edge function
    const { error: waError } = await supabase.functions.invoke("send-whatsapp", {
      body: {
        to: lead.phone,
        message: `Hi ${lead.name}, this is a reminder that your campus visit at ${campusLabel} is scheduled for today — ${visitTime}. We look forward to seeing you! Reply STOP to opt out.`,
      },
    });

    if (waError) {
      console.error(`WhatsApp failed for ${lead.name} (${lead.phone}):`, waError.message);
      failed++;
    } else {
      // Log activity
      await supabase.from("lead_activities").insert({
        lead_id: visit.lead_id,
        type: "whatsapp",
        description: `Automated visit reminder sent via WhatsApp for visit on ${visitTime}`,
      });
      sent++;
    }
  }

  console.log(`Done: ${sent} sent, ${failed} failed`);
  return new Response(
    JSON.stringify({ sent, failed, total: visits.length }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
