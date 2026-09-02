import { describe, expect, it } from "vitest";
import { campaignHealth, countdownTo, campaignProgressPct, isCampaignTerminal } from "@/lib/campaignHealth";

// A paced campaign sits at status='pending' between daily waves for hours. That
// looked identical in the UI to a campaign stranded by a lost finalisation
// write — both showed a bare "pending"/"scheduled" badge. These cases pin the
// distinction, which is drawn from the recipient queue, not the campaign status.
const base = {
  status: "pending",
  nextAttemptAt: null as string | null,
  workerError: null as string | null,
  pendingRecipients: 0,
  dueNow: 0,
  nextEligibleAt: null as string | null,
  sent: 0,
  total: 0,
};

const NOW = new Date("2026-09-01T14:00:00.000Z").getTime();
const inHours = (h: number) => new Date(NOW + h * 3600_000).toISOString();
const agoMin = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe("campaignHealth", () => {
  it("distinguishes a paced wave from a stall", () => {
    const paced = campaignHealth(
      { ...base, pendingRecipients: 3249, dueNow: 0, nextEligibleAt: inHours(20) },
      NOW,
    );
    expect(paced.label).toBe("Paced");
    expect(paced.detail).toContain("3,249 queued");
    expect(paced.detail).toContain("next");
  });

  it("reports Sending now when recipients are actually due", () => {
    const h = campaignHealth(
      { ...base, pendingRecipients: 500, dueNow: 412, nextEligibleAt: agoMin(5) },
      NOW,
    );
    expect(h.label).toBe("Live");
    expect(h.detail).toContain("412 due");
  });

  it("flags a campaign locked in sending with work left as Stalled", () => {
    const h = campaignHealth(
      { ...base, status: "sending", pendingRecipients: 120, nextAttemptAt: agoMin(45) },
      NOW,
    );
    expect(h.label).toBe("Stalled");
  });

  it("does not call a freshly-claimed sending campaign stalled", () => {
    const h = campaignHealth(
      { ...base, status: "sending", pendingRecipients: 120, nextAttemptAt: agoMin(1) },
      NOW,
    );
    expect(h.label).toBe("Live");
  });

  it("shows Wrapping up when nothing is pending but status lags", () => {
    // The exact state that stranded four campaigns: 0 pending, still 'sending'.
    expect(campaignHealth({ ...base, status: "sending", pendingRecipients: 0 }, NOW).label)
      .toBe("Wrapping up");
    expect(campaignHealth({ ...base, status: "pending", pendingRecipients: 0 }, NOW).label)
      .toBe("Wrapping up");
  });

  it("keeps terminal states plain", () => {
    // BSP-standard vocabulary (AiSensy/Interakt/WATI): Sent / Stopped / Live.
    expect(campaignHealth({ ...base, status: "completed" }, NOW).label).toBe("Sent");
    expect(campaignHealth({ ...base, status: "terminated" }, NOW).label).toBe("Stopped");
    expect(campaignHealth({ ...base, status: "paused", pendingRecipients: 9 }, NOW).detail).toBe("9 left");
  });

  it("surfaces the worker error on a failed campaign", () => {
    const h = campaignHealth({ ...base, status: "failed", workerError: "Meta 131042" }, NOW);
    expect(h.label).toBe("Failed");
    expect(h.detail).toBe("Meta 131042");
  });

  it("falls back to Scheduled for a future attempt with no queue data", () => {
    const h = campaignHealth({ ...base, pendingRecipients: 10, nextAttemptAt: inHours(5) }, NOW);
    expect(h.label).toBe("Scheduled");
  });

  it("counts down to the next wave and goes null once due", () => {
    expect(countdownTo(inHours(4.2), NOW)).toBe("4h 12m");
    expect(countdownTo(inHours(30), NOW)).toBe("1d 6h");
    expect(countdownTo(new Date(NOW + 45_000).toISOString(), NOW)).toBe("45s");
    // Due or past-due → no countdown, the progress line takes over.
    expect(countdownTo(agoMin(5), NOW)).toBeNull();
    expect(countdownTo(null, NOW)).toBeNull();
  });

  it("computes progress without dividing by zero", () => {
    expect(campaignProgressPct(1240, 4000)).toBe(31);
    expect(campaignProgressPct(0, 0)).toBe(0);
    expect(campaignProgressPct(9, 4)).toBe(100); // never over 100
  });

  it("knows which campaigns still need polling", () => {
    expect(isCampaignTerminal("completed")).toBe(true);
    expect(isCampaignTerminal("terminated")).toBe(true);
    expect(isCampaignTerminal("pending")).toBe(false);
    expect(isCampaignTerminal("sending")).toBe(false);
    expect(isCampaignTerminal("paused")).toBe(false); // resumable → keep watching
  });
});
