import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_ENGAGED_OR,
  campaignEngagedInboxPath,
  campaignHasEngaged,
  campaignPhoneLookupValues,
  conversationMatchesEngagedPhones,
  engagedPhoneDigitSet,
  fetchCampaignRecipientsByEngagement,
  isCampaignEngaged,
  matchesRecipientEngagementFilter,
  recipientEngagementOrFilter,
} from "@/lib/campaignEngaged";

const marketingPage = readFileSync("src/pages/Marketing.tsx", "utf8");
const inbox = readFileSync("src/pages/WhatsAppInbox.tsx", "utf8");

describe("campaign engaged leads", () => {
  it("treats a reply, call, or click as engaged", () => {
    expect(isCampaignEngaged({})).toBe(false);
    expect(isCampaignEngaged({ respondedAt: "2026-09-03T04:00:00Z" })).toBe(true);
    expect(isCampaignEngaged({ calledAt: "2026-09-03T04:00:00Z" })).toBe(true);
    expect(isCampaignEngaged({ clickedLinkAt: "2026-09-03T04:00:00Z" })).toBe(true);
    expect(isCampaignEngaged({ clickedButtonAt: "2026-09-03T04:00:00Z" })).toBe(true);
    expect(campaignHasEngaged({ responded: 5, called: 0, clickedLink: 0, clickedButton: 1 })).toBe(true);
    expect(campaignHasEngaged({ responded: 0, called: 0, clickedLink: 0, clickedButton: 0 })).toBe(false);
  });

  it("filters recipient rows by engagement kind", () => {
    const replied = { respondedAt: "2026-09-03T04:00:00Z" };
    const clicked = { clickedButtonAt: "2026-09-03T04:00:00Z" };
    expect(matchesRecipientEngagementFilter(replied, "all")).toBe(true);
    expect(matchesRecipientEngagementFilter(replied, "engaged")).toBe(true);
    expect(matchesRecipientEngagementFilter(replied, "responded")).toBe(true);
    expect(matchesRecipientEngagementFilter(replied, "clicked")).toBe(false);
    expect(matchesRecipientEngagementFilter(clicked, "clicked")).toBe(true);
    expect(matchesRecipientEngagementFilter(clicked, "called")).toBe(false);
  });

  it("builds the PostgREST or-filter the inbox and export share", () => {
    expect(recipientEngagementOrFilter("engaged")).toBe(CAMPAIGN_ENGAGED_OR);
    expect(CAMPAIGN_ENGAGED_OR).toContain("responded_at.not.is.null");
    expect(CAMPAIGN_ENGAGED_OR).toContain("clicked_button_at.not.is.null");
    expect(recipientEngagementOrFilter("clicked")).toContain("clicked_link_at");
  });

  it("matches campaign phones to conversation phones across 91-prefix variants", () => {
    expect(campaignPhoneLookupValues("+91 98765 43210")).toEqual(
      expect.arrayContaining(["919876543210", "9876543210"]),
    );
    const engaged = engagedPhoneDigitSet(["919876543210"]);
    expect(conversationMatchesEngagedPhones("9876543210", engaged)).toBe(true);
    expect(conversationMatchesEngagedPhones("919876543210", engaged)).toBe(true);
    expect(conversationMatchesEngagedPhones("919111111111", engaged)).toBe(false);
  });

  it("deep-links the inbox with campaign id instead of a phone list", () => {
    expect(campaignEngagedInboxPath("camp-1")).toBe(
      "/whatsapp-inbox?campaign=camp-1&engaged=1&inbox=all",
    );
  });

  it("lets Marketing export engaged leads and open the filtered inbox", () => {
    expect(marketingPage).toContain("Export engaged");
    expect(marketingPage).toContain("Open in inbox");
    expect(marketingPage).toContain("campaignEngagedInboxPath");
    expect(marketingPage).toContain("fetchCampaignRecipientsByEngagement");
    expect(marketingPage).toContain('key: "engaged" as const, label: "Engaged"');
    expect(marketingPage).toContain("downloadEngagedLeads");
  });

  it("loads only engaged campaign phones in the WhatsApp inbox", () => {
    expect(inbox).toContain('searchParams.get("engaged") === "1"');
    expect(inbox).toContain("fetchEngagedCampaignPhones");
    expect(inbox).toContain("isCampaignEngagedInbox");
    expect(inbox).toContain("Showing engaged leads");
    expect(inbox).toContain("conversationMatchesEngagedPhones");
  });

  it("pages through every engaged recipient instead of stopping at 500", async () => {
    const pages = [
      Array.from({ length: 500 }, (_, i) => ({ phone: `91${String(i).padStart(10, "0")}` })),
      [{ phone: "919999999999" }],
    ];
    let calls = 0;
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            or: () => ({
              order: () => ({
                range: async () => ({ data: pages[calls++] || [], error: null }),
              }),
            }),
          }),
        }),
      }),
    };
    const rows = await fetchCampaignRecipientsByEngagement(client, "whatsapp", "camp-1", "engaged");
    expect(rows).toHaveLength(501);
    expect(calls).toBe(2);
  });
});
