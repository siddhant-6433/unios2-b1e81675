import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  campaignMemberToLead,
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

  it("hard-excludes academic-partner leads not shared with NIMT", () => {
    const result = filterCampaignRecipients(
      [
        { id: "private", phone: "919999999999", stage: "new", shared_with_nimt: false },
        { id: "shared", phone: "918888888888", stage: "new", shared_with_nimt: true },
        { id: "default", phone: "917777777777", stage: "new" },
      ],
      { channel: "whatsapp", excludeCold: false, quietDays: 0, now },
    );
    expect(result.eligible.map((l) => l.id)).toEqual(["shared", "default"]);
    expect(result.counts.notShared).toBe(1);
    expect(result.preview).toContain("not shared with NIMT");
  });

  it("guards the campaign send path against not-shared leads", () => {
    expect(sender).toContain("shared_with_nimt");
    expect(sender).toContain("Lead not shared with NIMT — message not sent");
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

describe("polymorphic list members (leads + marketing contacts)", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");

  // Regression: the marketing_contacts split made lead_list_members polymorphic,
  // and every campaign path normalised a contact with `shared_with_nimt: false`.
  // That value means "academic-partner private" and is a hard exclusion, so 100%
  // of bulk-imported members were silently dropped — a 4,000-member list enrolled
  // 1 recipient. A contact has no partner and must never carry that flag.
  const members = [
    { lead_id: "lead-1", contact_id: null, leads: { id: "lead-1", phone: "919000000001", stage: "new" }, marketing_contacts: null },
    { lead_id: "lead-dnc", contact_id: null, leads: { id: "lead-dnc", phone: "919000000002", stage: "dnc" }, marketing_contacts: null },
    { lead_id: null, contact_id: "c-plain", leads: null, marketing_contacts: { id: "c-plain", phone: "919000000003", opted_out: false, promoted_lead_id: null } },
    { lead_id: null, contact_id: "c-optout", leads: null, marketing_contacts: { id: "c-optout", phone: "919000000004", opted_out: true, promoted_lead_id: null } },
    { lead_id: null, contact_id: "c-promoted", leads: null, marketing_contacts: { id: "c-promoted", phone: "919000000005", opted_out: false, promoted_lead_id: "lead-9" } },
  ];

  it("keeps plain marketing contacts eligible for WhatsApp", () => {
    const raw = members.map((m) => campaignMemberToLead(m, "whatsapp")).filter((l) => l && l.id);
    const result = filterCampaignRecipients(raw as never[], {
      channel: "whatsapp", excludeCold: false, quietDays: 0, now,
    });
    expect(result.eligible.map((l) => l.id)).toEqual(["lead-1", "c-plain"]);
    expect(result.counts.notShared).toBe(0);
    expect(result.counts.dnc).toBe(1);
  });

  it("never tags a contact shared_with_nimt: false", () => {
    const contact = campaignMemberToLead(members[2], "whatsapp");
    expect(contact?.shared_with_nimt).not.toBe(false);
    expect(contact?.isContact).toBe(true);
  });

  it("drops opted-out and already-promoted contacts", () => {
    expect(campaignMemberToLead(members[3], "whatsapp")).toBeNull();
    expect(campaignMemberToLead(members[4], "whatsapp")).toBeNull();
  });

  it("maps the email field for email campaigns", () => {
    const m = { lead_id: null, contact_id: "c", leads: null, marketing_contacts: { id: "c", email: "a@b.com", opted_out: false, promoted_lead_id: null } };
    expect(campaignMemberToLead(m, "email")?.email).toBe("a@b.com");
  });

  it("no campaign path re-introduces the shared_with_nimt: false placeholder", () => {
    for (const [name, src] of [["Marketing.tsx", marketing], ["LeadLists.tsx", leadLists], ["whatsapp-campaign-send", sender]] as const) {
      expect(src, name).not.toContain("shared_with_nimt: false");
    }
  });

  it("every list-member fetch joins marketing_contacts", () => {
    for (const [name, src] of [["Marketing.tsx", marketing], ["LeadLists.tsx", leadLists]] as const) {
      const selects = src.match(/"lead_id[^"]*"/g) || [];
      expect(selects.length, `${name} has no lead_list_members select`).toBeGreaterThan(0);
      for (const sel of selects) expect(sel, name).toContain("marketing_contacts");
    }
  });
});
