// hiring-notify — send a candidate communication for a hiring stage and record
// it in hiring_notifications (send-once per applicant+stage+channel).
//
// Uses the shared `send-email` function (Resend) with the seeded hiring-* email
// templates. WhatsApp is intentionally not sent here until Meta-approved hiring
// templates are registered (the register_hiring_wa_templates migration is a stub).
//
// Body: { applicant_id, stage, interview_id?, overrides? }
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
    const templateSlug = STAGE_TEMPLATE[stage];
    if (!applicantId || !templateSlug) return json({ error: "applicant_id and a valid stage are required" }, 400);

    const { data: a } = await admin
      .from("job_applicants")
      .select("id, name, email, source_phone, desired_role, job_opening_id, lead_id, job_openings(title, location)")
      .eq("id", applicantId).maybeSingle();
    if (!a) return json({ error: "Applicant not found" }, 404);

    // Resolve email: applicant.email, else the linked lead's email.
    let toEmail: string | null = a.email;
    if (!toEmail && a.lead_id) {
      const { data: l } = await admin.from("leads").select("email").eq("id", a.lead_id).maybeSingle();
      toEmail = l?.email ?? null;
    }
    if (!toEmail) return json({ error: "No email on file for this candidate" }, 400);

    // Send-once guard.
    const { data: prior } = await admin
      .from("hiring_notifications")
      .select("id")
      .eq("applicant_id", applicantId).eq("stage", stage).eq("channel", "email").eq("status", "sent")
      .maybeSingle();
    if (prior) return json({ ok: true, skipped: "already_sent" });

    // Build template variables.
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

    // Send via the shared email function using the caller's JWT.
    const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({ template_slug: templateSlug, to_email: toEmail, variables }),
    });
    const ok = res.ok;

    await admin.from("hiring_notifications").insert({
      applicant_id: applicantId,
      stage,
      channel: "email",
      template_key: templateSlug,
      status: ok ? "sent" : "failed",
      detail: ok ? toEmail : `send-email ${res.status}`,
      sent_by: uid,
    });

    if (!ok) return json({ error: `send failed (${res.status})` }, 502);
    return json({ ok: true, to: toEmail });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
