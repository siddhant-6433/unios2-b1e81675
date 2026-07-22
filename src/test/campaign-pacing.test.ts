import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { buildCampaignPacePlan, DEFAULT_DAILY_UNIQUE_CAP } from "@/lib/campaignPacing";

const migration = readFileSync(
  "supabase/migrations/20260714180000_whatsapp_campaign_pacing.sql",
  "utf8",
);
const sender = readFileSync("supabase/functions/whatsapp-campaign-send/index.ts", "utf8");
const leadLists = readFileSync("src/pages/LeadLists.tsx", "utf8");
const marketing = readFileSync("src/pages/Marketing.tsx", "utf8");

describe("campaign pacing (Meta unique-user waves)", () => {
  it("builds waves of daily_unique_cap spaced ~24h apart", () => {
    const start = new Date("2026-07-15T10:00:00.000Z");
    const plan = buildCampaignPacePlan({
      recipientCount: 4500,
      sendMode: "paced",
      dailyUniqueCap: 2000,
      startAt: start,
    });
    expect(plan.sendMode).toBe("paced");
    expect(plan.dailyUniqueCap).toBe(2000);
    expect(plan.waveCount).toBe(3);
    expect(plan.eligibleAtByIndex).toHaveLength(4500);
    expect(plan.eligibleAtByIndex[0]).toBe(start.toISOString());
    expect(plan.eligibleAtByIndex[1999]).toBe(start.toISOString());
    expect(new Date(plan.eligibleAtByIndex[2000]).getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(new Date(plan.eligibleAtByIndex[4000]).getTime() - start.getTime()).toBe(2 * 24 * 60 * 60 * 1000);
    expect(plan.preview).toContain("3 wave");
  });

  it("immediate mode marks everyone eligible at start", () => {
    const start = new Date("2026-07-15T10:00:00.000Z");
    const plan = buildCampaignPacePlan({
      recipientCount: 100,
      sendMode: "immediate",
      startAt: start,
    });
    expect(plan.sendMode).toBe("immediate");
    expect(plan.waveCount).toBe(1);
    expect(plan.eligibleAtByIndex.every((t) => t === start.toISOString())).toBe(true);
  });

  it("defaults daily cap for Meta tier-friendly batches", () => {
    expect(DEFAULT_DAILY_UNIQUE_CAP).toBe(2000);
  });

  it("schema and worker respect eligible_at", () => {
    expect(migration).toContain("eligible_at");
    expect(migration).toContain("send_mode");
    expect(migration).toContain("daily_unique_cap");
    expect(sender).toContain('lte("eligible_at"');
    expect(sender).toContain("waiting_for_eligible_at");
    expect(sender).toContain("No recipients eligible yet");
  });

  it("Lead Lists and Marketing expose pace-over-days UI", () => {
    expect(leadLists).toContain("Pace over days");
    expect(leadLists).toContain("buildCampaignPacePlan");
    expect(leadLists).toContain("eligible_at");
    expect(marketing).toContain("Pace over days");
    expect(marketing).toContain("buildCampaignPacePlan");
  });
});
