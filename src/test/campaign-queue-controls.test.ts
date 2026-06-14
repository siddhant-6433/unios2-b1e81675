import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260619114500_campaign_queue_controls.sql", "utf8");
const whatsappSender = readFileSync("supabase/functions/whatsapp-campaign-send/index.ts", "utf8");
const emailSender = readFileSync("supabase/functions/email-campaign-send/index.ts", "utf8");
const leadLists = readFileSync("src/pages/LeadLists.tsx", "utf8");

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
  it("exposes queue controls in the lead-list campaign queue", () => {
    expect(leadLists).toContain("Campaign Queue");
    expect(leadLists).toContain("pauseCampaign");
    expect(leadLists).toContain("resumeCampaign");
    expect(leadLists).toContain("terminateCampaign");
    expect(leadLists).toContain("whatsapp-campaign-send");
    expect(leadLists).toContain("email-campaign-send");
  });
});
