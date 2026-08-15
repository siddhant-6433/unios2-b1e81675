// Tell a candidate what just happened to their application.
//
// One applicant, one stage, both channels. Deliberately NOT a database trigger:
// there are 405 candidates sitting in Sourced, most of them for over a month, and
// a trigger on status would have fired at every one of them the moment it shipped.
// HR calls this when they move somebody, and can decline to.
//
// WhatsApp goes through whatsapp-send (template validation, provider routing and
// conversation logging all already live there); email goes through send-email,
// which now honours the per-template sender so this leaves from hr@nimt.ac.in.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Stage = "sourced" | "screening" | "interview" | "preboarding" | "hired" | "archived";

/** Which message belongs to which stage. Stages absent here send nothing. */
const PLAN: Record<string, { wa: string; email: string } | undefined> = {
  sourced:     { wa: "hiring_application_received", email: "hiring-acknowledgement" },
  interview:   { wa: "hiring_interview_invite",     email: "hiring-interview-invite" },
  preboarding: { wa: "hiring_offer_extended",       email: "hiring-offer" },
  archived:    { wa: "hiring_not_proceeding",       email: "hiring-regret" },
  // screening and hired are internal moves — nothing useful to tell the candidate
  // at screening, and a hire is followed by the appointment letter instead.
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey);

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    const { data: caller } = await admin.auth.getUser(token);
    const callerId = caller?.user?.id;
    if (!callerId) return json({ error: "Unauthorized" }, 401);

    const { data: perms } = await admin.rpc("get_user_permissions", { _user_id: callerId });
    const { data: role } = await admin.rpc("get_user_role", { _user_id: callerId });
    const allowed = role === "super_admin"
      || (Array.isArray(perms) && perms.includes("hr:recruitment_edit"));
    if (!allowed) return json({ error: "Forbidden" }, 403);

    const body = await req.json();
    const applicantId: string = body.applicant_id;
    const stage: Stage = body.stage;
    const channels: string[] = Array.isArray(body.channels) ? body.channels : ["whatsapp", "email"];
    const extra = (body.variables ?? {}) as Record<string, string>;
    if (!applicantId || !stage) return json({ error: "applicant_id and stage are required" }, 400);

    const plan = PLAN[stage];
    if (!plan) return json({ skipped: true, reason: `nothing is sent at ${stage}` });

    const { data: applicant } = await admin
      .from("job_applicants")
      .select("id, name, email, source_phone, desired_role, lead_id")
      .eq("id", applicantId)
      .maybeSingle();
    if (!applicant) return json({ error: "No such applicant" }, 404);

    const name = applicant.name?.trim() || "Candidate";
    const role_ = extra.role || applicant.desired_role || "the role you applied for";

    // Resolve the venue once. HR either picks one (venue_id) or types their own,
    // and only the email carries the full address — the WhatsApp template is a
    // fixed 4-parameter UTILITY message where a postal address reads badly.
    let venueName = extra.interview_where?.trim() || "";
    let venueAddress = extra.interview_address?.trim() || "";
    let venueMapUrl = "";
    if (body.venue_id) {
      const { data: venue } = await admin
        .from("hiring_venues")
        .select("name, address, map_url")
        .eq("id", body.venue_id)
        .maybeSingle();
      if (venue) {
        venueName = venue.name ?? venueName;
        venueAddress = venue.address ?? "";
        venueMapUrl = venue.map_url ?? "";
      }
    }
    if (!venueName) venueName = "NIMT campus";
    const results: Record<string, string> = {};

    // Already told them? The unique index would reject the second row anyway; this
    // reports it cleanly instead of surfacing a constraint error.
    const { data: already } = await admin
      .from("hiring_notifications")
      .select("channel")
      .eq("applicant_id", applicantId).eq("stage", stage).eq("status", "sent");
    const done = new Set((already ?? []).map((r: { channel: string }) => r.channel));

    const record = async (channel: string, templateKey: string, status: string, detail?: string) => {
      await admin.from("hiring_notifications").insert({
        applicant_id: applicantId, stage, channel, template_key: templateKey,
        status, detail: detail ?? null, sent_by: callerId,
      });
    };

    if (channels.includes("whatsapp") && !done.has("whatsapp")) {
      if (!applicant.source_phone) {
        results.whatsapp = "skipped: no phone number";
        await record("whatsapp", plan.wa, "skipped", "no phone number");
      } else {
        // Params are positional in Meta templates — order must match the body text.
        const params = stage === "interview"
          ? [name, role_, extra.interview_when ?? "to be confirmed", venueName]
          : stage === "preboarding"
            ? [name, role_, extra.joining_date ?? "to be confirmed"]
            : [name, role_];

        const res = await fetch(`${url}/functions/v1/whatsapp-send`, {
          method: "POST",
          headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            template_key: plan.wa,
            params,
            phone: applicant.source_phone,
            lead_id: applicant.lead_id,
          }),
        });
        const out = await res.json().catch(() => ({}));
        const ok = res.ok && !out?.error;
        results.whatsapp = ok ? "sent" : `failed: ${out?.error ?? res.status}`;
        await record("whatsapp", plan.wa, ok ? "sent" : "failed", ok ? undefined : String(out?.error ?? res.status));
      }
    } else if (done.has("whatsapp")) {
      results.whatsapp = "already sent";
    }

    if (channels.includes("email") && !done.has("email")) {
      if (!applicant.email) {
        results.email = "skipped: no email address";
        await record("email", plan.email, "skipped", "no email address");
      } else {
        const res = await fetch(`${url}/functions/v1/send-email`, {
          method: "POST",
          headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            template_slug: plan.email,
            to_email: applicant.email,
            variables: {
              candidate_name: name,
              role: role_,
              interview_when: extra.interview_when ?? "to be confirmed",
              interview_where: venueName,
              interview_address: venueAddress || "Address will follow separately.",
              // Substitution is plain string replace, so an absent map has to
              // resolve to empty rather than leaving a {{map_link}} in the email.
              map_link: venueMapUrl
                ? `<a href="${venueMapUrl}">Open in Google Maps</a>`
                : "",
              round_name: extra.round_name ?? "Interview",
              joining_date: extra.joining_date ?? "to be confirmed",
            },
          }),
        });
        const out = await res.json().catch(() => ({}));
        const ok = res.ok && !out?.error;
        results.email = ok ? "sent" : `failed: ${out?.error ?? res.status}`;
        await record("email", plan.email, ok ? "sent" : "failed", ok ? undefined : String(out?.error ?? res.status));
      }
    } else if (done.has("email")) {
      results.email = "already sent";
    }

    await admin.from("job_applicant_activities").insert({
      applicant_id: applicantId,
      user_id: callerId,
      type: "comms",
      description: `Notified about ${stage} — ${Object.entries(results).map(([k, v]) => `${k}: ${v}`).join(", ")}`,
    });

    return json({ applicant_id: applicantId, stage, results });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
