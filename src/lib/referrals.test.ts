import { describe, it, expect } from "vitest";
import { referralStatusBadge, referralStatusLabel, summarizeReferrals, type ReferralRow } from "@/lib/referrals";

const row = (status: string): ReferralRow => ({
  id: status, referrer_user_id: "u1", applicant_id: null, candidate_name: "Cand",
  candidate_phone: null, candidate_email: null, job_opening_id: null,
  note: null, status, created_at: "2026-01-01T00:00:00Z",
});

describe("referrals", () => {
  it("badges known statuses and falls back to muted", () => {
    expect(referralStatusBadge("hired")).toContain("pastel-green");
    expect(referralStatusBadge("invited")).toContain("pastel-yellow");
    expect(referralStatusBadge("weird")).toContain("muted");
  });

  it("labels statuses", () => {
    expect(referralStatusLabel("applied")).toBe("Applied");
    expect(referralStatusLabel("expired")).toBe("Expired");
  });

  it("summarizes by status", () => {
    const s = summarizeReferrals([row("invited"), row("applied"), row("applied"), row("hired")]);
    expect(s).toEqual({ total: 4, invited: 1, applied: 2, hired: 1 });
  });
});
