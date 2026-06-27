import { createClient } from "npm:@supabase/supabase-js@2";
import { sendWhatsAppTemplate } from "../_shared/whatsapp-channel.ts";
import {
  expectedReplyTypeForTemplate,
  recordWhatsAppOutboundContext,
} from "../_shared/whatsapp-outbound-context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Same template definitions as whatsapp-send
const TEMPLATES: Record<string, { name: string; params: string[] }> = {
  lead_welcome: { name: "lead_welcome", params: ["student_name", "course_name"] },
  visit_confirmation: { name: "visit_confirmation", params: ["student_name", "visit_date", "campus_name"] },
  visit_reminder_24hr: { name: "visit_reminder_24hr", params: ["student_name", "visit_date"] },
  // Internal key kept as `application_received`, but the Meta-approved
  // template is named `application_submitted` (see submit-wa-templates).
  application_received: { name: "application_submitted", params: ["student_name", "application_id"] },
  fee_reminder: { name: "fee_reminder", params: ["student_name", "amount", "due_date"] },
  bpt_bmrit_cahet_deadline: { name: "bpt_bmrit_cahet_deadline", params: [] },
  cnet_not_qualified_bpt_bmrit: { name: "cnet_not_qualified_bpt_bmrit", params: ["student_name"] },
  course_details: { name: "course_details", params: ["student_name", "course_name"] },
  counsellor_lead_assigned: { name: "counsellor_lead_assigned", params: ["counsellor_name", "lead_name", "lead_phone_last4", "sla_hours"] },
  counsellor_sla_warning: { name: "counsellor_sla_warning", params: ["lead_name", "hours_remaining"] },
  counsellor_lead_reclaimed: { name: "counsellor_lead_reclaimed", params: ["lead_name", "course_name"] },
  counsellor_visit_confirmation: { name: "counsellor_visit_confirmation", params: ["lead_name", "visit_date", "campus_name"] },
  counsellor_followup_overdue: { name: "counsellor_followup_overdue", params: ["lead_name", "followup_date"] },
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Kill switch: when WHATSAPP_BULK_PAUSED is set to anything truthy, the
    // function returns 503 before any send. Used to halt bulk dispatch
    // during a Meta quality-rating incident without ripping out the rule.
    const bulkPaused = (Deno.env.get("WHATSAPP_BULK_PAUSED") || "").toLowerCase();
    if (bulkPaused === "true" || bulkPaused === "1" || bulkPaused === "yes") {
      return new Response(
        JSON.stringify({
          error: "Bulk WhatsApp campaigns are paused by an administrator. Contact ops to re-enable (unset WHATSAPP_BULK_PAUSED).",
          paused: true,
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Validate auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { campaign_id } = await req.json();

    if (!campaign_id) {
      return new Response(
        JSON.stringify({ error: "campaign_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Fetch the campaign record
    const { data: campaign, error: campaignError } = await adminClient
      .from("whatsapp_campaigns")
      .select("*")
      .eq("id", campaign_id)
      .single();

    if (campaignError || !campaign) {
      return new Response(
        JSON.stringify({ error: "Campaign not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const templateDef = TEMPLATES[campaign.template_key];
    if (!templateDef) {
      return new Response(
        JSON.stringify({ error: `Unknown template: ${campaign.template_key}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark campaign as in-progress
    await adminClient
      .from("whatsapp_campaigns")
      .update({ status: "sending" })
      .eq("id", campaign_id);

    // Fetch all pending recipients with lead + course + campus joined in.
    // course/campus are used to auto-fill `course_name` and `campus_name`
    // template params per recipient — see substitution loop below.
    const { data: recipients, error: recipientsError } = await adminClient
      .from("whatsapp_campaign_recipients")
      .select("id, campaign_id, lead_id, phone, status, leads(name, courses(name), campuses(name))")
      .eq("campaign_id", campaign_id)
      .eq("status", "pending");

    if (recipientsError) {
      console.error("Failed to fetch recipients:", recipientsError);
      await adminClient
        .from("whatsapp_campaigns")
        .update({ status: "failed" })
        .eq("id", campaign_id);
      return new Response(
        JSON.stringify({ error: "Failed to fetch recipients" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!recipients || recipients.length === 0) {
      await adminClient
        .from("whatsapp_campaigns")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", campaign_id);
      return new Response(
        JSON.stringify({ success: true, sent: 0, failed: 0, message: "No pending recipients" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let sentCount = 0;
    let failedCount = 0;

    // Static params filled once at campaign-creation time (see Lists UI).
    // Used to plug params that aren't per-lead — visit_date, fee amount,
    // due_date, application_id, etc. Auto-filled per-lead from the leads
    // join: student_name, course_name, campus_name.
    const staticParams: Record<string, string> = ((campaign as any).static_params || {}) as any;

    for (const recipient of recipients) {
      const lead = (recipient as any).leads || {};
      const leadName = lead.name || "Student";
      const courseName = lead.courses?.name || "";
      const campusName = lead.campuses?.name || "";
      const waPhone = recipient.phone.replace(/[^0-9]/g, "");

      // Build template params in the exact order Meta expects. Per-lead
      // values take precedence over staticParams (so an explicit
      // course_name override at campaign level still loses to the actual
      // course the lead enquired about — that's the desired behavior).
      const resolveParam = (name: string): string => {
        if (name === "student_name") return leadName;
        if (name === "course_name")  return courseName || staticParams[name] || "";
        if (name === "campus_name")  return campusName || staticParams[name] || "";
        return staticParams[name] || "";
      };
      const bodyParams = templateDef.params.map(p => ({ type: "text", text: resolveParam(p) }));

      try {
        const sendResult = await sendWhatsAppTemplate(adminClient, {
          route: "bulk",
          requireBulk: true,
        }, waPhone, {
          name: templateDef.name,
          language: "en",
          components: bodyParams.length > 0
            ? [{ type: "body", parameters: bodyParams }]
            : [],
        });

        if (sendResult.ok) {
          const messageId = sendResult.messageId;

          // Mark recipient as sent
          await adminClient
            .from("whatsapp_campaign_recipients")
            .update({
              status: "sent",
              message_id: messageId,
              sent_at: new Date().toISOString(),
            })
            .eq("id", recipient.id);

          // Log to whatsapp_messages for inbox visibility
          const { data: insertedMessage } = await adminClient.from("whatsapp_messages").insert({
            lead_id: recipient.lead_id || null,
            wa_message_id: messageId,
            direction: "outbound",
            phone: waPhone,
            message_type: "template",
            content: `[Campaign: ${campaign.name}] [Template: ${campaign.template_key.replace(/_/g, " ")}]`,
            template_key: campaign.template_key,
            status: "sent",
            is_read: true,
            provider: sendResult.provider,
            business_phone_number_id: sendResult.businessPhoneNumberId,
            business_phone_number: sendResult.businessNumber,
            sender_user_id: user.id,
          }).select("id").maybeSingle();

          await recordWhatsAppOutboundContext(adminClient, {
            messageId: insertedMessage?.id || null,
            providerMessageId: messageId,
            phone: waPhone,
            businessNumber: sendResult.businessNumber || sendResult.businessPhoneNumberId,
            provider: sendResult.provider,
            leadId: recipient.lead_id || null,
            campaignId: campaign_id,
            campaignRecipientId: recipient.id,
            templateKey: campaign.template_key,
            outboundKind: "bulk_campaign",
            expectedReplyType: expectedReplyTypeForTemplate(campaign.template_key),
            responsePolicy: "engine",
            metadata: {
              campaign_name: campaign.name,
              static_params: staticParams,
              sent_by_user_id: user.id,
            },
            expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          });

          // Log lead activity
          if (recipient.lead_id) {
            await adminClient.from("lead_activities").insert({
              lead_id: recipient.lead_id,
              user_id: user.id,
              type: "whatsapp",
              description: `WhatsApp campaign "${campaign.name}" — Template: ${campaign.template_key.replace(/_/g, " ")}`,
            });
          }

          sentCount++;
        } else {
          const errorMsg = sendResult.error || "Unknown WhatsApp channel error";
          console.error(`Failed to send to ${waPhone}:`, errorMsg);

          await adminClient
            .from("whatsapp_campaign_recipients")
            .update({
              status: "failed",
              error_message: errorMsg,
            })
            .eq("id", recipient.id);

          failedCount++;
        }
      } catch (sendErr: any) {
        console.error(`Exception sending to ${waPhone}:`, sendErr.message);

        await adminClient
          .from("whatsapp_campaign_recipients")
          .update({
            status: "failed",
            error_message: sendErr.message || "Network error",
          })
          .eq("id", recipient.id);

        failedCount++;
      }

      // 200ms delay between sends to avoid rate limiting
      await delay(200);
    }

    // Update campaign totals
    // Fetch current counts in case there were already some sent/failed from a previous run
    const { data: updatedCampaign } = await adminClient
      .from("whatsapp_campaigns")
      .select("sent_count, failed_count")
      .eq("id", campaign_id)
      .single();

    const totalSent = (updatedCampaign?.sent_count || 0) + sentCount;
    const totalFailed = (updatedCampaign?.failed_count || 0) + failedCount;

    await adminClient
      .from("whatsapp_campaigns")
      .update({
        sent_count: totalSent,
        failed_count: totalFailed,
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", campaign_id);

    return new Response(
      JSON.stringify({
        success: true,
        sent: sentCount,
        failed: failedCount,
        total_sent: totalSent,
        total_failed: totalFailed,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Campaign send error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
