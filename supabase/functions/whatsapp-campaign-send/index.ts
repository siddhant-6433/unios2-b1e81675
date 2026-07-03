import { createClient } from "npm:@supabase/supabase-js@2";
import { sendWhatsAppTemplate } from "../_shared/whatsapp-channel.ts";
import { expectedReplyTypeForTemplate } from "../_shared/whatsapp-outbound-context.ts";
import { recordOutboundConversationAction } from "../_shared/whatsapp-conversation-action.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CUET_2026_COUNSELLING_IMAGE_URL =
  "https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/whatsapp-media/template-assets/cuet_2026_counselling_open.jpeg";

type DynamicHeaderComponent =
  | { kind: "media"; format: "image" | "video" | "document"; paramName: string }
  | { kind: "text"; params: string[] };
type DynamicButtonComponent = { index: number; params: string[] };
type DynamicTemplateComponents = {
  header?: DynamicHeaderComponent;
  bodyParams: string[];
  buttons: DynamicButtonComponent[];
};
type TemplateDef = {
  name: string;
  params: string[];
  headerImageUrl?: string;
  dynamicComponents?: DynamicTemplateComponents;
};

// Same template definitions as whatsapp-send
const TEMPLATES: Record<string, TemplateDef> = {
  lead_welcome: { name: "lead_welcome", params: ["student_name", "course_name"] },
  visit_confirmation: { name: "visit_confirmation", params: ["student_name", "visit_date", "campus_name"] },
  visit_reminder_24hr: { name: "visit_reminder_24hr", params: ["student_name", "visit_date"] },
  // Internal key kept as `application_received`, but the Meta-approved
  // template is named `application_submitted` (see submit-wa-templates).
  application_received: { name: "application_submitted", params: ["student_name", "application_id"] },
  fee_reminder: { name: "fee_reminder", params: ["student_name", "amount", "due_date"] },
  admission_payment_nudge: { name: "admission_payment_nudge", params: ["student_name", "course_name", "an_amount", "year1_amount", "due_date"] },
  bpt_bmrit_cahet_deadline: { name: "bpt_bmrit_cahet_deadline", params: [] },
  cnet_not_qualified_bpt_bmrit: { name: "cnet_not_qualified_bpt_bmrit", params: ["student_name"] },
  cuet_2026_counselling_open: { name: "cuet_2026_counselling_open", params: [], headerImageUrl: CUET_2026_COUNSELLING_IMAGE_URL },
  cuet_counselling_booking: { name: "cuet_counselling_booking", params: [] },
  course_details: { name: "course_details", params: ["student_name", "course_name"] },
  counsellor_lead_assigned: { name: "counsellor_lead_assigned", params: ["counsellor_name", "lead_name", "lead_phone_last4", "sla_hours"] },
  counsellor_sla_warning: { name: "counsellor_sla_warning", params: ["lead_name", "hours_remaining"] },
  counsellor_lead_reclaimed: { name: "counsellor_lead_reclaimed", params: ["lead_name", "course_name"] },
  counsellor_visit_confirmation: { name: "counsellor_visit_confirmation", params: ["lead_name", "visit_date", "campus_name"] },
  counsellor_followup_overdue: { name: "counsellor_followup_overdue", params: ["lead_name", "followup_date"] },
};

const DEAR_STUDENT_NAME_TEMPLATES = new Set([
  "cnet_not_qualified_bpt_bmrit",
]);

function cleanPersonName(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.includes("@") ? "" : trimmed;
}

function stringifyForClassification(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function isSchoolRecipient(lead: any, application: any): boolean {
  if ((lead?.lead_institution_type || "").toLowerCase() === "school") return true;
  if ((application?.program_category || "").toLowerCase() === "school") return true;

  const haystack = [
    lead?.courses?.name,
    lead?.campuses?.name,
    application?.course_selections,
  ].map(stringifyForClassification).join(" ").toLowerCase();

  return /\b(school|beacon|mirai|nursery|kindergarten|grade|lkg|ukg|pyp|myp|cbse|icse)\b/.test(haystack);
}

function resolveLeadDisplayName(lead: any, application: any): string {
  return cleanPersonName(application?.full_name) || cleanPersonName(lead?.name) || "Student";
}

function resolveDearRecipientName(lead: any, application: any): string {
  const prefix = isSchoolRecipient(lead, application) ? "Parent" : "Applicant";
  const displayName = cleanPersonName(application?.full_name) || cleanPersonName(lead?.name);
  if (!displayName) return prefix;
  if (new RegExp(`^${prefix}\\b`, "i").test(displayName)) return displayName;
  return `${prefix} ${displayName}`;
}

function templateBodyFromComponents(components: unknown): string | null {
  if (!Array.isArray(components)) return null;
  const body = components.find((component) => {
    const data = component as Record<string, unknown>;
    return data.type === "BODY";
  }) as Record<string, unknown> | undefined;
  return typeof body?.text === "string" ? body.text : null;
}

function numberedPlaceholders(text: unknown): number[] {
  if (typeof text !== "string") return [];
  return [...new Set(
    [...text.matchAll(/\{\{(\d+)\}\}/g)]
      .map((match) => Number(match[1]))
      .filter((index) => Number.isFinite(index) && index > 0),
  )].sort((a, b) => a - b);
}

function bodyTemplateParamNames(components: unknown, placeholderCount?: unknown): string[] {
  const body = Array.isArray(components)
    ? components.find((component) => {
        const data = component as Record<string, unknown>;
        return data.type === "BODY";
      }) as Record<string, unknown> | undefined
    : undefined;
  const matches = numberedPlaceholders(body?.text);
  const maxIndex = Math.max(Number(placeholderCount || 0), ...matches, 0);
  return Array.from({ length: maxIndex }, (_value, index) => `template_value_${index + 1}`);
}

function dynamicTemplateComponents(
  components: unknown,
  placeholderCount?: unknown,
  fallbackHeaderFormat?: unknown,
): DynamicTemplateComponents {
  const rows = Array.isArray(components) ? components as Record<string, unknown>[] : [];
  const header = rows.find((component) => component.type === "HEADER");
  const headerFormat = String(header?.format || fallbackHeaderFormat || "").toUpperCase();
  const dynamicComponents: DynamicTemplateComponents = {
    bodyParams: bodyTemplateParamNames(components, placeholderCount),
    buttons: [],
  };

  if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat)) {
    dynamicComponents.header = {
      kind: "media",
      format: headerFormat.toLowerCase() as "image" | "video" | "document",
      paramName: "template_header_media_url",
    };
  } else {
    const headerParams = numberedPlaceholders(header?.text).map((position) => `template_header_value_${position}`);
    if (headerParams.length > 0) dynamicComponents.header = { kind: "text", params: headerParams };
  }

  const buttons = rows.find((component) => component.type === "BUTTONS");
  const buttonRows = Array.isArray(buttons?.buttons) ? buttons.buttons as Record<string, unknown>[] : [];
  buttonRows.forEach((button, index) => {
    if (button.type !== "URL" || typeof button.url !== "string" || !button.url.includes("{{")) return;
    const params = numberedPlaceholders(button.url).map((position) => `template_button_${index}_url_value_${position}`);
    if (params.length > 0) dynamicComponents.buttons.push({ index, params });
  });

  return dynamicComponents;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function syncCampaignCounts(admin: any, campaignId: string) {
  const [
    { count: totalSent },
    { count: totalFailed },
    { count: pendingCount },
  ] = await Promise.all([
    admin
      .from("whatsapp_campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .in("status", ["sent", "delivered", "read"]),
    admin
      .from("whatsapp_campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .in("status", ["failed", "skipped", "canceled"]),
    admin
      .from("whatsapp_campaign_recipients")
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

    const { campaign_id, batch_size } = await req.json();

    if (!campaign_id) {
      return new Response(
        JSON.stringify({ error: "campaign_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const batchSize = Math.max(1, Math.min(Number(batch_size) || 20, 50));

    // Validate auth. Browser/manual sends use a user JWT; cron/dispatcher sends
    // use CRON_SECRET or the service-role key and are attributed below.
    const authHeader = req.headers.get("Authorization") || "";
    const expectedCronSecret = Deno.env.get("CRON_SECRET") || "";
    const isTrustedWorker =
      (!!expectedCronSecret && req.headers.get("x-cron-secret") === expectedCronSecret) ||
      authHeader === `Bearer ${serviceRoleKey}`;

    let actorUserId: string | null = null;
    if (!isTrustedWorker) {
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
      actorUserId = user.id;
    }

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

    if (!actorUserId && campaign.created_by) {
      const { data: ownerProfile } = await adminClient
        .from("profiles")
        .select("user_id")
        .eq("id", campaign.created_by)
        .maybeSingle();
      actorUserId = (ownerProfile as any)?.user_id || null;
    }

    let dynamicTemplateBody: string | null = null;
    let templateDef = TEMPLATES[campaign.template_key];
    if (!templateDef) {
      const { data: dynamicTemplate, error: dynamicErr } = await adminClient
        .from("whatsapp_templates")
        .select("name, status, placeholder_count, has_media, header_format, components")
        .eq("name", campaign.template_key)
        .eq("status", "APPROVED")
        .maybeSingle();
      if (dynamicErr) console.error("Dynamic campaign template lookup failed:", dynamicErr.message);
      const canSendDynamic = !!dynamicTemplate;
      if (!canSendDynamic) {
        return new Response(
          JSON.stringify({ error: `Unknown template: ${campaign.template_key}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      dynamicTemplateBody = templateBodyFromComponents((dynamicTemplate as any).components);
      templateDef = {
        name: (dynamicTemplate as any).name,
        params: bodyTemplateParamNames((dynamicTemplate as any).components, (dynamicTemplate as any).placeholder_count),
        dynamicComponents: dynamicTemplateComponents(
          (dynamicTemplate as any).components,
          (dynamicTemplate as any).placeholder_count,
          (dynamicTemplate as any).header_format,
        ),
      };
    }

    if (campaign.status === "paused" || campaign.status === "terminated") {
      return new Response(JSON.stringify({
        success: true,
        done: campaign.status === "terminated",
        paused: campaign.status === "paused",
        terminated: campaign.status === "terminated",
        message: campaign.status === "terminated" ? "Campaign terminated before send" : "Campaign paused before send",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const campaignBusinessPhoneNumberId = campaign.business_phone_number_id || campaign.selected_business_phone_number_id || null;
    const campaignBusinessNumber = campaign.business_phone_number || null;

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
      .select("id, campaign_id, lead_id, phone, status, leads(name, lead_institution_type, courses(name), campuses(name))")
      .eq("campaign_id", campaign_id)
      .eq("status", "pending")
      .limit(batchSize);

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
      const counts = await syncCampaignCounts(adminClient, campaign_id);
      await adminClient
        .from("whatsapp_campaigns")
        .update({
          sent_count: counts.totalSent,
          failed_count: counts.totalFailed,
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", campaign_id);
      return new Response(
        JSON.stringify({
          success: true,
          sent: 0,
          failed: 0,
          total_sent: counts.totalSent,
          total_failed: counts.totalFailed,
          pending: counts.pendingCount,
          done: true,
          message: "No pending recipients",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let sentCount = 0;
    let failedCount = 0;

    const leadIds = Array.from(new Set(
      recipients
        .map((recipient: any) => recipient.lead_id)
        .filter((leadId: unknown): leadId is string => typeof leadId === "string" && leadId.length > 0)
    ));
    const latestApplicationByLeadId = new Map<string, any>();
    if (leadIds.length > 0) {
      const { data: applications, error: applicationsError } = await adminClient
        .from("applications")
        .select("lead_id, full_name, program_category, course_selections, created_at")
        .in("lead_id", leadIds)
        .order("created_at", { ascending: false });
      if (applicationsError) {
        console.error("Failed to fetch recipient applications:", applicationsError.message);
      } else {
        for (const application of applications || []) {
          if (application?.lead_id && !latestApplicationByLeadId.has(application.lead_id)) {
            latestApplicationByLeadId.set(application.lead_id, application);
          }
        }
      }
    }

    // Static params filled once at campaign-creation time (see Lists UI).
    // Used to plug params that aren't per-lead — visit_date, fee amount,
    // due_date, application_id, etc. Auto-filled per-lead from the leads
    // join: student_name, course_name, campus_name.
    const staticParams: Record<string, string> = ((campaign as any).static_params || {}) as any;

    for (const recipient of recipients) {
      const lead = (recipient as any).leads || {};
      const latestApplication = latestApplicationByLeadId.get((recipient as any).lead_id);
      const leadName = resolveLeadDisplayName(lead, latestApplication);
      const dearLeadName = resolveDearRecipientName(lead, latestApplication);
      const courseName = lead.courses?.name || "";
      const campusName = lead.campuses?.name || "";
      const waPhone = recipient.phone.replace(/[^0-9]/g, "");

      // Build template params in the exact order Meta expects. Per-lead
      // values take precedence over staticParams (so an explicit
      // course_name override at campaign level still loses to the actual
      // course the lead enquired about — that's the desired behavior).
      const resolveParam = (name: string): string => {
        if (name === "student_name") {
          return DEAR_STUDENT_NAME_TEMPLATES.has(campaign.template_key) ? dearLeadName : leadName;
        }
        if (name === "course_name")  return courseName || staticParams[name] || "";
        if (name === "campus_name")  return campusName || staticParams[name] || "";
        return staticParams[name] || "";
      };
      const bodyParams = templateDef.params.map(p => ({ type: "text", text: resolveParam(p) }));
      const components: any[] = [];
      if (templateDef.headerImageUrl) {
        components.push({
          type: "header",
          parameters: [{ type: "image", image: { link: templateDef.headerImageUrl } }],
        });
      }
      if (templateDef.dynamicComponents?.header) {
        const header = templateDef.dynamicComponents.header;
        if (header.kind === "media") {
          const mediaUrl = resolveParam(header.paramName);
          components.push({
            type: "header",
            parameters: [{ type: header.format, [header.format]: { link: mediaUrl } }],
          });
        } else {
          components.push({
            type: "header",
            parameters: header.params.map((param) => ({ type: "text", text: resolveParam(param) })),
          });
        }
      }
      if (bodyParams.length > 0) {
        components.push({ type: "body", parameters: bodyParams });
      }
      for (const button of templateDef.dynamicComponents?.buttons || []) {
        components.push({
          type: "button",
          sub_type: "url",
          index: String(button.index),
          parameters: button.params.map((param) => ({ type: "text", text: resolveParam(param) })),
        });
      }

      try {
        const { data: liveCampaign } = await adminClient
          .from("whatsapp_campaigns")
          .select("status")
          .eq("id", campaign_id)
          .single();
        if (liveCampaign?.status === "paused" || liveCampaign?.status === "terminated") {
          const finalCampaign = liveCampaign;
          const counts = await syncCampaignCounts(adminClient, campaign_id);
          await adminClient
            .from("whatsapp_campaigns")
            .update({
              sent_count: counts.totalSent,
              failed_count: counts.totalFailed,
            })
            .eq("id", campaign_id);
          return new Response(JSON.stringify({
            success: true,
            done: finalCampaign.status === "terminated",
            paused: finalCampaign.status === "paused",
            terminated: finalCampaign.status === "terminated",
            message: finalCampaign.status === "terminated" ? "Campaign terminated before send" : "Campaign paused before send",
            ...counts,
          }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const sendResult = await (sendWhatsAppTemplate as any)(adminClient, {
          route: "bulk",
          requireBulk: true,
          businessPhoneNumberId: campaignBusinessPhoneNumberId,
          businessNumber: campaignBusinessNumber,
        }, waPhone, {
          name: templateDef.name,
          language: "en",
          components,
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

          const resolvedParams = templateDef.params.map(resolveParam);
          const readableContent = dynamicTemplateBody || `[Campaign: ${campaign.name}] [Template: ${campaign.template_key.replace(/_/g, " ")}]`;
          await recordOutboundConversationAction(adminClient, {
            kind: "campaignSend",
            phone: waPhone,
            leadId: recipient.lead_id || null,
            content: readableContent,
            messageType: "template",
            templateKey: campaign.template_key,
            status: "sent",
            userId: actorUserId,
            sendResult,
            outboundKind: "bulk_campaign",
            expectedReplyType: expectedReplyTypeForTemplate(campaign.template_key),
            responsePolicy: "engine",
            campaignId: campaign_id,
            campaignRecipientId: recipient.id,
            metadata: {
              campaign_name: campaign.name,
              static_params: staticParams,
              sent_by_user_id: actorUserId,
              sent_by_profile_id: campaign.created_by || null,
              params: resolvedParams,
            },
            renderMetadata: {
              key: campaign.template_key,
              label: campaign.template_key.replace(/_/g, " "),
              body: readableContent,
              params: resolvedParams,
              provider_template_name: templateDef.name,
              language: "en",
              campaign_name: campaign.name,
            },
            expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            activityDescription: recipient.lead_id
              ? `WhatsApp campaign "${campaign.name}" — Template: ${campaign.template_key.replace(/_/g, " ")}`
              : null,
          });

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
    const finalCampaign = await adminClient
      .from("whatsapp_campaigns")
      .select("status")
      .eq("id", campaign_id)
      .single()
      .then(({ data }) => data);
    if (finalCampaign?.status === "paused" || finalCampaign?.status === "terminated") {
      const counts = await syncCampaignCounts(adminClient, campaign_id);
      await adminClient
        .from("whatsapp_campaigns")
        .update({
          sent_count: counts.totalSent,
          failed_count: counts.totalFailed,
        })
        .eq("id", campaign_id);
      return new Response(JSON.stringify({
        success: true,
        done: finalCampaign.status === "terminated",
        paused: finalCampaign.status === "paused",
        terminated: finalCampaign.status === "terminated",
        message: finalCampaign.status === "terminated" ? "Campaign terminated before send" : "Campaign paused before send",
        ...counts,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const counts = await syncCampaignCounts(adminClient, campaign_id);
    const done = counts.pendingCount === 0;

    await adminClient
      .from("whatsapp_campaigns")
      .update({
        sent_count: counts.totalSent,
        failed_count: counts.totalFailed,
        status: done ? "completed" : "sending",
        completed_at: done ? new Date().toISOString() : null,
      })
      .eq("id", campaign_id);

    return new Response(
      JSON.stringify({
        success: true,
        sent: sentCount,
        failed: failedCount,
        total_sent: counts.totalSent,
        total_failed: counts.totalFailed,
        pending: counts.pendingCount,
        done,
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
