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
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type LeadVars = {
  student_name: string;
  course_name: string;
  campus_name: string;
  // Reasonable defaults so templates expecting these vars don't render literal
  // {{tokens}}; the counsellor can edit campaign templates later for richer
  // per-lead values.
};

function substitute(text: string, vars: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v ?? "");
  }
  return out;
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

    // Validate user auth (campaigns are user-initiated).
    const authHeader = req.headers.get("Authorization");
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

    const { campaign_id } = await req.json();
    if (!campaign_id) {
      return new Response(JSON.stringify({ error: "campaign_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

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
      .select("id, campaign_id, lead_id, to_email, status, leads(name, stage, courses(name), campuses(name))")
      .eq("campaign_id", campaign_id)
      .eq("status", "pending");

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
      return new Response(JSON.stringify({ success: true, sent: 0, failed: 0, message: "No pending recipients" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await admin.from("profiles").select("id").eq("user_id", user.id).single();
    const fromEmail = Deno.env.get("EMAIL_FROM") || "admissions@nimt.ac.in";
    const trackingBaseUrl = `${supabaseUrl}/functions/v1/track-engagement`;

    let sent = 0, failed = 0, skipped = 0;

    for (const r of recipients) {
      const lead = (r as any).leads || {};
      // Skip DNC leads — same rule as the single-send path.
      if (lead.stage === "dnc") {
        await admin.from("email_campaign_recipients")
          .update({ status: "skipped", error_message: "Lead is DNC" })
          .eq("id", r.id);
        skipped++;
        continue;
      }

      const vars: LeadVars = {
        student_name: lead.name || "Student",
        course_name: lead.courses?.name || "your course",
        campus_name: lead.campuses?.name || "NIMT",
      };

      let subject = substitute(subjectTpl!, vars as any);
      let bodyHtml = substitute(bodyTpl!, vars as any);

      // Open tracking pixel
      const pixelUrl = `${trackingBaseUrl}?t=email_open&lid=${r.lead_id}`;
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
            sent_by: profile?.id || null,
            sent_at: new Date().toISOString(),
          });

          await admin.from("lead_activities").insert({
            lead_id: r.lead_id,
            user_id: user.id,
            type: "email",
            description: `Email campaign "${(campaign as any).name}" — ${subject}`,
          });

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

    const { data: updatedCampaign } = await admin
      .from("email_campaigns")
      .select("sent_count, failed_count")
      .eq("id", campaign_id)
      .single();
    const totalSent = (updatedCampaign?.sent_count || 0) + sent;
    const totalFailed = (updatedCampaign?.failed_count || 0) + failed;

    await admin.from("email_campaigns").update({
      sent_count: totalSent,
      failed_count: totalFailed,
      status: "completed",
      completed_at: new Date().toISOString(),
    }).eq("id", campaign_id);

    return new Response(
      JSON.stringify({ success: true, sent, failed, skipped, total_sent: totalSent, total_failed: totalFailed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Email campaign send error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
