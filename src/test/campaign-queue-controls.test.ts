import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260619114500_campaign_queue_controls.sql", "utf8");
const cronAuthMigration = readFileSync("supabase/migrations/20260624100100_campaign_queue_controls_and_cron_auth.sql", "utf8");
const dispatcherTimeoutMigration = readFileSync("supabase/migrations/20260701093100_extend_marketing_dispatcher_timeout.sql", "utf8");
const campaignDispatcher = readFileSync("supabase/functions/campaign-dispatcher/index.ts", "utf8");
const whatsappSender = readFileSync("supabase/functions/whatsapp-campaign-send/index.ts", "utf8");
const emailSender = readFileSync("supabase/functions/email-campaign-send/index.ts", "utf8");
const leadLists = readFileSync("src/pages/LeadLists.tsx", "utf8");
const marketingPage = readFileSync("src/pages/Marketing.tsx", "utf8");
const bulkTemplates = readFileSync("src/config/waBulkTemplates.ts", "utf8");
const whatsappTemplateMeta = readFileSync("src/lib/whatsappTemplateMeta.ts", "utf8");
const waCampaignParams = readFileSync("src/lib/waCampaignParams.ts", "utf8");

describe("campaign queue controls", () => {
  it("adds database states for paused and terminated campaign queues", () => {
    expect(migration).toContain("whatsapp_campaigns_status_check");
    expect(migration).toContain("'paused'");
    expect(migration).toContain("'terminated'");
    expect(migration).toContain("whatsapp_campaign_recipients_status_check");
    expect(migration).toContain("'canceled'");
    expect(migration).toContain("email_campaigns_status_check");
    expect(migration).toContain("email_campaign_recipients_status_check");
  });

  it("stops senders when a queue is paused or terminated mid-run", () => {
    for (const sender of [whatsappSender, emailSender]) {
      expect(sender).toContain('status === "paused"');
      expect(sender).toContain('status === "terminated"');
      expect(sender).toContain("Campaign terminated before send");
      expect(sender).toContain("syncCampaignCounts");
      expect(sender).toContain("finalCampaign");
    }
  });

  it("lets the background dispatcher drain WhatsApp queues in bounded worker batches", () => {
    expect(whatsappSender).toContain("x-cron-secret");
    expect(whatsappSender).toContain("isTrustedWorker");
    expect(whatsappSender).toContain('authHeader === `Bearer ${serviceRoleKey}`');
    expect(whatsappSender).toContain("const batchSize = Math.max");
    expect(whatsappSender).toContain(".limit(batchSize)");
    expect(whatsappSender).toContain("const done = counts.pendingCount === 0");
    expect(whatsappSender).toContain('status: done ? "completed" : "sending"');
  });

  it("exposes queue controls in Marketing Hub executed campaigns", () => {
    expect(marketingPage).toContain("Executed Campaigns");
    expect(marketingPage).toContain("pauseCampaign");
    expect(marketingPage).toContain("resumeCampaign");
    expect(marketingPage).toContain("terminateCampaign");
    expect(marketingPage).toContain("campaign-dispatcher");
    expect(marketingPage).toContain('status: "paused"');
    expect(marketingPage).toContain('status: "terminated"');
    expect(leadLists).toContain("New Campaign");
    expect(leadLists).toContain("Marketing Hub");
  });

  it("keeps the bulk WhatsApp send dialog usable on short screens", () => {
    expect(leadLists).toContain("max-h-[90vh]");
    expect(leadLists).toContain("overflow-y-auto px-6 py-4");
    expect(leadLists).toContain("knownBulkSenderOptions");
    expect(leadLists).toContain("919667641872");
    expect(leadLists).toContain("917428499849");
    expect(leadLists).toContain("919555192192");
  });

  it("can load enabled approved templates dynamically for bulk campaigns", () => {
    expect(leadLists).toContain("dynamicWaBulkTemplates");
    expect(leadLists).toContain("availableWaBulkTemplates");
    expect(leadLists).toContain('from("whatsapp_template_settings")');
    expect(leadLists).toContain('from("whatsapp_templates")');
    expect(leadLists).toContain("const approvedTemplateByName = new Map");
    expect(leadLists).toContain("enrichApprovedWhatsAppTemplateMetadata");
    expect(leadLists).toContain(".filter((setting) => setting.template_key && !knownKeys.has(setting.template_key))");
    expect(leadLists).toContain("Meta details are not available locally");
    expect(leadLists).toContain("dynamicWaTemplateParams(row.components, row.placeholder_count)");
    expect(marketingPage).toContain('from("whatsapp_template_settings")');
    expect(marketingPage).toContain("const approvedTemplateByName = new Map");
    expect(marketingPage).toContain("enrichApprovedWhatsAppTemplateMetadata");
    expect(marketingPage).toContain(".filter((setting) => setting.template_key && !knownKeys.has(setting.template_key))");
    expect(marketingPage).toContain("Meta details are not available locally");
    expect(marketingPage).toContain("dynamicWaTemplateParams(row.components, row.placeholder_count)");
    expect(whatsappTemplateMeta).toContain('invokeEdge<{ templates?: MetaTemplateRow[] }>("whatsapp-templates"');
    expect(whatsappTemplateMeta).toContain('body: { action: "list" }');
    expect(bulkTemplates).toContain("template_header_media_url");
    expect(bulkTemplates).toContain("template_button_${buttonIndex}_url_value_${position}");
    expect(whatsappSender).toContain("dynamicTemplateComponents");
    expect(whatsappSender).toContain("bodyTemplateParamNames");
    expect(whatsappSender).toContain('sub_type: "url"');
    expect(whatsappSender).toContain("placeholder_count");
    expect(whatsappSender).toContain("fetchApprovedMetaCampaignTemplate");
    expect(whatsappSender).toContain("message_templates?fields=");
    expect(whatsappSender).toContain('onConflict: "name,language"');
  });

  it("supports mapped template variables and scheduled campaign starts", () => {
    expect(waCampaignParams).toContain('WA_PARAM_MAPPING_PREFIX = "__lead_field__:"');
    expect(waCampaignParams).toContain('name === "template_value_1" ? encodeWaParamFieldMapping("student_name")');
    expect(waCampaignParams).toContain("Object.prototype.hasOwnProperty.call(params, name)");
    expect(waCampaignParams).toContain("waBodyPreviewParams");
    expect(marketingPage).toContain("campaignScheduleMode");
    expect(marketingPage).toContain("DatePickerField");
    expect(marketingPage).toContain('type="time"');
    expect(marketingPage).toContain("defaultFutureDateTime");
    expect(marketingPage).toContain("next_attempt_at: nextAttemptAt");
    expect(marketingPage).toContain("campaignDisplayStatus");
    expect(marketingPage).toContain("scheduled");
    expect(marketingPage).toContain("effectiveWaParamValue(waStaticParams, field.name)");
    expect(marketingPage).toContain("selectedWaTemplateDefaultMediaUrl");
    expect(marketingPage).toContain("Override header media URL");
    expect(marketingPage).toContain("Use list column:");
    expect(leadLists).toContain("waScheduleMode");
    expect(leadLists).toContain("emailScheduleMode");
    expect(leadLists).toContain("resolveCampaignNextAttemptAt");
    expect(leadLists).toContain("sm:grid-cols-[170px_240px]");
    expect(leadLists).toContain("waTemplateDefaultMediaUrl");
    expect(leadLists).toContain("Use list column:");
    expect(whatsappSender).toContain('WA_PARAM_MAPPING_PREFIX = "__lead_field__:"');
    expect(whatsappSender).toContain("defaultUrl?: string | null");
    expect(whatsappSender).toContain("templateMediaUrlFromComponents");
    expect(whatsappSender).toContain("resolveMappedCampaignField");
    expect(whatsappSender).toContain("lead?.phone");
  });

  it("keeps scheduled campaigns pending until cron claims due work", () => {
    expect(cronAuthMigration).toContain("CREATE OR REPLACE FUNCTION public.claim_due_marketing_campaigns");
    expect(cronAuthMigration).toContain("coalesce(c.next_attempt_at, now()) <= now()");
    expect(cronAuthMigration).toContain("SELECT cron.schedule(");
    expect(cronAuthMigration).toContain("'marketing-campaign-dispatcher'");
    expect(cronAuthMigration).toContain("'* * * * *'");
    expect(cronAuthMigration).toContain("'x-cron-secret'");
    expect(dispatcherTimeoutMigration).toContain("timeout_milliseconds := 55000");
    expect(campaignDispatcher).toContain('admin.rpc("claim_due_marketing_campaigns"');
    expect(campaignDispatcher).toContain('next_attempt_at: payload?.done ? null : new Date(Date.now() + 60 * 1000).toISOString()');
    expect(campaignDispatcher).toContain('next_attempt_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()');
  });

  it("exposes the enabled admission payment nudge in Marketing Hub bulk campaigns", () => {
    expect(marketingPage).toContain("WA_BULK_TEMPLATES");
    expect(leadLists).toContain("WA_BULK_TEMPLATES");
    expect(bulkTemplates).toContain('key: "admission_payment_nudge"');
    expect(whatsappSender).toContain("admission_payment_nudge");
    expect(whatsappSender).toContain('"an_amount"');
    expect(whatsappSender).toContain('"year1_amount"');
  });

  it("exposes the enabled admission payment nudge in Marketing Hub bulk campaigns", () => {
    expect(marketingPage).toContain("WA_BULK_TEMPLATES");
    expect(leadLists).toContain("WA_BULK_TEMPLATES");
    expect(bulkTemplates).toContain('key: "admission_payment_nudge"');
    expect(whatsappSender).toContain("admission_payment_nudge");
    expect(whatsappSender).toContain('"an_amount"');
    expect(whatsappSender).toContain('"year1_amount"');
  });
});
