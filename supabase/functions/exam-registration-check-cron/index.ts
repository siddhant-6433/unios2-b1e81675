import { createClient } from "npm:@supabase/supabase-js@2";
import { examCodeForSelections, EXAM_DISPLAY_NAMES } from "../_shared/exam-mapping.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/*
  Exam Registration Check Cron
  ----------------------------
  Asks leads (over WhatsApp) whether they've registered for the entrance exam /
  counselling their course requires, so we can move their status out of
  'unknown'. Sends the `exam_registration_check` template (two quick-reply
  buttons; replies handled in whatsapp-webhook).

  Cadence: intended to run DAILY. Each lead is asked at most TWICE, spaced at
  least ~7 days apart (ASK_SPACING_DAYS). Because it upserts a row per lead the
  first time it sees them, new leads get their first ask within a day of
  entering the system, and the weekly re-ask is the second and final one.

  Guardrails:
    • Only leads whose exam status is still 'unknown'.
    • Skip mirror leads, DNC/lost/admitted stages.
    • ask_count < MAX_ASKS and last asked >= ASK_SPACING_DAYS ago.
    • Bounded batch per run (LIMIT) so a run can't blast thousands at once.
*/

const MAX_ASKS = 2;
const ASK_SPACING_DAYS = 7;
const LIMIT = 200;
const SKIP_STAGES = new Set(["dnc", "lost", "not_interested", "admitted", "enrolled"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Dry-run support: POST { dry_run: true } to preview without sending.
  let dryRun = false;
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    dryRun = !!body?.dry_run;
  } catch { /* ignore */ }

  const spacingCutoff = new Date(Date.now() - ASK_SPACING_DAYS * 86400000).toISOString();

  // Self-guard: never send until the exam_registration_check template is
  // APPROVED in Meta. This lets the cron be scheduled ahead of approval — it
  // simply no-ops (no failed sends, no burned asks) until the template goes
  // live, then starts working on the next run automatically.
  if (!dryRun) {
    try {
      const wabaId = Deno.env.get("WHATSAPP_WABA_ID");
      const waToken = Deno.env.get("WHATSAPP_API_TOKEN");
      if (wabaId && waToken) {
        const tRes = await fetch(
          `https://graph.facebook.com/v21.0/${wabaId}/message_templates?limit=200`,
          { headers: { Authorization: `Bearer ${waToken}` } },
        );
        const tBody = await tRes.json();
        const tpl = (tBody?.data || []).find((t: any) => t.name === "exam_registration_check");
        if (!tpl || String(tpl.status).toUpperCase() !== "APPROVED") {
          return json({ ok: true, skipped: "template_not_approved", template_status: tpl?.status || "not_found", sent: 0 });
        }
      }
    } catch (e) {
      console.error("[exam-registration-check-cron] template status check failed:", e);
      return json({ ok: true, skipped: "template_status_check_failed", sent: 0 });
    }
  }

  try {
    // Candidate applications: has a lead, not already on hold/rejected. We read
    // course_selections to resolve the exam, and the lead for stage/phone.
    const { data: apps, error: appErr } = await admin
      .from("applications")
      .select("lead_id, full_name, phone, course_selections, status, leads!inner(id, name, phone, stage, is_mirror)")
      .not("lead_id", "is", null)
      .not("status", "in", "(on_hold,rejected)")
      .limit(2000);
    if (appErr) throw appErr;

    // Resolve one (lead, exam) target per lead.
    const targets = new Map<string, { leadId: string; examCode: string; name: string; phone: string; course: string }>();
    for (const a of apps || []) {
      const lead = (a as any).leads;
      if (!lead || lead.is_mirror) continue;
      if (SKIP_STAGES.has(String(lead.stage || "").toLowerCase())) continue;
      const phone = lead.phone || a.phone;
      if (!phone) continue;
      const match = examCodeForSelections(a.course_selections as any);
      if (!match) continue;
      const key = `${lead.id}:${match.code}`;
      if (!targets.has(key)) {
        targets.set(key, { leadId: lead.id, examCode: match.code, name: lead.name || a.full_name || "there", phone, course: match.course });
      }
    }

    if (targets.size === 0) {
      return json({ ok: true, considered: 0, sent: 0, dry_run: dryRun });
    }

    // Existing registration rows for these leads → decide who still needs asking.
    const leadIds = Array.from(new Set(Array.from(targets.values()).map((t) => t.leadId)));
    const existing = new Map<string, { status: string; ask_count: number; asked_at: string | null }>();
    for (let i = 0; i < leadIds.length; i += 300) {
      const batch = leadIds.slice(i, i + 300);
      const { data: rows } = await admin
        .from("exam_registrations")
        .select("lead_id, exam_code, status, ask_count, asked_at")
        .in("lead_id", batch);
      for (const r of rows || []) existing.set(`${r.lead_id}:${r.exam_code}`, r as any);
    }

    const toAsk = Array.from(targets.entries())
      .filter(([key]) => {
        const row = existing.get(key);
        if (!row) return true; // never asked; will create + ask
        if (row.status !== "unknown") return false; // already answered/registered
        if ((row.ask_count || 0) >= MAX_ASKS) return false;
        if (row.asked_at && row.asked_at > spacingCutoff) return false; // asked too recently
        return true;
      })
      .slice(0, LIMIT)
      .map(([key, t]) => ({ key, ...t }));

    let sent = 0;
    const errors: any[] = [];

    for (const t of toAsk) {
      if (dryRun) { sent++; continue; }
      const nowIso = new Date().toISOString();
      const prior = existing.get(t.key);

      // Send first — only bump ask bookkeeping if the send is accepted, so a
      // failed send doesn't burn one of the two allowed asks.
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
          body: JSON.stringify({
            template_key: "exam_registration_check",
            phone: t.phone,
            lead_id: t.leadId,
            params: [t.name, t.course, EXAM_DISPLAY_NAMES[t.examCode as keyof typeof EXAM_DISPLAY_NAMES] || t.examCode],
          }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok || out?.error) {
          errors.push({ lead: t.leadId, exam: t.examCode, error: out?.error || `http_${res.status}` });
          continue;
        }
      } catch (e) {
        errors.push({ lead: t.leadId, exam: t.examCode, error: String(e) });
        continue;
      }

      await admin
        .from("exam_registrations")
        .upsert(
          {
            lead_id: t.leadId,
            exam_code: t.examCode,
            status: "unknown",
            asked_at: nowIso,
            ask_count: (prior?.ask_count || 0) + 1,
          },
          { onConflict: "lead_id,exam_code" },
        );
      sent++;
    }

    return json({ ok: true, considered: targets.size, eligible: toAsk.length, sent, errors: errors.slice(0, 20), dry_run: dryRun });
  } catch (err) {
    console.error("[exam-registration-check-cron] error:", err);
    return json({ error: (err as Error).message }, 500);
  }

  function json(obj: unknown, status = 200) {
    return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
