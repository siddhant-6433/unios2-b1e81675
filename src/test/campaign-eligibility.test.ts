import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUIET_DAYS,
  filterCampaignRecipients,
  isHardBlockedStage,
} from "@/lib/campaignEligibility";
import {
  evaluateTemplateQualityForBulk,
  normalizeTemplateQuality,
} from "@/lib/campaignTemplateQuality";

const sender = readFileSync("supabase/functions/whatsapp-campaign-send/index.ts", "utf8");
const leadLists = readFileSync("src/pages/LeadLists.tsx", "utf8");
const marketing = readFileSync("src/pages/Marketing.tsx", "utf8");

describe("campaign eligibility (DNC + quality)", () => {
  const now = new Date("2026-07-15T12:00:00.000Z");

  it("always hard-excludes DNC regardless of other options", () => {
    const result = filterCampaignRecipients(
      [
        { id: "1", phone: "919999999999", stage: "dnc" },
        { id: "2", phone: "918888888888", stage: "new" },
        { id: "3", phone: "917777777777", stage: "DNC" },
      ],
      { channel: "whatsapp", excludeCold: false, quietDays: 0, now },
    );
    expect(result.eligible.map((l) => l.id)).toEqual(["2"]);
    expect(result.counts.dnc).toBe(2);
    expect(result.preview).toContain("DNC");
    expect(isHardBlockedStage("dnc")).toBe(true);
  });

  it("excludes cold by default and recent marketing contacts", () => {
    const last = new Map([
      ["warm-recent", "2026-07-14T12:00:00.000Z"],
      ["warm-old", "2026-07-01T12:00:00.000Z"],
    ]);
    const result = filterCampaignRecipients(
      [
        { id: "cold-1", phone: "911111111111", stage: "cold" },
        { id: "warm-recent", phone: "912222222222", stage: "contacted" },
        { id: "warm-old", phone: "913333333333", stage: "contacted" },
        { id: "no-phone", phone: "", stage: "new" },
      ],
      {
        channel: "whatsapp",
        quietDays: DEFAULT_QUIET_DAYS,
        lastMarketingAtByLeadId: last,
        now,
      },
    );
    expect(result.eligible.map((l) => l.id)).toEqual(["warm-old"]);
    expect(result.counts.cold).toBe(1);
    expect(result.counts.recentContact).toBe(1);
    expect(result.counts.noContact).toBe(1);
  });

  it("blocks RED templates for bulk and allows GREEN", () => {
    expect(normalizeTemplateQuality({ score: "GREEN" })).toBe("GREEN");
    expect(evaluateTemplateQualityForBulk("GREEN").allowBulk).toBe(true);
    expect(evaluateTemplateQualityForBulk("YELLOW").warn).toBe(true);
    expect(evaluateTemplateQualityForBulk("RED").allowBulk).toBe(false);
  });

  it("worker skips DNC at send time", () => {
    expect(sender).toContain('=== "dnc"');
    expect(sender).toContain("Lead is DNC — message not sent");
    expect(sender).toContain('status: "skipped"');
  });

  it("Lead Lists and Marketing wire eligibility + quality UI", () => {
    expect(leadLists).toContain("filterCampaignRecipients");
    expect(leadLists).toContain("DNC is always excluded");
    expect(leadLists).toContain("evaluateTemplateQualityForBulk");
    expect(leadLists).toContain("waTemplateQuality.allowBulk");
    expect(marketing).toContain("filterCampaignRecipients");
    expect(marketing).toContain("DNC is always excluded");
    expect(marketing).toContain("evaluateTemplateQualityForBulk");
  });
});
