// fee-notify-bulk (staff auth)
//
// Bulk fee-due WhatsApp notifications. Resolves the students in a batch that
// still owe a given term, then mints a LIVE payment link per student
// (create-payment-link with live_fee:true) which recomputes base + late fine at
// pay-time, and sends the WhatsApp `payment_link_request` template.
//
// dry_run=true returns the matched students + current due for the preview table;
// it mints nothing.
//
// Auth: staff JWT only. The caller's Authorization header is forwarded to
// create-payment-link so links are created as the staff user (created_by/audit).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonRecord = Record<string, unknown>;

function json(payload: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const STAFF_ROLES = new Set([
  "super_admin", "campus_admin", "admission_head", "accountant", "counsellor",
]);

const isUuid = (v: unknown) => /^[0-9a-f-]{36}$/i.test(String(v || ""));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: userData } = await caller.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { data: roleRows } = await admin
      .from("user_roles").select("role").eq("user_id", user.id);
    const roles = (roleRows || []).map((r: any) => r.role);
    if (!roles.some((r: string) => STAFF_ROLES.has(r))) {
      return json({ error: "Not authorised" }, 403);
    }

    const parsed = await req.json().catch(() => ({}));
    const courseIds = (Array.isArray(parsed.course_ids) ? parsed.course_ids : [])
      .filter(isUuid).map(String);
    const sessionId = isUuid(parsed.session_id) ? String(parsed.session_id) : null;
    const campusId = isUuid(parsed.campus_id) ? String(parsed.campus_id) : null;
    const batchId = isUuid(parsed.batch_id) ? String(parsed.batch_id) : null;
    const feeTerm = parsed.fee_term ? String(parsed.fee_term) : null;
    const purposeLabel = parsed.purpose_label ? String(parsed.purpose_label).slice(0, 60) : "Fee due";
    const dryRun = parsed.dry_run === true;
    const expiresDays = Number.isFinite(Number(parsed.expires_days))
      ? Math.max(1, Math.min(365, Math.round(Number(parsed.expires_days))))
      : 7;

    if (!courseIds.length && !batchId) {
      return json({ error: "course_ids or batch_id is required" }, 400);
    }
    if (!feeTerm) return json({ error: "fee_term is required" }, 400);

    // --- Resolve candidate students -----------------------------------------
    // No status filter: whoever still owes the term is a valid target (the
    // due-balance filter below scopes it), and a .neq would silently drop
    // null-status rows.
    let sq = admin
      .from("students")
      .select("id, name, phone, lead_id, course_id, session_id, campus_id, batch_id, status");
    if (courseIds.length) sq = sq.in("course_id", courseIds);
    if (sessionId) sq = sq.eq("session_id", sessionId);
    if (campusId) sq = sq.eq("campus_id", campusId);
    if (batchId) sq = sq.eq("batch_id", batchId);
    const { data: students, error: sErr } = await sq;
    if (sErr) return json({ error: sErr.message }, 500);
    if (!students?.length) return json({ matched: [], total: 0, skipped_no_due: 0, skipped_no_phone: 0 });

    // --- Current due per student for [term, late_term] ----------------------
    const ids = students.map((s: any) => s.id);
    const { data: ledger, error: lErr } = await admin
      .from("fee_ledger")
      .select("student_id, balance, term")
      .in("student_id", ids)
      .in("term", [feeTerm, `late_${feeTerm}`])
      .in("status", ["due", "overdue"])
      .gt("balance", 0);
    if (lErr) return json({ error: lErr.message }, 500);

    const dueByStudent = new Map<string, number>();
    for (const row of ledger || []) {
      const prev = dueByStudent.get(row.student_id) || 0;
      dueByStudent.set(row.student_id, Math.round((prev + Number(row.balance || 0)) * 100) / 100);
    }

    let skippedNoDue = 0;
    let skippedNoPhone = 0;
    const targets = students
      .map((s: any) => ({ ...s, due: dueByStudent.get(s.id) || 0 }))
      .filter((s: any) => {
        if (s.due <= 0) { skippedNoDue++; return false; }
        const phone = s.phone && String(s.phone).replace(/\D/g, "").length >= 10;
        if (!phone) { skippedNoPhone++; return false; }
        return true;
      });

    const matchedPreview = targets.map((s: any) => ({
      student_id: s.id, name: s.name, phone: s.phone, due: s.due,
    }));

    if (dryRun) {
      return json({
        matched: matchedPreview,
        total: targets.length,
        skipped_no_due: skippedNoDue,
        skipped_no_phone: skippedNoPhone,
      });
    }

    // --- Real run: campaign row + per-student live link + WhatsApp -----------
    const { data: campaign, error: cErr } = await admin
      .from("fee_notification_campaigns")
      .insert({
        created_by: user.id,
        filter: { course_ids: courseIds, session_id: sessionId, campus_id: campusId, batch_id: batchId },
        fee_term: feeTerm,
        purpose_label: purposeLabel,
        expires_at: new Date(Date.now() + expiresDays * 86400000).toISOString(),
        total: targets.length,
        status: "sending",
      })
      .select("id")
      .single();
    if (cErr || !campaign) return json({ error: cErr?.message || "Failed to create campaign" }, 500);

    let sent = 0;
    let failed = 0;
    const results: Array<{ student_id: string; ok: boolean; error?: string }> = [];

    // Small batches with a pause — mirrors whatsapp-campaign-send pacing so we
    // don't hammer Meta or the gateway.
    const BATCH = 10;
    for (let i = 0; i < targets.length; i += BATCH) {
      const slice = targets.slice(i, i + BATCH);
      const settled = await Promise.all(slice.map(async (s: any) => {
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/create-payment-link`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: authHeader },
            body: JSON.stringify({
              purpose: "fee_due",
              live_fee: true,
              fee_term: feeTerm,
              student_id: s.id,
              amount: s.due, // send-time snapshot; pay-link recomputes live
              note: purposeLabel,
              expires_days: expiresDays,
              send_channel: "whatsapp",
              fee_campaign_id: campaign.id,
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) return { student_id: s.id, ok: false, error: body?.error || `HTTP ${res.status}` };
          return { student_id: s.id, ok: true };
        } catch (e) {
          return { student_id: s.id, ok: false, error: e instanceof Error ? e.message : "send failed" };
        }
      }));
      for (const r of settled) {
        results.push(r);
        if (r.ok) sent++; else failed++;
      }
      if (i + BATCH < targets.length) await new Promise((r) => setTimeout(r, 400));
    }

    await admin
      .from("fee_notification_campaigns")
      .update({ sent, failed, status: failed === 0 ? "completed" : "completed_with_errors" })
      .eq("id", campaign.id);

    return json({ campaign_id: campaign.id, total: targets.length, sent, failed, results });
  } catch (error) {
    console.error("[fee-notify-bulk] error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
