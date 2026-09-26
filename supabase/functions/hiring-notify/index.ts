// hiring-notify — send a candidate communication for a hiring stage and record
// it in hiring_notifications (send-once per applicant+stage+channel).
//
// Channels: email (via `send-email` + the seeded hiring-* email templates) and
// WhatsApp (via `whatsapp-send` + the Meta-approved hiring_* templates, sent
// from the HR sender). Default is both.
//
// Body: { applicant_id, stage, channel?: 'email'|'whatsapp'|'both', interview_id?, overrides? }
//   stage ∈ acknowledgement | interview_invite | offer | regret

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (p: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(p), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const STAGE_TEMPLATE: Record<string, string> = {
  acknowledgement: "hiring-acknowledgement",
  interview_invite: "hiring-interview-invite",
  offer: "hiring-offer",
  regret: "hiring-regret",
};

// Meta template key + the variable order of its approved body.
const WA_TEMPLATE: Record<string, { key: string; params: string[] }> = {
  acknowledgement: { key: "hiring_application_received", params: ["candidate_name", "role"] },
  interview_invite: { key: "hiring_interview_invite", params: ["candidate_name", "role", "interview_when", "interview_where"] },
  offer: { key: "hiring_offer_extended", params: ["candidate_name", "role", "joining_date"] },
  regret: { key: "hiring_not_proceeding", params: ["candidate_name", "role"] },
};

const fmtWhen = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" }) : "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const caller = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
    });
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: userData } = await caller.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) return json({ error: "Unauthorized" }, 401);
    const { data: canRecruit } = await admin.rpc("has_permission", { _user_id: uid, _perm: "hr:recruitment_edit" });
    if (!canRecruit) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const applicantId: string = body.applicant_id;
    const stage: string = body.stage;
    const emailSlug = STAGE_TEMPLATE[stage];
    const waTemplate = WA_TEMPLATE[stage];
    if (!applicantId || (!emailSlug && !waTemplate)) {
      return json({ error: "applicant_id and a valid stage are required" }, 400);
    }
    const channel: "email" | "whatsapp" | "both" =
      body.channel === "email" ? "email" : body.channel === "whatsapp" ? "whatsapp" : "both";

    const { data: a } = await admin
      .from("job_applicants")
      .select("id, name, email, source_phone, desired_role, job_opening_id, lead_id, job_openings(title, location)")
      .eq("id", applicantId).maybeSingle();
    if (!a) return json({ error: "Applicant not found" }, 404);

    // Resolve email / phone.
    let toEmail: string | null = a.email;
    if (!toEmail && a.lead_id) {
      const { data: l } = await admin.from("leads").select("email").eq("id", a.lead_id).maybeSingle();
      toEmail = l?.email ?? null;
    }
    const digits = String(a.source_phone || "").replace(/\D/g, "");
    const toPhone = digits.length === 10 ? `91${digits}` : digits.length >= 11 ? digits : "";

    // Build template variables (shared by both channels).
    const opening = (a as unknown as { job_openings?: { title?: string; location?: string } | null }).job_openings;
    const role = a.desired_role || opening?.title || "";
    const variables: Record<string, string> = {
      candidate_name: a.name || "Candidate",
      role,
      ...(body.overrides || {}),
    };

    if (stage === "interview_invite") {
      let when = "";
      let where = "";
      let address = "";
      if (body.interview_id) {
        const { data: iv } = await admin
          .from("interviews")
          .select("scheduled_at, mode, location, meeting_link")
          .eq("id", body.interview_id).maybeSingle();
        if (iv) {
          when = fmtWhen(iv.scheduled_at);
          where = iv.location || (iv.mode === "video" ? "Video call" : "");
          address = iv.meeting_link || "";
        }
      }
      variables.interview_when = variables.interview_when ?? when;
      variables.interview_where = variables.interview_where ?? where;
      variables.interview_address = variables.interview_address ?? address;
      variables.round_name = variables.round_name ?? "Interview";
      variables.map_link = variables.map_link ?? "";
    }
    if (stage === "offer") {
      variables.joining_date = variables.joining_date ?? "";
      variables.interview_where = variables.interview_where ?? opening?.location ?? "";
      variables.interview_address = variables.interview_address ?? "";
    }

    const results: Record<string, unknown> = {};

    // ── Email (send-once per applicant+stage+channel) ──
    if ((channel === "email" || channel === "both") && emailSlug) {
      if (!toEmail) {
        results.email = { skipped: "no_email" };
      } else {
        const { data: prior } = await admin.from("hiring_notifications").select("id")
          .eq("applicant_id", applicantId).eq("stage", stage).eq("channel", "email").eq("status", "sent").maybeSingle();
        if (prior) {
          results.email = { skipped: "already_sent" };
        } else {
          const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: authHeader },
            body: JSON.stringify({ template_slug: emailSlug, to_email: toEmail, variables }),
          });
          const ok = res.ok;
          await admin.from("hiring_notifications").insert({
            applicant_id: applicantId, stage, channel: "email", template_key: emailSlug,
            status: ok ? "sent" : "failed", detail: ok ? toEmail : `send-email ${res.status}`, sent_by: uid,
          });
          results.email = ok ? { sent: toEmail } : { error: `send-email ${res.status}` };
        }
      }
    }

    // ── WhatsApp (Meta-approved hiring templates, HR sender) ──
    if ((channel === "whatsapp" || channel === "both") && waTemplate) {
      if (!toPhone) {
        results.whatsapp = { skipped: "no_phone" };
      } else {
        const { data: prior } = await admin.from("hiring_notifications").select("id")
          .eq("applicant_id", applicantId).eq("stage", stage).eq("channel", "whatsapp").eq("status", "sent").maybeSingle();
        if (prior) {
          results.whatsapp = { skipped: "already_sent" };
        } else {
          const { data: ch } = await admin.from("whatsapp_channels")
            .select("meta_phone_number_id")
            .eq("route", "hr").eq("provider", "meta").not("meta_phone_number_id", "is", null)
            .limit(1).maybeSingle();
          const params = waTemplate.params.map((k) => variables[k] ?? "");
          const sendVia = async (phoneNumberId?: string) => {
            const r = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: authHeader },
              body: JSON.stringify({
                template_key: waTemplate.key, params, phone: toPhone, provider: "meta",
                business_phone_number_id: phoneNumberId,
              }),
            });
            const d = await r.json().catch(() => ({}));
            return { r, d, ok: r.ok && (d.ok !== false) && !d.error };
          };
          // Prefer the HR sender; fall back to the default Meta sender, which is
          // known-good for these templates (the HR number can be blocked by Meta
          // permissions until its WABA/token link is fixed).
          let sender = ch?.meta_phone_number_id ?? "default";
          let { r: waRes, d: waData, ok: waOk } = await sendVia(ch?.meta_phone_number_id ?? undefined);
          if (!waOk && ch?.meta_phone_number_id) {
            const retry = await sendVia(undefined);
            if (retry.ok) { waRes = retry.r; waData = retry.d; waOk = true; sender = "default"; }
          }
          await admin.from("hiring_notifications").insert({
            applicant_id: applicantId, stage, channel: "whatsapp", template_key: waTemplate.key,
            status: waOk ? "sent" : "failed",
            detail: waOk ? `${toPhone} via ${sender}` : JSON.stringify(waData).slice(0, 300), sent_by: uid,
          });
          results.whatsapp = waOk ? { sent: toPhone, sender } : { error: waData.error || `whatsapp-send ${waRes.status}`, detail: waData };
        }
      }
    }

    return json({ ok: true, results });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
