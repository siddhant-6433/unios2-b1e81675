import { describe, it, expect } from "vitest";
import {
  EXPENSE_STATUSES,
  canEditClaim,
  canL1,
  canL2,
  canReimburse,
  canSendToZoho,
  canSubmit,
  formatInr,
  needsCorrection,
  reimbursementLabel,
  reviewStage,
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
  it("covers the full two-stage lifecycle the DB CHECK allows", () => {
    expect([...EXPENSE_STATUSES].sort()).toEqual(
      [
        "approved",
        "cancelled",
        "changes_requested",
        "draft",
        "pending_superadmin",
        "reimbursed",
        "rejected",
        "submitted",
        "synced_to_zoho",
      ],
    );
  });
});

describe("statusBadge", () => {
  it("maps each known status to a pastel pill", () => {
    expect(statusBadge("submitted")).toContain("bg-pastel-yellow");
    expect(statusBadge("pending_superadmin")).toContain("bg-pastel-yellow");
    expect(statusBadge("changes_requested")).toContain("bg-pastel-orange");
    expect(statusBadge("approved")).toContain("bg-pastel-green");
    expect(statusBadge("rejected")).toContain("bg-pastel-red");
    expect(statusBadge("reimbursed")).toContain("bg-pastel-blue");
    expect(statusBadge("synced_to_zoho")).toContain("bg-pastel-blue");
    expect(statusBadge("draft")).toContain("bg-muted");
  });

  it("never returns undefined for an unexpected status", () => {
    expect(statusBadge("mystery")).toContain("bg-muted");
  });
});

describe("statusLabel", () => {
  it("gives a friendly label for the new statuses", () => {
    expect(statusLabel("submitted")).toBe("Pending L1");
    expect(statusLabel("pending_superadmin")).toBe("Pending final");
    expect(statusLabel("changes_requested")).toBe("Changes requested");
    expect(statusLabel("synced_to_zoho")).toBe("Sent to Zoho");
    expect(statusLabel("reimbursed")).toBe("Reimbursed");
  });

  it("capitalises an unknown status and de-underscores it", () => {
    expect(statusLabel("some_new_status")).toBe("Some new status");
    expect(statusLabel("")).toBe("");
  });
});

describe("reimbursementLabel", () => {
  it("names each mode", () => {
    expect(reimbursementLabel("payroll")).toBe("Payroll");
    expect(reimbursementLabel("zoho")).toBe("Zoho vendor payment");
    expect(reimbursementLabel("bank_transfer")).toBe("Bank transfer");
    expect(reimbursementLabel(null)).toBe("");
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

describe("canEditClaim / canSubmit", () => {
  it("lets the submitter edit a draft or a correction", () => {
    expect(canEditClaim(claim({ status: "draft" }), "user-1")).toBe(true);
    expect(canEditClaim(claim({ status: "changes_requested" }), "user-1")).toBe(true);
    expect(canSubmit(claim({ status: "draft" }), "user-1")).toBe(true);
    expect(canSubmit(claim({ status: "changes_requested" }), "user-1")).toBe(true);
  });

  it("locks the claim once it is in review or decided", () => {
    for (const status of [
      "submitted",
      "pending_superadmin",
      "approved",
      "synced_to_zoho",
      "reimbursed",
      "rejected",
      "cancelled",
    ] as const) {
      expect(canEditClaim(claim({ status }), "user-1")).toBe(false);
      expect(canSubmit(claim({ status }), "user-1")).toBe(false);
    }
  });

  it("never lets someone else edit the claim", () => {
    expect(canEditClaim(claim({ status: "draft" }), "user-2")).toBe(false);
    expect(canEditClaim(claim({ status: "draft" }), null)).toBe(false);
    expect(canEditClaim(null, "user-1")).toBe(false);
  });
});

describe("reviewStage / canL1 / canL2", () => {
  const base = { status: "submitted" as const, l1_reviewer: "manager-1" };

  it("puts a directly-assigned L1 claim with its reviewer, even without an HR perm", () => {
    expect(reviewStage(base, "manager-1", {})).toBe("l1");
    expect(canL1(base, "manager-1", false)).toBe(true);
  });

  it("shows every L1 claim to an HR approver as the fallback reviewer", () => {
    expect(reviewStage(base, "hr-1", { canApproveL1: true })).toBe("l1");
    expect(canL1(base, "hr-1", true)).toBe(true);
  });

  it("hides an unassigned L1 claim from someone with no L1 power", () => {
    expect(reviewStage(base, "other", {})).toBe("none");
    expect(canL1(base, "other", false)).toBe(false);
  });

  it("routes pending_superadmin to the final approver only", () => {
    const row = { status: "pending_superadmin" as const, l1_reviewer: "manager-1" };
    expect(reviewStage(row, "super-1", { canApproveL2: true })).toBe("l2");
    expect(reviewStage(row, "manager-1", { canApproveL1: true })).toBe("none");
    expect(canL2(row, true)).toBe(true);
    expect(canL2(row, false)).toBe(false);
  });

  it("returns none for decided rows and null", () => {
    expect(reviewStage({ status: "approved", l1_reviewer: "manager-1" }, "manager-1", { canApproveL1: true, canApproveL2: true })).toBe("none");
    expect(reviewStage(null, "manager-1", { canApproveL1: true })).toBe("none");
  });
});

describe("canSendToZoho / canReimburse", () => {
  it("allows a final approver to push an approved, unsynced claim", () => {
    const row = { status: "approved" as const, zoho_bill_id: null, zoho_sync_error: null };
    expect(canSendToZoho(row, true)).toBe(true);
    expect(canSendToZoho(row, false)).toBe(false);
    expect(canSendToZoho({ status: "approved", zoho_bill_id: "b1", zoho_sync_error: null }, true)).toBe(false);
    expect(canSendToZoho({ status: "synced_to_zoho", zoho_bill_id: null, zoho_sync_error: "boom" }, true)).toBe(true);
  });

  it("only lets a reimburser pay approved / synced claims", () => {
    expect(canReimburse({ status: "approved" }, true)).toBe(true);
    expect(canReimburse({ status: "synced_to_zoho" }, true)).toBe(true);
    expect(canReimburse({ status: "submitted" }, true)).toBe(false);
    expect(canReimburse({ status: "approved" }, false)).toBe(false);
    expect(canReimburse(null, true)).toBe(false);
  });

  it("flags a claim awaiting employee correction", () => {
    expect(needsCorrection({ status: "changes_requested" })).toBe(true);
    expect(needsCorrection({ status: "submitted" })).toBe(false);
    expect(needsCorrection(null)).toBe(false);
  });
});

describe("summarizeClaims", () => {
  const claims = [
    claim({ status: "draft", amount: 100 }),
    claim({ status: "submitted", amount: 500 }),
    claim({ status: "pending_superadmin", amount: 700 }),
    claim({ status: "changes_requested", amount: 250 }),
    claim({ status: "approved", amount: 1200 }),
    claim({ status: "synced_to_zoho", amount: 800 }),
    claim({ status: "reimbursed", amount: 2000 }),
    claim({ status: "rejected", amount: 300 }),
    claim({ status: "cancelled", amount: 999 }),
  ];

  it("totals every claim and buckets the new stages", () => {
    const s = summarizeClaims(claims);
    expect(s.total).toBe(6849);
    expect(s.pending).toBe(1200);
    expect(s.changesRequested).toBe(250);
    expect(s.approved).toBe(2000);
    expect(s.syncedToZoho).toBe(800);
    expect(s.reimbursed).toBe(2000);
    expect(s.rejected).toBe(300);
    expect(s.draft).toBe(100);
  });

  it("is all zeros for an empty list", () => {
    expect(summarizeClaims([])).toEqual({
      total: 0,
      pending: 0,
      changesRequested: 0,
      approved: 0,
      syncedToZoho: 0,
      reimbursed: 0,
      rejected: 0,
      draft: 0,
    });
  });

  it("coerces numeric-as-string amounts from Postgres", () => {
    const s = summarizeClaims([{ status: "submitted", amount: "1500.50" }]);
    expect(s.total).toBe(1500.5);
    expect(s.pending).toBe(1500.5);
  });
});
