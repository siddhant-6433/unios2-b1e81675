import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260619114500_campaign_queue_controls.sql", "utf8");
const whatsappSender = readFileSync("supabase/functions/whatsapp-campaign-send/index.ts", "utf8");
const emailSender = readFileSync("supabase/functions/email-campaign-send/index.ts", "utf8");
const leadLists = readFileSync("src/pages/LeadLists.tsx", "utf8");
const marketingPage = readFileSync("src/pages/Marketing.tsx", "utf8");

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
    expect(leadLists).toContain("919667691872");
    expect(leadLists).toContain("917428499849");
    expect(leadLists).toContain("919555192192");
  });

  it("can load enabled zero-parameter approved templates dynamically", () => {
    expect(leadLists).toContain("dynamicWaBulkTemplates");
    expect(leadLists).toContain("availableWaBulkTemplates");
    expect(leadLists).toContain('from("whatsapp_templates")');
    expect(leadLists).toContain("row.placeholder_count === 0");
    expect(leadLists).toContain("hasDynamicUrlButton");
  });
});
