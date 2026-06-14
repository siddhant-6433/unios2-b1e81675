import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const leadLists = readFileSync("src/pages/LeadLists.tsx", "utf8");
const bulkTemplates = readFileSync("src/config/waBulkTemplates.ts", "utf8");
const whatsappCampaignSender = readFileSync("supabase/functions/whatsapp-campaign-send/index.ts", "utf8");

describe("bulk WhatsApp approved-template safety", () => {
  it("shows the actual approved Meta template body before a list campaign can be sent", () => {
    expect(leadLists).toContain("Approved Meta template preview");
    expect(leadLists).toContain("whatsapp-templates");
    expect(leadLists).toContain("waApprovedBody");
    expect(leadLists).toContain("waApprovedIssue");
    expect(leadLists).toContain("Approved params");
    expect(leadLists).toContain("Sender params");
  });

  it("maps internal template keys to the exact Meta template name used at send time", () => {
    expect(bulkTemplates).toContain('metaTemplateName: "application_submitted"');
    expect(bulkTemplates).toContain('metaTemplateName: "bpt_bmrit_cahet_deadline_v2"');
    expect(bulkTemplates).toContain('metaTemplateName: "bsc_nursing_cnet_deadline_v1"');
    expect(bulkTemplates).toContain('name: "deadline_date"');
    expect(bulkTemplates).toContain("requiredApprovedBodyPattern");
    expect(bulkTemplates).toContain("blockedApprovedBodyPattern");
  });

  it("blocks deadline campaigns if Meta still has old approved copy", () => {
    expect(whatsappCampaignSender).toContain("validateApprovedTemplateBeforeSend");
    expect(whatsappCampaignSender).toContain("validateCampaignStaticParams");
    expect(whatsappCampaignSender).toContain("bpt_bmrit_cahet_deadline_v2");
    expect(whatsappCampaignSender).toContain("bsc_nursing_cnet_deadline_v1");
    expect(whatsappCampaignSender).toContain("DEADLINE_TEMPLATE_KEYS");
    expect(whatsappCampaignSender).toContain("deadline_date");
    expect(whatsappCampaignSender).toContain("fetchApprovedTemplateBody");
    expect(whatsappCampaignSender).toContain("old 5 June deadline");
    expect(whatsappCampaignSender).toContain("{{1}} for the campaign deadline value");
    expect(whatsappCampaignSender).toContain('status: "paused"');
  });
});
