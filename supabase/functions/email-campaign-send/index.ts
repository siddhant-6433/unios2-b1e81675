// Bulk email campaign sender.
//
// Mirrors whatsapp-campaign-send. Iterates email_campaign_recipients for a
// given campaign_id, calls Resend per recipient (via the same flow as the
// single-send send-email function — template substitution + DNC block +
// activity logging), and updates per-recipient + per-campaign totals.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function syncCampaignCounts(admin: any, campaignId: string) {
  const [
    { count: totalSent },
    { count: totalFailed },
    { count: pendingCount },
  ] = await Promise.all([
    admin
      .from("email_campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "sent"),
    admin
      .from("email_campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .in("status", ["failed", "skipped"]),
    admin
      .from("email_campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "pending"),
  ]);

  return {
    totalSent: totalSent || 0,
    totalFailed: totalFailed || 0,
    pendingCount: pendingCount || 0,
  };
}

type LeadVars = {
  student_name: string;
  lead_name: string;
  phone: string;
  email: string;
  lead_source: string;
  lead_stage: string;
  guardian_name: string;
  guardian_phone: string;
  course_name: string;
  campus_name: string;
  notes: string;
  latest_note: string;
};

function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] ?? "" : match
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ error: "Email provider not configured. Set RESEND_API_KEY." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const { campaign_id, batch_size } = await req.json();
    if (!campaign_id) {
      return new Response(JSON.stringify({ error: "campaign_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const batchSize = Math.max(1, Math.min(Number(batch_size) || 50, 100));

    const authHeader = req.headers.get("Authorization") || "";
    const expectedCronSecret = Deno.env.get("CRON_SECRET") || "";
    const isTrustedWorker =
      (!!expectedCronSecret && req.headers.get("x-cron-secret") === expectedCronSecret) ||
      authHeader === `Bearer ${serviceRoleKey}`;

    let actorUserId: string | null = null;
    if (!isTrustedWorker) {
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authError } = await userClient.auth.getUser();
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      actorUserId = user.id;
    }

    const { data: campaign, error: campaignError } = await admin
      .from("email_campaigns")
      .select("*")
      .eq("id", campaign_id)
      .single();
    if (campaignError || !campaign) {
      return new Response(JSON.stringify({ error: "Campaign not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if ((campaign as any).status === "paused" || (campaign as any).status === "terminated") {
      return new Response(JSON.stringify({
        success: true,
        done: true,
        paused: (campaign as any).status === "paused",
        terminated: (campaign as any).status === "terminated",
        message: `Campaign is ${(campaign as any).status}`,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let actorProfileId: string | null = (campaign as any).created_by || null;
    if (!actorUserId && actorProfileId) {
      const { data: ownerProfile } = await admin
        .from("profiles")
        .select("user_id")
        .eq("id", actorProfileId)
        .maybeSingle();
      actorUserId = (ownerProfile as any)?.user_id || null;
    }
    if (!actorProfileId && actorUserId) {
      const { data: ownerProfile } = await admin
        .from("profiles")
        .select("id")
        .eq("user_id", actorUserId)
        .maybeSingle();
      actorProfileId = (ownerProfile as any)?.id || null;
    }

    // Resolve template (slug → subject/body) once.
    let subjectTpl = (campaign as any).custom_subject as string | null;
    let bodyTpl = (campaign as any).custom_body as string | null;

    if ((campaign as any).template_slug) {
      const { data: template } = await admin
        .from("email_templates")
        .select("*")
        .eq("slug", (campaign as any).template_slug)
        .eq("is_active", true)
        .single();
      if (!template) {
        return new Response(JSON.stringify({ error: `Template not found: ${(campaign as any).template_slug}` }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      subjectTpl = template.subject;
      bodyTpl = template.body_html;
    }

    if (!subjectTpl || !bodyTpl) {
      return new Response(JSON.stringify({ error: "Campaign has no subject/body" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin.from("email_campaigns").update({ status: "sending" }).eq("id", campaign_id);

    const { data: recipients, error: recError } = await admin
      .from("email_campaign_recipients")
      .select("id, campaign_id, lead_id, contact_id, to_email, status, marketing_contacts(name, phone, email, opted_out), leads(name, phone, email, source, stage, shared_with_nimt, guardian_name, guardian_phone, courses(name), campuses(name), lead_notes(content, created_at))")
      .eq("campaign_id", campaign_id)
      .eq("status", "pending")
      .limit(batchSize);

    if (recError) {
      console.error("Failed to fetch recipients:", recError);
      await admin.from("email_campaigns").update({ status: "failed" }).eq("id", campaign_id);
      return new Response(JSON.stringify({ error: "Failed to fetch recipients" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!recipients || recipients.length === 0) {
      await admin
        .from("email_campaigns")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", campaign_id);
      return new Response(JSON.stringify({ success: true, sent: 0, failed: 0, total_sent: 0, total_failed: 0, pending: 0, done: true, message: "No pending recipients" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fromEmail = Deno.env.get("EMAIL_FROM") || "admissions@nimt.ac.in";
    const trackingBaseUrl = `${supabaseUrl}/functions/v1/track-engagement`;

    let sent = 0, failed = 0, skipped = 0;

    for (const r of recipients) {
      const { data: liveCampaign } = await admin
        .from("email_campaigns")
        .select("status")
        .eq("id", campaign_id)
        .single();

      if (liveCampaign?.status === "paused") {
        const counts = await syncCampaignCounts(admin, campaign_id);
        await admin.from("email_campaigns").update({
          sent_count: counts.totalSent,
          failed_count: counts.totalFailed,
        }).eq("id", campaign_id);
        return new Response(
          JSON.stringify({
            success: true,
            paused: true,
            sent,
            failed,
            skipped,
            total_sent: counts.totalSent,
            total_failed: counts.totalFailed,
            pending: counts.pendingCount,
            done: false,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (liveCampaign?.status === "terminated") {
        await admin.from("email_campaign_recipients")
          .update({ status: "canceled", error_message: "Campaign terminated before send" })
          .eq("campaign_id", campaign_id)
          .eq("status", "pending");
        const counts = await syncCampaignCounts(admin, campaign_id);
        await admin.from("email_campaigns").update({
          sent_count: counts.totalSent,
          failed_count: counts.totalFailed,
        }).eq("id", campaign_id);
        return new Response(
          JSON.stringify({
            success: true,
            terminated: true,
            sent,
            failed,
            skipped,
            total_sent: counts.totalSent,
            total_failed: counts.totalFailed,
            pending: counts.pendingCount,
            done: true,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Recipients are polymorphic (lead or bulk-imported marketing contact).
      // Shape the contact into the lead object so every downstream var/template
      // path is identical. `shared_with_nimt` stays null, never false — false
      // means "academic-partner private" and is a hard skip just below.
      const contact = (r as any).marketing_contacts;
      if (contact?.opted_out) {
        await admin.from("email_campaign_recipients")
          .update({ status: "skipped", error_message: "Skipped: marketing contact opted out" })
          .eq("id", r.id);
        skipped++;
        continue;
      }
      const lead = (r as any).leads
        || (contact
          ? { name: contact.name, phone: contact.phone, email: contact.email, source: "import", stage: null, shared_with_nimt: null }
          : {});
      // Skip DNC leads — same rule as the single-send path.
      if (lead.stage === "dnc") {
        await admin.from("email_campaign_recipients")
          .update({ status: "skipped", error_message: "Lead is DNC" })
          .eq("id", r.id);
        skipped++;
        continue;
      }
      // Academic-partner private leads are never part of NIMT outreach.
      if (lead.shared_with_nimt === false) {
        await admin.from("email_campaign_recipients")
          .update({ status: "skipped", error_message: "Lead not shared with NIMT" })
          .eq("id", r.id);
        skipped++;
        continue;
      }

      const vars: LeadVars = {
        student_name: lead.name || "Student",
        lead_name: lead.name || "Student",
        phone: lead.phone || "",
        email: lead.email || r.to_email || "",
        lead_source: lead.source || "",
        lead_stage: lead.stage || "",
        guardian_name: lead.guardian_name || "",
        guardian_phone: lead.guardian_phone || "",
        course_name: lead.courses?.name || "your course",
        campus_name: lead.campuses?.name || "NIMT",
        notes: ((lead.lead_notes || []) as Array<{ content?: string | null; created_at?: string | null }>)
          .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
          .map((note) => note.content)
          .filter(Boolean)
          .join("\n"),
        latest_note: ((lead.lead_notes || []) as Array<{ content?: string | null; created_at?: string | null }>)
          .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0]?.content || "",
      };

      let subject = substitute(subjectTpl!, vars as any);
      let bodyHtml = substitute(bodyTpl!, vars as any);

      // Open tracking pixel
      // Contact-backed recipients have no lead_id; omit it rather than sending
      // the literal "null", which track-engagement would try to cast to a uuid.
      const pixelUrl = `${trackingBaseUrl}?t=email_open${r.lead_id ? `&lid=${r.lead_id}` : ""}`;
      const pixelTag = `<img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />`;
      bodyHtml = bodyHtml.includes("</body>")
        ? bodyHtml.replace("</body>", `${pixelTag}</body>`)
        : bodyHtml + pixelTag;

      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: fromEmail, to: [r.to_email], subject, html: bodyHtml }),
        });
        const result = await res.json();

        if (res.ok) {
          await admin.from("email_campaign_recipients")
            .update({ status: "sent", provider_id: result?.id || null, sent_at: new Date().toISOString() })
            .eq("id", r.id);

          await admin.from("email_messages").insert({
            lead_id: r.lead_id,
            to_email: r.to_email,
            from_email: fromEmail,
            subject,
            body_html: bodyHtml,
            status: "sent",
            provider_id: result?.id || null,
            sent_by: actorProfileId,
            sent_at: new Date().toISOString(),
          });

          // lead_activities.lead_id is NOT NULL — a contact-backed recipient has
          // no lead to log against, so skip the timeline entry rather than
          // failing the send.
          if (r.lead_id) {
            await admin.from("lead_activities").insert({
              lead_id: r.lead_id,
              user_id: actorProfileId,
              type: "email",
              description: `Email campaign "${(campaign as any).name}" — ${subject}`,
            });
          }

          sent++;
        } else {
          const errMsg = result?.message || "Unknown Resend error";
          await admin.from("email_campaign_recipients")
            .update({ status: "failed", error_message: errMsg })
            .eq("id", r.id);
          failed++;
        }
      } catch (e: any) {
        await admin.from("email_campaign_recipients")
          .update({ status: "failed", error_message: e?.message || "Network error" })
          .eq("id", r.id);
        failed++;
      }

      // 250ms throttle — Resend free tier allows ~2 req/sec sustained.
      await delay(250);
    }

    const counts = await syncCampaignCounts(admin, campaign_id);
    const { data: finalCampaign } = await admin
      .from("email_campaigns")
      .select("status")
      .eq("id", campaign_id)
      .single();

    if (finalCampaign?.status === "paused" || finalCampaign?.status === "terminated") {
      await admin.from("email_campaigns").update({
        sent_count: counts.totalSent,
        failed_count: counts.totalFailed,
      }).eq("id", campaign_id);
      return new Response(
        JSON.stringify({
          success: true,
          status: finalCampaign.status,
          paused: finalCampaign.status === "paused",
          terminated: finalCampaign.status === "terminated",
          sent,
          failed,
          skipped,
          total_sent: counts.totalSent,
          total_failed: counts.totalFailed,
          pending: counts.pendingCount,
          done: finalCampaign.status === "terminated",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const done = counts.pendingCount === 0;

    await admin.from("email_campaigns").update({
      sent_count: counts.totalSent,
      failed_count: counts.totalFailed,
      status: done ? "completed" : "sending",
      completed_at: done ? new Date().toISOString() : null,
    }).eq("id", campaign_id);

    return new Response(
      JSON.stringify({
        success: true,
        sent,
        failed,
        skipped,
        total_sent: counts.totalSent,
        total_failed: counts.totalFailed,
        pending: counts.pendingCount,
        done,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Email campaign send error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
