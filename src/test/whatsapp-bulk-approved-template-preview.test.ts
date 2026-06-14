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
    expect(bulkTemplates).toContain("requiredApprovedBodyPattern");
    expect(bulkTemplates).toContain("blockedApprovedBodyPattern");
  });

  it("blocks the CAHET deadline campaign if Meta still has old approved copy", () => {
    expect(whatsappCampaignSender).toContain("validateApprovedTemplateBeforeSend");
    expect(whatsappCampaignSender).toContain("fetchApprovedTemplateBody");
    expect(whatsappCampaignSender).toContain("old 5 June deadline");
    expect(whatsappCampaignSender).toContain("14 June 2026 deadline");
    expect(whatsappCampaignSender).toContain('status: "paused"');
  });
});
