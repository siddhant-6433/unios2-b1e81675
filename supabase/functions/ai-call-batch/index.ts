/**
 * Batch AI Call — queues AI calls for a list of leads.
 *
 * Instead of processing sequentially (would timeout), it inserts rows into
 * an ai_call_queue table. A pg_cron job picks them up and fires calls
 * one at a time every 30 seconds.
 *
 * Input: { lead_ids: string[] }
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth
    const authHeader = req.headers.get("authorization") || "";
    const db = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: authErr } = await db.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { lead_ids } = await req.json();
    if (!lead_ids?.length) return json({ error: "lead_ids required" }, 400);

    // Filter leads that have phone numbers and are not in terminal stages
    const { data: validLeads } = await db
      .from("leads")
      .select("id, phone, stage")
      .in("id", lead_ids)
      .not("phone", "is", null)
      .not("stage", "in", '("not_interested","dnc","rejected","ineligible")');

    const validIds = (validLeads || []).filter((l: any) => l.phone?.trim()).map((l: any) => l.id);
    const skipped = lead_ids.length - validIds.length;

    if (validIds.length === 0) {
      return json({ success: true, queued: 0, skipped, message: "No leads with phone numbers" });
    }

    // Insert into queue table — cron picks up 5 per minute
    // Stagger 12s apart so 5 fit within each 1-minute cron window
    // The `(lead_id) WHERE status='pending'` partial unique index would
    // reject the entire batch if even one lead already has a pending row.
    // Filter those out first so the remaining insert is conflict-free.
    let alreadyQueuedSkipped = 0;
    let insertIds = validIds as string[];
    if (validIds.length > 0) {
      const { data: existing } = await db
        .from("ai_call_queue" as any)
        .select("lead_id")
        .eq("status", "pending")
        .in("lead_id", validIds);
      const pending = new Set((existing || []).map((r: any) => r.lead_id));
      insertIds = validIds.filter((id: string) => !pending.has(id));
      alreadyQueuedSkipped = validIds.length - insertIds.length;
    }

    const queueRows = insertIds.map((id: string, i: number) => ({
      lead_id: id,
      status: "pending",
      scheduled_at: new Date(Date.now() + i * 12000).toISOString(),
      requested_by: user.id,
    }));

    if (queueRows.length > 0) {
      const { error: qErr } = await db.from("ai_call_queue" as any).insert(queueRows);
      if (qErr) return json({ error: `Queue insert failed: ${qErr.message}` }, 500);
    }

    return json({
      success: true,
      queued: insertIds.length,
      skipped: skipped + alreadyQueuedSkipped,
      already_pending: alreadyQueuedSkipped,
      message: `${insertIds.length} AI calls queued${alreadyQueuedSkipped ? ` (${alreadyQueuedSkipped} already pending)` : ""}.`,
    });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
});
