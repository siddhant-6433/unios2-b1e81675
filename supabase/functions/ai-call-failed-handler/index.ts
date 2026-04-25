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

    // ── Phase 1: Round-robin assign leads with 3+ failed calls (via SQL) ──
    const assignSql = `
      WITH team_members AS (
        SELECT p.id as profile_id, ROW_NUMBER() OVER (ORDER BY p.id) as rn
        FROM teams t JOIN team_members tm ON tm.team_id = t.id JOIN profiles p ON p.user_id = tm.user_id
        WHERE t.name = 'Grn Counselling'
      ),
      leads_to_assign AS (
        SELECT l.id as lead_id, ROW_NUMBER() OVER (ORDER BY l.created_at) as rn
        FROM get_leads_for_counsellor_assignment() a
        JOIN leads l ON l.id = a.lead_id
        LIMIT 50
      ),
      updated AS (
        UPDATE leads SET counsellor_id = tm.profile_id, assigned_at = now()
        FROM leads_to_assign la
        JOIN team_members tm ON ((la.rn - 1) % (SELECT count(*) FROM team_members)) + 1 = tm.rn
        WHERE leads.id = la.lead_id AND leads.counsellor_id IS NULL
        RETURNING leads.id
      ),
      followups AS (
        INSERT INTO lead_followups (lead_id, scheduled_at, type, notes, status)
        SELECT id, now() + interval '30 minutes', 'call',
          '🤖 AI Call: Max 3 attempts failed — counsellor follow-up required', 'pending'
        FROM updated
        RETURNING lead_id
      )
      SELECT count(*) as assigned_count FROM updated;
    `;

    const assignRes = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ sql: assignSql }),
    });

    // Fallback: use direct query if exec_sql doesn't exist
    if (!assignRes.ok) {
      // Run via the query endpoint
      const { data: remaining } = await db.rpc("get_leads_for_counsellor_assignment" as any);
      const candidates = (remaining || []) as any[];

      if (candidates.length > 0) {
        // Get Grn Counselling team members
        const { data: teams } = await db.from("teams").select("id").eq("name", "Grn Counselling").limit(1);
        if (teams?.length) {
          const { data: members } = await db.from("team_members").select("user_id").eq("team_id", teams[0].id);
          const uids = (members || []).map((m: any) => m.user_id);
          const { data: profs } = await db.from("profiles").select("id").in("user_id", uids);
          const profileIds = (profs || []).map((p: any) => p.id);

          if (profileIds.length > 0) {
            for (let i = 0; i < Math.min(candidates.length, 50); i++) {
              const pick = profileIds[i % profileIds.length];
              const lid = candidates[i].lead_id;
              const { error } = await db.from("leads")
                .update({ counsellor_id: pick, assigned_at: new Date().toISOString() } as any)
                .eq("id", lid);
              if (!error) {
                await db.from("lead_followups").insert({
                  lead_id: lid, type: "call", status: "pending",
                  scheduled_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                  notes: "🤖 AI Call: Max 3 attempts failed — counsellor follow-up required",
                });
                await db.from("lead_activities").insert({
                  lead_id: lid, type: "assignment",
                  description: "Lead auto-assigned after 3 failed AI calls",
                });
                assigned++;
              }
            }
          }
        }
      }
    } else {
      const result = await assignRes.json().catch(() => null);
      assigned = result?.[0]?.assigned_count || result?.assigned_count || 0;
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

    const retryInserts: any[] = [];
    for (const [lid, s] of Object.entries(stats)) {
      if (s.total < 3 && s.completed === 0 && !pendingSet.has(lid)) {
        retryInserts.push({ lead_id: lid, status: "pending", scheduled_at: new Date(Date.now() + 4 * 3600000).toISOString() });
      }
    }
    for (let i = 0; i < retryInserts.length; i += 100) {
      await db.from("ai_call_queue").insert(retryInserts.slice(i, i + 100));
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
