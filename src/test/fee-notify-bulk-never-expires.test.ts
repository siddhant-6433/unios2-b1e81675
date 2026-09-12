import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const feeNotifyFn = readFileSync("supabase/functions/fee-notify-bulk/index.ts", "utf8");
const payLinkFn = readFileSync("supabase/functions/pay-link/index.ts", "utf8");
const feeNotifyPage = readFileSync("src/pages/FeeNotifications.tsx", "utf8");

describe("fee-notify-bulk never-expire links", () => {
  it("treats never_expires or expires_days=0 as a null payment_links.expires_at", () => {
    expect(feeNotifyFn).toContain("parsed.never_expires === true || Number(parsed.expires_days) === 0");
    expect(feeNotifyFn).toContain("expires_at: neverExpires ? null");
    expect(feeNotifyFn).toContain("expires_at: expiresAt");
    expect(feeNotifyFn).toContain('? "the fee is paid"');
  });

  it("does not clamp a never-expire send into the 1–365 day window", () => {
    expect(feeNotifyFn).toContain("const neverExpires = parsed.never_expires === true || Number(parsed.expires_days) === 0");
    expect(feeNotifyFn).toMatch(/const expiresDays = neverExpires\s*\n\s*\? 0/);
  });
});

describe("pay-link live fee + null expiry", () => {
  it("only expires a link when expires_at is set and in the past", () => {
    expect(payLinkFn).toContain("const isExpired = link.expires_at && new Date(link.expires_at) < new Date()");
  });

  it("recomputes late fines from the ledger at pay-time for live_fee links", () => {
    expect(payLinkFn).toContain('await admin.rpc("fn_recompute_late_fees", { _student_id: link.student_id })');
    expect(payLinkFn).toContain("if (link.live_fee && link.student_id)");
  });
});

describe("Fee Notifications indefinitely-active checkbox", () => {
  it("sends never_expires and expires_days=0 when the checkbox is on", () => {
    expect(feeNotifyPage).toContain("Keep link active indefinitely");
    expect(feeNotifyPage).toContain("expires_days: neverExpires ? 0 : expiresDays()");
    expect(feeNotifyPage).toContain("never_expires: neverExpires");
    expect(feeNotifyPage).toContain("disabled={neverExpires}");
  });
});
