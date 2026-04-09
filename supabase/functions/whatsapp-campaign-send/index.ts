import { createClient } from "npm:@supabase/supabase-js@2";

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
  application_received: { name: "application_received", params: ["student_name", "application_id"] },
  fee_reminder: { name: "fee_reminder", params: ["student_name", "amount", "due_date"] },
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
    const whatsappToken = Deno.env.get("WHATSAPP_API_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

    if (!whatsappToken || !phoneNumberId) {
      return new Response(
        JSON.stringify({ error: "WhatsApp API not configured. Contact administrator." }),
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

    // Fetch all pending recipients, joined with leads for name
    const { data: recipients, error: recipientsError } = await adminClient
      .from("whatsapp_campaign_recipients")
      .select("id, campaign_id, lead_id, phone, status, leads(name)")
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

    for (const recipient of recipients) {
      const leadName = (recipient as any).leads?.name || "Student";
      const waPhone = recipient.phone.replace(/[^0-9]/g, "");

      // Build template params — use lead name as the first param
      // The first param for most templates is the student/lead name
      const bodyParams = [{ type: "text", text: leadName }];

      const waPayload: any = {
        messaging_product: "whatsapp",
        to: waPhone,
        type: "template",
        template: {
          name: templateDef.name,
          language: { code: "en" },
          ...(bodyParams.length > 0
            ? { components: [{ type: "body", parameters: bodyParams }] }
            : {}),
        },
      };

      try {
        const waResponse = await fetch(
          `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${whatsappToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(waPayload),
          }
        );

        const waResult = await waResponse.json();

        if (waResponse.ok) {
          const messageId = waResult?.messages?.[0]?.id || null;

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
          await adminClient.from("whatsapp_messages").insert({
            lead_id: recipient.lead_id || null,
            wa_message_id: messageId,
            direction: "outbound",
            phone: waPhone,
            message_type: "template",
            content: `[Campaign: ${campaign.name}] [Template: ${campaign.template_key.replace(/_/g, " ")}]`,
            template_key: campaign.template_key,
            status: "sent",
            is_read: true,
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
          const errorMsg = waResult?.error?.message || "Unknown Meta API error";
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
