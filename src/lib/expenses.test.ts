import { describe, it, expect } from "vitest";
import {
  EXPENSE_STATUSES,
  canEditClaim,
  formatInr,
  statusBadge,
  statusLabel,
  summarizeClaims,
  type ExpenseClaim,
} from "./expenses";

const claim = (over: Partial<ExpenseClaim> = {}): Pick<ExpenseClaim, "submitted_by" | "status" | "amount"> => ({
  submitted_by: "user-1",
  status: "submitted",
  amount: 1000,
  ...over,
});

describe("EXPENSE_STATUSES", () => {
  it("covers the full lifecycle the DB CHECK allows", () => {
    expect([...EXPENSE_STATUSES].sort()).toEqual(
      ["approved", "cancelled", "draft", "reimbursed", "rejected", "submitted"],
    );
  });
});

describe("statusBadge", () => {
  it("maps each known status to a pastel pill", () => {
    expect(statusBadge("submitted")).toContain("bg-pastel-yellow");
    expect(statusBadge("approved")).toContain("bg-pastel-green");
    expect(statusBadge("rejected")).toContain("bg-pastel-red");
    expect(statusBadge("reimbursed")).toContain("bg-pastel-blue");
    expect(statusBadge("draft")).toContain("bg-muted");
  });

  it("never returns undefined for an unexpected status", () => {
    expect(statusBadge("mystery")).toContain("bg-muted");
  });
});

describe("statusLabel", () => {
  it("capitalises the status for display", () => {
    expect(statusLabel("submitted")).toBe("Submitted");
    expect(statusLabel("reimbursed")).toBe("Reimbursed");
    expect(statusLabel("")).toBe("");
  });
});

describe("formatInr", () => {
  it("groups in the Indian numbering system", () => {
    expect(formatInr(0)).toBe("0");
    expect(formatInr(1500)).toBe("1,500");
    expect(formatInr(1234567)).toBe("12,34,567");
  });

  it("keeps up to two decimals and tolerates string/numeric input", () => {
    expect(formatInr(1500.5)).toBe("1,500.5");
    expect(formatInr("1234.25")).toBe("1,234.25");
    expect(formatInr(null)).toBe("0");
  });
});

describe("canEditClaim", () => {
  it("lets the submitter edit while the claim is in flight", () => {
    expect(canEditClaim(claim({ status: "draft" }), "user-1")).toBe(true);
    expect(canEditClaim(claim({ status: "submitted" }), "user-1")).toBe(true);
  });

  it("locks the claim once a decision has been made", () => {
    for (const status of ["approved", "rejected", "reimbursed", "cancelled"] as const) {
      expect(canEditClaim(claim({ status }), "user-1")).toBe(false);
    }
  });

  it("never lets someone else edit the claim", () => {
    expect(canEditClaim(claim(), "user-2")).toBe(false);
    expect(canEditClaim(claim(), null)).toBe(false);
    expect(canEditClaim(null, "user-1")).toBe(false);
  });
});

describe("summarizeClaims", () => {
  const claims = [
    claim({ status: "submitted", amount: 500 }),
    claim({ status: "approved", amount: 1200 }),
    claim({ status: "approved", amount: 800 }),
    claim({ status: "reimbursed", amount: 2000 }),
    claim({ status: "rejected", amount: 300 }),
    claim({ status: "cancelled", amount: 999 }),
    claim({ status: "draft", amount: 111 }),
  ];

  it("totals every claim and buckets the decided ones", () => {
    const s = summarizeClaims(claims);
    expect(s.total).toBe(5910);
    expect(s.pending).toBe(500);
    expect(s.approved).toBe(2000);
    expect(s.reimbursed).toBe(2000);
    expect(s.rejected).toBe(300);
  });

  it("is all zeros for an empty list", () => {
    expect(summarizeClaims([])).toEqual({
      total: 0, pending: 0, approved: 0, reimbursed: 0, rejected: 0,
    });
  });

  it("coerces numeric-as-string amounts from Postgres", () => {
    const s = summarizeClaims([{ status: "submitted", amount: "1500.50" }]);
    expect(s.total).toBe(1500.5);
    expect(s.pending).toBe(1500.5);
  });
});
