// fee-notify-bulk (staff auth)
//
// Bulk fee-due WhatsApp notifications. Resolves the students in a batch that
// still owe a given term, mints a LIVE payment link for each (one batch insert
// into payment_links; the /pay page recomputes base + late fine at pay-time),
// and sends the WhatsApp `payment_link_request` template per student.
//
// Links are minted inline (not via create-payment-link) and WhatsApp is sent
// serially+paced: fanning out 80 nested edge-function calls trips the Edge
// Function nested-call trace budget (RateLimitError "Rate limit exceeded for
// trace…"). See supabase.com/docs/guides/functions/recursive-functions.
//
// dry_run=true returns the matched students + current due for the preview table;
// it mints nothing.
//
// Auth: staff JWT only (getUser once), then role-checked. Links are stamped
// created_by = the staff user for audit.

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

    // --- Resend mode: send to a specific phone for an existing payment link ---
    if (parsed.resend === true) {
      const token = String(parsed.token || "");
      const phone = String(parsed.phone || "").replace(/\D/g, "");
      if (!token || phone.length < 10) return json({ error: "token and valid phone required" }, 400);

      const { data: pl } = await admin
        .from("payment_links")
        .select("id, student_id, amount, fee_term, fee_campaign_id, note, expires_at")
        .eq("token", token)
        .single();
      if (!pl) return json({ error: "Link not found" }, 404);

      const { data: stRow } = await admin.from("students").select("name").eq("id", pl.student_id).single();
      const validTill = pl.expires_at
        ? new Date(pl.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })
        : "—";

      // Send via WA API
      const phoneStr = phone.length === 10 ? `91${phone}` : phone;
      const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          template_key: "payment_link_request",
          phone: phoneStr,
          params: [stRow?.name || "Student", pl.note || "Fee due", Number(pl.amount).toLocaleString("en-IN"), validTill],
          button_urls: [token],
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: body?.error || `HTTP ${res.status}` }, 500);

      // Update delivery tracking
      const wamid = body?.message_id ?? null;
      const update: Record<string, unknown> = { sent_to_phone: phoneStr };
      if (wamid) update.wa_message_id = wamid;
      await admin.from("payment_links").update(update).eq("id", pl.id);

      return json({ ok: true, message_id: wamid, sent_to: phoneStr });
    }

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
      .select("id, name, phone, whatsapp_no, father_phone, father_whatsapp, mother_phone, mother_whatsapp, guardian_phone, lead_id, course_id, session_id, campus_id, batch_id, status");
    if (courseIds.length) sq = sq.in("course_id", courseIds);
    if (sessionId) sq = sq.eq("session_id", sessionId);
    if (campusId) sq = sq.eq("campus_id", campusId);
    if (batchId) sq = sq.eq("batch_id", batchId);
    const { data: students, error: sErr } = await sq;
    if (sErr) return json({ error: sErr.message }, 500);
    if (!students?.length) return json({ matched: [], total: 0, skipped_no_due: 0, skipped_no_phone: 0 });

    // Fetch lead phones for fallback (parent/guardian from CRM)
    const leadIds = [...new Set(students.map((s: any) => s.lead_id).filter(Boolean))];
    const leadPhoneMap = new Map<string, { phone: string | null; guardian_phone: string | null }>();
    if (leadIds.length) {
      const { data: leadRows } = await admin
        .from("leads").select("id, phone, guardian_phone").in("id", leadIds);
      for (const l of leadRows || []) leadPhoneMap.set(l.id, { phone: l.phone, guardian_phone: l.guardian_phone });
    }

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

    // ponytail: resolve best phone per student — cascade through all available numbers
    const validPhone = (v: unknown) => v && String(v).replace(/\D/g, "").length >= 10 ? String(v) : null;
    const resolvePhone = (s: any): string | null => {
      const lead = s.lead_id ? leadPhoneMap.get(s.lead_id) : null;
      return validPhone(s.phone)         // primary student mobile (OTP login)
        || validPhone(s.whatsapp_no)     // secondary student mobile
        || validPhone(s.father_phone)
        || validPhone(s.father_whatsapp)
        || validPhone(s.mother_phone)
        || validPhone(s.mother_whatsapp)
        || validPhone(s.guardian_phone)
        || validPhone(lead?.phone)
        || validPhone(lead?.guardian_phone);
    };

    let skippedNoDue = 0;
    let skippedNoPhone = 0;
    const targets = students
      .map((s: any) => ({ ...s, due: dueByStudent.get(s.id) || 0, resolved_phone: resolvePhone(s) }))
      .filter((s: any) => {
        if (s.due <= 0) { skippedNoDue++; return false; }
        if (!s.resolved_phone) { skippedNoPhone++; return false; }
        return true;
      });

    const matchedPreview = targets.map((s: any) => ({
      student_id: s.id, name: s.name, phone: s.resolved_phone, due: s.due,
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

    // Mint every live link in ONE batch insert (no fan-out). live_fee links carry
    // no hosted gateway link — the /pay page resolves base + late fine at pay-time
    // — so there is nothing to do per student except insert the row. Doing this
    // inline (instead of calling create-payment-link 80×) avoids the Edge Function
    // nested-call trace budget, which throttled the per-student fan-out at ~30.
    // token auto-generates (payment_links.token default); gateway stays null so
    // /pay shows the picker.
    if (!targets.length) {
      await admin.from("fee_notification_campaigns")
        .update({ sent: 0, failed: 0, status: "completed" }).eq("id", campaign.id);
      return json({ campaign_id: campaign.id, total: 0, sent: 0, failed: 0, results: [] });
    }

    const expiresAt = new Date(Date.now() + expiresDays * 86400000).toISOString();
    const { data: linkRows, error: linkErr } = await admin
      .from("payment_links")
      .insert(targets.map((s: any) => ({
        student_id: s.id,
        purpose: "fee_due",
        amount: s.due, // send-time snapshot; /pay recomputes live
        note: purposeLabel,
        created_by: user.id,
        live_fee: true,
        fee_term: feeTerm,
        fee_campaign_id: campaign.id,
        expires_at: expiresAt,
      })))
      .select("id, token, student_id");
    if (linkErr || !linkRows) {
      await admin.from("fee_notification_campaigns")
        .update({ status: "failed" }).eq("id", campaign.id);
      return json({ error: linkErr?.message || "Failed to mint links" }, 500);
    }
    const linkByStudent = new Map<string, { id: string; token: string }>(
      linkRows.map((r: any) => [r.student_id, { id: r.id, token: r.token }]),
    );

    const validTill = new Date(Date.now() + expiresDays * 86400000)
      .toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

    // Send WhatsApp SERIALLY with a small pace. whatsapp-send is a nested edge
    // call, so it draws from this execution's trace budget — one call per student,
    // paced, plus a retry that honours the platform's retryAfterMs on the rare
    // RateLimitError. (With create-payment-link no longer nested, the budget is
    // no longer doubled and the fan-out fits comfortably.)
    const sendOne = async (phone: string, params: string[], token: string): Promise<string | null> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify({ template_key: "payment_link_request", phone, params, button_urls: [token] }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
          return body?.message_id ?? null; // Meta wamid → delivery report join key
        } catch (e) {
          // Deno throws RateLimitError on the outbound fetch when the trace budget
          // is exhausted; wait the suggested window and retry. Detect by shape
          // (name/retryAfterMs) rather than `instanceof`, which throws if the
          // runtime doesn't expose the class.
          const retryMs = (e as any)?.retryAfterMs;
          const isRateLimit = (e as any)?.name === "RateLimitError" || typeof retryMs === "number";
          if (isRateLimit && attempt < 2) {
            await new Promise((r) => setTimeout(r, Math.min(Number(retryMs) || 5000, 60000)));
            continue;
          }
          throw e;
        }
      }
      return null;
    };

    for (const s of targets as any[]) {
      const link = linkByStudent.get(s.id);
      try {
        if (!link) throw new Error("link not minted");
        const wamid = await sendOne(
          s.resolved_phone,
          [s.name || "Student", "Fee due", Number(s.due).toLocaleString("en-IN"), validTill],
          link.token,
        );
        // Stamp the wamid + which phone was used so the delivery report shows it
        const updatePayload: Record<string, unknown> = { sent_to_phone: s.resolved_phone };
        if (wamid) updatePayload.wa_message_id = wamid;
        await admin.from("payment_links").update(updatePayload).eq("id", link.id);
        results.push({ student_id: s.id, ok: true });
        sent++;
      } catch (e) {
        results.push({ student_id: s.id, ok: false, error: e instanceof Error ? e.message : "send failed" });
        failed++;
      }
      await new Promise((r) => setTimeout(r, 120)); // gentle pace
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
