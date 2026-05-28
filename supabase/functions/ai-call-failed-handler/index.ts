import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * AI Call Failed Handler — runs every 30 minutes
 * Phase 1: Assign leads with 3+ failed calls via round-robin (SQL)
 * Phase 2: Queue retries for leads with < 3 attempts
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    let assigned = 0;
    let retries = 0;

    // ── Phase 1: Round-robin assign leads with 3+ failed calls ──
    // Each lead is routed via fn_round_robin_assign_counsellor, which picks
    // the right team (Mirai / NSAE II / BEd / Law / Mgmt / Grn Counselling)
    // from the lead's campus + course department. Hardcoding Grn Counselling
    // here previously dumped Law/Mgmt/School leads onto the wrong counsellors.
    const { data: remaining } = await db.rpc("get_leads_for_counsellor_assignment" as any);
    const candidates = ((remaining || []) as any[]).slice(0, 50);

    for (const c of candidates) {
      const lid = c.lead_id;
      const { data: pickedId, error: rrErr } = await db.rpc(
        "fn_round_robin_assign_counsellor" as any,
        { _lead_id: lid },
      );
      if (rrErr || !pickedId) continue;

      // After 3 failed AI calls, flip the lead to `cold` alongside the
      // round-robin assignment. Cold is non-terminal — the counsellor still
      // owns the lead and can re-engage on their own schedule — but it
      // suppresses the lead from the active follow-up queue so the team
      // isn't chased to chase phones that don't pick up.
      await db.from("leads")
        .update({ stage: "cold", assigned_at: new Date().toISOString() } as any)
        .eq("id", lid);
      await db.from("lead_activities").insert({
        lead_id: lid, type: "assignment",
        description: "Lead auto-marked cold + assigned after 3 failed AI calls",
      });
      assigned++;
    }

    // ── Phase 2: Queue retries for leads with < 3 attempts ──
    const { data: pendingQ } = await db.from("ai_call_queue").select("lead_id").eq("status", "pending");
    const pendingSet = new Set((pendingQ || []).map((q: any) => q.lead_id));

    let allRecords: any[] = [];
    let offset = 0;
    while (true) {
      const { data: batch } = await db.from("ai_call_records").select("lead_id, status").range(offset, offset + 999);
      if (!batch?.length) break;
      allRecords = allRecords.concat(batch);
      if (batch.length < 1000) break;
      offset += 1000;
    }

    const stats: Record<string, { total: number; completed: number }> = {};
    for (const r of allRecords) {
      if (!r.lead_id) continue;
      if (!stats[r.lead_id]) stats[r.lead_id] = { total: 0, completed: 0 };
      stats[r.lead_id].total++;
      if (r.status === "completed") stats[r.lead_id].completed++;
    }

    // Filter out leads in terminal stages before retrying
    const TERMINAL_STAGES = ["not_interested", "dnc", "rejected", "ineligible", "admitted", "cold"];
    const candidateIds = Object.entries(stats)
      .filter(([lid, s]) => s.total < 3 && s.completed === 0 && !pendingSet.has(lid))
      .map(([lid]) => lid);

    let retryInserts: any[] = [];
    if (candidateIds.length > 0) {
      const { data: activeLeads } = await db
        .from("leads")
        .select("id, stage")
        .in("id", candidateIds)
        .not("stage", "in", `(${TERMINAL_STAGES.join(",")})`);
      const activeSet = new Set((activeLeads || []).map((l: any) => l.id));
      retryInserts = candidateIds
        .filter(lid => activeSet.has(lid))
        .map(lid => ({ lead_id: lid, status: "pending", scheduled_at: new Date(Date.now() + 4 * 3600000).toISOString() }));
    }
    // Defense in depth: even though we already filtered out leads with pending
    // entries, a race could let a row sneak in between our check and insert.
    // The partial unique index on (lead_id) WHERE status='pending' will reject
    // those — swallow the unique-violation (23505) so the rest of the batch
    // still lands.
    for (let i = 0; i < retryInserts.length; i += 100) {
      const batch = retryInserts.slice(i, i + 100);
      const { error } = await db.from("ai_call_queue").insert(batch);
      if (error && error.code !== "23505") {
        console.error("[ai-call-failed-handler] queue insert error:", error);
      }
    }
    retries = retryInserts.length;

    return new Response(
      JSON.stringify({ assigned, retries }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Handler error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
