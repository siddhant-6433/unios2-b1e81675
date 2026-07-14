import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260701100000_marketing_lists_assignment_and_notifications.sql",
  "utf8",
);
const engagementMigration = readFileSync(
  "supabase/migrations/20260701162000_campaign_engagement_metrics.sql",
  "utf8",
);
const marketingPage = readFileSync("src/pages/Marketing.tsx", "utf8");
const leadListsPage = readFileSync("src/pages/LeadLists.tsx", "utf8");
const whatsappSender = readFileSync("supabase/functions/whatsapp-campaign-send/index.ts", "utf8");
const whatsappWebhook = readFileSync("supabase/functions/whatsapp-webhook/index.ts", "utf8");
const emailSender = readFileSync("supabase/functions/email-campaign-send/index.ts", "utf8");

describe("marketing campaign reports and list assignment", () => {
  it("adds database support for list round-robin assignment and list calling reports", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.lead_list_assignment_batches");
    expect(migration).toContain("list_assignment_batch_id uuid REFERENCES public.lead_list_assignment_batches");
    expect(migration).toContain("'list_round_robin'");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.assign_lead_list_round_robin");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_lead_list_assignment_report");
    expect(migration).toContain("latest_call_disposition");
    expect(migration).toContain("latest_call_response");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.fn_notify_lead_assigned");
    expect(migration).toContain("SELECT p.user_id INTO v_counsellor_user_id");
  });

  it("tracks delivered/read campaign recipients and notifies campaign completion", () => {
    expect(migration).toContain("'delivered'");
    expect(migration).toContain("'read'");
    expect(migration).toContain("'campaign_completed'");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.notify_campaign_completed");
    expect(migration).toContain("trg_notify_whatsapp_campaign_completed");
    expect(migration).toContain("trg_notify_email_campaign_completed");
    expect(migration).toContain("WHERE ur.role = 'super_admin'::public.app_role");
    expect(migration).toContain("WHERE p.id = NEW.created_by");
  });

  it("updates WhatsApp campaign recipients from provider delivery callbacks", () => {
    expect(whatsappWebhook).toContain(".from(\"whatsapp_campaign_recipients\")");
    expect(whatsappWebhook).toContain(".eq(\"message_id\", waMessageId)");
    expect(whatsappWebhook).toContain("[\"sent\", \"delivered\", \"read\", \"failed\"]");
    expect(whatsappSender).toContain(".in(\"status\", [\"sent\", \"delivered\", \"read\"])");
  });

  it("adds campaign engagement metrics for responses, calls, links, and buttons", () => {
    expect(engagementMigration).toContain("response_count");
    expect(engagementMigration).toContain("called_count");
    expect(engagementMigration).toContain("link_click_count");
    expect(engagementMigration).toContain("button_click_count");
    expect(engagementMigration).toContain("responded_at");
    expect(engagementMigration).toContain("clicked_link_at");
    expect(engagementMigration).toContain("clicked_button_at");
    expect(engagementMigration).toContain("called_at");
    expect(engagementMigration).toContain("fn_mark_campaign_recipient_whatsapp_response");
    expect(engagementMigration).toContain("fn_mark_campaign_recipient_called");
    expect(engagementMigration).toContain("trg_mark_campaign_recipient_whatsapp_response");
    expect(engagementMigration).toContain("trg_mark_campaign_recipient_called");
    expect(whatsappWebhook).toContain("markCampaignRecipientEngagement");
    expect(whatsappWebhook).toContain("clicked_button_at");
    expect(whatsappWebhook).toContain("clicked_link_at");
  });

  it("makes Marketing the campaign hub and shows all recipient details", () => {
    expect(marketingPage).toContain("Marketing Hub");
    expect(marketingPage).toContain("Lists / Initiate New Campaign");
    expect(marketingPage).toContain("Executed Campaigns");
    expect(marketingPage).toContain("WhatsApp Preview");
    expect(marketingPage).toContain("Email Preview");
    expect(marketingPage).toContain("WhatsAppTemplatePreviewBubble");
    expect(marketingPage).toContain("body_html");
    expect(marketingPage).toContain("Insert list value");
    expect(marketingPage).toContain("EMAIL_LIST_VALUE_TOKENS");
    expect(marketingPage).toContain("latest_note");
    expect(marketingPage).toContain("setEmailInsertTarget");
    expect(marketingPage).toContain("Queue Campaign");
    expect(marketingPage).toContain("Campaign recipients");
    expect(marketingPage).toContain("openRecipients");
    expect(marketingPage).toContain("providerColumn");
    expect(marketingPage).toContain("downloadCampaignReport");
    expect(marketingPage).toContain("downloadRecipientReport");
    expect(marketingPage).toContain("Download CSV");
    expect(marketingPage).toContain("Responded");
    expect(marketingPage).toContain("Called");
    expect(marketingPage).toContain("Clicked link");
    expect(marketingPage).toContain("Clicked button");
    expect(marketingPage).toContain("response_count");
    expect(marketingPage).toContain("called_count");
    expect(marketingPage).toContain("link_click_count");
    expect(marketingPage).toContain("button_click_count");
    expect(marketingPage).toContain("responded_at");
    expect(marketingPage).toContain("clicked_button_title");
    expect(marketingPage).not.toContain("Failed recipients");
  });

  it("renders custom email list-value tokens per recipient", () => {
    expect(emailSender).toContain("lead_name");
    expect(emailSender).toContain("guardian_phone");
    expect(emailSender).toContain("latest_note");
    expect(emailSender).toContain("lead_notes(content, created_at)");
    expect(emailSender).toContain("\\{\\{\\s*([a-zA-Z0-9_]+)\\s*\\}\\}");
  });

  it("adds list assignment and list-level calling report controls", () => {
    expect(leadListsPage).toContain("Assign Round Robin");
    expect(leadListsPage).toContain("Assign \"{assignList?.name}\" to counsellors");
    expect(leadListsPage).toContain("get_lead_list_assignment_report");
    expect(leadListsPage).toContain("assign_lead_list_round_robin");
    expect(leadListsPage).toContain("Calling Report");
    expect(leadListsPage).toContain("latest_call_disposition");
    expect(leadListsPage).toContain("Marketing Hub");
    expect(leadListsPage).toContain("New Campaign");
  });
});
